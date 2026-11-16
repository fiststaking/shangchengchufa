// Human-readable ABIs (ethers v6 accepts these strings directly, so the site needs no build step).

export const MALL_ABI = [
  // ── buyer ──
  "function placeOrder(uint256 productId, bytes payload) returns (uint256)",
  "function placeOrderWithBNB(uint256 productId, uint256 maxBnbIn, bytes payload) payable returns (uint256)",
  "function unlockOrder(uint256 orderId)",
  "function updateOrderInfo(uint256 orderId, bytes payload)",
  "function farmingCredit(address user) view returns (uint256)",
  "function farmRequirement(uint256 amountUsd) view returns (uint256 nominalUsd, uint256 requiredUsd)",
  "function unlockProgress(uint256 orderId) view returns (uint256 requiredFarmUsd, uint256 credit, uint256 consumedUsd, bool forceUnlocked, bool unlocked)",

  // ── catalogue (dropdowns) ──
  "function productCount() view returns (uint256)",
  "function getProductInfo(uint256 id) view returns (string name, uint256 amountUsd, address supplier, bool active)",
  "function getAmountTiers() view returns (uint256[])",
  "function getProductIdsByAmount(uint256 amountUsd) view returns (uint256[])",
  "function getProductsByAmountPaged(uint256 amountUsd, uint256 offset, uint256 limit) view returns (uint256[] ids, string[] names, address[] suppliers, bool[] actives)",

  // ── orders ──
  "function orderCount() view returns (uint256)",
  "function getUserOrderIdsPaged(address user, uint256 offset, uint256 limit) view returns (uint256[])",
  "function getSupplierOrderIdsPaged(address supplier, uint256 offset, uint256 limit) view returns (uint256[])",
  "function getOrderInfo(uint256 orderId) view returns (address buyer, address supplier, uint256 productId, uint256 amountUsd, uint256 refundAmount, uint256 createdAt, uint8 status, bytes payload)",
  "function getPayloadChunkCount(uint256 orderId) view returns (uint256)",
  "function getPayloadChunks(uint256 orderId, uint256 offset, uint256 limit) view returns (bytes[])",

  // ── quoting / config ──
  "function quoteBnbForUsd(uint256 amountUsd) view returns (uint256)",
  "function paymentToken() view returns (address)",
  "function paymentDecimals() view returns (uint8)",
  "function bnbEnabled() view returns (bool)",
  "function forceUnlockCount() view returns (uint256)",
  "function MIN_AMOUNT() view returns (uint256)",
  "function MAX_AMOUNT() view returns (uint256)",
  "function AMOUNT_STEP() view returns (uint256)",

  // ── admin facet (same address) ──
  "function addProduct(string name, uint256 amountUsd, address supplier) returns (uint256)",
  "function updateProduct(uint256 id, string name, uint256 amountUsd, address supplier, bool active)",
  "function setProductActive(uint256 id, bool active)",
  "function setProductSupplier(uint256 id, address supplier)",
  "function addPoolAddress(uint8 kind, address account)",
  "function removePoolAddress(uint8 kind, address account)",
  "function replacePoolAddress(uint8 kind, address oldAddr, address newAddr)",
  "function getPool(uint8 kind) view returns (address[])",
  "function poolCount(uint8 kind) view returns (uint256)",
  "function isAdmin(address account) view returns (bool)",
  "function isOperationAddress(address account) view returns (bool)",
  "function addAdmin(address account)",
  "function removeAdmin(address account)",
  "function replaceAdmin(address oldAccount, address newAccount)",
  "function setPaused(bool paused)",
  "function setMerchantModule(address module)",
  "function addOrderViewer(address account)",
  "function removeOrderViewer(address account)",
  "function getOrderViewers() view returns (address[])",
  "function forceUnlockOrder(uint256 orderId, bytes32 reasonHash)",
  "function revokeForceUnlock(uint256 orderId)",
  "function getSwapPath() view returns (address[])",
];

export const MODULE_ABI = [
  "function merchantPubKey(address merchant) view returns (bytes)",
  "function setMerchantPubKey(bytes spki)",
  "function isMerchant(address account) view returns (bool)",
  "function setMerchant(address merchant, bool allowed)",
  "function submitProduct(string name, uint256 amountUsd) returns (uint256)",
  "function updateSubmission(uint256 submissionId, string name, uint256 amountUsd)",
  "function approve(uint256 submissionId) returns (uint256)",
  "function reject(uint256 submissionId)",
  "function delist(uint256 submissionId)",
  "function getMerchantSubmissions(address merchant) view returns (uint256[])",
  "function getSubmission(uint256 submissionId) view returns (address merchant, string name, uint256 amountUsd, uint8 status, uint256 productId, uint256 updatedAt)",
  "function getStatusCounts() view returns (uint256 pending, uint256 approved, uint256 rejected, uint256 delisted)",
  "function canReview(address account) view returns (bool)",
];

export const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];
