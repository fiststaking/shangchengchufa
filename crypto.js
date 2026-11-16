// PII envelope -- ECIES with a wallet-derived key.
//
// Ported from the V1 front-end so existing merchant/admin/buyer keys stay valid: the same signature
// messages and HKDF labels produce the same keys, which means a merchant who already registered a
// public key under V1 can still decrypt there and here.
//
// Why derive from a signature: WebCrypto cannot import a P-256 private key from a bare scalar (it
// requires x/y), and a wallet never hands out its private key. A deterministic signature is therefore
// the only way to get "same key on any device" without asking the user to back anything up.
//
// Layout of the sealed payload (raw bytes, stored on chain as-is):
//   [0]        version (2)
//   [1]        flags: bit0 = admin copy present, bit1 = supplier copy present
//   [2..14]    iv (12) for the payload ciphertext
//   [14..]     admin box   (65 epk + 12 iv + 48 ct)  if flag bit0
//              supplier box(65 epk + 12 iv + 48 ct)  if flag bit1
//   [..]       payload ciphertext (AES-GCM of the UTF-8 JSON record)
//
// The buyer holds the data key (KEK) directly. The admin and supplier boxes are ECIES-wrapped copies
// of that same KEK, so one payload serves all three without paying a full ciphertext per recipient.

const VERSION = 2;
const FLAG_ADMIN = 1;
const FLAG_SUPPLIER = 2;
const HDR = 2 + 12;
const BOX = 65 + 12 + 48;
const BOX_ADMIN_OFF = HDR;
const BOX_SUPPLIER_OFF = HDR + BOX;

const EC = { name: "ECDH", namedCurve: "P-256" };

function b64(u8) {
  let bin = "";
  const a = new Uint8Array(u8);
  for (let i = 0; i < a.length; i++) bin += String.fromCharCode(a[i]);
  return btoa(bin);
}

function unb64(s) {
  const bin = atob(String(s));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ─────────────────────────────────────────────────────────────
//  P-256 scalar arithmetic (BigInt, Jacobian). ~1.6ms per multiply.
// ─────────────────────────────────────────────────────────────
const P256 = (function () {
  const P = 0xffffffff00000001000000000000000000000000ffffffffffffffffffffffffn;
  const N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
  const A = P - 3n;
  const GX = 0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296n;
  const GY = 0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5n;
  const SPKI_PREFIX = [
    0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01, 0x06, 0x08, 0x2a,
    0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, 0x03, 0x42, 0x00, 0x04,
  ];

  const mod = (x, m) => {
    const r = x % m;
    return r < 0n ? r + m : r;
  };

  function inv(a, m) {
    let oldR = mod(a, m);
    let r = m;
    let oldS = 1n;
    let s = 0n;
    while (r !== 0n) {
      const q = oldR / r;
      const t1 = oldR - q * r;
      oldR = r;
      r = t1;
      const t2 = oldS - q * s;
      oldS = s;
      s = t2;
    }
    if (oldR !== 1n) throw new Error("p256: not invertible");
    return mod(oldS, m);
  }

  const dbl = (X, Y, Z) => {
    if (Z === 0n || Y === 0n) return [0n, 1n, 0n];
    const YY = mod(Y * Y, P);
    const S = mod(4n * X * YY, P);
    const M = mod(3n * X * X + A * mod(mod(Z * Z, P) * mod(Z * Z, P), P), P);
    const X3 = mod(M * M - 2n * S, P);
    const Y3 = mod(M * (S - X3) - 8n * YY * YY, P);
    const Z3 = mod(2n * Y * Z, P);
    return [X3, Y3, Z3];
  };

  const add = (p1, p2) => {
    const [X1, Y1, Z1] = p1;
    const [X2, Y2, Z2] = p2;
    if (Z1 === 0n) return p2;
    if (Z2 === 0n) return p1;
    const Z1Z1 = mod(Z1 * Z1, P);
    const Z2Z2 = mod(Z2 * Z2, P);
    const U1 = mod(X1 * Z2Z2, P);
    const U2 = mod(X2 * Z1Z1, P);
    const S1 = mod(Y1 * Z2 * Z2Z2, P);
    const S2 = mod(Y2 * Z1 * Z1Z1, P);
    if (U1 === U2) return S1 !== S2 ? [0n, 1n, 0n] : dbl(X1, Y1, Z1);
    const H = mod(U2 - U1, P);
    const I = mod(4n * H * H, P);
    const J = mod(H * I, P);
    const r = mod(2n * (S2 - S1), P);
    const V = mod(U1 * I, P);
    const X3 = mod(r * r - J - 2n * V, P);
    const Y3 = mod(r * (V - X3) - 2n * S1 * J, P);
    const Z3 = mod((mod((Z1 + Z2) * (Z1 + Z2), P) - Z1Z1 - Z2Z2) * H, P);
    return [X3, Y3, Z3];
  };

  const toAffine = (X, Y, Z) => {
    if (Z === 0n) throw new Error("p256: infinity");
    const zi = inv(Z, P);
    const zi2 = mod(zi * zi, P);
    return [mod(X * zi2, P), mod(Y * zi2 * zi, P)];
  };

  function mul(k, pt) {
    const base = pt || [GX, GY];
    let acc = [0n, 1n, 0n];
    let cur = [base[0], base[1], 1n];
    let e = mod(k, N);
    while (e > 0n) {
      if (e & 1n) acc = add(acc, cur);
      cur = dbl(cur[0], cur[1], cur[2]);
      e >>= 1n;
    }
    return toAffine(acc[0], acc[1], acc[2]);
  }

  const bytes32 = (v) => {
    const h = v.toString(16).padStart(64, "0");
    const out = new Uint8Array(32);
    for (let i = 0; i < 32; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
    return out;
  };

  const bytesToBigInt = (u8) => {
    let v = 0n;
    for (let i = 0; i < u8.length; i++) v = (v << 8n) | BigInt(u8[i]);
    return v;
  };

  return {
    N,
    modN: (v) => mod(v, N),
    /** SPKI DER (91 bytes) for a scalar. */
    spkiFromScalar(k) {
      const [x, y] = mul(k);
      const out = new Uint8Array(91);
      out.set(SPKI_PREFIX, 0);
      out.set(bytes32(x), 27);
      out.set(bytes32(y), 59);
      return out;
    },
    /** ECDH shared X coordinate: k * Q. */
    sharedX(k, epkBytes) {
      const x = bytesToBigInt(epkBytes.slice(1, 33));
      const y = bytesToBigInt(epkBytes.slice(33, 65));
      const [sx] = mul(k, [x, y]);
      return bytes32(sx);
    },
  };
})();

// ─────────────────────────────────────────────────────────────
//  Wallet-derived keys (cached per account for the session)
// ─────────────────────────────────────────────────────────────

const cache = new Map();

async function hkdfBits(sig, account, saltLabel, infoLabel, extra) {
  const ikm = new TextEncoder().encode(sig + extra + String(account).toLowerCase());
  const base = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(
    await crypto.subtle.deriveBits(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt: new Uint8Array(0),
        info: new TextEncoder().encode(infoLabel),
      },
      base,
      256
    )
  );
}

async function scalarFromSignature(sig, account, cacheKey, extra, infoLabel) {
  if (cache.has(cacheKey)) return cache.get(cacheKey);
  const bits = await hkdfBits(sig, account, null, infoLabel, extra);
  let d = 0n;
  for (let i = 0; i < bits.length; i++) d = (d << 8n) | BigInt(bits[i]);
  d = P256.modN(d);
  if (d === 0n) d = 1n;
  cache.set(cacheKey, d);
  return d;
}

function requireSigner(signer) {
  if (!signer || typeof signer.signMessage !== "function") {
    throw new Error("钱包不支持消息签名，无法派生解密密钥");
  }
}

/** Merchant decryption scalar (same message as V1, so registered keys stay valid). */
export async function merchantScalar(signer, account) {
  const key = "mch:" + String(account).toLowerCase();
  if (cache.has(key)) return cache.get(key);
  requireSigner(signer);
  const sig = await signer.signMessage("EcoMall merchant PII key v1\n" + String(account).toLowerCase());
  return scalarFromSignature(sig, account, key, "|m|", "ecomall-merchant-pii-v1");
}

/** Merchant public key as SPKI DER bytes (91), ready for `setMerchantPubKey`. */
export async function merchantSpki(signer, account) {
  const d = await merchantScalar(signer, account);
  return P256.spkiFromScalar(d);
}

/** Admin decryption scalar. */
export async function adminScalar(signer, account) {
  const key = "adm:" + String(account).toLowerCase();
  if (cache.has(key)) return cache.get(key);
  requireSigner(signer);
  const sig = await signer.signMessage("EcoMall admin PII key v1\n" + String(account).toLowerCase());
  return scalarFromSignature(sig, account, key, "|", "ecomall-admin-pii-v1");
}

/** Admin public key as SPKI base64 (for `config.js`). */
export async function adminSpkiB64(signer, account) {
  const d = await adminScalar(signer, account);
  return b64(P256.spkiFromScalar(d));
}

/** Buyer data key (KEK). */
async function buyerKekRaw(signer, account) {
  const key = String(account).toLowerCase();
  const ck = "kek:" + key;
  if (cache.has(ck)) return cache.get(ck);
  requireSigner(signer);
  const sig = await signer.signMessage("EcoMall buyer PII key v1\n" + key);
  const raw = await hkdfBits(sig, account, null, "ecomall-pii-v1", "|");
  cache.set(ck, raw);
  return raw;
}

async function aesKey(raw, usage) {
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, [usage]);
}

// ─────────────────────────────────────────────────────────────
//  ECIES wrap / unwrap of the KEK
// ─────────────────────────────────────────────────────────────

async function wrapKek(recipientSpkiBytes, kekRaw) {
  const recipient = await crypto.subtle.importKey("spki", recipientSpkiBytes, EC, false, []);
  const eph = await crypto.subtle.generateKey(EC, true, ["deriveBits"]);
  const shared = await crypto.subtle.deriveBits({ name: "ECDH", public: recipient }, eph.privateKey, 256);
  const wrapKey = await aesKey(await crypto.subtle.digest("SHA-256", shared), "encrypt");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, wrapKey, kekRaw));
  const epk = new Uint8Array(await crypto.subtle.exportKey("raw", eph.publicKey));
  return { epk, iv, ct };
}

function unwrapKekWithScalar(scalar, epk, iv, ct) {
  const shared = P256.sharedX(scalar, epk);
  return { shared, iv, ct };
}

async function decryptWrapped(shared, iv, ct) {
  const wrapKey = await aesKey(await crypto.subtle.digest("SHA-256", shared), "decrypt");
  return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, wrapKey, ct));
}

// ─────────────────────────────────────────────────────────────
//  Public API
// ─────────────────────────────────────────────────────────────

/**
 * Seal the shipping record for a buyer, optionally wrapping the data key for an admin and a supplier.
 * @returns raw payload bytes (store these on chain)
 */
export async function sealShipping(signer, account, fields, supplierSpkiBytes, adminSpkiB64Str) {
  const kekRaw = await buyerKekRaw(signer, account);
  const kek = await aesKey(kekRaw, "encrypt");

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = new TextEncoder().encode(JSON.stringify(fields));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, kek, plain));

  const zero = () => ({
    epk: new Uint8Array(65),
    iv: new Uint8Array(12),
    ct: new Uint8Array(48),
  });
  let flags = 0;
  let adminBox = zero();
  let supplierBox = zero();

  if (adminSpkiB64Str) {
    adminBox = await wrapKek(unb64(adminSpkiB64Str), kekRaw);
    flags |= FLAG_ADMIN;
  }
  if (supplierSpkiBytes && supplierSpkiBytes.length === 91) {
    supplierBox = await wrapKek(supplierSpkiBytes, kekRaw);
    flags |= FLAG_SUPPLIER;
  }

  const fixed = HDR + (flags & FLAG_ADMIN ? BOX : 0) + (flags & FLAG_SUPPLIER ? BOX : 0);
  const blob = new Uint8Array(fixed + ct.length);
  let o = 0;
  blob[o++] = VERSION;
  blob[o++] = flags;
  blob.set(iv, o);
  o += 12;
  if (flags & FLAG_ADMIN) {
    blob.set(adminBox.epk, o);
    o += 65;
    blob.set(adminBox.iv, o);
    o += 12;
    blob.set(adminBox.ct, o);
    o += 48;
  }
  if (flags & FLAG_SUPPLIER) {
    blob.set(supplierBox.epk, o);
    o += 65;
    blob.set(supplierBox.iv, o);
    o += 12;
    blob.set(supplierBox.ct, o);
    o += 48;
  }
  blob.set(ct, o);
  return blob;
}

function parse(blob) {
  if (!blob || blob.length < HDR + 16) throw new Error("载荷格式不正确");
  if (blob[0] !== VERSION) throw new Error("不支持的载荷版本：" + blob[0]);
  const flags = blob[1];
  const iv = blob.slice(2, 14);
  let o = HDR;
  const admin = { epk: null, iv: null, ct: null };
  const supplier = { epk: null, iv: null, ct: null };
  if (flags & FLAG_ADMIN) {
    admin.epk = blob.slice(o, o + 65);
    admin.iv = blob.slice(o + 65, o + 77);
    admin.ct = blob.slice(o + 77, o + 125);
    o += BOX;
  }
  if (flags & FLAG_SUPPLIER) {
    supplier.epk = blob.slice(o, o + 65);
    supplier.iv = blob.slice(o + 65, o + 77);
    supplier.ct = blob.slice(o + 77, o + 125);
    o += BOX;
  }
  return { flags, iv, admin, supplier, ct: blob.slice(o) };
}

async function openWithKek(kekRaw, iv, ct) {
  const kek = await aesKey(kekRaw, "decrypt");
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, kek, ct);
  return JSON.parse(new TextDecoder().decode(plain));
}

/** Buyer opens their own order. */
export async function openAsBuyer(signer, account, blob) {
  const e = parse(blob);
  return openWithKek(await buyerKekRaw(signer, account), e.iv, e.ct);
}

/** Merchant opens an order addressed to them (needs the supplier box). */
export async function openAsMerchant(signer, account, blob) {
  const e = parse(blob);
  if (!(e.flags & FLAG_SUPPLIER)) throw new Error("该订单未包含商家密钥副本");
  const d = await merchantScalar(signer, account);
  const { shared } = unwrapKekWithScalar(d, e.supplier.epk, e.supplier.iv, e.supplier.ct);
  return openWithKek(await decryptWrapped(shared, e.supplier.iv, e.supplier.ct), e.iv, e.ct);
}

/** Admin (owner or any additional admin sharing the platform key) opens an order. */
export async function openAsAdmin(signer, account, blob) {
  const e = parse(blob);
  if (!(e.flags & FLAG_ADMIN)) throw new Error("该订单未包含平台密钥副本");
  const d = await adminScalar(signer, account);
  const { shared } = unwrapKekWithScalar(d, e.admin.epk, e.admin.iv, e.admin.ct);
  return openWithKek(await decryptWrapped(shared, e.admin.iv, e.admin.ct), e.iv, e.ct);
}

export const PII_LIMITS = { MAX_PAYLOAD_BYTES: 8192 };
export { b64, unb64 };
