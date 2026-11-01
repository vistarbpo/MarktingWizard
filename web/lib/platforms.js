// Ecommerce platforms a store can run on. Used by the Store CRM and Sales to group stores, detect the
// platform from the store link, and say how DPA AD connects to the catalog.
// region: where the platform is strongest. connect: how DPA AD gets the catalog today.
export const PLATFORM_LIST = [
  // Saudi / GCC / MENA
  { id: "Salla", region: "Saudi / GCC", hosts: [/(^|\.)salla\.(sa|store)$/], names: [/salla/, /سلة|سله/], connect: "Salla catalog feed now; DPA AD Salla app planned" },
  { id: "Zid", region: "Saudi / GCC", hosts: [/(^|\.)zid\.(store|sa)$/], names: [/\bzid\b/, /زد/], connect: "Product feed now; Zid app planned" },
  { id: "ExpandCart", region: "MENA", hosts: [/expandcart\.com$/], names: [/expand ?cart/, /اكسباند/], connect: "Product feed (CSV/XML)" },
  { id: "YouCan", region: "MENA", hosts: [/youcan\.shop$/], names: [/you ?can/, /يوكان/], connect: "Product feed (CSV/XML)" },
  // Global
  { id: "Shopify", region: "Global", hosts: [/myshopify\.com$/], names: [/shopify/, /شوبيفاي|شوبفاي/], connect: "Product feed now; DPA AD Shopify app planned" },
  { id: "WooCommerce", region: "Global", hosts: [], names: [/woo ?commerce|wordpress/, /ووكومرس|ووكمرس|وردبريس/], connect: "WooCommerce product feed plugin (XML)" },
  { id: "Magento", region: "Global", hosts: [], names: [/magento|adobe commerce/, /ماجنتو/], connect: "Product feed (XML) from the store's feed extension" },
  { id: "BigCommerce", region: "Global", hosts: [/mybigcommerce\.com$/], names: [/big ?commerce/], connect: "Product feed (built-in channel feeds)" },
  { id: "Wix", region: "Global", hosts: [/wixsite\.com$/], names: [/\bwix\b/, /ويكس/], connect: "Product feed via Wix Google/Meta channel" },
  { id: "Squarespace", region: "Global", hosts: [/squarespace\.com$/], names: [/squarespace/], connect: "Product feed via Meta/Google channel" },
  { id: "PrestaShop", region: "Global", hosts: [], names: [/presta ?shop/], connect: "Product feed module (XML)" },
  { id: "OpenCart", region: "Global", hosts: [], names: [/open ?cart/, /اوبن كارت/], connect: "Product feed extension (XML)" },
  { id: "Ecwid", region: "Global", hosts: [/ecwid\.com$/, /company\.site$/], names: [/ecwid|lightspeed/], connect: "Product feed (catalog export)" },
  { id: "Shopware", region: "Global", hosts: [], names: [/shopware/], connect: "Product comparison feed (XML)" },
  { id: "Salesforce Commerce", region: "Global (enterprise)", hosts: [], names: [/salesforce|demandware|sfcc/], connect: "Product feed export (enterprise)" },
  // Other
  { id: "Custom", region: "—", hosts: [], names: [/custom|in-house|bespoke|own site|مخصص|خاص/], connect: "Product feed (CSV/XML) or API" },
  { id: "Other", region: "—", hosts: [], names: [], connect: "Product feed (CSV/XML)" },
];
export const PLATFORMS = PLATFORM_LIST.map((p) => p.id);
export const platformInfo = (id) => PLATFORM_LIST.find((p) => p.id === id) || PLATFORM_LIST.at(-1);

// From a platform name in a spreadsheet ("سلة", "shopify plus") and/or the store link ("x.myshopify.com").
export function detectPlatform(raw = "", domain = "") {
  const s = String(raw || "").toLowerCase().trim();
  if (s) { const hit = PLATFORM_LIST.find((p) => p.names.some((re) => re.test(s))); if (hit) return hit.id; }
  const d = String(domain || "").toLowerCase();
  if (d) { const hit = PLATFORM_LIST.find((p) => p.hosts.some((re) => re.test(d))); if (hit) return hit.id; }
  return "";
}
