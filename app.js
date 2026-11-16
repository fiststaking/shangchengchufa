import { CONFIG } from "./config.js";
import { MALL_ABI, MODULE_ABI, ERC20_ABI } from "./abi.js";
import {
  merchantSpki,
  adminSpkiB64,
  sealShipping,
  openAsBuyer,
  openAsMerchant,
  openAsAdmin,
  b64,
} from "./crypto.js";

const { ethers } = window;
const $ = (id) => document.getElementById(id);

const STATUS_LABEL = ["待理财", "待发货", "已发货", "已完成", "已取消"];
const POOL_LABEL = { 0: "原始股东", 1: "联创", 2: "运营" };

let readProvider = null;
let signer = null;
let account = null;
let mallRead = null;
let mallWrite = null;
let moduleRead = null;
let moduleWrite = null;
let tokenRead = null;
let tiers = [];

// ─────────────────────────────────────────────────────────────
//  Provider / wallet
// ─────────────────────────────────────────────────────────────

function readOnly() {
  if (!readProvider) {
    readProvider = new ethers.JsonRpcProvider(CONFIG.rpcUrls[0], CONFIG.chainId, {
      staticNetwork: true,
    });
  }
  return readProvider;
}

function bindReadContracts() {
  mallRead = new ethers.Contract(CONFIG.mall, MALL_ABI, readOnly());
  moduleRead = CONFIG.merchantModule
    ? new ethers.Contract(CONFIG.merchantModule, MODULE_ABI, readOnly())
    : null;
  tokenRead = new ethers.Contract(CONFIG.paymentToken, ERC20_ABI, readOnly());
}

async function connect() {
  if (!window.ethereum) return fail("buyMsg", "没有检测到钱包插件（MetaMask 等）");
  try {
    const provider = new ethers.BrowserProvider(window.ethereum);
    await provider.send("eth_requestAccounts", []);
    const net = await provider.getNetwork();
    if (Number(net.chainId) !== CONFIG.chainId) {
      try {
        await window.ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: "0x" + CONFIG.chainId.toString(16) }],
        });
      } catch {
        return fail("buyMsg", "请先把钱包切换到 BNB Smart Chain");
      }
    }
    signer = await provider.getSigner();
    account = await signer.getAddress();
    mallWrite = new ethers.Contract(CONFIG.mall, MALL_ABI, signer);
    moduleWrite = CONFIG.merchantModule
      ? new ethers.Contract(CONFIG.merchantModule, MODULE_ABI, signer)
      : null;
    $("chainBadge").textContent = account.slice(0, 6) + "…" + account.slice(-4);
    $("chainBadge").classList.add("ok");
    $("connectBtn").textContent = "已连接";
    $("footerStatus").textContent = "已连接 " + account;
    await refreshAll();
  } catch (e) {
    fail("buyMsg", "连接失败：" + (e.shortMessage || e.message));
  }
}

function fmtUsd(v) {
  return Number(ethers.formatUnits(v, 18)).toLocaleString("en-US");
}

function fmtToken(v, decimals) {
  return Number(ethers.formatUnits(v, decimals)).toLocaleString("en-US", {
    maximumFractionDigits: 6,
  });
}

function ok(id, text) {
  const el = $(id);
  el.className = "msg ok";
  el.textContent = text;
}
function fail(id, text) {
  const el = $(id);
  el.className = "msg err";
  el.textContent = text;
}

// ─────────────────────────────────────────────────────────────
//  Catalogue: two linked dropdowns
// ─────────────────────────────────────────────────────────────

async function loadTiers() {
  const sel = $("amountSelect");
  try {
    const raw = await mallRead.getAmountTiers();
    tiers = raw.map((v) => BigInt(v)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    if (tiers.length === 0) {
      sel.innerHTML = '<option value="">暂无在售金额</option>';
      return;
    }
    sel.innerHTML =
      '<option value="">请选择金额</option>' +
      tiers.map((t) => `<option value="${t}">${fmtUsd(t)} USDT</option>`).join("");
  } catch (e) {
    sel.innerHTML = '<option value="">读取失败</option>';
    fail("buyMsg", "读取金额档位失败：" + (e.shortMessage || e.message));
  }
}

async function onAmountChange() {
  const amount = $("amountSelect").value;
  const sel = $("productSelect");
  $("productMeta").textContent = "";
  if (!amount) {
    sel.innerHTML = '<option value="">请先选择金额</option>';
    sel.disabled = true;
    $("buyBtn").disabled = true;
    return;
  }
  const [ids, names, suppliers, actives] = await mallRead.getProductsByAmountPaged(amount, 0, 100);
  const rows = [];
  for (let i = 0; i < ids.length; i++) {
    if (!actives[i]) continue;
    rows.push({ id: ids[i], name: names[i], supplier: suppliers[i] });
  }
  if (rows.length === 0) {
    sel.innerHTML = '<option value="">该金额下暂无在售产品</option>';
    sel.disabled = true;
    $("buyBtn").disabled = true;
    return;
  }
  sel.disabled = false;
  sel.innerHTML = rows
    .map((r) => `<option value="${r.id}">${r.name}</option>`)
    .join("");
  onProductChange();
}

function onProductChange() {
  const pid = $("productSelect").value;
  $("buyBtn").disabled = !pid;
  updateQuote();
}

async function updateQuote() {
  const amount = $("amountSelect").value;
  if (!amount) return;
  const pay = document.querySelector('input[name="pay"]:checked').value;
  const line = $("quoteLine");
  if (pay === "usdt") {
    const nominal = BigInt(amount) / 2n;
    const tolerated = (nominal * 9000n) / 10000n;
    line.textContent =
      `将以 ${fmtUsd(amount)} USDT 支付；其中 ${fmtUsd(nominal)} USDT 会立刻退回你的钱包。` +
      `下单后需新增理财 ${fmtUsd(tolerated)}（标价一半 ${fmtUsd(nominal)}，含 10% 汇率容错）方可解锁。`;
    return;
  }
  try {
    const wei = await mallRead.quoteBnbForUsd(amount);
    const nominal = BigInt(amount) / 2n;
    const tolerated = (nominal * 9000n) / 10000n;
    line.textContent =
      `预计需要 ${ethers.formatEther(wei)} BNB（含 5% 保护上限，多余的会退回）。` +
      `下单后需新增理财 ${fmtUsd(tolerated)}（标价一半 ${fmtUsd(nominal)}，含 10% 汇率容错）。`;
  } catch {
    line.textContent = "BNB 报价暂不可用，请改用 USDT。";
  }
}

// ─────────────────────────────────────────────────────────────
//  Buyer: encrypt + place order
// ─────────────────────────────────────────────────────────────

// The shipping record is sealed once with a key derived from the buyer's wallet signature. The admin
// and the supplier each get a wrapped copy of that key inside the same blob, so one payload serves all
// three (see crypto.js for the layout). Nothing is kept in localStorage: the same wallet always
// re-derives the same key, which is what makes "log in anywhere and read your orders" work.
const MAX_PAYLOAD_BYTES = 8192;

/** Read the supplier's P-256 public key (SPKI DER) from the merchant module. */
async function supplierSpki(supplier) {
  if (!moduleRead) return null;
  try {
    const raw = await moduleRead.merchantPubKey(supplier);
    const bytes = ethers.getBytes(raw);
    return bytes.length === 91 ? bytes : null;
  } catch {
    return null;
  }
}

/** Seal the record and return the on-chain payload bytes. */
async function sealPayload(fields, supplier) {
  const spki = await supplierSpki(supplier);
  const blob = await sealShipping(
    signer,
    account,
    fields,
    spki,
    CONFIG.adminPubKeyB64 || ""
  );
  if (blob.length > MAX_PAYLOAD_BYTES) {
    throw new Error(`加密后 ${blob.length} 字节，超过上限 ${MAX_PAYLOAD_BYTES}，请缩短地址或备注`);
  }
  return ethers.hexlify(blob);
}

/** Normalise the decrypted JSON into the display shape. */
function asRecord(o) {
  if (!o) return null;
  return {
    receiver: o.receiver || o.r || "",
    phone: o.phone || o.p || "",
    address: o.address || o.addressLine || o.a || "",
    note: o.note || o.n || "",
  };
}

function recordBlock(r) {
  return (
    `<div class="pii">收件人：${r.receiver}\n电话：${r.phone}\n` +
    `地址：${r.address}\n备注：${r.note || "—"}</div>`
  );
}

async function placeOrder() {
  const btn = $("buyBtn");
  btn.disabled = true;
  try {
    if (!signer) return fail("buyMsg", "请先连接钱包");
    const pid = $("productSelect").value;
    const amount = $("amountSelect").value;
    const receiver = $("fReceiver").value.trim();
    const phone = $("fPhone").value.trim();
    const address = $("fAddress").value.trim();
    const note = $("fNote").value.trim();
    if (!receiver || !phone || !address) return fail("buyMsg", "请填写收货地址、联系人和电话");

    const [, , supplier] = await mallRead.getProductInfo(pid);
    if (!(await supplierSpki(supplier))) {
      return fail("buyMsg", "该商品尚未登记加密公钥，暂时无法下单，请联系商家。");
    }

    ok("buyMsg", "请在钱包中确认签名（用于加密收货信息，仅第一次需要）…");
    const payload = await sealPayload({ receiver, phone, address, note }, supplier);

    const pay = document.querySelector('input[name="pay"]:checked').value;
    let tx;
    if (pay === "usdt") {
      const decimals = Number(await tokenRead.decimals());
      const tokenAmount = (BigInt(amount) * 10n ** BigInt(decimals)) / 10n ** 18n;
      const token = new ethers.Contract(CONFIG.paymentToken, ERC20_ABI, signer);
      const allowance = await token.allowance(account, CONFIG.mall);
      if (allowance < tokenAmount) {
        ok("buyMsg", "请在钱包中确认授权 USDT…");
        await (await token.approve(CONFIG.mall, ethers.MaxUint256)).wait();
      }
      ok("buyMsg", "请在钱包中确认下单…");
      tx = await mallWrite.placeOrder(pid, payload);
    } else {
      const quote = await mallRead.quoteBnbForUsd(amount);
      const cap = (quote * 105n) / 100n;
      ok("buyMsg", "请在钱包中确认下单…");
      tx = await mallWrite.placeOrderWithBNB(pid, cap, payload, { value: cap });
    }
    ok("buyMsg", "交易已提交，等待确认…");
    await tx.wait();
    const newId = Number(await mallRead.orderCount()) - 1;
    ok(
      "buyMsg",
      `下单成功，订单号 #${newId}。50% 已退回你的钱包，请去理财后回来「我的订单」解锁。`
    );
    await loadMyOrders();
  } catch (e) {
    fail("buyMsg", "下单失败：" + (e.shortMessage || e.message));
  } finally {
    btn.disabled = false;
  }
}

// ─────────────────────────────────────────────────────────────
//  Buyer: my orders
// ─────────────────────────────────────────────────────────────

async function loadMyOrders() {
  if (!account) return;
  const box = $("ordersList");
  box.innerHTML = '<p class="muted">加载中…</p>';
  try {
    const count = Number(await mallRead.orderCount());
    if (count === 0) {
      box.innerHTML = '<p class="muted">暂无订单</p>';
      return;
    }
    const ids = await mallRead.getUserOrderIdsPaged(account, 0, 100);
    const mine = ids.slice().reverse();
    if (mine.length === 0) {
      box.innerHTML = '<p class="muted">暂无订单</p>';
      return;
    }
    const html = [];
    for (const id of mine) {
      const o = await mallRead.getOrderInfo(id);
      const st = Number(o.status);
      let mine = null;
      try {
        mine = asRecord(await openAsBuyer(signer, account, ethers.getBytes(o.payload)));
      } catch {
        mine = null;
      }
      const prog = await mallRead.unlockProgress(id);
      const need = fmtUsd(prog.requiredFarmUsd);
      const nominal = fmtUsd((o.amountUsd + 0n) / 2n);
      const credit = fmtUsd(prog.credit);
      const consumed = fmtUsd(prog.consumedUsd);
      html.push(`
        <div class="item">
          <div class="top">
            <span class="title">订单 #${id} · ${fmtUsd(o.amountUsd)} USDT</span>
            <span class="status-${st}">${STATUS_LABEL[st]}</span>
          </div>
          <div class="sub">退款 ${fmtToken(o.refundAmount, await tokenRead.decimals())} · 供货商 ${o.supplier.slice(0, 6)}…</div>
          ${
            st === 0
              ? `<div class="sub">解锁进度：需要 ${need}（标价一半 ${nominal}，已含 10% 汇率容错），当前理财 ${credit}，已核销 ${consumed}</div>
                 <button data-unlock="${id}" class="ghost">解锁订单</button>`
              : ""
          }
          ${
            mine
              ? recordBlock(mine)
              : `<div class="sub">收货信息已加密上链，点「查看收货信息」用钱包签名解密</div>`
          }
        </div>`);
    }
    box.innerHTML = html.join("");
    box.querySelectorAll("[data-unlock]").forEach((b) => {
      b.onclick = () => unlock(Number(b.dataset.unlock));
    });
  } catch (e) {
    box.innerHTML = `<p class="msg err">加载失败：${e.shortMessage || e.message}</p>`;
  }
}

async function unlock(orderId) {
  try {
    if (!mallWrite) return;
    const tx = await mallWrite.unlockOrder(orderId);
    await tx.wait();
    await loadMyOrders();
  } catch (e) {
    alert("解锁失败：" + (e.shortMessage || e.message));
  }
}

// ─────────────────────────────────────────────────────────────
//  Merchant
// ─────────────────────────────────────────────────────────────

// The merchant key is derived from the wallet signature, so there is nothing to generate, store or
// back up. Registering the public key is a one-time on-chain write; after that any device that can
// sign with the same wallet can decrypt.
async function showDerivedKey() {
  if (!signer) return ($("keyStatus").textContent = "请先连接钱包");
  try {
    $("keyStatus").textContent = "请在钱包中确认签名（不会发送任何交易）…";
    const spki = await merchantSpki(signer, account);
    const registered = await supplierSpki(account);
    const same = registered && b64(registered) === b64(spki);
    $("keyStatus").textContent =
      `你的加密公钥指纹：${b64(spki).slice(0, 16)}…` +
      (same ? "（已登记）" : registered ? "（链上登记的是另一把，建议重新登记）" : "（尚未登记）");
    $("publishKey").disabled = false;
  } catch (e) {
    $("keyStatus").textContent = "派生失败：" + (e.shortMessage || e.message);
  }
}

async function publishKey() {
  if (!signer || !moduleWrite) return;
  try {
    $("keyStatus").textContent = "请在钱包中确认签名与交易…";
    const spki = await merchantSpki(signer, account);
    const tx = await moduleWrite.setMerchantPubKey(ethers.hexlify(spki));
    await tx.wait();
    $("keyStatus").textContent = `公钥已登记：${b64(spki).slice(0, 16)}…（换设备只需重新连钱包，无需备份）`;
  } catch (e) {
    $("keyStatus").textContent = "登记失败：" + (e.shortMessage || e.message);
  }
}

/** Show the platform public key so it can be pasted into config.js. */
async function showAdminKey() {
  if (!signer) return ($("keyStatus").textContent = "请先连接钱包");
  try {
    const spkiB64 = await adminSpkiB64(signer, account);
    $("keyStatus").textContent =
      `平台公钥（填入 config.js 的 adminPubKeyB64）：${spkiB64}`;
  } catch (e) {
    $("keyStatus").textContent = "派生失败：" + (e.shortMessage || e.message);
  }
}

async function submitProduct() {
  try {
    if (!moduleWrite) return;
    const name = $("mName").value.trim();
    const amount = BigInt($("mAmount").value || 0) * 10n ** 18n;
    if (!name || amount === 0n) return;
    const tx = await moduleWrite.submitProduct(name, amount);
    await tx.wait();
    await loadMySubs();
  } catch (e) {
    alert("提交失败：" + (e.shortMessage || e.message));
  }
}

async function loadMySubs() {
  if (!account || !moduleRead) return;
  const box = $("mySubs");
  try {
    const ids = await moduleRead.getMerchantSubmissions(account);
    if (ids.length === 0) return (box.innerHTML = '<p class="muted">还没有提交过商品</p>');
    const rows = [];
    for (const id of ids) {
      const s = await moduleRead.getSubmission(id);
      const label = ["待审核", "已上架", "已驳回", "已下架"][Number(s.status)];
      rows.push(
        `<div class="item"><div class="top"><span class="title">${s.name}</span><span>${label}</span></div>
         <div class="sub">${fmtUsd(s.amountUsd)} USDT · 编号 #${id}</div></div>`
      );
    }
    box.innerHTML = rows.join("");
  } catch (e) {
    box.innerHTML = `<p class="msg err">${e.shortMessage || e.message}</p>`;
  }
}

async function loadSupplierOrders() {
  if (!account) return;
  const box = $("supplierOrders");
  box.innerHTML = '<p class="muted">加载中…</p>';
  try {
    const ids = await mallRead.getSupplierOrderIdsPaged(account, 0, 100);

    const rows = [];
    for (const id of ids.slice().reverse()) {
      let o;
      try {
        o = await mallRead.getOrderInfo(id);
      } catch {
        // EcoMallV2 only lets the supplier read an order after it is unlocked (status >= 1).
        continue;
      }
      const st = Number(o.status);
      if (st < 1) continue;
      let pii = "（点「解密」用钱包签名读取）";
      let block = `<div class="sub" data-pii="${id}">${pii}</div>
         <button class="ghost" data-decrypt="${id}">解密</button>`;
      rows.push(
        `<div class="item"><div class="top"><span class="title">订单 #${id}</span>
         <span class="status-${st}">${STATUS_LABEL[st]}</span></div>
         <div class="sub">${fmtUsd(o.amountUsd)} USDT</div>
         ${block}</div>`
      );
    }
    box.innerHTML = rows.length ? rows.join("") : '<p class="muted">暂无已解锁订单</p>';
    box.querySelectorAll("[data-decrypt]").forEach((b) => {
      b.onclick = async () => {
        const id = Number(b.dataset.decrypt);
        const target = box.querySelector(`[data-pii="${id}"]`);
        try {
          target.textContent = "请在钱包中确认签名…";
          const o = await mallRead.getOrderInfo(id);
          const rec = asRecord(await openAsMerchant(signer, account, ethers.getBytes(o.payload)));
          target.outerHTML = recordBlock(rec);
        } catch (e) {
          target.textContent = "解密失败：" + (e.shortMessage || e.message);
        }
      };
    });
  } catch (e) {
    box.innerHTML = `<p class="msg err">${e.shortMessage || e.message}</p>`;
  }
}

// ─────────────────────────────────────────────────────────────
//  Admin
// ─────────────────────────────────────────────────────────────

async function checkAdmin() {
  if (!account) return;
  try {
    const yes = await mallRead.isAdmin(account);
    $("adminStatus").textContent = yes
      ? "你是 owner 或额外管理员，拥有全部业务权限。"
      : "当前地址没有任何管理权限（运营分红池地址也不具备权限）。";
  } catch (e) {
    $("adminStatus").textContent = "读取权限失败：" + (e.shortMessage || e.message);
  }
}

async function adminAddProduct() {
  try {
    const name = $("aName").value.trim();
    const amount = BigInt($("aAmount").value || 0) * 10n ** 18n;
    const supplier = $("aSupplier").value.trim();
    if (!name || !ethers.isAddress(supplier)) return fail("adminMsg", "请填写名称与合法的供货商地址");
    const tx = await mallWrite.addProduct(name, amount, supplier);
    await tx.wait();
    ok("adminMsg", "商品已添加");
    await loadTiers();
  } catch (e) {
    fail("adminMsg", "添加失败：" + (e.shortMessage || e.message));
  }
}

async function adminPool(add) {
  try {
    const kind = Number($("aPoolKind").value);
    const addr = $("aPoolAddr").value.trim();
    if (!ethers.isAddress(addr)) return fail("adminMsg", "请填写合法地址");
    const tx = add
      ? await mallWrite.addPoolAddress(kind, addr)
      : await mallWrite.removePoolAddress(kind, addr);
    await tx.wait();
    await showPool();
    ok("adminMsg", add ? "已添加" : "已移除");
  } catch (e) {
    fail("adminMsg", "操作失败：" + (e.shortMessage || e.message));
  }
}

async function showPool() {
  try {
    const kind = Number($("aPoolKind").value);
    const list = await mallRead.getPool(kind);
    $("poolView").innerHTML = list.length
      ? list.map((a) => `<div class="item">${POOL_LABEL[kind]} · ${a}</div>`).join("")
      : '<p class="muted">该池为空</p>';
  } catch (e) {
    $("poolView").innerHTML = `<p class="msg err">${e.shortMessage || e.message}</p>`;
  }
}

// ─────────────────────────────────────────────────────────────
//  Admin: decrypt any order with the platform key
// ─────────────────────────────────────────────────────────────

async function adminDecrypt() {
  const box = $("aDecryptOut");
  const id = Number($("aOrderId").value);
  if (!Number.isInteger(id) || id < 0) return (box.innerHTML = '<p class="msg err">请输入订单号</p>');
  if (!signer) return (box.innerHTML = '<p class="msg err">请先连接钱包</p>');
  try {
    box.innerHTML = '<p class="muted">请在钱包中确认签名…</p>';
    const o = await mallRead.getOrderInfo(id);
    const rec = asRecord(await openAsAdmin(signer, account, ethers.getBytes(o.payload)));
    box.innerHTML =
      `<div class="item"><div class="top"><span class="title">订单 #${id}</span>` +
      `<span>${fmtUsd(o.amountUsd)} USDT</span></div>` +
      recordBlock(rec) +
      `<div class="sub">买家 ${o.buyer} · 供货商 ${o.supplier}</div></div>`;
  } catch (e) {
    box.innerHTML = `<p class="msg err">解密失败：${e.shortMessage || e.message}</p>`;
  }
}

// ─────────────────────────────────────────────────────────────
//  Wiring
// ─────────────────────────────────────────────────────────────

function switchTab(name) {
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
  document.querySelectorAll(".panel").forEach((p) => p.classList.toggle("active", p.id === "tab-" + name));
  if (name === "orders") loadMyOrders();
  if (name === "merchant") {
    loadMySubs();
    loadSupplierOrders();
  }
  if (name === "admin") {
    checkAdmin();
    showPool();
  }
}

async function refreshAll() {
  await loadTiers();
  if (account) {
    await loadMyOrders();
    await checkAdmin();
  }
}

function boot() {
  bindReadContracts();
  document.querySelectorAll(".tab").forEach((t) => (t.onclick = () => switchTab(t.dataset.tab)));
  $("connectBtn").onclick = connect;
  $("amountSelect").onchange = onAmountChange;
  $("productSelect").onchange = onProductChange;
  document.querySelectorAll('input[name="pay"]').forEach((r) => (r.onchange = updateQuote));
  $("buyBtn").onclick = placeOrder;
  $("refreshOrders").onclick = loadMyOrders;
  $("genKey").onclick = showDerivedKey;
  $("loadKey").onclick = showAdminKey;
  $("publishKey").onclick = publishKey;
  $("mSubmit").onclick = submitProduct;
  $("loadSupplierOrders").onclick = loadSupplierOrders;
  $("aAddProduct").onclick = adminAddProduct;
  $("aAddPool").onclick = () => adminPool(true);
  $("aRemovePool").onclick = () => adminPool(false);
  $("aPoolKind").onchange = showPool;
  $("aDecrypt").onclick = adminDecrypt;
  $("aPause").onclick = async () => {
    try {
      const tx = await mallWrite.setPaused(true);
      await tx.wait();
      ok("adminMsg", "已暂停下单（再次点击不会恢复，请用合约管理工具取消暂停）");
    } catch (e) {
      fail("adminMsg", "操作失败：" + (e.shortMessage || e.message));
    }
  };

  if (CONFIG.mall === ethers.ZeroAddress) {
    $("footerStatus").textContent = "尚未配置合约地址：请编辑 web/config.js";
  } else {
    $("footerStatus").textContent = "只读模式：连接钱包后可下单";
    loadTiers();
  }
}

boot();
