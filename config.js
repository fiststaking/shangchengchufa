// Deployment configuration -- edit this file (no build step) before publishing.
//
// Everything the page needs to talk to the chain lives here. Nothing secret may go in this file:
// the only keys it may contain are PUBLIC keys.

export const CONFIG = {
  chainId: 56,
  chainName: "BNB Smart Chain",
  rpcUrls: [
    "https://bsc-dataseed.binance.org",
    "https://bsc-dataseed1.defibit.io",
    "https://bsc-dataseed1.ninicoin.io",
  ],
  explorer: "https://bscscan.com",

  // EcoMallV2 core (the admin facet is reached through the same address).
  mall: "0x0000000000000000000000000000000000000000",
  // EcoMallMerchantModuleV2
  merchantModule: "0x0000000000000000000000000000000000000000",
  // Payment token (USDT)
  paymentToken: "0x55d398326f99059fF775485246999027B3197955",

  // Platform (admin) P-256 public key, SPKI DER base64. Generated once by the operator; the matching
  // private JWK is what the admin panel uses to decrypt orders. Leave empty to seal for merchants only.
  adminPubKeyB64: "",

  // Product images: optional. Put files in web/img/ and map productId -> filename.
  // Anything missing falls back to a generated placeholder.
  productImages: {},
};
