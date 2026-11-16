import {
  merchantSpki,
  adminSpkiB64,
  sealShipping,
  openAsBuyer,
  openAsMerchant,
  openAsAdmin,
} from "./crypto.js";

// ── minimal wallet-signature stand-in (65 bytes, deterministic) ──
const mkSigner = (seed) => ({
  async signMessage(msg) {
    const data = new TextEncoder().encode(seed + "|" + msg);
    const h = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
    const out = new Uint8Array(65);
    out.set(h, 0);
    out.set(h, 32);
    out[64] = 27;
    return "0x" + [...out].map((b) => b.toString(16).padStart(2, "0")).join("");
  },
});

const adminAcc = "0xAD00000000000000000000000000000000000001";
const merchantAcc = "0x5A10000000000000000000000000000000000001";
const buyerAcc = "0x0B01000000000000000000000000000000000001";
const strangerAcc = "0xBAD0000000000000000000000000000000000001";

const adminS = mkSigner("admin-seed");
const merchantS = mkSigner("merchant-seed");
const buyerS = mkSigner("buyer-seed");
const strangerS = mkSigner("stranger-seed");

const record = {
  receiver: "张三",
  phone: "13800138000",
  address: "广东省深圳市南山区科技园 1 号 A 座 1801 室",
  note: "工作日送达",
};

const adminPub = await adminSpkiB64(adminS, adminAcc);
const merchantPub = await merchantSpki(merchantS, merchantAcc);
console.log("admin    SPKI b64 len:", adminPub.length, "(expect 124)");
console.log("merchant SPKI bytes  :", merchantPub.length, "(expect 91)");

const blob = await sealShipping(buyerS, buyerAcc, record, merchantPub, adminPub);
console.log("payload bytes        :", blob.length, "| version:", blob[0], "| flags:", blob[1]);
console.log("chunks (2048)        :", Math.ceil(blob.length / 2048));

// Every legitimate party must open it; a stranger must not.
const asBuyer = await openAsBuyer(buyerS, buyerAcc, blob);
const asMerchant = await openAsMerchant(merchantS, merchantAcc, blob);
const asAdmin = await openAsAdmin(adminS, adminAcc, blob);

const eq = (x) => JSON.stringify(x) === JSON.stringify(record);
console.log("buyer   opens        :", eq(asBuyer));
console.log("merchant opens       :", eq(asMerchant));
console.log("admin   opens        :", eq(asAdmin));

let strangerBlocked = false;
try {
  await openAsMerchant(strangerS, strangerAcc, blob);
} catch {
  strangerBlocked = true;
}
console.log("stranger blocked     :", strangerBlocked);

// Determinism: the same wallet on another device derives the same key.
const again = await sealShipping(buyerS, buyerAcc, record, merchantPub, adminPub);
console.log("merchant re-derives  :", JSON.stringify(await openAsMerchant(mkSigner("merchant-seed"), merchantAcc, again)) === JSON.stringify(record));

// Capacity: how long an address fits in one 2048-byte chunk.
let maxAddr = 0;
for (let len = 0; len < 3000; len += 1) {
  const probe = { ...record, address: "A".repeat(len) };
  const out = await sealShipping(buyerS, buyerAcc, probe, merchantPub, adminPub);
  if (out.length <= 2048) maxAddr = len;
  else break;
}
console.log("max address in 1 chunk:", maxAddr, "chars");

const ok =
  eq(asBuyer) && eq(asMerchant) && eq(asAdmin) && strangerBlocked && adminPub.length === 124 && merchantPub.length === 91;
console.log(ok ? "ALL OK" : "FAILED");
process.exit(ok ? 0 : 1);
