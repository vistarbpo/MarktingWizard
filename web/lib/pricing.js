// Pricing calculator: what one store costs DPA AD per month on each plan, the margin at a candidate price,
// and the lowest price that reaches the target gross margin. All money in USD; SAR shown alongside.
// The default numbers are EXAMPLES to replace with real costs, not measured figures.
import { PLANS, SAR_PER_USD } from "./sales.js";

export const COST_FIELDS = {
  image_cost: "Cost per designed image render (USD)",
  video_cost: "Cost per catalog video render (USD)",
  storage_per_1k: "Storage + CDN per 1,000 images per month (USD)",
  support_hour: "Cost of one hour of human support/onboarding (USD)",
  payment_pct: "Payment processing (% of price)",
  appstore_pct: "App-store revenue share (% of price)",
  fixed_monthly: "Fixed platform costs per month: servers, tools (USD)",
  target_margin: "Target gross margin (%)",
};
export const PLAN_FIELDS = {
  price: "Price per month (USD)",
  annual_price: "Price per month, billed yearly (USD)",
  products: "Products a typical store has on this plan",
  creatives: "Designed images per product",
  refresh_pct: "Share of images re-rendered each month (%)",
  videos: "Catalog videos per month",
  ai: "AI cost per store per month (USD)",
  support_hours: "Human support hours per month",
  onboarding_hours: "Onboarding hours (one time)",
  stores: "Paying stores expected (for fixed-cost share)",
};

const typical = { Starter: 300, Growth: 2500, Scale: 20000, Enterprise: 80000 };
export const DEFAULT_PRICING = {
  example: true,
  costs: { image_cost: 0.004, video_cost: 0.08, storage_per_1k: 0.03, support_hour: 16, payment_pct: 2.9, appstore_pct: 0, fixed_monthly: 400, target_margin: 70 },
  plans: PLANS.map((p) => ({
    name: p.name, price: p.usd, annual_price: Math.round((p.usd * 10) / 12), products: typical[p.name] || 500,
    creatives: 3, refresh_pct: 50, videos: { Starter: 0, Growth: 20, Scale: 100, Enterprise: 400 }[p.name] ?? 0,
    ai: { Starter: 3, Growth: 8, Scale: 25, Enterprise: 80 }[p.name] ?? 5,
    support_hours: { Starter: 0.25, Growth: 0.5, Scale: 2, Enterprise: 6 }[p.name] ?? 0.5,
    onboarding_hours: { Starter: 0.5, Growth: 1, Scale: 4, Enterprise: 12 }[p.name] ?? 1,
    stores: { Starter: 60, Growth: 25, Scale: 6, Enterprise: 1 }[p.name] ?? 1,
  })),
};

const num = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
export function cleanPricing(b = {}, cur = DEFAULT_PRICING) {
  const costs = { ...cur.costs };
  for (const k of Object.keys(COST_FIELDS)) if (b.costs?.[k] !== undefined) costs[k] = num(b.costs[k], 0, k.endsWith("pct") || k === "target_margin" ? 95 : 1e7, cur.costs[k]);
  const plans = (b.plans || cur.plans).slice(0, 8).map((p, i) => {
    const base = cur.plans[i] || cur.plans.at(-1);
    const o = { name: String(p.name ?? base.name).trim().slice(0, 40) || base.name };
    for (const k of Object.keys(PLAN_FIELDS)) o[k] = num(p[k] ?? base[k], 0, k === "refresh_pct" ? 100 : 1e8, base[k]);
    return o;
  });
  return { example: b.example === undefined ? cur.example : !!b.example, costs, plans };
}

// Monthly cost of one store, and the prices that work.
export function pricingModel(pr, churnPct = 3) {
  const c = pr.costs, churn = Math.max(0.5, churnPct) / 100, lifetime = 1 / churn;
  const fee = (c.payment_pct + c.appstore_pct) / 100, target = c.target_margin / 100;
  const totalStores = pr.plans.reduce((a, p) => a + p.stores, 0) || 1;
  const fixedPerStore = c.fixed_monthly / totalStores;
  const r2 = (x) => Math.round(x * 100) / 100;
  const plans = pr.plans.map((p) => {
    const images = p.products * p.creatives * (p.refresh_pct / 100);
    const firstRender = p.products * p.creatives * c.image_cost; // one-time, spread over the store's lifetime
    const parts = {
      images: images * c.image_cost,
      videos: p.videos * c.video_cost,
      storage: ((p.products * p.creatives) / 1000) * c.storage_per_1k,
      ai: p.ai,
      support: p.support_hours * c.support_hour,
      onboarding: (p.onboarding_hours * c.support_hour + firstRender) / lifetime,
      fixed_share: fixedPerStore,
    };
    const direct = Object.values(parts).reduce((a, x) => a + x, 0);
    const at = (price) => { const cost = direct + price * fee; return { price, cost: r2(cost), margin: price ? Math.round(((price - cost) / price) * 1000) / 10 : null, profit: r2(price - cost) }; };
    const minPrice = 1 - fee - target > 0 ? direct / (1 - fee - target) : null;
    const breakEven = 1 - fee > 0 ? direct / (1 - fee) : null;
    const monthly = at(p.price), yearly = at(p.annual_price);
    return {
      name: p.name, images_per_month: Math.round(images), parts: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, r2(v)])),
      fees: r2(p.price * fee), direct: r2(direct), monthly, yearly,
      min_price: minPrice && Math.ceil(minPrice), break_even: breakEven && Math.ceil(breakEven),
      ok: monthly.margin != null && monthly.margin >= c.target_margin, yearly_ok: yearly.margin != null && yearly.margin >= c.target_margin,
      sar: { price: Math.round(p.price * SAR_PER_USD), cost: Math.round(monthly.cost * SAR_PER_USD), min_price: minPrice ? Math.ceil(minPrice * SAR_PER_USD) : null },
      lifetime_profit: r2(monthly.profit * lifetime),
    };
  });
  return { plans, churn_pct: churn * 100, lifetime_months: Math.round(lifetime), fixed_per_store: r2(fixedPerStore), target_margin: c.target_margin, fee_pct: Math.round(fee * 1000) / 10 };
}
