// One-click sample data for every module, so the dashboard can be explored before real data exists.
// Every record is flagged `sample: true` (names people see start with "Sample ·") and
// removeSampleData() deletes exactly those records, leaving real data untouched.
import { DEFAULT_KPIS } from "./catalog.js";
import { SAMPLE_TEAM, SUGGESTED_ORG } from "./hr.js";
import { STARTER_ROADMAP } from "./product.js";
import { saudiStarter } from "./ops.js";
import { periodFor } from "./sop.js";
import { loadSamplePeople, removeSamplePeople } from "./peopleroutes.js";
import { loadSampleIntel, removeSampleIntel } from "./intel.js";

const DAY = 864e5;
const ago = (days, now) => new Date(now - days * DAY).toISOString();
const dateAgo = (days, now) => ago(days, now).slice(0, 10);
const S = (name) => `Sample · ${name}`;

export function hasSampleData(store, wsId) {
  const id = String(wsId);
  return ["deals", "support_tickets", "finance_expenses", "ops_tasks", "product_feedback", "hr_candidates", "notes", "people_employees"]
    .some((c) => store.db[c].some((x) => x.workspace_id === id && x.sample));
}

export function loadSampleData(store, wsId, now = Date.now()) {
  const id = String(wsId), counts = {};
  const tag = (x, extra = {}) => Object.assign(x, { sample: true }, extra);

  // ---- Knowledge
  counts.notes = 0;
  for (const [category, title, content] of [
    ["objections", "Common objections in demos", "1) \"AI ads look fake\": show 3 creatives from their own catalog first.\n2) \"My designer does this\": they can't make 3 creatives × every SKU and keep prices current.\n3) \"Too expensive\": compare with SAR 40 per design × products × 3."],
    ["customers", "Typical first customers", "Salla/Zid fashion, perfume and beauty stores in Riyadh and Jeddah, 300-5,000 products, SAR 15-60k/month on Snap and TikTok ads."],
    ["competitors", "Competitor notes", "Confect: tiered by product count, no Arabic focus (verify). Marpipe: sales-led, higher price (verify). Locally: design agencies at SAR 50-150 per design."],
  ]) { tag(store.addNote(id, { category, title: S(title), content }, false)); counts.notes++; }

  // ---- KPIs: load the SOP set if missing, then 8 weeks of values
  let kpis = store.listKpis(id);
  if (!kpis.length) { kpis = DEFAULT_KPIS.map((k) => tag(store.addKpi(id, k, false))); }
  const series = {
    "Signups / installs": [3, 5, 6, 9, 11, 14, 18, 23], "Listing conversion": [4.1, 4.6, 5.2, 5.0, 5.8, 6.3, 6.1, 6.9],
    "Activation rate": [20, 24, 27, 31, 33, 36, 39, 42], "Time to first creatives": [30, 26, 22, 19, 14, 12, 10, 8],
    "Trial-to-paid": [0, 0, 10, 12, 15, 17, 18, 21], "Demos booked": [2, 3, 3, 5, 4, 6, 7, 8],
    "Churn rate": [0, 0, 0, 5, 4, 3, 3, 2.5], "Creatives per product": [1.2, 1.5, 1.9, 2.2, 2.4, 2.8, 3.1, 3.3],
  };
  counts.kpi_values = 0;
  for (const [name, vals] of Object.entries(series)) {
    const k = kpis.find((x) => x.name === name); if (!k) continue;
    vals.forEach((v, i) => {
      const period = periodFor(k.frequency === "monthly" ? "monthly" : "weekly", new Date(now - (vals.length - 1 - i) * 7 * DAY));
      if (store.db.kpi_values.some((x) => x.kpi_id === k.id && x.period === period)) return;
      const row = store.logKpiValue(k.id, { period, value: v, note: "sample" }); row.sample = true; counts.kpi_values++;
    });
  }

  // ---- Sales: deals across every stage, with history
  const deals = [
    ["Oud & Amber", "Perfume", "Riyadh", "Salla", 320, "contacted", 9, 1], ["Abaya Lane", "Fashion", "Jeddah", "Salla", 1450, "trial", 28, 3],
    ["Sahara Sport", "Sportswear", "Dammam", "Shopify", 12500, "demo", 20, 6], ["Red Sea Beauty", "Beauty", "Jeddah", "Zid", 3900, "beta", 35, 8],
    ["Coast Optics", "Eyewear", "Khobar", "Zid", 780, "paying", 55, 4], ["Lavender Spa", "Wellness", "Riyadh", "Salla", 150, "paying", 48, 10],
    ["Najd Home", "Home & furniture", "Riyadh", "Shopify", 6400, "contacted", 14, 7], ["Dates House", "Food", "Buraidah", "Salla", 90, "lead", 3, 3],
    ["Hijaz Kids", "Kids", "Madinah", "Salla", 2100, "demo", 18, 2], ["Pearl Jewels", "Jewellery", "Jeddah", "Shopify", 1200, "paying", 60, 15],
    ["Tabuk Outdoors", "Outdoor", "Tabuk", "Salla", 540, "lead", 2, 2], ["Asir Honey", "Food", "Abha", "Salla", 60, "lost", 40, 25],
  ];
  const order = ["lead", "contacted", "demo", "beta", "trial", "paying"];
  // Win/loss reasons for Market intel (sample wording, not real customers).
  const reasons = { "Asir Honey": { lost_reason: "Sample: catalog too small to need it yet; keeps doing designs in Canva", competitor: "Canva (in-house)" },
    "Pearl Jewels": { won_reason: "Sample: Arabic templates and prices updated from the feed" }, "Coast Optics": { won_reason: "Sample: Zid catalog import" } };
  counts.deals = 0;
  for (const [name, category, city, platform, skus, stage, age, quiet] of deals) {
    const d = tag(store.addDeal(id, { name: S(name), category, city, platform, skus, contact_name: "", notes: "" }));
    store.db.deal_activities = store.db.deal_activities.filter((a) => a.deal_id !== d.id); // drop the "created now" row
    const acts = [{ type: "created", by: "you", text: "", at: age }];
    const path = stage === "lost" ? ["lead", "contacted", "lost"] : order.slice(0, order.indexOf(stage) + 1);
    path.slice(1).forEach((st, i) => acts.push({ type: "stage", by: "you", text: `${path[i]} → ${st}`, at: Math.max(quiet, age - (i + 1) * Math.ceil((age - quiet) / path.length)) }));
    acts.push({ type: "ai_draft", by: "ai", task: "opener", text: "السلام عليكم، سوّينا لكم ٣ إعلانات من كتالوجكم… (sample draft)", at: age - 1 });
    if (stage !== "lead") acts.push({ type: "sent", by: "you", task: "opener", text: "Opener sent on WhatsApp (sample)", at: age - 1 });
    for (const a of acts) { const row = store.addDealActivity(d.id, { type: a.type, by: a.by, text: a.text, task: a.task || null }, false); row.created_at = ago(a.at, now); row.sample = true; }
    Object.assign(d, { stage, created_at: ago(age, now), stage_changed_at: ago(quiet, now), last_activity_at: ago(quiet, now) }, reasons[name] || {});
    counts.deals++;
  }

  // ---- Support: help center + conversations
  counts.articles = 0;
  for (const [question, answer, language, category] of [
    ["How do I connect my product feed?", "Go to Settings → Feeds, paste your product feed URL (XML or CSV) and click Import. Your catalog appears within a few minutes.", "en", "feed-import"],
    ["Which store platforms work today?", "Today: any store with a custom product feed. The Salla app is in beta; Zid and Shopify apps are planned.", "en", "getting-started"],
    ["How do I add my logo and brand colours?", "Open Brand settings, upload your logo (PNG) and pick your colours and fonts. Every template updates automatically.", "en", "templates"],
    ["Do prices update automatically in my ads?", "Yes. When your feed changes, DPA AD re-renders the affected creatives with the new price and discount.", "en", "templates"],
    ["How do I export ads to Snapchat or TikTok?", "Download the creatives as a ZIP, or use the catalog feed link in your Snap or TikTok catalog manager.", "en", "video"],
    ["How do plans and video renders work?", "Plans are by number of products. Each plan includes monthly video renders; extra renders are SAR 184 per 100.", "en", "billing"],
    ["كيف أربط ملف المنتجات؟", "من الإعدادات ← الكتالوج، الصق رابط ملف المنتجات واضغط استيراد. تظهر منتجاتك خلال دقائق.", "ar", "feed-import"],
    ["هل تتحدث الأسعار تلقائياً في الإعلانات؟", "نعم، أي تغيير في السعر أو الخصم في ملف المنتجات ينعكس على الإعلانات تلقائياً.", "ar", "templates"],
  ]) { tag(store.addArticle(id, { question, answer, language, category }, false)); counts.articles++; }
  counts.tickets = 0;
  for (const [cust, storeName, channel, category, status, age, msgs, reason] of [
    ["Sample · Reem", "abayalane.sa", "WhatsApp", "feed-import", "resolved", 6, [["customer", "السلام عليكم، كيف أربط متجري في سلة؟"], ["ai", "وعليكم السلام! تطبيق سلة في مرحلة تجريبية حالياً. الآن تقدرين تلصقين رابط ملف المنتجات من الإعدادات ← الكتالوج."]], ""],
    ["Sample · Khalid", "coastoptics.sa", "Email", "templates", "resolved", 4, [["customer", "How do I add my logo to the templates?"], ["ai", "Open Brand settings, upload your logo as a PNG and every template updates automatically."]], ""],
    ["Sample · Noura", "redseabeauty.com", "WhatsApp", "billing", "needs_human", 1, [["customer", "I was charged twice this month, I want a refund for one of them"], ["ai", "Sorry about that. A team member will check your billing and follow up today. Could you share the email on your account?"]], "Refund / double charge"],
    ["Sample · Faris", "saharasport.sa", "Website chat", "feature-request", "ai_answered", 2, [["customer", "Can you make TikTok video ads from my catalog?"], ["ai", "Catalog-to-video templates are being built now. You'll be able to export them for TikTok and Snap. I've noted your interest."]], ""],
    ["Sample · Hessa", "lavenderspa.sa", "Email", "bug", "needs_human", 0, [["customer", "Some of my ads still show last week's prices"]], "Possible feed refresh bug"],
    ["Sample · Majed", "najdhome.sa", "App store review", "other", "new", 0, [["customer", "Great idea, but I need Zid support before I can use it."]], ""],
  ]) {
    const t = tag(store.addTicket(id, { channel, customer_name: cust, contact: "", store: storeName, category, status, escalation_reason: reason }));
    msgs.forEach(([from, text], i) => { const m = store.addTicketMessage(id, t.id, { from, text }); m.at = ago(age, now + i * 60e3); });
    Object.assign(t, { created_at: ago(age, now), updated_at: ago(age, now + msgs.length * 60e3), human_touched: false });
    counts.tickets++;
  }

  // ---- HR: suggested org + sample people and candidates
  const have = new Set(store.listHrRoles(id).map((r) => r.title.toLowerCase()));
  const added = SUGGESTED_ORG.filter((r) => !have.has(r.title.toLowerCase())).map((r) => tag(store.addHrRole(id, { location: "", duties: "", must_be_human: "", notes: "", reports_to: null, ...r }, false)));
  const ceo = store.listHrRoles(id).find((r) => r.department === "Leadership");
  if (ceo) for (const r of added) if (r.id !== ceo.id && !r.reports_to) r.reports_to = ceo.id;
  const byTitle = Object.fromEntries(store.listHrRoles(id).map((r) => [r.title, r]));
  for (const [title, name] of Object.entries(SAMPLE_TEAM.holders)) {
    const r = byTitle[title];
    if (r && !r.holder) Object.assign(r, { holder: name, sample_holder: true, prev_status: r.status, status: "active" });
  }
  const names = new Set(store.listHrCandidates(id).map((c) => c.name));
  counts.candidates = 0;
  for (const c of SAMPLE_TEAM.candidates) {
    if (names.has(c.name)) continue;
    const cand = store.addHrCandidate(id, { name: c.name, role_id: byTitle[c.role]?.id || null, source: c.source, cv_text: c.cv_text, email: "", phone: "", notes: "", sample: true });
    store.db.hr_activities = store.db.hr_activities.filter((a) => a.entity_id !== cand.id);
    Object.assign(cand, { stage: c.stage, score: c.score });
    if (c.screen) tag(store.addHrActivity(id, "candidate", cand.id, { type: "ai_draft", by: "sample", task: "screen", text: c.screen }, false));
    counts.candidates++;
  }
  counts.roles = added.length;

  // ---- Attendance & payroll: sample employees in India, a month of punches, a pending leave request
  if (!store.db.people_employees.some((e) => e.workspace_id === id && e.sample)) counts.employees = loadSamplePeople(store, id, now).employees;

  // ---- Finance
  counts.expenses = 0;
  for (const [vendor, category, amount_sar, recurring, vat_sar, age] of [
    ["Founder salary", "payroll", 15000, "monthly", 0, 30], ["Anthropic API", "ai_api", 1800, "monthly", 0, 28], ["Render servers", "hosting", 900, "monthly", 117.39, 27],
    ["Hostinger", "hosting", 1200, "yearly", 156.52, 200], ["Figma + Notion + Google Workspace", "tools", 650, "monthly", 84.78, 25], ["Freelance motion designer", "freelancers", 4000, "monthly", 0, 22],
    ["Snapchat ads", "marketing", 6500, "one-off", 847.83, 12], ["TikTok ads", "marketing", 3200, "one-off", 417.39, 8], ["CR renewal", "legal_gov", 1200, "one-off", 0, 40],
  ]) { tag(store.addExpense(id, { date: dateAgo(age, now), vendor: S(vendor), category, amount_sar, recurring, vat_sar, note: "", source: "manual" }, false)); counts.expenses++; }
  counts.income = 0;
  for (const [source, type, amount_sar, recurring, vat_sar, age, note] of [
    ["Coast Optics", "subscription", 1683.75, "monthly", 219.62, 20, "Growth plan"], ["Lavender Spa", "subscription", 746.25, "monthly", 97.34, 15, "Starter plan"],
    ["Pearl Jewels", "subscription", 1683.75, "monthly", 219.62, 10, "Growth plan"], ["Pearl Jewels", "setup", 1875, "one-off", 244.57, 10, "Template setup"],
    ["Angel investor", "investment", 187500, "one-off", 0, 75, "Pre-seed SAFE"],
  ]) { tag(store.addOps("finance_income", id, { date: dateAgo(age, now), source: S(source), type, amount_sar, vat_sar, recurring, note, deal_id: null, ended_at: null, entry: "manual" }, false)); counts.income++; }
  tag(store.addCash(id, { date: dateAgo(60, now), balance_sar: 420000, note: "sample" }));
  tag(store.addCash(id, { date: dateAgo(30, now), balance_sar: 392000, note: "sample" }));
  tag(store.addCash(id, { date: dateAgo(1, now), balance_sar: 365000, note: "sample" }));

  // ---- Operations
  const day = (n) => dateAgo(-n, now);
  counts.tasks = 0;
  for (const [title, owner_kind, owner, area, priority, due, status] of [
    ["Write the Salla app store listing (AR + EN)", "ai", "AI Marketer", "Marketing", 1, day(2), "doing"],
    ["Sign the Salla partner agreement", "human", "Founder & CEO", "Sales", 1, day(-2), "waiting"],
    ["Draft openers for 30 Riyadh fashion stores", "ai", "AI Prospector", "Sales", 2, day(4), "todo"],
    ["Turn repeated support questions into help articles", "ai", "AI Support", "Support", 2, day(5), "todo"],
    ["Approve next month's ad budget", "human", "Founder & CEO", "Finance", 2, day(1), "todo"],
    ["Screen Product Engineer CVs", "ai", "AI Recruiter", "People", 3, day(6), "doing"],
    ["Weekly KPI report", "ai", "AI Analyst", "Marketing", 3, day(-1), "done"],
  ]) { tag(store.addOps("ops_tasks", id, { title: S(title), owner_kind, owner, area, priority, due, status, notes: "", source: "manual", done_at: status === "done" ? ago(1, now) : null }, false)); counts.tasks++; }
  const dlHave = new Set(store.listOps("ops_deadlines", id).map((d) => d.title));
  counts.deadlines = 0;
  for (const d of saudiStarter(new Date(now))) if (!dlHave.has(d.title)) { tag(store.addOps("ops_deadlines", id, { ...d, done_at: null }, false)); counts.deadlines++; }
  for (const [name, purpose, cost_sar, renew, critical, owner] of [["Render", "Video and image rendering", 900, 9, true, "Founder"], ["Anthropic API", "AI drafts and AI Support", 1800, null, true, "Founder"], ["Hostinger", "Website and dashboard hosting", 100, 200, true, "Founder"], ["Figma", "Template design", 180, 40, false, "Designer"]])
    tag(store.addOps("ops_vendors", id, { name: S(name), purpose, cost_sar, renewal_date: renew == null ? null : day(renew), owner, critical, notes: "" }, false));
  tag(store.addOps("ops_incidents", id, { title: S("Video renders delayed after deploy"), severity: "SEV2", status: "resolved", started_at: ago(5, now), resolved_at: ago(5, now + 3 * 3600e3), impact: "About 30% of beta stores waited 2-3 hours for videos", notes: "", updates: [{ at: ago(5, now + 600e3), text: "Render queue backed up after a deploy" }, { at: ago(5, now + 3600e3), text: "Scaled workers from 2 to 6; queue draining" }, { at: ago(5, now + 3 * 3600e3), text: "All videos delivered; added a queue-length alert" }] }, false));

  // ---- Product
  const pHave = new Set(store.listOps("product_items", id).map((i) => i.title.toLowerCase()));
  for (const it of STARTER_ROADMAP) if (!pHave.has(it.title.toLowerCase())) tag(store.addOps("product_items", id, { ...it, target: null, notes: "", source: "starter", reviewed: true, starter: false }, false));
  const items = store.listOps("product_items", id), find = (t) => items.find((i) => i.title.startsWith(t))?.id || null;
  counts.feedback = 0;
  for (const [text, customer, source, link, age] of [
    ["Can you connect to Zid? We're on Zid", "Sample · Najd Home", "sales", "Zid app", 12], ["Zid integration please", "Sample · Dammam Mart", "support", "Zid app", 9],
    ["We need Zid, not Salla", "Sample · Hijaz Kids", "sales", "Zid app", 6], ["Arabic fonts look broken in the perfume template", "Sample · Oud & Amber", "support", "Arabic template pack", 5],
    ["I want videos for TikTok from my products", "Sample · Sahara Sport", "sales", "Catalog-to-video", 4], ["Video ads for Snap please", "Sample · Red Sea Beauty", "support", "Catalog-to-video", 3],
    ["Some ads still show last week's prices", "Sample · Lavender Spa", "support", null, 1], ["Can I see which creative won?", "Sample · Abaya Lane", "sales", null, 1],
  ]) { const f = tag(store.addOps("product_feedback", id, { text, customer, source, item_id: link ? find(link) : null, dismissed: false }, false)); f.created_at = ago(age, now); counts.feedback++; }
  tag(store.addOps("product_releases", id, { version: "Sample v0.3", date: dateAgo(14, now), item_ids: [], notes: "Feed import speed-up, brand fonts", status: "released" }, false));
  tag(store.addOps("product_releases", id, { version: "Sample v0.4", date: day(10), item_ids: [find("Salla app")].filter(Boolean), notes: "", status: "draft" }, false));

  // ---- ROAS results: 4 weeks of ad-level results for three sample stores
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  counts.roas_rows = 0;
  for (const [storeName, channel, aov] of [["Coast Optics", "Snapchat", 260], ["Pearl Jewels", "Meta", 410], ["Red Sea Beauty", "TikTok", 180]]) {
    const deal = store.listDeals(id).find((d) => d.name === S(storeName));
    const batch = tag(store.addOps("roas_batches", id, { store: S(storeName), deal_id: deal?.id || null, channel, rows: 0, from: dateAgo(28, now), to: dateAgo(1, now) }, false));
    for (const [template, type, cvr, ctr] of [["Bold Price Tag", "designed", 0.034, 0.015], ["Ramadan Gold", "designed", 0.031, 0.016], ["Story Video", "video", 0.036, 0.019], ["Plain packshot", "plain", 0.024, 0.011]]) {
      for (let dAgo = 28; dAgo >= 1; dAgo--) {
        const spend = Math.round(90 + rnd() * 110);
        const impressions = Math.round((spend / 18) * 1000);
        const clicks = Math.round(impressions * ctr * (0.85 + rnd() * 0.3));
        const purchases = Math.round(clicks * cvr * (0.7 + rnd() * 0.6));
        tag(store.addOps("roas_rows", id, { batch_id: batch.id, store: S(storeName), deal_id: deal?.id || null, channel, date: dateAgo(dAgo, now), ad_name: `${storeName} | [tpl:${template}] | ${type}`, template, creative_type: type, spend_sar: spend, revenue_sar: Math.round(purchases * aov * (0.9 + rnd() * 0.2)), impressions, clicks, purchases }, false));
        batch.rows++; counts.roas_rows++;
      }
    }
  }

  // ---- SOP: a few ticks this period
  for (const [cadence, step] of [["setup", "brief"], ["setup", "kpis"], ["weekly", "log"], ["weekly", "report"]]) {
    const period = periodFor(cadence, new Date(now)), key = `${cadence}:${step}`;
    if (!store.db.sop_checks.some((c) => c.workspace_id === id && c.period === period && c.step === key)) store.db.sop_checks.push({ workspace_id: id, period, step: key, done_at: ago(0, now), sample: true });
  }

  Object.assign(counts, loadSampleIntel(store, id, now)); // Market intel: sample competitors and signals
  store.save();
  return counts;
}

export function removeSampleData(store, wsId) {
  const id = String(wsId), db = store.db, mine = (x) => x.workspace_id === id;
  const drop = (coll) => { const before = db[coll].length; db[coll] = db[coll].filter((x) => !(mine(x) && x.sample)); return before - db[coll].length; };
  const removed = {};
  const dealIds = new Set(db.deals.filter((d) => mine(d) && d.sample).map((d) => d.id));
  db.deal_activities = db.deal_activities.filter((a) => !dealIds.has(a.deal_id));
  removed.deals = drop("deals");
  const kpiIds = new Set(db.kpis.filter((k) => mine(k) && k.sample).map((k) => k.id));
  const myKpis = new Set(db.kpis.filter(mine).map((k) => k.id));
  db.kpi_values = db.kpi_values.filter((v) => !(myKpis.has(v.kpi_id) && (v.sample || kpiIds.has(v.kpi_id))));
  removed.kpis = drop("kpis");
  for (const c of ["notes", "support_articles", "support_tickets", "finance_expenses", "finance_income", "finance_cash", "ops_tasks", "ops_deadlines", "ops_vendors", "ops_incidents", "product_feedback", "product_releases", "sop_checks", "roas_rows", "roas_batches"]) removed[c] = drop(c);
  // Product items added by samples go; feedback links to them are cleared.
  const itemIds = new Set(db.product_items.filter((i) => mine(i) && i.sample).map((i) => i.id));
  for (const f of db.product_feedback) if (itemIds.has(f.item_id)) f.item_id = null;
  removed.product_items = drop("product_items");
  // HR: sample candidates and their history, sample-added roles, sample role holders.
  const candIds = new Set(db.hr_candidates.filter((c) => mine(c) && c.sample).map((c) => c.id));
  db.hr_activities = db.hr_activities.filter((a) => !(candIds.has(a.entity_id) || (mine(a) && a.sample)));
  removed.candidates = drop("hr_candidates");
  const roleIds = new Set(db.hr_roles.filter((r) => mine(r) && r.sample).map((r) => r.id));
  for (const c of db.hr_candidates) if (roleIds.has(c.role_id)) c.role_id = null;
  removed.roles = drop("hr_roles");
  for (const r of db.hr_roles) if (mine(r) && r.sample_holder) Object.assign(r, { holder: "", sample_holder: false, status: r.prev_status || "planned" });
  Object.assign(removed, removeSamplePeople(store, id));
  Object.assign(removed, removeSampleIntel(store, id));
  store.save();
  return removed;
}
