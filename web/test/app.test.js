import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { createApp } from "../lib/app.js";
import { PLAYBOOKS } from "../lib/catalog.js";
import { LLMError, demoProvider } from "../lib/engine.js";
import { Store } from "../lib/store.js";

const PASSWORD = "correct horse";
let server, base, cookie, store, dir, appRef;
const prompts = [];
let failNext = false;

const provider = {
  name: "test", model: "test",
  async generate({ prompt, onText }) {
    prompts.push(prompt);
    if (failNext) { failNext = false; throw new LLMError("boom"); }
    return demoProvider().generate({ prompt, onText });
  },
};

const call = (p, opts = {}) => fetch(base + p, {
  redirect: "manual", ...opts,
  headers: { "Content-Type": "application/json", cookie, ...(opts.headers || {}) },
});
const json = async (p, opts) => (await call(p, opts)).json();
const post = (p, body) => call(p, { method: "POST", body: JSON.stringify(body ?? {}) });

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "mwiz-"));
  // Legacy history from the first dashboard version must be imported.
  fs.writeFileSync(path.join(dir, "assets.json"), JSON.stringify([
    { id: "u2", playbook: "positioning", title: "Positioning & Messaging Foundation", inputs: {}, text: "## Newer positioning", createdAt: 2000 },
    { id: "u1", playbook: "pricing_strategy", title: "Pricing & Packaging Strategy", inputs: {}, text: "## Older pricing", createdAt: 1000 },
  ]));
  store = new Store(dir);
  appRef = createApp({ store, provider, password: PASSWORD });
  server = appRef.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); appRef.locals.crm.flush(); fs.rmSync(dir, { recursive: true, force: true }); });

test("login is required and works", async () => {
  assert.equal((await call("/")).status, 302);
  assert.equal((await call("/api/workspaces")).status, 401);
  assert.equal((await call("/healthz")).status, 200);
  const bad = await fetch(base + "/login", { method: "POST", redirect: "manual", body: new URLSearchParams({ password: "nope" }) });
  assert.match(bad.headers.get("location"), /e=bad/);
  const ok = await fetch(base + "/login", { method: "POST", redirect: "manual", body: new URLSearchParams({ password: PASSWORD }) });
  cookie = ok.headers.get("set-cookie").split(";")[0];
  assert.equal((await call("/api/workspaces")).status, 200);
  assert.equal((await call("/vendor/marked.js")).status, 200);
});

test("first start seeds DPA AD, the pricing note and legacy history", async () => {
  const [ws] = await json("/api/workspaces");
  assert.equal(ws.brief.company_name, "DPA AD");
  const notes = await json(`/api/workspaces/${ws.id}/notes`);
  assert.ok(notes.some((n) => n.category === "pricing"));
  const assets = await json(`/api/workspaces/${ws.id}/assets`);
  assert.deepEqual(assets.map((a) => a.text), ["## Newer positioning", "## Older pricing"]);
});

test("every playbook streams, saves, and uses brand memory, knowledge and KPIs", async () => {
  const ws = await (await post("/api/workspaces", { company_name: "Acme" })).json();
  await post(`/api/workspaces/${ws.id}/notes`, { category: "results", title: "Case", content: "ROAS 2.1 -> 3.4" });
  for (const pb of PLAYBOOKS) {
    const text = await (await post(`/api/workspaces/${ws.id}/run/${pb.key}`, { inputs: {} })).text();
    assert.match(text, /\[\[MWIZ_SAVED\]\]\d+$/, pb.key);
  }
  const icp = prompts.find((p) => p.includes('title="ICP & Buyer Personas"'));
  assert.match(icp, /<prior_work playbook="positioning"/);
  assert.match(icp, /ROAS 2\.1 -> 3\.4/);
  assert.match(prompts.find((p) => p.includes("Outbound Email")), /\{first_name\}/);
  assert.match(prompts.find((p) => p.includes("KPI Report")), /<kpi_data>/);
  assert.doesNotMatch(icp, /<kpi_data>/);
  assert.equal((await json(`/api/workspaces/${ws.id}/assets`)).length, PLAYBOOKS.length);
  assert.equal((await post(`/api/workspaces/${ws.id}/run/nope`)).status, 404);
});

test("generation errors are reported in the stream and nothing is saved", async () => {
  const ws = await (await post("/api/workspaces", { company_name: "Err Co" })).json();
  failNext = true;
  const text = await (await post(`/api/workspaces/${ws.id}/run/positioning`)).text();
  assert.match(text, /\[\[MWIZ_ERROR\]\]boom/);
  assert.equal((await json(`/api/workspaces/${ws.id}/assets`)).length, 0);
});

test("KPIs, values, gaps and export", async () => {
  const ws = await (await post("/api/workspaces", { company_name: "Gap Co" })).json();
  const b = `/api/workspaces/${ws.id}`;
  let { gaps } = await json(`${b}/gaps`);
  assert.ok(gaps.some((g) => g.field === "pricing"));
  assert.ok(gaps.some((g) => g.field === "setup"));

  const kpis = await (await post(`${b}/kpis/load-defaults`)).json();
  assert.equal(kpis.length, 20);
  assert.deepEqual(await (await post(`${b}/kpis/load-defaults`)).json(), []);
  await post(`${b}/kpis/${kpis[2].id}/values`, { period: "2026-W43", value: 40 });
  await post(`${b}/kpis/${kpis[2].id}/values`, { period: "2026-W44", value: 55 });
  await post(`${b}/kpis/${kpis[2].id}/values`, { period: "2026-W44", value: 60 });
  assert.equal((await post(`${b}/kpis/${kpis[2].id}/values`, { period: "x", value: "abc" })).status, 422);
  assert.equal((await post(`${b}/kpis/99999/values`, { period: "x", value: 1 })).status, 404);
  assert.equal((await json(`${b}/kpis`)).values.length, 2);

  await post(`${b}/run/kpi_report`);
  assert.match(prompts.at(-1), /2026-W43=40, 2026-W44=60/);

  ({ gaps } = await json(`${b}/gaps`));
  assert.ok(!gaps.some((g) => g.area === "kpis"));
  assert.equal((await post(`${b}/notes`, { category: "nope", title: "t", content: "c" })).status, 422);

  const md = await (await call(`${b}/export`)).text();
  assert.match(md, /^# Gap Co - Marketing Kit/);
  assert.equal((await call(b, { method: "DELETE" })).status, 204);
  assert.equal((await call(b)).status, 404);
});

test("data survives a restart", async () => {
  const reopened = new Store(dir);
  assert.ok(reopened.listWorkspaces().some((w) => w.brief.company_name === "Acme"));
  assert.equal(reopened.listWorkspaces()[0].brief.company_name, "DPA AD");
});

test("SOP: every step links to a real page or playbook", async () => {
  const { SOP } = await import("../lib/sop.js");
  const routes = ["people", "workforce", "studio", "crm", "access", "results", "product", "ops", "finance", "command", "support", "team", "pipeline", "sop", "overview", "brief", "knowledge", "kpis", "playbooks", "library"];
  const keys = new Set(PLAYBOOKS.map((p) => p.key));
  for (const s of SOP) for (const st of s.steps) {
    if (st.go) assert.ok(routes.includes(st.go), `${s.cadence}:${st.id} -> ${st.go}`);
    if (st.param) assert.ok(keys.has(st.param), `${s.cadence}:${st.id} -> ${st.param}`);
  }
});

test("SOP: ticks are shared, per period, and can be undone", async () => {
  const [ws] = await json("/api/workspaces");
  const url = `/api/workspaces/${ws.id}/sop`;
  assert.equal((await post(url, { cadence: "weekly", step: "nope", done: true })).status, 422);
  assert.equal((await post(url, { cadence: "weekly", step: "log", done: true })).status, 200);
  let r = await json(url);
  assert.match(r.periods.weekly, /^\d{4}-W\d{2}$/);
  assert.deepEqual(r.checks.map((c) => c.step), ["weekly:log"]);
  await post(url, { cadence: "weekly", step: "log", done: false });
  r = await json(url);
  assert.equal(r.checks.length, 0);
});

test("SOP: ISO week, month and quarter periods", async () => {
  const { periodFor } = await import("../lib/sop.js");
  const d = new Date(Date.UTC(2026, 9, 31));
  assert.equal(periodFor("weekly", d), "2026-W44");
  assert.equal(periodFor("monthly", d), "2026-10");
  assert.equal(periodFor("quarterly", d), "2026-Q4");
  assert.equal(periodFor("weekly", new Date(Date.UTC(2027, 0, 1))), "2026-W53");
});

test("old DAP ADS data is renamed to DPA AD on start", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "mwiz-mig-"));
  fs.writeFileSync(path.join(d, "db.json"), JSON.stringify({ seq: 1, workspaces: [{ id: "1", brief: { company_name: "DAP ADS", product_name: "DAP ADS", website: "" } }] }));
  const s = new Store(d);
  assert.equal(s.listWorkspaces()[0].brief.company_name, "DPA AD");
  assert.equal(s.listWorkspaces()[0].brief.website, "https://dpa.ad");
  assert.deepEqual(s.db.sop_checks, []);
});

test("sales: deals, AI-first next steps, stage log, drafts and sent", async () => {
  const [ws] = await json("/api/workspaces");
  const base = `/api/workspaces/${ws.id}/deals`;
  assert.equal((await post(base, { city: "Riyadh" })).status, 422);
  const small = await (await post(base, { name: "Oud House", city: "Riyadh", platform: "Salla", skus: 320 })).json();
  assert.equal(small.stage, "lead");
  assert.equal(small.plan, "Starter");
  assert.equal(small.next.owner, "ai");
  assert.equal(small.next.task, "opener");

  // Large deals at demo need a human; small ones stay with AI.
  const big = await (await post(base, { name: "Sahara Sport", platform: "Shopify", skus: 12500, stage: "demo" })).json();
  assert.equal(big.plan, "Scale");
  assert.equal(big.next.owner, "you");
  let list = await json(base);
  assert.deepEqual(list.summary.needs_you.map((n) => n.name), ["Sahara Sport"]);
  assert.equal(list.summary.ai_share, 50);

  // Stage change is logged; unknown stage rejected.
  assert.equal((await call(`${base}/${small.id}`, { method: "PUT", body: JSON.stringify({ stage: "nope" }) })).status, 422);
  await call(`${base}/${small.id}`, { method: "PUT", body: JSON.stringify({ stage: "contacted" }) });
  let detail = await json(`${base}/${small.id}`);
  assert.ok(detail.activities.some((a) => a.type === "stage" && a.text === "lead → contacted"));

  // AI draft streams, is saved as an ai_draft activity, and uses the deal + brief.
  const res = await post(`${base}/${small.id}/ai/opener`, {});
  const body = await res.text();
  assert.match(body, /\[\[MWIZ_SAVED\]\]/);
  assert.match(prompts.at(-1), /Oud House/);
  assert.match(prompts.at(-1), /<brand_brief>/);
  assert.equal((await post(`${base}/${small.id}/ai/nope`, {})).status, 404);
  assert.equal((await post(`${base}/${small.id}/activities`, { type: "sent", task: "opener", text: "hi" })).status, 201);
  detail = await json(`${base}/${small.id}`);
  assert.ok(detail.activities.some((a) => a.type === "ai_draft" && a.by === "ai"));
  assert.ok(detail.activities.some((a) => a.type === "sent" && a.by === "you"));
  list = await json(base);
  assert.equal(list.summary.agents.prospector.drafts, 1);
  assert.equal(list.summary.agents.prospector.sent, 1);

  assert.equal((await call(`${base}/${big.id}`, { method: "DELETE" })).status, 204);
  assert.equal((await call(`${base}/${big.id}`)).status, 404);
});

test("hr: suggested org, roles, AI screening with score, human-only steps", async () => {
  const [ws] = await json("/api/workspaces");
  const base = `/api/workspaces/${ws.id}/hr`;
  assert.equal((await post(`${base}/suggested-org`, {})).status, 201);
  let hr = await json(base);
  assert.ok(hr.summary.agents >= 5);
  assert.ok(hr.roles.some((r) => r.kind === "human" && r.must_be_human));
  // Loading twice adds nothing new.
  assert.equal((await (await post(`${base}/suggested-org`, {})).json()).added, 0);
  const engineer = hr.roles.find((r) => r.title.startsWith("Product Engineer"));
  const ceo = hr.roles.find((r) => r.department === "Leadership");
  assert.equal(engineer.reports_to, ceo.id);

  assert.equal((await post(`${base}/roles`, { title: "" })).status, 422);
  assert.equal((await call(`${base}/roles/${engineer.id}`, { method: "PUT", body: JSON.stringify({ reports_to: engineer.id }) })).status, 422);
  const jp = await (await post(`${base}/roles/${engineer.id}/ai/job_post`, {})).text();
  assert.match(jp, /\[\[MWIZ_SAVED\]\]/);
  assert.match(prompts.at(-1), /Product Engineer/);

  // Candidate without CV: a person must add it. With CV: AI screens, sets score and stage.
  const noCv = await (await post(`${base}/candidates`, { name: "Sara", role_id: engineer.id })).json();
  assert.equal(noCv.next.owner, "you");
  assert.equal((await post(`${base}/candidates/${noCv.id}/ai/screen`, {})).status, 422);
  const cand = await (await post(`${base}/candidates`, { name: "Omar", role_id: engineer.id, cv_text: "5 years Node.js, built Salla apps" })).json();
  assert.equal(cand.next.owner, "ai");
  assert.equal(cand.next.task, "screen");
  // Demo output has no score line, so the stage moves but the score stays empty.
  await (await post(`${base}/candidates/${cand.id}/ai/screen`, {})).text();
  assert.match(prompts.at(-1), /Ignore name, gender, age, nationality/);
  let c = (await json(`${base}/candidates/${cand.id}`)).candidate;
  assert.equal(c.stage, "screened");
  assert.equal(c.next.owner, "you"); // no score in the screen: a person decides
  await call(`${base}/candidates/${cand.id}`, { method: "PUT", body: JSON.stringify({ stage: "interview" }) });
  hr = await json(base);
  assert.ok(hr.summary.needs_you.some((n) => n.name === "Omar"));

  // Deleting a role detaches its candidates.
  assert.equal((await call(`${base}/roles/${engineer.id}`, { method: "DELETE" })).status, 204);
  c = (await json(`${base}/candidates/${cand.id}`)).candidate;
  assert.equal(c.role_id, null);
});

test("hr: score parsing", async () => {
  const { parseScore } = await import("../lib/hr.js");
  assert.equal(parseScore("SCORE: 8/10\n## Summary"), 8);
  assert.equal(parseScore("score : 6.5 / 10"), 6.5);
  assert.equal(parseScore("no score"), null);
  assert.equal(parseScore("SCORE: 14/10"), 10);
});

test("hr: sample team loads DPA AD roles and people, and removes cleanly", async () => {
  const [ws] = await json("/api/workspaces");
  const base = `/api/workspaces/${ws.id}/hr`;
  const r = await (await post(`${base}/sample-team`, {})).json();
  assert.ok(r.people >= 5);
  let hr = await json(base);
  assert.ok(hr.roles.some((x) => x.title === "Template & Motion Designer"));
  assert.ok(hr.roles.some((x) => x.title === "AI Support" && x.status === "active"));
  const samples = hr.candidates.filter((c) => c.sample);
  assert.ok(samples.every((c) => c.name.startsWith("Sample ·")));
  assert.ok(samples.some((c) => c.stage === "offer" && c.next.owner === "you"));
  const sales = hr.roles.find((x) => x.title === "Sales & Partnerships Lead (KSA)");
  assert.equal(sales.status, "active");
  // A real name replaces the sample: it is kept when samples are removed.
  const content = hr.roles.find((x) => x.title === "Arabic Content & Creator Partnerships");
  await call(`${base}/roles/${content.id}`, { method: "PUT", body: JSON.stringify({ holder: "Real Person" }) });
  assert.equal((await call(`${base}/sample-team`, { method: "DELETE" })).status, 204);
  hr = await json(base);
  assert.equal(hr.candidates.filter((c) => c.sample).length, 0);
  assert.equal(hr.roles.find((x) => x.id === sales.id).holder, "");
  assert.equal(hr.roles.find((x) => x.id === sales.id).status, "planned");
  assert.equal(hr.roles.find((x) => x.id === content.id).holder, "Real Person");
});

test("support: help center parsing, reply contract and escalation", async () => {
  const { parseArticles, parseReply } = await import("../lib/support.js");
  const arts = parseArticles("### How do I start?\nPaste your feed URL.\n\n### Is video included?\nYes on Growth.\n## العربية\n### كيف أبدأ؟\nالصق رابط الكتالوج.");
  assert.deepEqual(arts.map((a) => a.language), ["en", "en", "ar"]);
  const ok = parseReply('META {"category":"feed-import","language":"en","escalate":false,"reason":""}\n\nPaste your feed URL in Settings.');
  assert.equal(ok.escalate, false);
  assert.equal(ok.category, "feed-import");
  assert.equal(ok.reply, "Paste your feed URL in Settings.");
  const refund = parseReply('META {"category":"billing","language":"ar","escalate":true,"reason":"refund request"}\n\nبيتواصل معك أحد من الفريق.');
  assert.equal(refund.escalate, true);
  // No META line: never trust it, a person checks.
  assert.equal(parseReply("Sure, here's a refund!").escalate, true);
});

test("support: inbox, articles, AI reply and the public chat switch", async () => {
  const [ws] = await json("/api/workspaces");
  const sb = `/api/workspaces/${ws.id}/support`;
  assert.equal((await post(`${sb}/articles`, { question: "How do I connect Salla?", answer: "Settings → Feeds → Salla." })).status, 201);
  assert.equal((await post(`${sb}/tickets`, {})).status, 422);
  const t = await (await post(`${sb}/tickets`, { customer_name: "Abaya Lane", channel: "WhatsApp", message: "How do I connect my Salla store?" })).json();
  const r = await (await post(`${sb}/tickets/${t.id}/ai-reply`, {})).json();
  assert.match(prompts.at(-1), /How do I connect Salla\?/);
  assert.match(prompts.at(-1), /Refunds, chargebacks/);
  assert.equal(r.escalate, true); // demo output has no META line
  await post(`${sb}/tickets/${t.id}/messages`, { from: "you", text: "Go to Settings → Feeds." });
  await call(`${sb}/tickets/${t.id}`, { method: "PUT", body: JSON.stringify({ status: "resolved" }) });
  let sup = await json(sb);
  assert.equal(sup.summary.articles, 1);
  assert.equal(sup.tickets[0].status, "resolved");
  assert.equal(sup.summary.ai_resolved_pct, 0); // a person replied

  // Public chat: off by default, then on with a key.
  const s1 = await (await call(`${sb}/settings`, { method: "PUT", body: JSON.stringify({ widget_enabled: false }) })).json();
  const pub = (path, body) => fetch(base + path, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json" }, body: body && JSON.stringify(body) });
  assert.equal((await pub(`/api/public/support/${s1.widget_key}/chat`, { message: "hi" })).status, 404);
  await call(`${sb}/settings`, { method: "PUT", body: JSON.stringify({ widget_enabled: true }) });
  assert.equal((await pub(`/support/${s1.widget_key}`)).status, 200);
  const first = await (await pub(`/api/public/support/${s1.widget_key}/chat`, { message: "I want a refund" })).json();
  assert.ok(first.token);
  assert.equal(first.handed_over, true);
  assert.equal(first.reply, null); // unchecked AI text is never shown to the customer
  // Once with a person, AI stays quiet.
  const second = await (await pub(`/api/public/support/${s1.widget_key}/chat`, { message: "hello?", token: first.token })).json();
  assert.equal(second.reply, null);
  sup = await json(sb);
  const chat = sup.tickets.find((x) => x.channel === "Website chat");
  assert.equal(chat.status, "needs_human");
  assert.equal(chat.count, 2); // two customer messages; the unchecked AI text was not posted
  assert.equal(chat.public_token, undefined);
});

test("command center: one snapshot across modules", async () => {
  const [ws] = await json("/api/workspaces");
  const d = await json(`/api/workspaces/${ws.id}/command`);
  assert.equal(d.company, ws.brief.company_name);
  assert.equal(d.goal.arr_goal, 100_000_000);
  assert.equal(d.goal.arr, d.revenue.paying_mrr * 12);
  assert.ok(d.goal.next_milestone > d.goal.arr);
  assert.deepEqual(d.work.modules.map((m) => m.module), ["Marketing", "Sales", "Support", "Outreach", "Hiring"]);
  assert.ok(d.work.ai > 0); // earlier tests ran playbooks and AI drafts this week
  assert.ok(Array.isArray(d.needs) && d.needs.every((n) => ["Sales", "Support", "Hiring", "Finance", "Operations", "Product", "Compliance"].includes(n.module)));
  assert.ok(d.needs.some((n) => n.module === "Support")); // the escalated chat from the support test
  assert.equal(d.sop.length, 4);
  assert.ok(d.feed.length > 0 && d.feed.length <= 14);
  assert.ok(d.feed.every((f, i) => i === 0 || d.feed[i - 1].at >= f.at));
  assert.ok(d.data_completeness >= 0 && d.data_completeness <= 100);
});

test("finance: burn, runway, budgets, forecast, VAT and AI import", async () => {
  const [ws] = await json("/api/workspaces");
  const fb = `/api/workspaces/${ws.id}/finance`;
  let f = await json(fb);
  assert.ok(f.snapshot.needs.some((n) => /bank balance/.test(n.text)));
  assert.equal((await post(`${fb}/expenses`, { vendor: "", amount_sar: 10 })).status, 422);
  await post(`${fb}/expenses`, { vendor: "Anthropic", amount_sar: 3000, category: "ai_api", recurring: "monthly" });
  await post(`${fb}/expenses`, { vendor: "Hostinger", amount_sar: 1200, category: "hosting", recurring: "yearly", vat_sar: 156.52 });
  await post(`${fb}/expenses`, { vendor: "Snap ads", amount_sar: 13000, category: "marketing", recurring: "one-off" });
  await post(`${fb}/cash`, { date: new Date().toISOString().slice(0, 10), balance_sar: 200000 });
  await call(`${fb}/settings`, { method: "PUT", body: JSON.stringify({ include_hires: false, mrr_growth_pct: 10 }) });
  f = await json(fb);
  const s = f.snapshot;
  assert.equal(s.costs.run_rate_sar, 3100); // 3000 monthly + 1200/12
  assert.equal(s.costs.month_burn_sar, 16100);
  const mkt = s.costs.by_category.find((c) => c.id === "marketing");
  assert.equal(mkt.budget, 11250); // $3,000 default marketing budget
  assert.equal(mkt.over, true);
  assert.ok(s.needs.some((n) => /over budget/.test(n.text)));
  assert.equal(s.forecast.months.length, 12);
  assert.ok(s.runway_months > 0);
  assert.equal(s.vat.input_vat_sar, 157);
  assert.equal((await call(`${fb}/settings`, { method: "PUT", body: JSON.stringify({ mrr_growth_pct: 999 }) })).status, 422);

  // AI import: demo output is not JSON, so nothing is proposed or saved.
  const bad = await post(`${fb}/expenses/ai-import`, { text: "2026-10-03 ANTHROPIC USD 120" });
  assert.equal(bad.status, 422);
  const { parseImport } = await import("../lib/finance.js");
  const items = parseImport('Here: [{"date":"2026-10-03","vendor":"Anthropic","amount_sar":450,"vat_sar":0,"category":"ai_api","recurring":"monthly","note":"USD 120 at 3.75"},{"date":"x","vendor":"Refund","amount_sar":-5}]');
  assert.equal(items.length, 1);
  assert.equal(items[0].category, "ai_api");
  const saved = await (await post(`${fb}/expenses/bulk`, { items })).json();
  assert.equal(saved.saved, 1);

  // AI CFO report streams and is stored.
  const rep = await (await post(`${fb}/ai/monthly_report`, {})).text();
  assert.match(rep, /\[\[MWIZ_SAVED\]\]/);
  assert.match(prompts.at(-1), /"cash_sar": 200000/);
  f = await json(fb);
  assert.equal(f.reports.length, 1);

  // Command Center shows runway and finance needs.
  const cc = await json(`/api/workspaces/${ws.id}/command`);
  assert.equal(cc.finance.cash_sar, 200000);
  assert.ok(cc.needs.some((n) => n.module === "Finance"));
});

test("operations: tasks, AI plan parsing, deadlines roll forward, stack and incidents", async () => {
  const [ws] = await json("/api/workspaces");
  const ob = `/api/workspaces/${ws.id}/ops`;
  assert.equal((await post(`${ob}/tasks`, { title: "" })).status, 422);
  const t = await (await post(`${ob}/tasks`, { title: "Sign the Salla partner agreement", owner_kind: "human", owner: "Founder & CEO", area: "Sales", due: "2020-01-01" })).json();
  await post(`${ob}/tasks`, { title: "Draft the Salla app listing copy", owner_kind: "ai", owner: "AI Marketer", area: "Marketing" });
  let o = await json(ob);
  assert.equal(o.snapshot.tasks.open, 2);
  assert.equal(o.snapshot.tasks.ai_owned_pct, 50);
  assert.ok(o.snapshot.needs.some((n) => /Overdue task: Sign the Salla/.test(n.text)));
  await call(`${ob}/tasks/${t.id}`, { method: "PUT", body: JSON.stringify({ status: "done" }) });
  o = await json(ob);
  assert.equal(o.snapshot.tasks.done_week, 1);

  // AI planner: demo output isn't JSON, so nothing is proposed.
  assert.equal((await post(`${ob}/plan`, { goal: "Launch the Salla app" })).status, 422);
  const { parsePlan, rollForward } = await import("../lib/ops.js");
  const plan = parsePlan('[{"title":"Write app listing","owner_kind":"ai","owner":"AI Marketer","area":"Marketing","priority":1,"due_in_days":3,"why":"x"},{"title":"Sign agreement","owner_kind":"human","owner":"Founder & CEO","area":"Nope","priority":9}]');
  assert.equal(plan[1].area, "Operations");
  assert.equal(plan[1].priority, 2);
  assert.equal((await (await post(`${ob}/tasks/bulk`, { items: plan, goal: "Launch" })).json()).saved, 2);

  // Saudi starter calendar loads once; repeating deadlines roll forward when done.
  assert.ok((await (await post(`${ob}/deadlines/starter`, {})).json()).added >= 6);
  assert.equal((await (await post(`${ob}/deadlines/starter`, {})).json()).added, 0);
  assert.equal(rollForward("2026-01-31", "quarterly"), "2026-05-01");
  assert.equal(rollForward("2026-03-15", "monthly"), "2026-04-15");
  assert.equal(rollForward("2026-03-15", "none"), null);
  o = await json(ob);
  const gosi = o.deadlines.find((d) => d.title.startsWith("GOSI"));
  const rolled = await (await call(`${ob}/deadlines/${gosi.id}`, { method: "PUT", body: JSON.stringify({ done: true }) })).json();
  assert.equal(rolled.due, rollForward(gosi.due, "monthly"));
  assert.equal(rolled.done_at, null);
  const fixed = await (await call(`${ob}/deadlines/${gosi.id}`, { method: "PUT", body: JSON.stringify({ due: "2027-01-15" }) })).json();
  assert.equal(fixed.starter, false); // a person set the real date

  // Tool stack: renewal shows as a deadline.
  const soon = new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10);
  await post(`${ob}/vendors`, { name: "Render", purpose: "Rendering servers", cost_sar: 900, renewal_date: soon, critical: true });
  o = await json(ob);
  assert.ok(o.snapshot.deadlines.some((d) => d.from_vendor && d.title === "Renew Render"));
  assert.ok(o.snapshot.needs.some((n) => /Renew Render/.test(n.text)));
  assert.ok(o.snapshot.stack.cost_sar >= 900);

  // Incidents: open SEV1 needs a person; AI drafts notice + postmortem.
  const inc = await (await post(`${ob}/incidents`, { title: "Video renders failing", severity: "SEV1", impact: "All Salla stores" })).json();
  await call(`${ob}/incidents/${inc.id}`, { method: "PUT", body: JSON.stringify({ update: "Queue worker restarted" }) });
  o = await json(ob);
  assert.ok(o.snapshot.needs.some((n) => /SEV1 open/.test(n.text)));
  const draft = await (await post(`${ob}/ai/incident`, { incident_id: inc.id })).text();
  assert.match(draft, /\[\[MWIZ_SAVED\]\]/);
  assert.match(prompts.at(-1), /Queue worker restarted/);
  await call(`${ob}/incidents/${inc.id}`, { method: "PUT", body: JSON.stringify({ status: "resolved" }) });
  o = await json(ob);
  assert.equal(o.snapshot.incidents.open, 0);
  const cc = await json(`/api/workspaces/${ws.id}/command`);
  assert.ok(cc.ops.open_tasks >= 3);
});

test("product: roadmap, feedback from support, AI clusters, specs and releases", async () => {
  const [ws] = await json("/api/workspaces");
  const pb = `/api/workspaces/${ws.id}/product`;
  assert.ok((await (await post(`${pb}/items/starter`, {})).json()).added >= 8);
  assert.equal((await (await post(`${pb}/items/starter`, {})).json()).added, 0);
  let p = await json(pb);
  const salla = p.items.find((i) => i.title === "Salla app");
  assert.equal(salla.status, "building");
  assert.ok(p.snapshot.counts.now >= 1);

  // Declining needs a reason.
  const api2 = p.items.find((i) => i.title === "Public API");
  assert.equal((await call(`${pb}/items/${api2.id}`, { method: "PUT", body: JSON.stringify({ status: "not_doing" }) })).status, 422);
  const declined = await (await call(`${pb}/items/${api2.id}`, { method: "PUT", body: JSON.stringify({ status: "not_doing", reason: "Focus on Salla first" }) })).json();
  assert.equal(declined.starter, false);

  // Feedback: manual + imported from Support feature requests.
  const sup = `/api/workspaces/${ws.id}/support`;
  const t = await (await post(`${sup}/tickets`, { customer_name: "Abaya Lane", message: "Please add Zid support, we're moving from Salla" })).json();
  await call(`${sup}/tickets/${t.id}`, { method: "PUT", body: JSON.stringify({ category: "feature-request" }) });
  assert.equal((await (await post(`${pb}/feedback/import-support`, {})).json()).added, 1);
  assert.equal((await (await post(`${pb}/feedback/import-support`, {})).json()).added, 0);
  await post(`${pb}/feedback`, { text: "Want TikTok video ads from my catalog", customer: "Sahara Sport", source: "sales" });
  p = await json(pb);
  assert.equal(p.snapshot.feedback.unlinked, 2);
  // Clustering: demo output isn't JSON, so nothing is proposed.
  assert.equal((await post(`${pb}/feedback/cluster`, {})).status, 422);
  const { parseClusters, score } = await import("../lib/product.js");
  const zid = p.items.find((i) => i.title === "Zid app");
  const fids = p.feedback.map((f) => f.id);
  const clusters = parseClusters(JSON.stringify([
    { theme: "Zid", feedback_ids: [fids[0], "999"], existing_item_id: zid.id, new_item: null },
    { theme: "Video", feedback_ids: [fids[1]], existing_item_id: null, new_item: { title: "TikTok catalog video", type: "feature", area: "Video", effort: "M", impact: 7, confidence: 60 } },
  ]), fids, p.items.map((i) => i.id));
  assert.deepEqual(clusters[0].feedback_ids, [fids[0]]);
  const applied = await (await post(`${pb}/feedback/apply-clusters`, { clusters })).json();
  assert.deepEqual(applied, { created: 1, linked: 2 });
  p = await json(pb);
  assert.equal(p.snapshot.items.find((i) => i.id === zid.id).votes, 1);
  assert.ok(p.snapshot.needs.some((n) => /AI-suggested idea/.test(n.text)));
  assert.ok(score({ impact: 8, confidence: 50, effort: "S" }, 3) > score({ impact: 8, confidence: 50, effort: "L" }, 3));

  // Spec uses linked feedback; release ships items and feeds the help center.
  await (await post(`${pb}/items/${zid.id}/ai/spec`, {})).text();
  assert.match(prompts.at(-1), /moving from Salla/);
  const rel = await (await post(`${pb}/releases`, { version: "v0.4", item_ids: [salla.id, "nope"] })).json();
  assert.deepEqual(rel.item_ids, [salla.id]);
  p = await json(pb);
  assert.ok(p.snapshot.needs.some((n) => /v0.4 is a draft/.test(n.text)));
  await (await post(`${pb}/releases/${rel.id}/ai`, {})).text();
  await call(`${pb}/releases/${rel.id}`, { method: "PUT", body: JSON.stringify({ status: "released" }) });
  p = await json(pb);
  assert.equal(p.items.find((i) => i.id === salla.id).status, "released");
  assert.equal(p.snapshot.last_release.version, "v0.4");
  const doc = p.docs.find((d) => d.kind === "release");
  assert.equal((await post(`${pb}/docs/${doc.id}/to-help-center`, {})).status, 422); // demo text has no article
  const cc = await json(`/api/workspaces/${ws.id}/command`);
  assert.equal(cc.product.last_release, "v0.4");
});

test("sample data: loads into every module and removes cleanly", async () => {
  const fresh = await (await post("/api/workspaces", { company_name: "Sample Co" })).json();
  const W = `/api/workspaces/${fresh.id}`;
  // Some real data first: it must survive removal.
  await post(`${W}/deals`, { name: "Real Store", skus: 100 });
  await post(`${W}/finance/expenses`, { vendor: "Real tool", amount_sar: 50 });
  const counts = await (await post(`${W}/sample-data`, {})).json();
  assert.ok(counts.deals >= 10 && counts.tickets >= 5 && counts.expenses >= 8 && counts.tasks >= 5 && counts.feedback >= 6 && counts.kpi_values >= 40);
  assert.equal((await post(`${W}/sample-data`, {})).status, 409);
  const cc = await json(`${W}/command`);
  assert.equal(cc.has_samples, true);
  assert.ok(cc.revenue.paying >= 3);
  assert.ok(cc.finance.cash_sar === 365000);
  assert.ok(cc.kpis.length >= 6);
  assert.ok(cc.needs.length > 0);
  for (const m of ["Sales", "Support", "Hiring", "Finance", "Operations", "Product"]) assert.ok(cc.feed.length || m, m);
  const inc = (await json(`${W}/ops`)).incidents[0];
  assert.ok(inc.resolved_at > inc.started_at);
  assert.ok((await json(`${W}/support`)).summary.ai_resolved_pct > 0);

  await call(`${W}/sample-data`, { method: "DELETE" });
  const after = await json(`${W}/command`);
  assert.equal(after.has_samples, false);
  const deals = (await json(`${W}/deals`)).deals;
  assert.deepEqual(deals.map((d) => d.name), ["Real Store"]);
  assert.deepEqual((await json(`${W}/finance`)).expenses.map((e) => e.vendor), ["Real tool"]);
  assert.equal((await json(`${W}/support`)).tickets.length, 0);
  assert.equal((await json(`${W}/hr`)).candidates.length, 0);
  assert.equal((await json(`${W}/product`)).items.length, 0);
  assert.equal((await json(`${W}/ops`)).tasks.length, 0);
  assert.equal((await json(`${W}/kpis`)).kpis.length, 0);
  await call(W, { method: "DELETE" });
});

test("finance income: billed MRR replaces the estimate; investment isn't revenue; import sorts in/out", async () => {
  const w = await (await post("/api/workspaces", { company_name: "Income Co" })).json();
  const fb = `/api/workspaces/${w.id}/finance`;
  const d = await (await post(`/api/workspaces/${w.id}/deals`, { name: "Paying Store", skus: 300 })).json();
  await call(`/api/workspaces/${w.id}/deals/${d.id}`, { method: "PUT", body: JSON.stringify({ stage: "paying" }) });
  let s = (await json(fb)).snapshot;
  assert.equal(s.revenue.source, "estimated");
  assert.equal(s.revenue.mrr_sar, Math.round(199 * 3.75));
  assert.ok(s.needs.some((n) => /no subscription income is logged/.test(n.text)));
  assert.equal((await post(`${fb}/income`, { amount_sar: 10 })).status, 422);
  const sub = await (await post(`${fb}/income`, { source: "Paying Store", type: "subscription", amount_sar: 600, recurring: "monthly", vat_sar: 78.26 })).json();
  await post(`${fb}/income`, { source: "Investor", type: "investment", amount_sar: 100000, recurring: "one-off" });
  await post(`${fb}/income`, { source: "Paying Store", type: "setup", amount_sar: 900, recurring: "one-off" });
  await post(`${fb}/expenses`, { vendor: "Tools", amount_sar: 2000, recurring: "monthly" });
  s = (await json(fb)).snapshot;
  assert.equal(s.revenue.source, "billed");
  assert.equal(s.revenue.mrr_sar, 600);
  assert.equal(s.revenue.one_off_month_sar, 900);
  assert.equal(s.revenue.capital_month_sar, 100000);
  assert.equal(s.costs.net_burn_sar, 500); // 2000 costs - 600 MRR - 900 one-off; investment excluded
  assert.ok(!s.needs.some((n) => /no subscription income/.test(n.text)));
  await call(`${fb}/income/${sub.id}`, { method: "PUT", body: JSON.stringify({ ended: true }) });
  s = (await json(fb)).snapshot;
  assert.equal(s.revenue.source, "estimated"); // the only subscription ended

  const { parseImport } = await import("../lib/finance.js");
  const items = parseImport('[{"direction":"in","date":"2026-10-02","vendor":"Salla payout","amount_sar":1200,"category":"subscription"},{"direction":"out","date":"2026-10-03","vendor":"Render","amount_sar":900,"category":"hosting"},{"direction":"in","date":"2026-10-04","vendor":"?","amount_sar":50,"category":"hosting"}]');
  assert.deepEqual(items.map((i) => [i.direction, i.category]), [["in", "subscription"], ["out", "hosting"], ["in", "other_revenue"]]);
  const r = await (await post(`${fb}/expenses/bulk`, { items })).json();
  assert.deepEqual([r.expenses, r.income], [1, 2]);
  assert.equal((await json(fb)).income.filter((i) => i.entry === "ai_import").length, 2);
  await call(`/api/workspaces/${w.id}`, { method: "DELETE" });
});

test("ROAS: CSV parsing, template mapping, lift with confidence, KPI and case study", async () => {
  const { parseAdsCsv, classifyAd, zTest, roasSummary } = await import("../lib/roas.js");
  const csv = `"Day","Ad name","Amount spent (SAR)","Impressions","Link clicks","Purchases","Purchase conversion value"
2026-10-01,"Oud | [tpl:Bold Price Tag] | designed","1,200.50",80000,2400,120,"31,200"
2026-10-01,"Oud | plain packshot",1000,70000,2000,60,"15,000"
Total,,2200,,,,`;
  const p = parseAdsCsv(csv);
  assert.equal(p.channel, "Meta");
  assert.equal(p.rows.length, 2);
  assert.equal(p.rows[0].spend_sar, 1200.5);
  assert.equal(p.rows[0].revenue_sar, 31200);
  assert.deepEqual(classifyAd(p.rows[0].ad_name), { template: "Bold Price Tag", creative_type: "designed" });
  assert.equal(classifyAd("Store | Story slideshow").creative_type, "video");
  assert.equal(classifyAd("Oud | plain packshot").template, "Plain packshot");
  assert.match(parseAdsCsv("a,b\n1,2").error, /Couldn't find these columns/);
  assert.equal(parseAdsCsv("Ad name,Spend,Purchase conversion value\nx,10,30", { currency: "USD" }).rows[0].spend_sar, 37.5);
  assert.ok(zTest(48, 1200, 20, 800).p > 0.05); // 4% vs 2.5% on these numbers: not sure yet
  const t = zTest(120, 2400, 60, 2000);
  assert.ok(t.p < 0.05 && t.z > 0);
  assert.equal(zTest(10, 100, 10, 100).p, 1);

  const [ws] = await json("/api/workspaces");
  const rb = `/api/workspaces/${ws.id}/roas`;
  assert.equal((await post(`${rb}/parse`, { text: "nope" })).status, 422);
  const parsed = await (await post(`${rb}/parse`, { text: csv })).json();
  assert.equal(parsed.ads.length, 2);
  assert.equal((await post(`${rb}/import`, { rows: parsed.rows })).status, 422); // no store
  const imp = await (await post(`${rb}/import`, { store: "Oud House", channel: "Meta", rows: parsed.rows, mapping: { [parsed.ads[1].ad_name]: { template: "Plain packshot", creative_type: "plain" } } })).json();
  assert.equal(imp.rows, 2);
  let r = await json(rb);
  const st = r.summary.stores.find((x) => x.store === "Oud House");
  assert.ok(st.roas_lift > 0.5); // 26x vs 15x
  assert.equal(st.verdict, "designed wins");
  const k = await (await post(`${rb}/log-kpi`, {})).json();
  assert.equal(k.kpi, "Merchant ROAS");
  const cs = await (await post(`${rb}/case-study`, { store: "Oud House" })).text();
  assert.match(cs, /\[\[MWIZ_SAVED\]\]/);
  assert.match(prompts.at(-1), /never invent a quote/);
  assert.ok((await json(`/api/workspaces/${ws.id}/notes`)).some((n) => n.title === "Case study: Oud House"));
  const cc = await json(`/api/workspaces/${ws.id}/command`);
  assert.ok(cc.roas.lift > 0);
  assert.equal((await call(`${rb}/batches/${imp.batch_id}`, { method: "DELETE" })).status, 204);
  r = await json(rb);
  assert.ok(!r.summary.stores.some((x) => x.store === "Oud House"));
  assert.equal(roasSummary([]).overall.verdict, "not enough data");
});

test("teams & roles: personal logins, per-module access, last-owner guard, activity log", async () => {
  const [ws] = await json("/api/workspaces");
  const signIn = async (email, password) => {
    const r = await fetch(base + "/login", { method: "POST", redirect: "manual", body: new URLSearchParams({ email, password }) });
    const c = r.headers.get("set-cookie");
    return c ? c.split(";")[0] : null;
  };
  const as = (c, p, opts = {}) => fetch(base + p, { redirect: "manual", ...opts, headers: { "Content-Type": "application/json", cookie: c } });

  // The team password is the Owner.
  const me = await json("/api/me");
  assert.equal(me.user.id, "owner"); assert.equal(me.shared_login, true); assert.equal(me.perms.finance, "edit");

  assert.equal((await post("/api/admin/users", { name: "Short", email: "s@dpa.ad", password: "short", role_id: "viewer" })).status, 422);
  const own = await (await post("/api/admin/users", { name: "Founder", email: "Founder@dpa.ad", password: "founder-pass-1", role_id: "owner" })).json();
  assert.equal(own.email, "founder@dpa.ad"); assert.equal(own.hash, undefined);
  const viewer = await (await post("/api/admin/users", { name: "Investor", email: "inv@dpa.ad", password: "viewer-pass-1", role_id: "viewer" })).json();
  assert.equal((await post("/api/admin/users", { name: "Dup", email: "inv@dpa.ad", password: "viewer-pass-1", role_id: "viewer" })).status, 422);

  assert.equal(await signIn("inv@dpa.ad", "wrong-password"), null);
  const vc = await signIn("inv@dpa.ad", "viewer-pass-1");
  assert.ok(vc);
  const vme = await (await as(vc, "/api/me")).json();
  assert.equal(vme.role, "Viewer"); assert.equal(vme.perms.finance, "none");
  assert.equal((await as(vc, `/api/workspaces/${ws.id}/deals`)).status, 200);
  const r403 = await as(vc, `/api/workspaces/${ws.id}/deals`, { method: "POST", body: JSON.stringify({ name: "X" }) });
  assert.equal(r403.status, 403); assert.match((await r403.json()).detail, /Viewer/);
  assert.equal((await as(vc, `/api/workspaces/${ws.id}/finance`)).status, 403);
  assert.equal((await as(vc, "/api/admin")).status, 403);

  // Custom role and a change to it take effect at once.
  const role = await (await post("/api/admin/roles", { name: "Agency partner", perms: { sales: "edit" } })).json();
  assert.equal(role.perms.finance, "none");
  await call(`/api/admin/users/${viewer.id}`, { method: "PUT", body: JSON.stringify({ role_id: role.id }) });
  assert.equal((await as(vc, `/api/workspaces/${ws.id}/deals`, { method: "POST", body: JSON.stringify({ name: "Partner store", skus: 100 }) })).status, 201);
  assert.equal((await call(`/api/admin/roles/${role.id}`, { method: "DELETE" })).status, 422); // still has people
  assert.equal((await call("/api/admin/roles/owner", { method: "PUT", body: JSON.stringify({ perms: { finance: "none" } }) })).status, 422);

  // Deactivated people are signed out and can't sign in.
  await call(`/api/admin/users/${viewer.id}`, { method: "PUT", body: JSON.stringify({ active: false }) });
  assert.equal((await as(vc, "/api/me")).status, 401);
  assert.equal(await signIn("inv@dpa.ad", "viewer-pass-1"), null);

  // At least one active Owner account stays.
  assert.equal((await call(`/api/admin/users/${own.id}`, { method: "PUT", body: JSON.stringify({ role_id: "admin" }) })).status, 422);

  // Teams, members and the activity log.
  assert.equal((await (await post("/api/admin/teams/starter")).json()).added, 4);
  assert.equal((await (await post("/api/admin/teams/starter")).json()).added, 0);
  const adm = await json("/api/admin");
  const lead = adm.teams.find((t) => t.name === "Leadership");
  await call(`/api/admin/teams/${lead.id}`, { method: "PUT", body: JSON.stringify({ lead_id: own.id, member_ids: [own.id] }) });
  const adm2 = await json("/api/admin");
  assert.deepEqual(adm2.users.find((u) => u.id === own.id).team_ids, [lead.id]);
  assert.ok(adm2.audit.some((a) => a.user_name === "Investor" && a.module === "sales"));
  assert.ok(adm2.audit.some((a) => a.module === "admin"));

  // Own password change.
  const oc = await signIn("founder@dpa.ad", "founder-pass-1");
  assert.equal((await as(oc, "/api/me/password", { method: "POST", body: JSON.stringify({ current: "nope", password: "new-founder-pass" }) })).status, 422);
  assert.equal((await as(oc, "/api/me/password", { method: "POST", body: JSON.stringify({ current: "founder-pass-1", password: "new-founder-pass" }) })).status, 200);
  assert.ok(await signIn("founder@dpa.ad", "new-founder-pass"));
  assert.equal((await post("/api/me/password", { current: "", password: "whatever-long" })).status, 422);
});

test("store CRM: import 30k-style CSV, segments, sequences in Saudi hours, replies, unsubscribe", async () => {
  const { CrmStore } = await import("../lib/crmstore.js");
  const { createOutreach } = await import("../lib/outreach.js");
  const { parseStores, normPhone, inWindow, guessIntent, cleanFilter } = await import("../lib/crm.js");
  const [ws] = await json("/api/workspaces");
  const P = `/api/workspaces/${ws.id}/crm`;

  // Parsing: Arabic headers, Saudi phones, categories, duplicates.
  assert.equal(normPhone("0551234567"), "966551234567");
  assert.equal(normPhone("+966 55 123 4567"), "966551234567");
  const csv = "اسم المتجر,رابط المتجر,البريد الإلكتروني,رقم الجوال,التصنيف,المدينة,عدد المنتجات\n" +
    "عبايات لمسة,https://lamsa.salla.sa/,info@lamsa.sa,0551111111,عبايات,Riyadh,420\n" +
    "عطور الريم,reem.salla.sa,reem@reem.sa,,عطور وبخور,Jeddah,90\n" +
    "Tech Volt,https://volt.zid.store,,0552222222,Electronics,Dammam,1500\n" +
    "Dup Lamsa,lamsa.salla.sa,,,,Riyadh,\n";
  const parsed = parseStores(csv);
  assert.equal(parsed.total, 4);
  assert.equal(parsed.rows[0].category, "Fashion & abayas");
  assert.equal(parsed.rows[1].category, "Perfumes & oud");
  assert.equal(parsed.rows[0].domain, "lamsa.salla.sa");

  const textPost = (p, body) => call(p, { method: "POST", body, headers: { "Content-Type": "text/csv" } });
  const pv = await (await textPost(`${P}/import/preview`, csv)).json();
  assert.equal(pv.total, 4); assert.equal(pv.with_email, 2);
  const imp = await (await textPost(`${P}/import?tags=batch1`, csv)).json();
  assert.deepEqual(imp, { added: 3, updated: 0, skipped: 1 }); // the 4th row is the same store
  const again = await (await textPost(`${P}/import`, csv)).json();
  assert.equal(again.added, 0);

  // Filters and facets.
  const list = await json(`${P}/contacts?f=${encodeURIComponent(JSON.stringify({ category: ["Fashion & abayas"], has_email: true }))}`);
  assert.equal(list.total, 1); assert.equal(list.rows[0].store_name, "عبايات لمسة"); assert.equal(list.rows[0].unsub_token, undefined);
  assert.equal(list.facets.city.Riyadh, 1);
  const big = await json(`${P}/contacts?f=${encodeURIComponent(JSON.stringify({ min_products: 300 }))}&sort=products`);
  assert.deepEqual(big.rows.map((r) => r.store_name), ["Tech Volt", "عبايات لمسة"]);

  // Sending rules, on a separate outreach engine with fake channels.
  const sent = [];
  const crm = new CrmStore(fs.mkdtempSync(path.join(os.tmpdir(), "crm-")), { flushMs: 5 });
  const cfg = { email: { ready: true, imap: { ready: false } }, whatsapp: { ready: true }, public_url: "https://x.test", address: "Riyadh", inbound_secret: "" };
  const out = createOutreach({ store, crm, provider, cfg, senders: { email: async (m) => { sent.push(["email", m]); return { provider_id: "e" + sent.length }; }, whatsapp: async (m) => { sent.push(["wa", m]); return { provider_id: "w" + sent.length }; } } });
  crm.db.settings[ws.id] = { mode: "live", sender_name: "Noura" };
  const a = crm.add(ws.id, { store_name: "Lamsa", email: "a@lamsa.sa", phone: "966551111111", category: "Fashion & abayas", products: 400, owner_name: "Huda" });
  const b = crm.add(ws.id, { store_name: "Reem", email: "b@reem.sa", phone: "966553333333", category: "Perfumes & oud", products: 50, wa_opt_in: true });
  const camp = crm.addCampaign(ws.id, { name: "T", type: "outreach", filter: cleanFilter({}), daily_limit: 100,
    steps: [{ channel: "email", delay_days: 0, subject: "Hi {{store_name}}", body: "Hello {{owner_name}} from {{sender_name}}" }, { channel: "whatsapp", delay_days: 2, subject: "", body: "WA {{store_name}}", wa_template: "dpa_intro_ar" }] });
  // 22:00 Riyadh = 19:00 UTC on a Sunday: outside hours; launch waits for 09:00.
  const sunNight = new Date("2026-11-01T19:00:00Z");
  assert.equal(inWindow(sunNight), false);
  assert.equal(inWindow(new Date("2026-11-06T08:00:00Z")), false); // Friday
  crm.updateCampaign(ws.id, camp.id, { start_at: sunNight.toISOString() });
  const l = out.launch(crm.campaign(ws.id, camp.id), [a, b]);
  assert.equal(l.enrolled, 2); assert.equal(l.starts_at, "2026-11-02T06:00:00.000Z");
  assert.equal((await out.tick(sunNight)).sent, 0);
  const mon = new Date("2026-11-02T07:00:00Z");
  assert.equal((await out.tick(mon)).sent, 2);
  assert.equal(sent[0][1].subject, "Hi Lamsa"); assert.match(sent[0][1].text, /Hello Huda from Noura/); assert.match(sent[0][1].text, /https:\/\/x\.test\/u\//);
  assert.equal(crm.get(ws.id, a.id).stage, "contacted");
  // Lamsa replies "interested" before step 2: sequence stops, deal is created.
  await out.inbound({ channel: "email", from: "A@Lamsa.sa", subject: "Re: Hi", body: "نعم ارسل النماذج" });
  const a2 = crm.get(ws.id, a.id);
  assert.equal(a2.stage, "qualified"); assert.ok(a2.deal_id);
  assert.equal(store.getDeal(ws.id, a2.deal_id).name, "Lamsa");
  const wed = new Date("2026-11-04T07:00:00Z");
  const t2 = await out.tick(wed);
  assert.equal(t2.sent, 1); // only Reem gets the WhatsApp step (opted in, template)
  assert.equal(sent.at(-1)[0], "wa"); assert.equal(sent.at(-1)[1].template, "dpa_intro_ar");
  assert.equal(crm.enrollments(camp.id).find((e) => e.contact_id === a.id).status, "replied");
  assert.equal(crm.campaign(ws.id, camp.id).status, "done");
  // WhatsApp without opt-in is skipped; unsubscribe by reply is honoured.
  const c = crm.add(ws.id, { store_name: "NoOpt", phone: "966554444444" });
  assert.equal((await out.sendOne(ws.id, c, { channel: "whatsapp", body: "x", wa_template: "t" })).status, "skipped");
  await out.inbound({ channel: "email", from: "b@reem.sa", body: "please stop / إلغاء الاشتراك" });
  assert.equal(crm.get(ws.id, b.id).email_opt_out, true); assert.equal(crm.get(ws.id, b.id).stage, "do_not_contact");
  assert.equal((await out.sendOne(ws.id, crm.get(ws.id, b.id), { channel: "email", subject: "x", body: "x" })).status, "skipped");
  // Onboarding flow starts when a store moves to Onboarding.
  const onb = crm.addCampaign(ws.id, { name: "Onb", type: "onboarding", trigger: "stage:onboarding", status: "running", steps: [{ channel: "email", delay_days: 0, subject: "Welcome", body: "Welcome" }] });
  out.setStage(crm.get(ws.id, a.id), "onboarding");
  assert.equal(crm.enrollments(onb.id).length, 1);
  assert.equal(guessIntent("لاحقاً إن شاء الله"), "not_now");

  // HTTP: starter campaigns, preview, launch in test mode, inbox, unsubscribe page, sample stores, permissions.
  assert.equal((await (await post(`${P}/campaigns/starter`)).json()).added, 5);
  const camps = await json(`${P}/campaigns`);
  const cold = camps.find((x) => x.type === "outreach");
  const prev = await json(`${P}/campaigns/${cold.id}/preview`);
  assert.match(prev.steps[0].subject, /عبايات لمسة|عطور الريم/);
  const launched = await (await post(`${P}/campaigns/${cold.id}/launch`)).json();
  assert.ok(launched.enrolled >= 1);
  const run = await json(`${P}/run`, { method: "POST" });
  assert.equal(typeof run.sent, "number");
  const lamsa = (await json(`${P}/contacts?f=${encodeURIComponent(JSON.stringify({ q: "lamsa" }))}`)).rows[0];
  const lr = await (await post(`${P}/contacts/${lamsa.id}/log-reply`, { channel: "email", body: "كم السعر؟" })).json();
  assert.equal(lr.direction, "in");
  const inbox = await json(`${P}/inbox`);
  assert.ok(inbox.some((m) => m.store?.id === lamsa.id));
  const appCrm = store.dir ? null : null; void appCrm;
  const full = await json(`${P}/contacts/${lamsa.id}`);
  assert.ok(full.messages.length >= 1);
  const tok = (await import("../lib/crmstore.js")) && full.contact.unsub_token;
  assert.equal((await call(`/u/${tok}`)).status, 200);
  assert.equal((await fetch(base + `/u/${tok}`, { method: "POST" })).status, 200);
  assert.equal((await json(`${P}/contacts/${lamsa.id}`)).contact.email_opt_out, true);
  assert.equal((await (await post(`${P}/sample`)).json()).added, 240);
  const ov = await json(`${P}/overview`);
  assert.ok(ov.total >= 243); assert.ok(ov.categories.length > 3);
  const bulk = await (await post(`${P}/bulk`, { filter: { tags: ["sample"], city: ["Riyadh"] }, action: "tag", value: "riyadh-wave" })).json();
  assert.ok(bulk.affected > 10);
  assert.equal((await json(`${P}/sample`, { method: "DELETE" })).removed, 240);
  const exp = await (await call(`${P}/export`)).text();
  assert.match(exp, /store_name,domain,email/);
  assert.equal((await call("/hooks/whatsapp?hub.mode=subscribe&hub.verify_token=x&hub.challenge=1")).status, 403);
});

test("store CRM: old starter campaigns switch to the Arabic category placeholder", async () => {
  const { CrmStore } = await import("../lib/crmstore.js");
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "crm-mig-"));
  fs.writeFileSync(path.join(d, "crm.json"), JSON.stringify({ seq: 2, contacts: [], campaigns: [
    { id: "1", workspace_id: "1", created_by: "starter", steps: [{ subject: "x", body: "متاجر {{category}} اللي" }, { subject: "Hi", body: "Stores in {{category}}" }] },
    { id: "2", workspace_id: "1", created_by: "Founder", steps: [{ subject: "", body: "متاجر {{category}}" }] },
  ] }));
  const c = new CrmStore(d);
  assert.equal(c.db.campaigns[0].steps[0].body, "متاجر {{category_ar}} اللي");
  assert.equal(c.db.campaigns[0].steps[1].body, "Stores in {{category}}"); // English text keeps the English name
  assert.equal(c.db.campaigns[1].steps[0].body, "متاجر {{category}}"); // people's own campaigns are untouched
  assert.match(fs.readFileSync(path.join(d, "crm.json"), "utf8"), /category_ar/);
  fs.rmSync(d, { recursive: true, force: true });
});

test("command center hides modules a role can't see", async () => {
  const [ws] = await json("/api/workspaces");
  await post("/api/admin/users", { name: "Member M", email: "member-cc@dpa.ad", password: "member-pass-1", role_id: "member" });
  const r = await fetch(base + "/login", { method: "POST", redirect: "manual", body: new URLSearchParams({ email: "member-cc@dpa.ad", password: "member-pass-1" }) });
  const c = r.headers.get("set-cookie").split(";")[0];
  const d = await (await fetch(base + `/api/workspaces/${ws.id}/command`, { headers: { cookie: c } })).json();
  assert.equal(d.finance.hidden, true); assert.equal(d.finance.cash_sar, 0);
  assert.ok(!d.needs.some((n) => n.module === "Finance"));
  const own = await json(`/api/workspaces/${ws.id}/command`);
  assert.equal(own.finance.hidden, undefined);
});

test("masterclass rules: close rate, LTV:CAC, intent tags, one-variable A/B tests", async () => {
  const { closeRate } = await import("../lib/sales.js");
  const { financeSnapshot } = await import("../lib/finance.js");
  const { scoreContact } = await import("../lib/crm.js");
  // Close rate counts only deals that reached a demo; 2 won of 12 closed = 17% → broken.
  const deals = [...Array(2)].map((_, i) => ({ id: "w" + i, stage: "paying" })).concat([...Array(10)].map((_, i) => ({ id: "l" + i, stage: "lost", lost_reason: i < 4 ? "staying with Canva" : "price" })), [{ id: "early", stage: "lost" }]);
  const acts = [...Array(10)].map((_, i) => ({ deal_id: "l" + i, type: "stage", text: "demo → lost" })).concat([{ deal_id: "early", type: "stage", text: "lead → lost" }]);
  const cr = closeRate(deals, acts);
  assert.equal(cr.closed, 12); assert.equal(cr.verdict, "broken"); assert.equal(cr.lost_to_status_quo, 4);
  // LTV:CAC = (ARPA × margin ÷ churn) ÷ CAC.
  const now = new Date("2026-11-15T00:00:00Z");
  const snap = financeSnapshot({ now, cash: [], roles: [], income: [], settings: { churn_pct: 5 },
    deals: [{ stage: "paying", skus: 100, stage_changed_at: "2026-11-10T00:00:00Z" }],
    expenses: [{ category: "marketing", amount_sar: 3000, recurring: "monthly", date: "2026-11-01" }, { category: "ai_api", amount_sar: 74.625, recurring: "monthly", date: "2026-11-01" }] });
  assert.equal(snap.unit.cac_sar, 3000); assert.equal(snap.unit.ltv_sar, 13425); // 746.25 SAR × ~90% margin ÷ 5% churn
  assert.equal(snap.unit.ltv_cac, 4.5);
  assert.equal(scoreContact({ products: 0, tags: ["running-ads"] }) - scoreContact({ products: 0, tags: [] }), 15);

  // A/B: version B copies A, flags extra changes, and the two split the segment without overlap.
  const [ws] = await json("/api/workspaces");
  const P = `/api/workspaces/${ws.id}/crm`;
  await post(`${P}/sample`);
  const a = await (await post(`${P}/campaigns`, { name: "AB base", type: "outreach", filter: { tags: ["sample"], has_email: true }, steps: [{ channel: "email", delay_days: 0, subject: "S1", body: "Hello {{store_name}}" }] })).json();
  assert.equal((await post(`${P}/campaigns/${a.id}/variant`, { variable: "nope" })).status, 422);
  const b = await (await post(`${P}/campaigns/${a.id}/variant`, { variable: "subject" })).json();
  assert.equal(b.experiment.part, "B");
  let list = await json(`${P}/campaigns`);
  assert.deepEqual(list.find((c) => c.id === b.id).experiment.changes, []);
  await call(`${P}/campaigns/${b.id}`, { method: "PUT", body: JSON.stringify({ steps: [{ channel: "email", delay_days: 0, subject: "S2", body: "Hi there {{store_name}}" }] }) });
  list = await json(`${P}/campaigns`);
  assert.deepEqual(list.find((c) => c.id === b.id).experiment.changes, ["subject", "message"]);
  const l = await (await post(`${P}/campaigns/${a.id}/launch`)).json();
  assert.equal(l.ab, true);
  const ea = (await json(`${P}/campaigns`)).filter((c) => c.experiment?.id === b.experiment.id);
  assert.ok(ea.every((c) => c.status === "running" && c.stats.enrolled > 50));
  assert.ok(Math.abs(ea[0].stats.enrolled - ea[1].stats.enrolled) < 40); // roughly half each, no store in both
  const ov = await json(`${P}/overview`);
  assert.equal(ov.rates.bench.reply, 0.02);
  await json(`${P}/sample`, { method: "DELETE" });
});

test("store CRM: phone-call steps become tasks; ICP focus list; allowable CAC", async () => {
  const [ws] = await json("/api/workspaces");
  const P = `/api/workspaces/${ws.id}/crm`;
  await post(`${P}/sample`);
  const icp = await (await post(`${P}/bulk`, { filter: { tags: ["sample"] }, action: "icp", value: 30 })).json();
  assert.equal(icp.affected, 30);
  const camp = await (await post(`${P}/campaigns`, { name: "Call test", type: "outreach", filter: { tags: ["icp"], has_whatsapp: true }, window: { from: 0, to: 24, skip_friday: false },
    steps: [{ channel: "call", delay_days: 0, body: "Call {{store_name}}" }] })).json();
  assert.equal(camp.steps[0].channel, "call");
  await post(`${P}/campaigns/${camp.id}/launch`);
  const r = await json(`${P}/run`, { method: "POST" });
  assert.ok(r.calls > 0);
  const calls = await json(`${P}/calls`);
  assert.ok(calls.length > 0 && calls.every((c) => c.store.phone));
  assert.match(calls[0].body, /^Call Sample/);
  assert.equal((await post(`${P}/calls/${calls[0].id}`, { outcome: "bogus" })).status, 422);
  await post(`${P}/calls/${calls[0].id}`, { outcome: "meeting", note: "Thursday 4pm" });
  const c = (await json(`${P}/contacts/${calls[0].store.id}`)).contact;
  assert.equal(c.stage, "qualified"); assert.ok(c.deal_id);
  assert.equal((await json(`${P}/calls`)).length, calls.length - 1);
  await json(`${P}/sample`, { method: "DELETE" });
  const fin = await json(`/api/workspaces/${ws.id}/finance`);
  assert.ok("allowable_cac_sar" in (fin.snapshot || fin).unit);
});

test("platforms: detected from name or link, filterable, legacy values cleaned", async () => {
  const { detectPlatform, PLATFORMS } = await import("../lib/platforms.js");
  const { parseStores } = await import("../lib/crm.js");
  assert.equal(detectPlatform("", "abaya-house.myshopify.com"), "Shopify");
  assert.equal(detectPlatform("سلة"), "Salla");
  assert.equal(detectPlatform("Shopify Plus"), "Shopify");
  assert.equal(detectPlatform("Adobe Commerce"), "Magento");
  assert.equal(detectPlatform("our own custom site"), "Custom");
  assert.equal(detectPlatform("", "store.example.com"), "");
  for (const p of ["Salla", "Zid", "Shopify", "WooCommerce", "Magento", "BigCommerce", "Wix", "Custom", "Other"]) assert.ok(PLATFORMS.includes(p));
  const r = parseStores("name,link,platform\nA,a.myshopify.com,\nB,b.com,ووكومرس\nC,c.com,Tictail\nD,d.com,\n", { platform: "Zid" });
  assert.deepEqual(r.rows.map((x) => x.platform), ["Shopify", "WooCommerce", "Other", "Zid"]);

  const { CrmStore } = await import("../lib/crmstore.js");
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "crm-plat-"));
  fs.writeFileSync(path.join(d, "crm.json"), JSON.stringify({ seq: 1, contacts: [{ id: "1", workspace_id: "1", store_name: "X", platform: "Unknown", domain: "x.salla.sa", tags: [] }], campaigns: [] }));
  assert.equal(new CrmStore(d).db.contacts[0].platform, "Salla");
  fs.rmSync(d, { recursive: true, force: true });

  const [ws] = await json("/api/workspaces");
  const P = `/api/workspaces/${ws.id}/crm`;
  const c = await (await post(`${P}/contacts`, { store_name: "Plat test", domain: "plat-test.myshopify.com" })).json();
  assert.equal(c.platform, "Shopify");
  const meta = await json(`${P}/meta`);
  assert.ok(meta.platforms.find((p) => p.id === "Shopify").connect);
  const ov = await json(`${P}/overview`);
  assert.ok(ov.platforms.some((p) => p.platform === "Shopify"));
  assert.equal((await json(`${P}/contacts?f=${encodeURIComponent(JSON.stringify({ platform: ["Shopify"] }))}`)).total >= 1, true);
  await call(`${P}/contacts/${c.id}`, { method: "DELETE" });
});

test("pricing calculator: cost per store, margin and the lowest price for the target", async () => {
  const { pricingModel, cleanPricing, DEFAULT_PRICING } = await import("../lib/pricing.js");
  const p = cleanPricing({ costs: { image_cost: 0.01, video_cost: 0, storage_per_1k: 0, support_hour: 20, payment_pct: 3, appstore_pct: 0, fixed_monthly: 0, target_margin: 70 },
    plans: [{ name: "T", price: 100, annual_price: 80, products: 1000, creatives: 2, refresh_pct: 50, videos: 0, ai: 5, support_hours: 0.5, onboarding_hours: 0, stores: 1 }] }, DEFAULT_PRICING);
  const m = pricingModel(p, 5).plans[0];
  // images 1000×2×50% = 1000 → $10; AI $5; support $10; first render 2000×0.01=$20 over 20 months = $1 → $26 direct
  assert.equal(m.images_per_month, 1000); assert.equal(m.direct, 26);
  assert.equal(m.monthly.cost, 29); assert.equal(m.monthly.margin, 71); assert.equal(m.ok, true);
  assert.equal(m.min_price, 97); // 26 ÷ (1 − 0.03 − 0.70) = 96.3
  assert.equal(m.yearly.margin, 64.5); assert.equal(m.yearly_ok, false);

  const [ws] = await json("/api/workspaces");
  const F = `/api/workspaces/${ws.id}/finance/pricing`;
  const g = await json(F);
  assert.equal(g.inputs.example, true); assert.equal(g.model.plans.length, 4);
  const upd = await json(F, { method: "PUT", body: JSON.stringify({ ...g.inputs, costs: { ...g.inputs.costs, image_cost: 0.02 } }) });
  assert.equal(upd.inputs.example, false); assert.equal(upd.inputs.costs.image_cost, 0.02);
  assert.ok(upd.model.plans[0].monthly.cost > g.model.plans[0].monthly.cost);
  assert.equal((await json(F, { method: "PUT", body: JSON.stringify({ reset: true }) })).inputs.example, true);
});

test("pricing: render limits with billed overage or a hard stop", async () => {
  const { pricingModel, cleanPricing, DEFAULT_PRICING } = await import("../lib/pricing.js");
  const base = { costs: { image_cost: 0.004, video_cost: 0, storage_per_1k: 0, support_hour: 0, payment_pct: 0, appstore_pct: 0, fixed_monthly: 0, target_margin: 70 } };
  const plan = { name: "S", price: 1000, annual_price: 1000, products: 20000, creatives: 3, refresh_pct: 50, videos: 0, ai: 0, support_hours: 0, onboarding_hours: 0, stores: 1 };
  const billed = pricingModel(cleanPricing({ ...base, plans: [{ ...plan, render_limit: 15000, overage_per_1k: 10 }] }, DEFAULT_PRICING), 100 / 33).plans[0];
  assert.equal(billed.renders_wanted, 30000); assert.equal(billed.extra_renders, 15000); assert.equal(billed.overage, 150);
  assert.equal(billed.images_per_month, 30000); assert.equal(billed.monthly.revenue, 1150);
  const capped = pricingModel(cleanPricing({ ...base, plans: [{ ...plan, render_limit: 15000, overage_per_1k: 0 }] }, DEFAULT_PRICING), 3).plans[0];
  assert.equal(capped.images_per_month, 15000); assert.equal(capped.held_back, 15000); assert.equal(capped.parts.images, 60);
  // Older saved pricing without the new fields picks up the defaults.
  const old = cleanPricing({ plans: DEFAULT_PRICING.plans.map(({ render_limit, overage_per_1k, ...p }) => p) }, { ...DEFAULT_PRICING, plans: DEFAULT_PRICING.plans.map(({ render_limit, overage_per_1k, ...p }) => p) });
  assert.equal(old.plans[2].render_limit, 15000); assert.equal(old.plans[0].render_limit, 0);
});

test("home board: greeting data, outreach funnel and role-aware sections", async () => {
  const [ws] = await json("/api/workspaces");
  const P = `/api/workspaces/${ws.id}/crm`;
  await post(`${P}/sample`);
  const d = await json(`/api/workspaces/${ws.id}/command`);
  assert.ok(d.outreach.stores >= 240);
  for (const k of ["contacted", "replied", "qualified", "onboarding", "active", "sent_week", "calls", "inbox_open", "running", "mode"]) assert.ok(k in d.outreach, k);
  assert.ok(d.close && "verdict" in d.close);
  assert.equal(d.me.name, ""); // team-password owner has no first name
  await json(`${P}/sample`, { method: "DELETE" });
});

test("creative studio: items, checks, approvals, posting, brand kit, email design in CRM", async () => {
  const { seasonsBetween, checkItem, renderEmail, cleanItem, DEFAULT_BRAND, STARTER_EMAIL, cleanVariant } = await import("../lib/creative.js");
  // Saudi seasons with lead times; Hijri dates are flagged approx.
  const s = seasonsBetween("2027-01-01", "2027-03-31");
  const ram = s.find((x) => x.name.startsWith("Ramadan"));
  assert.equal(ram.date, "2027-02-08"); assert.equal(ram.approx, true); assert.equal(ram.prepare_from, "2026-12-25");
  assert.ok(s.some((x) => x.name.startsWith("Founding Day") && x.date === "2027-02-22"));
  assert.ok(s.some((x) => x.minor && x.date === "2027-01-27")); // payday
  // Checks: limits, missing Arabic, unproven numbers, guarantees.
  const it = cleanItem({ title: "T", channels: ["x", "ig_reel"], variants: { x: { caption_en: "a".repeat(300) }, ig_reel: { caption_ar: "نتائج مضمونة ٣ أضعاف" } } });
  const ch = checkItem(it, DEFAULT_BRAND);
  assert.ok(ch.some((c) => c.level === "bad" && /limit is 280/.test(c.text)));
  assert.ok(ch.some((c) => /no Arabic caption/.test(c.text)));
  assert.ok(ch.some((c) => /number or % claim/.test(c.text)));
  assert.ok(ch.some((c) => c.level === "bad" && /guarantee/.test(c.text)));
  // Email renderer: RTL, escaped, placeholders filled, https-only links, footer.
  const d = cleanVariant("email", { ...STARTER_EMAIL, blocks: [...STARTER_EMAIL.blocks, { type: "text", text: "<script>x</script>" }, { type: "button", label: "x", url: "javascript:alert(1)" }] });
  const r = renderEmail(d, DEFAULT_BRAND, { vars: { company: "DPA AD", contact: { store_name: "عبايات لمسة" }, extra: { sender_name: "نورة" } }, footer: { company: "DPA AD", address: "Riyadh", unsubscribe: "https://x.test/u/t" } });
  assert.equal(r.rtl, true); assert.match(r.html, /dir="rtl"/); assert.match(r.html, /عبايات لمسة/); assert.match(r.html, /https:\/\/x\.test\/u\/t/);
  assert.ok(!r.html.includes("<script>")); assert.ok(!r.html.includes("javascript:"));
  assert.match(r.text, /نورة/); assert.equal(r.subject, "إعلانات مصممة لكل منتج في عبايات لمسة");

  const [ws] = await json("/api/workspaces");
  const P = `/api/workspaces/${ws.id}/creative`;
  const meta = await json(`${P}/meta`);
  assert.ok(meta.channels.length >= 12 && meta.pillars.length === 5 && meta.can_approve);
  const item = await (await post(`${P}/items`, { title: "Reel: plain vs designed", date: "2026-11-10", channels: ["ig_reel", "tiktok"], pillar: "product" })).json();
  assert.equal(item.status, "idea");
  // Can't approve while blocking checks fail.
  assert.equal((await post(`${P}/items/${item.id}/status`, { status: "approved" })).status, 422);
  await call(`${P}/items/${item.id}`, { method: "PUT", body: JSON.stringify({ variants: { ig_reel: { caption_ar: "الفرق بين صورة عادية وإعلان مصمم", script: "مشهد ١", asset_url: "https://drive.example/r.mp4" }, tiktok: { caption_ar: "شوف الفرق", script: "مشهد ١" } } }) });
  assert.equal((await post(`${P}/items/${item.id}/posted`, { channel: "tiktok" })).status, 422); // not approved yet
  await post(`${P}/items/${item.id}/status`, { status: "review" });
  const ok = await (await post(`${P}/items/${item.id}/status`, { status: "approved" })).json();
  assert.equal(ok.status, "approved"); assert.ok(ok.approved_by);
  // Editing after approval sends it back to review.
  const back = await json(`${P}/items/${item.id}`, { method: "PUT", body: JSON.stringify({ variants: { ...ok.variants, tiktok: { ...ok.variants.tiktok, caption_ar: "شوف الفرق 👀" } } }) });
  assert.equal(back.status, "review"); assert.equal(back.history.length >= 1, true);
  await post(`${P}/items/${item.id}/status`, { status: "approved" });
  const pack = await (await call(`${P}/items/${item.id}/pack/tiktok`)).text();
  assert.match(pack, /شوف الفرق/);
  await post(`${P}/items/${item.id}/posted`, { channel: "tiktok", url: "https://tiktok.com/@dpa/1" });
  const done = await json(`${P}/items/${item.id}/posted`, { method: "POST", body: JSON.stringify({ channel: "ig_reel" }) });
  assert.equal(done.status, "published"); assert.equal(done.published.tiktok.url, "https://tiktok.com/@dpa/1");

  // A Creative user can send for review but not approve.
  await post("/api/admin/users", { name: "Reem Creative", email: "reem-cr@dpa.ad", password: "creative-pass", role_id: "creative" });
  const lr = await fetch(base + "/login", { method: "POST", redirect: "manual", body: new URLSearchParams({ email: "reem-cr@dpa.ad", password: "creative-pass" }) });
  const cc = lr.headers.get("set-cookie").split(";")[0];
  const asC = (p, b) => fetch(base + p, { method: "POST", headers: { "Content-Type": "application/json", cookie: cc }, body: JSON.stringify(b) });
  const mine = await (await asC(`${P}/items`, { title: "Carousel tips", channels: ["linkedin"], variants: { linkedin: { caption_ar: "نصيحة", caption_en: "Tip" } }, date: "2026-11-12" })).json();
  assert.equal((await asC(`${P}/items/${mine.id}/status`, { status: "review" })).status, 200);
  assert.equal((await asC(`${P}/items/${mine.id}/status`, { status: "approved" })).status, 403);
  assert.equal((await fetch(base + `/api/workspaces/${ws.id}/finance`, { headers: { cookie: cc } })).status, 403);
  const cmd = await json(`/api/workspaces/${ws.id}/command`);
  assert.ok(cmd.creative.review >= 1); assert.ok(cmd.needs.some((n) => n.module === "Creative"));

  // Brand kit.
  const bk = await json(`${P}/brand`, { method: "PUT", body: JSON.stringify({ brand: { colors: { primary: "#ff0000", ink: "bad" }, hashtags: "dpa سلة", logo_url: "http://insecure" } }) });
  assert.equal(bk.brand.colors.primary, "#ff0000"); assert.equal(bk.brand.colors.ink, "#111111"); assert.deepEqual(bk.brand.hashtags, ["#dpa", "#سلة"]); assert.equal(bk.brand.logo_url, "");

  // Email design → approved → used by a CRM campaign step.
  const em = await (await post(`${P}/items`, { title: "Outreach email", starter_email: true })).json();
  assert.ok(em.variants.email.blocks.length > 3);
  const preview = await (await call(`${P}/items/${em.id}/email`)).text();
  assert.match(preview, /متجر نموذج/);
  const C = `/api/workspaces/${ws.id}/crm`;
  await post(`${C}/sample`);
  const camp = await (await post(`${C}/campaigns`, { name: "Designed", type: "outreach", filter: { tags: ["sample"], has_email: true }, steps: [{ channel: "email", delay_days: 0, subject: "", body: "", design_id: em.id }] })).json();
  assert.equal(camp.steps[0].design_id, em.id);
  const pv = await json(`${C}/campaigns/${camp.id}/preview`);
  assert.match(pv.steps[0].subject, /not approved/);
  await post(`${P}/items/${em.id}/status`, { status: "approved" });
  const pv2 = await json(`${C}/campaigns/${camp.id}/preview`);
  assert.match(pv2.steps[0].subject, /إعلانات مصممة/);
  assert.ok((await json(`${P}/emails`)).some((x) => x.id === em.id));
  assert.equal((await post(`${C}/campaigns/${camp.id}/launch`)).status, 200);
  await json(`${C}/sample`, { method: "DELETE" });
});

test("creative studio: AI plans a month and writes every version (JSON in, reviewed out)", async () => {
  const fake = { name: "fake", model: "fake", async generate({ prompt }) {
    if (prompt.includes('title="Content calendar')) return JSON.stringify({ items: [{ title: "Ramadan prep tips", pillar: "seasonal", date: "2027-01-12", channels: ["ig_reel", "bogus"], brief: "..." }, { title: "Out of month", date: "2027-05-01", channels: ["x"] }] });
    if (prompt.includes('title="Write every version"')) return JSON.stringify({ ig_reel: { caption_ar: "جهّز لرمضان", caption_en: "Get ready", hashtags: ["رمضان"], script: "1. hook" }, email: { subject: "S", blocks: [{ type: "text", text: "hi" }] } });
    return "{}";
  } };
  const d2 = fs.mkdtempSync(path.join(os.tmpdir(), "mwiz-cs-"));
  const st2 = new Store(d2), app2 = createApp({ store: st2, provider: fake, password: "pw-cs" }), srv = app2.listen(0);
  await new Promise((r) => srv.once("listening", r));
  const b2 = `http://127.0.0.1:${srv.address().port}`;
  const ck = (await fetch(b2 + "/login", { method: "POST", redirect: "manual", body: new URLSearchParams({ password: "pw-cs" }) })).headers.get("set-cookie").split(";")[0];
  const j = (p, b) => fetch(b2 + p, { method: b ? "POST" : "GET", headers: { "Content-Type": "application/json", cookie: ck }, body: b && JSON.stringify(b) }).then((r) => r.json());
  const [w] = await j("/api/workspaces");
  const plan = await j(`/api/workspaces/${w.id}/creative/plan`, { month: "2027-01" });
  assert.equal(plan.added, 2);
  assert.deepEqual(plan.items[0].channels, ["ig_reel"]); assert.equal(plan.items[0].created_by, "AI strategist");
  assert.equal(plan.items[1].date, null); // dates outside the month are dropped
  const it = plan.items[0];
  await fetch(b2 + `/api/workspaces/${w.id}/creative/items/${it.id}`, { method: "PUT", headers: { "Content-Type": "application/json", cookie: ck }, body: JSON.stringify({ channels: ["ig_reel", "email"] }) });
  const wr = await j(`/api/workspaces/${w.id}/creative/items/${it.id}/write`, {});
  assert.equal(wr.status, "draft"); assert.equal(wr.variants.ig_reel.hashtags[0], "#رمضان"); assert.equal(wr.variants.email.subject, "S");
  srv.close(); app2.locals.crm.flush(); fs.rmSync(d2, { recursive: true, force: true });
});

test("AI workforce: attribution, cost, budget, pause, levels, demotion, promotion, permissions", async () => {
  const { Workforce, withAgent, costOf, AGENTS } = await import("../lib/agents.js");
  assert.equal(costOf({ input_tokens: 1e6, output_tokens: 1e6 }, "claude-opus-5-5"), 24);
  assert.equal(costOf({ input_tokens: 1e6 }, "unknown-model"), 4);
  // Budget and pause on a private store.
  const d0 = fs.mkdtempSync(path.join(os.tmpdir(), "wf-")), st0 = new Store(d0), wf = new Workforce(st0);
  const fake = { name: "claude", model: "claude-opus-5-5", async generate({ onUsage }) { onUsage?.({ input_tokens: 500000, output_tokens: 0 }, "claude-opus-5-5"); return "ok"; } };
  const p = wf.wrap(fake);
  wf.set("finance_cfo", { budget_usd: 3 });
  assert.equal(await withAgent("finance_cfo", "1", () => p.generate({ prompt: "x" })), "ok"); // $2
  await withAgent("finance_cfo", "1", () => p.generate({ prompt: "x" }));                       // $4 total
  await assert.rejects(withAgent("finance_cfo", "1", () => p.generate({ prompt: "x" })), /monthly AI budget/);
  assert.equal(wf.stats("finance_cfo").cost_month, 4);
  wf.set("ops_planner", { paused: true });
  await assert.rejects(withAgent("ops_planner", "1", () => p.generate({ prompt: "x" })), /switched off/);
  // Auto-demotion after 3 rejections; promotion after 50 clean items.
  wf.set("creative_copywriter", { level: 3 });
  for (let i = 0; i < 3; i++) wf.event("creative_copywriter", "1", "rejected");
  assert.equal(wf.config("creative_copywriter").level, 2);
  wf.set("crm_replier", { level: 1 });
  for (let i = 0; i < 50; i++) wf.event("crm_replier", "1", "accepted", "", false);
  assert.equal(wf.stats("crm_replier").can_promote, true);
  fs.rmSync(d0, { recursive: true, force: true });

  // HTTP: summary, attribution of a real route, CRM triage level 1, permissions.
  const s = await json("/api/workforce");
  assert.equal(s.agents.length, AGENTS.length); assert.ok(s.totals.people >= 1);
  const [ws] = await json("/api/workspaces");
  await post(`/api/workspaces/${ws.id}/creative/plan`, { month: "2027-01" });
  const strat = await json("/api/workforce/agents/creative_strategist");
  assert.ok(strat.runs.length >= 1);
  assert.equal((await call("/api/workforce/agents/crm_replier", { method: "PUT", body: JSON.stringify({ level: 3 }) })).status, 422); // max 2
  await call("/api/workforce/agents/crm_triage", { method: "PUT", body: JSON.stringify({ level: 1 }) });
  const C = `/api/workspaces/${ws.id}/crm`;
  const st = await (await post(`${C}/contacts`, { store_name: "WF Triage", email: "wf@triage.example.com" })).json();
  await post(`${C}/contacts/${st.id}/log-reply`, { channel: "email", body: "نعم ارسلوا النماذج" });
  const after = (await json(`${C}/contacts/${st.id}`)).contact;
  assert.notEqual(after.stage, "qualified"); assert.equal(after.deal_id, null); // level 1: labels only
  await post(`${C}/contacts/${st.id}/log-reply`, { channel: "email", body: "stop" });
  assert.equal((await json(`${C}/contacts/${st.id}`)).contact.stage, "do_not_contact"); // unsubscribe always honoured
  await call("/api/workforce/agents/crm_triage", { method: "PUT", body: JSON.stringify({ level: 2 }) });
  await call("/api/workforce/agents/ops_planner", { method: "PUT", body: JSON.stringify({ paused: true }) });
  const r = await post(`/api/workspaces/${ws.id}/ops/plan`, { goal: "launch" });
  assert.ok(r.status >= 400 || /switched off/.test(await r.text()));
  await call("/api/workforce/agents/ops_planner", { method: "PUT", body: JSON.stringify({ paused: false }) });
  await post("/api/admin/users", { name: "Member WF", email: "member-wf@dpa.ad", password: "member-wf-pass", role_id: "member" });
  const mc = (await fetch(base + "/login", { method: "POST", redirect: "manual", body: new URLSearchParams({ email: "member-wf@dpa.ad", password: "member-wf-pass" }) })).headers.get("set-cookie").split(";")[0];
  assert.equal((await fetch(base + "/api/workforce", { headers: { cookie: mc } })).status, 200);
  assert.equal((await fetch(base + "/api/workforce/agents/crm_triage", { method: "PUT", headers: { cookie: mc, "Content-Type": "application/json" }, body: "{}" })).status, 403);
  const cmd = await json(`/api/workspaces/${ws.id}/command`);
  assert.ok(cmd.workforce && cmd.workforce.agents > 0);
});

test("AI workforce: copywriter at level 2 auto-approves clean pieces, sends number claims to review", async () => {
  let answer = { ig_post: { caption_ar: "إعلانات مصممة لكل منتج", caption_en: "Designed ads for every product", hashtags: ["#سلة"] } };
  const fake = { name: "fake", model: "fake", async generate() { return JSON.stringify(answer); } };
  const d2 = fs.mkdtempSync(path.join(os.tmpdir(), "mwiz-wf2-"));
  const st2 = new Store(d2), app2 = createApp({ store: st2, provider: fake, password: "pw-wf" }), srv = app2.listen(0);
  await new Promise((r) => srv.once("listening", r));
  const b2 = `http://127.0.0.1:${srv.address().port}`;
  const ck = (await fetch(b2 + "/login", { method: "POST", redirect: "manual", body: new URLSearchParams({ password: "pw-wf" }) })).headers.get("set-cookie").split(";")[0];
  const j = (p, b, m) => fetch(b2 + p, { method: m || (b ? "POST" : "GET"), headers: { "Content-Type": "application/json", cookie: ck }, body: b && JSON.stringify(b) }).then((r) => r.json());
  const [w] = await j("/api/workspaces");
  const P = `/api/workspaces/${w.id}/creative`;
  await j("/api/workforce/agents/creative_copywriter", { level: 2 }, "PUT");
  const it = await j(`${P}/items`, { title: "Clean", channels: ["ig_post"], date: "2027-01-10" });
  const wr = await j(`${P}/items/${it.id}/write`, {});
  assert.equal(wr.status, "approved"); assert.equal(wr.approved_by, "AI Copywriter (auto)");
  answer = { ig_post: { caption_ar: "مبيعات أكثر ٣ أضعاف", caption_en: "3x sales" } };
  const it2 = await j(`${P}/items`, { title: "Claim", channels: ["ig_post"], date: "2027-01-11" });
  const wr2 = await j(`${P}/items/${it2.id}/write`, {});
  assert.equal(wr2.status, "review");
  // Approving it unchanged counts as "accepted" for the copywriter.
  await j(`${P}/items/${it2.id}/status`, { status: "approved" });
  const cw = await j("/api/workforce/agents/creative_copywriter");
  assert.ok(cw.events.some((e) => e.outcome === "accepted")); assert.ok(cw.events.some((e) => e.outcome === "auto"));
  assert.ok(cw.runs.length >= 2);
  srv.close(); app2.locals.crm.flush(); fs.rmSync(d2, { recursive: true, force: true });
});

test("page scripts don't redeclare each other's top-level names (they share one global scope)", () => {
  const dir = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "public");
  const seen = new Map(), dupes = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".js"))) {
    for (const m of fs.readFileSync(path.join(dir, f), "utf8").matchAll(/^(?:const|let|class|(?:async\s+)?function)\s+([A-Za-z_$][\w$]*)/gm)) {
      if (seen.has(m[1]) && seen.get(m[1]) !== f) dupes.push(`${m[1]} in ${seen.get(m[1])} and ${f}`);
      seen.set(m[1], f);
    }
  }
  assert.deepEqual(dupes, []);
});

test("Ask DPA AD: tools over the API with the person's permissions, confirm before changes, logged and costed", async () => {
  const seen = [];
  let script = [];
  const fakeClient = async (p) => { seen.push(p); const next = script.shift(); return typeof next === "function" ? next(p) : next; };
  const d2 = fs.mkdtempSync(path.join(os.tmpdir(), "mwiz-ak-"));
  const st2 = new Store(d2), app2 = createApp({ store: st2, provider, password: "pw-ak", assistantClient: fakeClient }), srv = app2.listen(0);
  await new Promise((r) => srv.once("listening", r));
  const b2 = `http://127.0.0.1:${srv.address().port}`;
  const login = async (body) => (await fetch(b2 + "/login", { method: "POST", redirect: "manual", body: new URLSearchParams(body) })).headers.get("set-cookie").split(";")[0];
  const ck = await login({ password: "pw-ak" });
  const j = (c, p, b) => fetch(b2 + p, { method: b ? "POST" : "GET", headers: { "Content-Type": "application/json", cookie: c }, body: b && JSON.stringify(b) }).then(async (r) => ({ status: r.status, ...(await r.json()) }));
  const [w] = (await fetch(b2 + "/api/workspaces", { headers: { cookie: ck } }).then((r) => r.json()));
  await j(ck, `/api/workspaces/${w.id}/crm/sample`, {});
  const use = (id, name, input) => ({ stop_reason: "tool_use", model: "claude-opus-5-5", usage: { input_tokens: 1000, output_tokens: 100 }, content: [{ type: "tool_use", id, name, input }] });
  const say = (text) => ({ stop_reason: "end_turn", model: "claude-opus-5-5", usage: { input_tokens: 1200, output_tokens: 80 }, content: [{ type: "text", text }] });
  // 1. A question answered from real data.
  script = [use("t1", "find_stores", { category: ["Perfumes & oud"], limit: 3 }), (p) => { const r = JSON.parse(p.messages.at(-1).content[0].content); return say(`There are ${r.total} perfume stores.`); }];
  const a1 = await j(ck, "/api/assistant", { message: "How many perfume stores?", ws: w.id, page: "Store CRM" });
  assert.match(a1.reply, /There are \d+ perfume stores/); assert.deepEqual(a1.steps.map((s) => s.tool), ["find_stores"]);
  assert.ok(seen[0].tools.some((t) => t.name === "update_stores")); assert.match(seen[0].system, /Never guess or invent numbers/);
  assert.match(seen[0].messages[0].content[0].text, /\[Looking at: Store CRM\]/);
  // 2. A change waits for confirmation, then runs as the person (audit log says via the assistant).
  script = [use("t2", "update_stores", { action: "tag", value: "perfume-push", filter: { category: ["Perfumes & oud"] } })];
  const a2 = await j(ck, "/api/assistant", { thread_id: a1.thread_id, message: "Tag them perfume-push", ws: w.id });
  assert.ok(a2.pending); assert.match(a2.pending.summary, /Add tag "perfume-push" on \d+ stores \(category: Perfumes & oud\)/);
  let tagged = await j(ck, `/api/workspaces/${w.id}/crm/contacts?f=${encodeURIComponent(JSON.stringify({ tags: ["perfume-push"] }))}`);
  assert.equal(tagged.total, 0); // nothing yet
  script = [(p) => { assert.equal(p.messages.at(-1).content[0].tool_use_id, "t2"); return say("Done: tagged them."); }];
  const a3 = await j(ck, "/api/assistant/confirm", { thread_id: a1.thread_id, action_id: a2.pending.id, approve: true });
  assert.equal(a3.reply, "Done: tagged them.");
  tagged = await j(ck, `/api/workspaces/${w.id}/crm/contacts?f=${encodeURIComponent(JSON.stringify({ tags: ["perfume-push"] }))}`);
  assert.ok(tagged.total > 0);
  const adm = await j(ck, "/api/admin");
  assert.ok(adm.audit.some((a) => /via Ask DPA AD/.test(a.summary) && a.module === "crm"));
  // 3. Declining changes nothing; a new message while a change waits also counts as "no".
  script = [use("t3", "add_task", { title: "Call Lamsa" })];
  const a4 = await j(ck, "/api/assistant", { thread_id: a1.thread_id, message: "Add a task to call Lamsa", ws: w.id });
  script = [say("OK, I didn't add it.")];
  await j(ck, "/api/assistant/confirm", { thread_id: a1.thread_id, action_id: a4.pending.id, approve: false });
  const ops = await j(ck, `/api/workspaces/${w.id}/ops`);
  assert.ok(!(ops.tasks || []).some((t) => t.title === "Call Lamsa"));
  script = [use("t4", "add_task", { title: "Call Reem" })];
  await j(ck, "/api/assistant", { thread_id: a1.thread_id, message: "Add a task to call Reem", ws: w.id });
  script = [(p) => { const c = p.messages.at(-1).content; assert.match(c[0].content, /moved on without confirming/); assert.equal(c.at(-1).type, "text"); return say("Sure."); }];
  await j(ck, "/api/assistant", { thread_id: a1.thread_id, message: "never mind, how's finance?", ws: w.id });
  // 4. Costs are charged to the Coordinator agent.
  const co = await j(ck, "/api/workforce/agents/coordinator");
  assert.ok(co.runs.length >= 6); assert.ok(co.stats.cost_month > 0); assert.ok(co.events.some((e) => e.outcome === "accepted") && co.events.some((e) => e.outcome === "rejected"));
  // 5. A Viewer gets no change tools, and can't sneak one through.
  await j(ck, "/api/admin/users", { name: "Vic Viewer", email: "vic@dpa.ad", password: "viewer-pass-9", role_id: "viewer" });
  const vc = await login({ email: "vic@dpa.ad", password: "viewer-pass-9" });
  script = [use("v1", "update_stores", { action: "tag", value: "x", filter: {} }), (p) => { assert.match(p.messages.at(-1).content[0].content, /isn't available/); return say("You can't change stores with your role."); }];
  const v = await j(vc, "/api/assistant", { message: "tag everything x", ws: w.id });
  assert.equal(v.pending, undefined); assert.match(v.reply, /can't/);
  assert.ok(!seen.at(-1).tools.some((t) => t.name === "update_stores" || t.name === "finance_snapshot"));
  // Someone else can't confirm another person's pending change.
  assert.equal((await j(vc, "/api/assistant/confirm", { thread_id: a1.thread_id, action_id: "x", approve: true })).status, 409);
  srv.close(); app2.locals.crm.flush(); fs.rmSync(d2, { recursive: true, force: true });
});

// ---- Creative Studio phase 4a: "your products as ads". All network calls are mocked.
const mockWeb = (pages, calls = []) => async (url, opts) => {
  calls.push(url);
  assert.equal(opts.redirect, "manual"); assert.equal(opts.headers["User-Agent"], "DPA-AD-bot (+https://dpa.ad)");
  const p = pages[url];
  if (!p) return new Response("not found", { status: 404 });
  if (p.delay) await new Promise((r) => setTimeout(r, p.delay));
  return new Response(p.body ?? "", { status: p.status || 200, headers: { "content-type": p.type || "text/html", ...(p.headers || {}) } });
};
const publicDns = async (host) => (/internal|evil/.test(host) ? [{ address: "10.0.0.7", family: 4 }] : [{ address: "93.184.216.34", family: 4 }]);
const SHOPIFY_JSON = JSON.stringify({ products: [
  { title: "Oud Royal", handle: "oud-royal", images: [{ src: "https://cdn.shopify.com/oud.jpg" }], variants: [{ price: "149.00" }] },
  { title: "No photo", handle: "x", images: [], variants: [{ price: "10" }] },
  { title: "Insecure", handle: "y", images: [{ src: "http://cdn.example/insecure.jpg" }], variants: [{ price: "5" }] },
  { title: "Protocol-relative", handle: "z", images: [{ src: "//cdn.shopify.com/z.jpg" }], variants: [{ price: "99.5" }] },
] });
const LD_HOME = `<html><head><script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebSite","name":"X"},
  {"@type":"ItemList","itemListElement":[{"@type":"ListItem","item":{"@type":"Product","name":"عباية &amp; طرحة","image":["https://cdn.salla.sa/a.jpg"],"url":"https://lamsa.salla.sa/abaya/p111111","offers":{"@type":"Offer","price":"250","priceCurrency":"SAR"}}},
  {"@type":"ListItem","item":{"@type":"Product","name":"<b>Bad</b>","image":{"url":"https://cdn.salla.sa/b.jpg"},"offers":[{"price":99,"priceCurrency":"USD"}]}}]}]}</script>
  <script type="application/ld+json">{ not json </script></head><body></body></html>`;

test("product samples: CSV columns, Shopify, JSON-LD, og pages, SSRF guard", async () => {
  const { parseStores } = await import("../lib/crm.js");
  const P = await import("../lib/products.js");
  // CSV: English and Arabic product columns; the store's own link and product count still map right.
  const csv = "store_name,رابط المتجر,رابط المنتج 1,product1_title,product1_price,product1_image,اسم المنتج 2,سعر المنتج ٢,صورة المنتج 2,Products,email\n" +
    "Lamsa,https://lamsa.salla.sa,https://lamsa.salla.sa/abaya/p1,Black abaya,250 SAR,https://cdn.salla.sa/1.jpg,طرحة,٩٠,http://insecure/2.jpg,420,a@lamsa.sa\n" +
    "Volt,volt.zid.store,,,,,,,,15,v@volt.sa\n";
  const r = parseStores(csv);
  assert.equal(r.rows[0].domain, "lamsa.salla.sa"); assert.equal(r.rows[0].products, 420);
  assert.equal(r.with_products, 1); assert.equal(r.rows[0].products_source, "csv");
  assert.deepEqual(r.rows[0].products_sample[0], { title: "Black abaya", price: "250 SAR", image_url: "https://cdn.salla.sa/1.jpg", url: "https://lamsa.salla.sa/abaya/p1" });
  assert.equal(r.rows[0].products_sample[1].title, "طرحة"); assert.equal(r.rows[0].products_sample[1].image_url, ""); // http photos are dropped
  assert.equal(r.rows[1].products_sample, undefined);
  assert.equal(r.columns.product1_image, "product1_image"); assert.equal(r.columns.product2_title, "اسم المنتج 2");

  // Shopify products.json: first image, first variant price, https only.
  const sp = P.parseShopifyProducts(JSON.parse(SHOPIFY_JSON), "oud.myshopify.com");
  assert.deepEqual(sp[0], { title: "Oud Royal", price: "149", image_url: "https://cdn.shopify.com/oud.jpg", url: "https://oud.myshopify.com/products/oud-royal" });
  assert.equal(sp.find((p) => p.title === "Insecure").image_url, "");
  assert.equal(sp.find((p) => p.title === "Protocol-relative").image_url, "https://cdn.shopify.com/z.jpg");

  // JSON-LD: @graph + ItemList, arrays and objects for image, offers as array, broken blocks ignored.
  const ld = P.extractJsonLdProducts(LD_HOME, "https://lamsa.salla.sa/");
  assert.equal(ld.length, 2);
  assert.deepEqual(ld[0], { title: "عباية & طرحة", price: "250 ر.س", image_url: "https://cdn.salla.sa/a.jpg", url: "https://lamsa.salla.sa/abaya/p111111" });
  assert.equal(ld[1].price, "99 USD"); assert.equal(ld[1].image_url, "https://cdn.salla.sa/b.jpg");
  const og = P.extractOgProduct(`<meta property="og:title" content="عطر الليل"><meta property="og:image" content="https://cdn.zid.store/n.jpg"><meta property="product:price:amount" content="180"><meta property="product:price:currency" content="SAR">`, "https://n.zid.store/products/night");
  assert.deepEqual(og, { title: "عطر الليل", price: "180 ر.س", image_url: "https://cdn.zid.store/n.jpg", url: "https://n.zid.store/products/night" });
  assert.deepEqual(P.productLinks(`<a href="/abaya/p123456">a</a><a href="https://other.com/products/x">x</a><a href="/products/">all</a><a href="/products/rose">r</a><a href="/about">about</a>`, "https://lamsa.salla.sa/"),
    ["https://lamsa.salla.sa/abaya/p123456", "https://lamsa.salla.sa/products/rose"]);

  // SSRF: private, loopback, link-local and odd schemes are refused, also behind DNS and redirects.
  for (const ip of ["10.1.2.3", "127.0.0.1", "169.254.169.254", "172.20.0.1", "192.168.1.1", "100.64.0.1", "0.0.0.0", "::1", "fe80::1", "fd00::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "not-an-ip"]) assert.equal(P.isPrivateIp(ip), true, ip);
  for (const ip of ["93.184.216.34", "8.8.8.8", "2606:4700::1111"]) assert.equal(P.isPrivateIp(ip), false, ip);
  for (const u of ["http://127.0.0.1/", "http://[::1]/", "ftp://x.com/", "file:///etc/passwd", "http://localhost/", "https://internal.corp/", "http://a:b@x.com/"]) await assert.rejects(P.assertPublicUrl(u, publicDns), P.FetchRefused, u);
  await assert.doesNotReject(P.assertPublicUrl("https://lamsa.salla.sa/", publicDns));
  const calls = [];
  const redirecting = mockWeb({ "https://shop.example/": { status: 302, headers: { location: "http://evil.example/admin" } } }, calls);
  await assert.rejects(P.safeGet("https://shop.example/", { fetchImpl: redirecting, lookup: publicDns }), /Private/);
  assert.deepEqual(calls, ["https://shop.example/"]); // the private hop was never requested
  // Size cap: big pages are cut at maxBytes.
  const big = await P.safeGet("https://big.example/", { fetchImpl: mockWeb({ "https://big.example/": { body: "x".repeat(5000) } }), lookup: publicDns, limits: { ...P.FETCH_LIMITS, maxBytes: 1000 } });
  assert.equal(big.text.length, 1000); assert.equal(big.truncated, true);
  // The real transport re-checks the address when it connects (a DNS answer that turns private is refused).
  await assert.rejects(P.guardedFetch(base.replace("127.0.0.1", "localhost") + "/healthz", {}), P.FetchRefused);

  // One store, end to end, for each source.
  const web = mockWeb({
    "https://oud.myshopify.com/products.json?limit=6": { body: SHOPIFY_JSON, type: "application/json" },
    "https://lamsa.salla.sa/": { body: LD_HOME },
    "https://night.zid.store/": { body: `<a href="/products/night">Night</a><a href="/products/day">Day</a>` },
    "https://night.zid.store/products/night": { body: `<meta property="og:title" content="عطر الليل"><meta property="og:image" content="https://cdn.zid.store/n.jpg">` },
    "https://night.zid.store/products/day": { body: `<meta property="og:title" content="no photo">` },
    "https://empty.example/": { body: "<html><body>Loading…</body></html>" },
  });
  const o = { fetchImpl: web, lookup: publicDns };
  const shop = await P.fetchStoreProducts({ domain: "oud.myshopify.com", platform: "Shopify" }, o);
  assert.equal(shop.source, "shopify"); assert.equal(shop.products.length, 2); // only products with an https photo
  const sal = await P.fetchStoreProducts({ domain: "lamsa.salla.sa", platform: "Salla" }, o);
  assert.equal(sal.source, "jsonld"); assert.equal(sal.products.length, 2);
  const zid = await P.fetchStoreProducts({ domain: "night.zid.store", platform: "Zid" }, o);
  assert.equal(zid.source, "og"); assert.deepEqual(zid.products.map((p) => p.title), ["عطر الليل"]);
  const none = await P.fetchStoreProducts({ domain: "empty.example", platform: "Other" }, o);
  assert.equal(none.ok, false); assert.match(none.reason, /No product data/);
  const priv = await P.fetchStoreProducts({ domain: "internal.example", platform: "Other" }, o);
  assert.equal(priv.ok, false); assert.match(priv.reason, /Private/);
  assert.match((await P.fetchStoreProducts({ domain: "" }, o)).reason, /No store link/);
});

test("email block store_products: designed cards per store, fallback, escaping", async () => {
  const { renderEmail, cleanVariant, checkItem, cleanItem, DEFAULT_BRAND, STARTER_EMAIL, STORE_PRODUCTS_DEFAULTS } = await import("../lib/creative.js");
  assert.ok(STARTER_EMAIL.blocks.some((b) => b.type === "store_products"));
  const d = cleanVariant("email", { subject: "منتجات {{store_name}}", blocks: [{ type: "store_products", title: "منتجات {{store_name}}", count: 2, headline: "تسوّق الآن", cta_label: "أبي نماذج", cta_url: "https://dpa.ad/?s=1" }] });
  const contact = { store_name: "لمسة", products_sample: [
    { title: `<img src=x onerror=alert(1)> "عباية"`, price: "250 ر.س", image_url: "https://cdn.salla.sa/a.jpg?x=1&y=2", url: "https://lamsa.salla.sa/p1" },
    { title: "No https photo", price: "1", image_url: "http://cdn/insecure.jpg" },
    { title: "طرحة", price: "", image_url: "https://cdn.salla.sa/b.jpg" },
    { title: "Third", price: "3", image_url: "https://cdn.salla.sa/c.jpg" },
  ] };
  const r = renderEmail(d, DEFAULT_BRAND, { vars: { company: "DPA AD", contact } });
  assert.equal(r.rtl, true);
  assert.equal((r.html.match(/إعلان مصمم · DPA AD/g) || []).length, 2); // count 2 cards
  assert.match(r.html, /https:\/\/cdn\.salla\.sa\/a\.jpg\?x=1&amp;y=2/); assert.match(r.html, /cdn\.salla\.sa\/b\.jpg/);
  assert.ok(!r.html.includes("insecure.jpg") && !r.html.includes("c.jpg"));
  assert.ok(!r.html.includes("<img src=x") && r.html.includes("&lt;img src=x onerror=alert(1)&gt; &quot;عباية&quot;"));
  assert.match(r.html, /250 ر\.س/); assert.match(r.html, /href="https:\/\/dpa\.ad\/\?s=1"/); assert.match(r.html, /منتجات لمسة/);
  assert.match(r.html, /<!--\[if mso\]>/); // Outlook keeps the columns
  assert.match(r.text, /منتجات لمسة\n· .*250 ر\.س/);
  // No samples: the fallback text, never an empty block.
  const fb = renderEmail(d, DEFAULT_BRAND, { vars: { contact: { store_name: "زد ستور" } } });
  assert.ok(!fb.html.includes("إعلان مصمم · DPA AD"));
  assert.match(fb.html, /زد ستور/); assert.match(fb.text, new RegExp(STORE_PRODUCTS_DEFAULTS.fallback_text.slice(0, 12)));
  // Cleaning: count clamps to 1–3, unsafe links fall back to dpa.ad, checks accept the block.
  const c2 = cleanVariant("email", { blocks: [{ type: "store_products", count: 9, cta_url: "javascript:alert(1)", fallback_text: "<script>" }] }).blocks[0];
  assert.equal(c2.count, 3); assert.equal(c2.cta_url, "https://dpa.ad");
  assert.ok(!renderEmail({ blocks: [c2] }, DEFAULT_BRAND, { vars: { contact: {} } }).html.includes("<script>"));
  const item = cleanItem({ title: "T", date: "2026-12-01", channels: ["email"], variants: { email: { subject: "S", blocks: [{ type: "store_products" }, { type: "text", text: "x" }] } } });
  assert.deepEqual(checkItem(item, DEFAULT_BRAND).filter((x) => x.level === "bad"), []);

  // Studio preview: sample store (example.com photos) or a real CRM store with samples.
  const [ws] = await json("/api/workspaces");
  const P = `/api/workspaces/${ws.id}/creative`;
  const em = await (await post(`${P}/items`, { title: "Your products", starter_email: true })).json();
  const prev = await (await call(`${P}/items/${em.id}/email`)).text();
  assert.match(prev, /https:\/\/example\.com\/dpa-preview\/abaya\.jpg/);
  const c = appRef.locals.crm.add(ws.id, { store_name: "متجر الورد", domain: "ward.salla.sa", products_sample: [{ title: "باقة ورد", price: "120 ر.س", image_url: "https://cdn.salla.sa/ward.jpg", url: "" }] });
  assert.ok((await json(`${P}/preview-stores`)).some((x) => x.id === c.id));
  const prev2 = await (await call(`${P}/items/${em.id}/email?contact_id=${c.id}`)).text();
  assert.match(prev2, /cdn\.salla\.sa\/ward\.jpg/); assert.match(prev2, /متجر الورد/); assert.ok(!prev2.includes("example.com/dpa-preview"));
  assert.ok((await json(`${P}/meta`)).block_defaults.store_products.title);
  appRef.locals.crm.remove(ws.id, [c.id]); await call(`${P}/items/${em.id}`, { method: "DELETE" });
});

test("WhatsApp header image: the store's first product photo in the template payload", async () => {
  const { CrmStore } = await import("../lib/crmstore.js");
  const { createOutreach, makeSenders, whatsappPayload } = await import("../lib/outreach.js");
  const [ws] = await json("/api/workspaces");
  const crm = new CrmStore(fs.mkdtempSync(path.join(os.tmpdir(), "crm-wa-")), { flushMs: 5 });
  const cfg = { email: { ready: false, imap: { ready: false } }, whatsapp: { ready: true, token: "t", phone_id: "123", lang: "ar" }, public_url: "https://x.test", address: "Riyadh", inbound_secret: "" };
  const out = createOutreach({ store, crm, provider, cfg, senders: makeSenders(cfg) });
  crm.db.settings[ws.id] = { mode: "live", sender_name: "Noura" };
  const withPhoto = crm.add(ws.id, { store_name: "Lamsa", phone: "966551111111", wa_opt_in: true, owner_name: "Huda", products_sample: [{ title: "x", price: "", image_url: "http://no/1.jpg" }, { title: "Abaya", price: "250", image_url: "https://cdn.salla.sa/a.jpg" }] });
  const noPhoto = crm.add(ws.id, { store_name: "Reem", phone: "966553333333", wa_opt_in: true });
  const step = { channel: "whatsapp", body: "hi {{store_name}}", wa_template: "dpa_intro_img", wa_header: "product" };
  const realFetch = globalThis.fetch, bodies = [];
  globalThis.fetch = async (url, opts) => { bodies.push({ url, body: JSON.parse(opts.body) }); return new Response(JSON.stringify({ messages: [{ id: "wamid.1" }] }), { status: 200 }); };
  try {
    const m = await out.sendOne(ws.id, withPhoto, step);
    assert.equal(m.status, "sent"); assert.equal(m.wa_header_image, "https://cdn.salla.sa/a.jpg");
    const comps = bodies[0].body.template.components;
    assert.equal(bodies[0].url, "https://graph.facebook.com/v21.0/123/messages");
    assert.deepEqual(comps[0], { type: "header", parameters: [{ type: "image", image: { link: "https://cdn.salla.sa/a.jpg" } }] });
    assert.equal(comps[1].type, "body"); assert.deepEqual(comps[1].parameters.map((p) => p.text), ["Huda", "Lamsa"]);
    // No product photo and no fallback: skipped with a clear reason, nothing sent.
    const sk = await out.sendOne(ws.id, noPhoto, step);
    assert.equal(sk.status, "skipped"); assert.match(sk.error, /product photo/); assert.equal(bodies.length, 1);
    // A fixed fallback image on the step is used instead.
    const fbm = await out.sendOne(ws.id, noPhoto, { ...step, wa_header_url: "https://dpa.ad/sample.jpg" });
    assert.equal(fbm.status, "sent"); assert.equal(bodies[1].body.template.components[0].parameters[0].image.link, "https://dpa.ad/sample.jpg");
    // Opt-in still required; Test mode logs the header without sending.
    const noOpt = crm.add(ws.id, { store_name: "NoOpt", phone: "966554444444", products_sample: withPhoto.products_sample });
    assert.match((await out.sendOne(ws.id, noOpt, step)).error, /opt-in/);
    crm.db.settings[ws.id] = { mode: "test" };
    const t = await out.sendOne(ws.id, withPhoto, step);
    assert.equal(t.status, "test"); assert.equal(t.wa_header_image, "https://cdn.salla.sa/a.jpg"); assert.equal(bodies.length, 2);
  } finally { globalThis.fetch = realFetch; }
  assert.deepEqual(whatsappPayload({ to: "1", text: "x" }), { messaging_product: "whatsapp", to: "1", type: "text", text: { body: "x" } });
  // Campaign steps keep the option (WhatsApp only).
  const C = `/api/workspaces/${ws.id}/crm`;
  const camp = await (await post(`${C}/campaigns`, { name: "WA header", type: "outreach", filter: {}, steps: [{ channel: "whatsapp", body: "x", wa_template: "t", wa_header: "product", wa_header_url: "http://insecure/x.jpg" }, { channel: "email", subject: "s", body: "b", wa_header: "product" }] })).json();
  assert.equal(camp.steps[0].wa_header, "product"); assert.equal(camp.steps[0].wa_header_url, ""); assert.equal(camp.steps[1].wa_header, "");
  await call(`${C}/campaigns/${camp.id}`, { method: "DELETE" });
});

test("product fetch: store drawer, edits, bulk job with progress, personalized previews", async () => {
  const pages = {
    "https://lamsa.salla.sa/": { body: LD_HOME, delay: 30 },
    "https://oud.myshopify.com/products.json?limit=6": { body: SHOPIFY_JSON, type: "application/json", delay: 30 },
    "https://empty.example/": { body: "<html></html>", delay: 30 },
  };
  const d2 = fs.mkdtempSync(path.join(os.tmpdir(), "mwiz-pf-"));
  const st2 = new Store(d2), app2 = createApp({ store: st2, provider, password: "pw-pf", productOptions: { fetchImpl: mockWeb(pages), lookup: publicDns, delayMs: 0, pageDelayMs: 0 } }), srv = app2.listen(0);
  await new Promise((r) => srv.once("listening", r));
  const b2 = `http://127.0.0.1:${srv.address().port}`;
  const ck = (await fetch(b2 + "/login", { method: "POST", redirect: "manual", body: new URLSearchParams({ password: "pw-pf" }) })).headers.get("set-cookie").split(";")[0];
  const req = (p, method = "GET", b) => fetch(b2 + p, { method, headers: { "Content-Type": "application/json", cookie: ck }, body: b && JSON.stringify(b) });
  try {
    const [w] = await (await req("/api/workspaces")).json();
    const C = `/api/workspaces/${w.id}/crm`, crm = app2.locals.crm;
    const lamsa = crm.add(w.id, { store_name: "Lamsa", domain: "lamsa.salla.sa", platform: "Salla", email: "a@lamsa.sa", phone: "966551111111", wa_opt_in: true });
    const oud = crm.add(w.id, { store_name: "Oud", domain: "oud.myshopify.com", platform: "Shopify", email: "o@oud.sa" });
    const empty = crm.add(w.id, { store_name: "Empty", domain: "empty.example", platform: "Other", email: "e@empty.sa", products_sample: [{ title: "From CSV", price: "", image_url: "https://cdn.x/csv.jpg", url: "" }], products_source: "csv" });
    crm.add(w.id, { store_name: "Sample", domain: "s.example.com", sample: true });
    // One store from the drawer.
    const one = await (await req(`${C}/contacts/${lamsa.id}/products/fetch`, "POST")).json();
    assert.equal(one.ok, true); assert.equal(one.contact.products_source, "jsonld"); assert.equal(one.contact.products_sample.length, 2);
    // Bulk for a filter: background job with progress; a second start while running is refused.
    const job = await (await req(`${C}/products/fetch`, "POST", { filter: {} })).json();
    assert.equal(job.status, "running"); assert.equal(job.total, 3); // sample stores are skipped
    assert.equal((await req(`${C}/products/fetch`, "POST", { filter: {} })).status, 409);
    await app2.locals.products.wait(job.id);
    const done = await (await req(`${C}/products/jobs/${job.id}`)).json();
    assert.deepEqual([done.status, done.done, done.found, done.failed], ["done", 3, 2, 1]);
    assert.equal(done.errors[0].store, "Empty"); assert.match(done.errors[0].reason, /No product data/);
    assert.equal((await (await req(`${C}/products/jobs/latest`)).json()).id, job.id);
    assert.equal((await (await req(`${C}/meta`)).json()).products_job.id, job.id);
    assert.equal(crm.get(w.id, oud.id).products_source, "shopify");
    const e2 = crm.get(w.id, empty.id); // a failed fetch keeps the CSV samples and records why
    assert.equal(e2.products_sample[0].title, "From CSV"); assert.match(e2.products_error, /No product data/);
    // Edit or remove samples by hand: cleaned, https photos only.
    const ed = await (await req(`${C}/contacts/${oud.id}/products`, "PUT", { products: [{ title: "Edited", price: "10", image_url: "javascript:x" }, { title: "Kept", image_url: "https://cdn.shopify.com/k.jpg" }, ...Array(8).fill({ title: "more" })] })).json();
    assert.equal(ed.products_sample.length, 6); assert.equal(ed.products_sample[0].image_url, ""); assert.equal(ed.products_source, "manual");
    const has = await (await req(`${C}/contacts?f=${encodeURIComponent(JSON.stringify({ has_products: true }))}`)).json();
    assert.deepEqual(has.rows.map((r) => r.store_name).sort(), ["Empty", "Lamsa", "Oud"]);
    // Campaign preview defaults to a store with products and can pick any; designed email shown as that store gets it.
    const P = `/api/workspaces/${w.id}/creative`;
    const em = await (await req(`${P}/items`, "POST", { title: "Your products", starter_email: true })).json();
    await req(`${P}/items/${em.id}/status`, "POST", { status: "approved" });
    const camp = await (await req(`${C}/campaigns`, "POST", { name: "Products", type: "outreach", filter: {}, steps: [{ channel: "email", subject: "", body: "", design_id: em.id }, { channel: "whatsapp", body: "x", wa_template: "t", wa_header: "product" }] })).json();
    const pv = await (await req(`${C}/campaigns/${camp.id}/preview?contact_id=${lamsa.id}`)).json();
    assert.equal(pv.store, "Lamsa"); assert.ok(pv.stores_with_products.length >= 3);
    assert.match(pv.steps[0].body, /عباية & طرحة/); assert.equal(pv.steps[1].header_image, "https://cdn.salla.sa/a.jpg");
    const html = await (await req(pv.steps[0].email_url)).text();
    assert.match(html, /cdn\.salla\.sa\/a\.jpg/); assert.match(html, /إعلان مصمم · DPA AD/); assert.match(html, /Unsubscribe/);
    const noP = crm.add(w.id, { store_name: "NoPhotos", domain: "np.example", email: "n@np.sa" });
    const pv2 = await (await req(`${C}/campaigns/${camp.id}/preview?contact_id=${noP.id}`)).json();
    assert.match(pv2.steps[1].warning, /skipped/); assert.ok(!(await (await req(pv2.steps[0].email_url)).text()).includes("إعلان مصمم · DPA AD"));
  } finally { srv.close(); app2.locals.crm.flush(); fs.rmSync(d2, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------- Creative Studio phases 2-3
// A mock of every platform API: routes are [method, regex, (url, opts, n) => { status, json, headers }].
function mockFetch(routes) {
  const calls = [];
  const fn = async (url, opts = {}) => {
    const method = opts.method || "GET";
    calls.push({ method, url: String(url), body: opts.body, headers: opts.headers || {} });
    const r = routes.find(([m, re]) => m === method && re.test(String(url)));
    if (!r) return new Response(JSON.stringify({ error: { message: `no mock for ${method} ${url}` } }), { status: 500 });
    const out = await r[2](String(url), opts, calls.filter((c) => r[1].test(c.url)).length);
    return new Response(out.text ?? JSON.stringify(out.json ?? {}), { status: out.status || 200, headers: { "content-type": "application/json", ...(out.headers || {}) } });
  };
  fn.calls = calls;
  return fn;
}
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 2)]);
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypisom"), Buffer.alloc(200, 3)]);
const MP3 = Buffer.concat([Buffer.from("ID3"), Buffer.alloc(64, 4)]);

async function studioApp({ env = {}, routes = [], provider: prov } = {}) {
  const { socialConfig } = await import("../lib/social.js");
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "mwiz-st-"));
  const st = new Store(d), fetchImpl = mockFetch(routes);
  const supportProvider = prov || { name: "fake", model: "fake", async generate({ prompt }) {
    if (prompt.includes("AI Support's next reply")) return 'META {"category":"other","language":"ar","escalate":false,"reason":""}\n\nهلا! نرد عليك بالخاص.';
    if (prompt.includes('title="What worked"')) return "## What worked\nReels led on saves.";
    return "{}";
  } };
  const cfg = socialConfig({ PUBLIC_URL: "https://wiz.test", META_APP_ID: "mapp", META_APP_SECRET: "msecret", META_VERIFY_TOKEN: "mverify", LINKEDIN_CLIENT_ID: "lid", LINKEDIN_CLIENT_SECRET: "lsec", GOOGLE_CLIENT_ID: "gid", GOOGLE_CLIENT_SECRET: "gsec", TIKTOK_CLIENT_KEY: "tkey", TIKTOK_CLIENT_SECRET: "tsec", ...env }, "pw-st");
  const app = createApp({ store: st, provider: supportProvider, password: "pw-st", studioOptions: { cfg, fetchImpl, sleep: async () => {}, pollEvery: 0, pollMax: 5, log: { error() {} } } });
  const srv = app.listen(0);
  await new Promise((r) => srv.once("listening", r));
  const b = `http://127.0.0.1:${srv.address().port}`;
  const ck = (await fetch(b + "/login", { method: "POST", redirect: "manual", body: new URLSearchParams({ password: "pw-st" }) })).headers.get("set-cookie").split(";")[0];
  const req = (p, opts = {}) => fetch(b + p, { redirect: "manual", ...opts, headers: { "Content-Type": "application/json", cookie: ck, ...(opts.headers || {}) } });
  const j = async (p, body, method) => { const r = await req(p, { method: method || (body !== undefined ? "POST" : "GET"), body: body !== undefined ? JSON.stringify(body) : undefined }); return { status: r.status, body: r.status === 204 ? null : await r.json() }; };
  const [w] = st.listWorkspaces();
  const upload = (buf, filename, q = {}, type = "application/octet-stream") => fetch(`${b}/api/workspaces/${w.id}/creative/media?${new URLSearchParams({ filename, ...q })}`, { method: "POST", headers: { "Content-Type": type, cookie: ck }, body: buf });
  const close = () => { srv.close(); app.locals.crm.flush(); fs.rmSync(d, { recursive: true, force: true }); };
  return { st, app, studio: app.locals.studio, cfg, fetchImpl, b, ck, req, j, w, P: `/api/workspaces/${w.id}/creative`, upload, close, dir: d };
}
// An approved item, straight in the store (approval itself is tested in phase 1).
function addItem(st, wsId, { channels, variants, status = "scheduled", date = "2026-01-05", time = "09:00" }) {
  return st.addOps("creative_items", wsId, { title: "Test post", status, date, time, channels, variants, comments: [], history: [], published: {}, pillar: "product" });
}
function connectMeta(studio, wsId) {
  return studio.saveAccount(wsId, "meta", { name: "DPA AD", tokens: { user: "U-LONG", pages: { P1: "PAGE-TOKEN" } }, targets: [{ id: "P1", page_id: "P1", page_name: "DPA AD", ig_id: "IG1", ig_username: "dpa.ad" }], selected: "P1", expires_at: new Date(Date.now() + 50 * 864e5).toISOString(), scopes: ["pages_show_list"] }, "test");
}

test("studio: token encryption round-trip and OAuth state (CSRF) checks", async () => {
  const { seal, unseal, tokenKey, makeState, checkState } = await import("../lib/social.js");
  const k = tokenKey("", "pass-1"), k2 = tokenKey("", "pass-2"), hex = tokenKey("a".repeat(64), "x");
  assert.equal(hex.length, 32); assert.deepEqual(hex, Buffer.from("a".repeat(64), "hex"));
  const s = seal({ access: "secret-token" }, k);
  assert.ok(!s.includes("secret-token"));
  assert.deepEqual(unseal(s, k), { access: "secret-token" });
  assert.equal(unseal(s, k2), null); // rotated password without TOKEN_KEY: unreadable, reconnect
  const parts = s.split("."); parts[3] = (parts[3][0] === "A" ? "B" : "A") + parts[3].slice(1);
  assert.equal(unseal(parts.join("."), k), null); // tampered
  assert.notEqual(seal({ a: 1 }, k), seal({ a: 1 }, k)); // random IV
  const { state, nonce } = makeState(k, { ws: "1", provider: "meta", uid: "owner" });
  assert.deepEqual(checkState(k, state, { uid: "owner", nonce, provider: "meta" }), { ws: "1", provider: "meta" });
  assert.equal(checkState(k, state, { uid: "someone-else", nonce, provider: "meta" }), null);
  assert.equal(checkState(k, state, { uid: "owner", nonce: "other", provider: "meta" }), null);
  assert.equal(checkState(k, state, { uid: "owner", nonce, provider: "tiktok" }), null);
  assert.equal(checkState(k2, state, { uid: "owner", nonce, provider: "meta" }), null);
  assert.equal(checkState(k, state.slice(0, -3) + "abc", { uid: "owner", nonce, provider: "meta" }), null);
  assert.equal(checkState(k, state, { uid: "owner", nonce, provider: "meta" }, Date.now() + 16 * 60e3), null); // expired
});

test("studio: media library upload limits, public serving, tags, delete", async () => {
  const t = await studioApp();
  try {
    const up = await t.upload(PNG, "packshot.png", { tags: "Abaya, ramadan", ai: "1" });
    assert.equal(up.status, 201);
    const m = await up.json();
    assert.equal(m.kind, "image"); assert.equal(m.ext, "png"); assert.deepEqual(m.tags, ["abaya", "ramadan"]); assert.equal(m.ai_generated, true);
    assert.match(m.url, /^https:\/\/wiz\.test\/media\/[A-Za-z0-9_-]{32}\.png$/); assert.equal(m.path, m.url.replace("https://wiz.test", ""));
    // Served publicly (platforms fetch it), right type, no login needed.
    const pub = await fetch(t.b + m.path);
    assert.equal(pub.status, 200); assert.equal(pub.headers.get("content-type"), "image/png"); assert.equal(pub.headers.get("x-content-type-options"), "nosniff");
    assert.deepEqual(Buffer.from(await pub.arrayBuffer()), PNG);
    assert.equal((await fetch(t.b + "/media/..%2Fdb.json")).status, 404);
    assert.equal((await fetch(t.b + "/media/short.png")).status, 404);
    // Allowlist and real bytes: a text file named .png is refused; unknown types too.
    assert.equal((await t.upload(Buffer.from("hello world, not an image"), "fake.png")).status, 415);
    assert.equal((await t.upload(PNG, "doc.pdf")).status, 415);
    assert.equal((await t.upload(JPG, "photo.jpeg")).status, 201);
    assert.equal((await t.upload(MP4, "reel.mp4")).status, 201);
    // Size limits: images 10 MB.
    const big = Buffer.concat([PNG, Buffer.alloc(10 * 1024 * 1024 + 10)]);
    assert.equal((await t.upload(big, "big.png")).status, 413);
    // Audio needs "I have the rights".
    assert.equal((await t.upload(MP3, "song.mp3")).status, 422);
    const au = await t.upload(MP3, "voice.mp3", { rights: "1", licence: "Recorded by Noura" });
    assert.equal(au.status, 201); const a = await au.json();
    assert.equal(a.kind, "audio"); assert.equal(a.rights_confirmed, true); assert.equal(a.licence, "Recorded by Noura");
    const list = (await t.j(`${t.P}/media`)).body;
    assert.equal(list.media.length, 4); assert.equal(list.limits.mp4.max_mb, 150);
    const ed = (await t.j(`${t.P}/media/${m.id}`, { tags: "eid", ai_generated: false, name: "Abaya" }, "PUT")).body;
    assert.deepEqual(ed.tags, ["eid"]); assert.equal(ed.ai_generated, false);
    // Attached to a variant, then deleted: the file goes and the variant forgets it.
    const it = (await t.j(`${t.P}/items`, { title: "With media", channels: ["ig_post"], variants: { ig_post: { caption_ar: "هلا", media: [m.id] } } })).body;
    assert.deepEqual(it.variants.ig_post.media, [m.id]);
    assert.ok(it.checks.some((c) => c.level === "bad" && /only accepts JPEG/.test(c.text))); // Instagram needs JPEG
    assert.ok(!it.checks.some((c) => /attach or link/.test(c.text)));
    assert.equal((await t.req(`${t.P}/media/${m.id}`, { method: "DELETE" })).status, 204);
    assert.equal((await fetch(t.b + m.path)).status, 404);
    assert.deepEqual(t.st.getOps("creative_items", t.w.id, it.id).variants.ig_post.media, []);
    assert.ok(!fs.readdirSync(path.join(t.dir, "media")).some((f) => f.startsWith(".up-"))); // no temp files left
    // Deleting the workspace removes its files.
    assert.ok(fs.readdirSync(path.join(t.dir, "media")).length >= 3);
    t.st.deleteWorkspace(t.w.id);
    assert.equal(fs.readdirSync(path.join(t.dir, "media")).length, 0);
  } finally { t.close(); }
});

test("studio: OAuth connect needs a signed-in person, a valid state and the browser cookie", async () => {
  const t = await studioApp({ routes: [
    ["GET", /graph\.facebook\.com\/v23\.0\/oauth\/access_token\?client_id=mapp.*code=CODE1/, () => ({ json: { access_token: "SHORT" } })],
    ["GET", /oauth\/access_token\?grant_type=fb_exchange_token/, () => ({ json: { access_token: "LONG", expires_in: 5184000 } })],
    ["GET", /\/me\?fields=id%2Cname/, () => ({ json: { id: "U1", name: "Founder" } })],
    ["GET", /\/me\/permissions/, () => ({ json: { data: [{ permission: "pages_show_list", status: "granted" }, { permission: "instagram_content_publish", status: "granted" }] } })],
    ["GET", /\/me\/accounts\?fields=name%2Caccess_token%2Cinstagram_business_account/, () => ({ json: { data: [{ id: "P0", name: "Old page", access_token: "PT0" }, { id: "P1", name: "DPA AD", access_token: "PT1", instagram_business_account: { id: "IG1", username: "dpa.ad" } }] } })],
    ["DELETE", /\/me\/permissions/, () => ({ json: { success: true } })],
  ] });
  try {
    // Not logged in: login wall.
    assert.equal((await fetch(t.b + `/oauth/meta/start?ws=${t.w.id}`, { redirect: "manual" })).status, 302);
    assert.match((await fetch(t.b + `/oauth/meta/callback?code=x&state=y`, { redirect: "manual" })).headers.get("location"), /\/login/);
    const start = await t.req(`/oauth/meta/start?ws=${t.w.id}`);
    assert.equal(start.status, 302);
    const loc = new URL(start.headers.get("location"));
    assert.equal(loc.origin + loc.pathname, "https://www.facebook.com/v23.0/dialog/oauth");
    assert.equal(loc.searchParams.get("redirect_uri"), "https://wiz.test/oauth/meta/callback");
    assert.match(loc.searchParams.get("scope"), /instagram_content_publish/);
    const nonce = /mwiz_oauth=([^;]+)/.exec(start.headers.get("set-cookie"))[1];
    const state = loc.searchParams.get("state");
    // Wrong or missing cookie (another browser) → refused; bad state → refused.
    assert.equal((await t.req(`/oauth/meta/callback?code=CODE1&state=${encodeURIComponent(state)}`)).status, 403);
    assert.equal((await t.req(`/oauth/meta/callback?code=CODE1&state=forged`, { headers: { cookie: `${t.ck}; mwiz_oauth=${nonce}` } })).status, 403);
    assert.equal(t.fetchImpl.calls.length, 0);
    const ok = await t.req(`/oauth/meta/callback?code=CODE1&state=${encodeURIComponent(state)}`, { headers: { cookie: `${t.ck}; mwiz_oauth=${nonce}` } });
    assert.equal(ok.status, 302); assert.equal(ok.headers.get("location"), `/#/${t.w.id}/studio/accounts`);
    const acc = (await t.j(`${t.P}/accounts`)).body;
    const meta = acc.providers.find((p) => p.id === "meta");
    assert.equal(meta.configured, true); assert.equal(meta.account.status, "connected"); assert.equal(meta.account.target.ig_username, "dpa.ad"); // picks the Page with Instagram
    assert.ok(meta.account.missing_scopes.includes("instagram_manage_comments"));
    assert.ok(!JSON.stringify(acc).includes("PT1") && !JSON.stringify(acc).includes("LONG") && !("token_enc" in meta.account)); // tokens never reach the browser
    assert.match(acc.notice.text, /connected/);
    const raw = t.st.db.social_accounts[0];
    assert.ok(!raw.token_enc.includes("PT1"));
    assert.deepEqual(t.studio.tokensOf(raw).pages, { P0: "PT0", P1: "PT1" });
    assert.equal(acc.settings.mode, "test"); assert.equal(acc.settings.auto_publish, false); // safe defaults
    // Switch page, then disconnect (revokes).
    assert.equal((await t.j(`${t.P}/accounts/${raw.id}`, { selected: "P0" }, "PUT")).body.target.page_id, "P0");
    assert.equal((await t.j(`${t.P}/accounts/${raw.id}`, { selected: "nope" }, "PUT")).status, 422);
    assert.equal((await t.req(`${t.P}/accounts/${raw.id}`, { method: "DELETE" })).status, 204);
    assert.ok(t.fetchImpl.calls.some((c) => c.method === "DELETE" && /me\/permissions/.test(c.url)));
    assert.equal(t.st.db.social_accounts.length, 0);
    // Unconfigured platform: clear message, no redirect.
    const t2 = await studioApp({ env: { TIKTOK_CLIENT_KEY: "" } });
    try { assert.equal((await t2.req(`/oauth/tiktok/start?ws=${t2.w.id}`)).status, 422); } finally { t2.close(); }
  } finally { t.close(); }
});

test("studio: OAuth code exchange for LinkedIn, YouTube and TikTok, with refresh", async () => {
  const { socialConfig, exchangeCode, refreshTokens, authUrl } = await import("../lib/social.js");
  const cfg = socialConfig({ PUBLIC_URL: "https://wiz.test", LINKEDIN_CLIENT_ID: "lid", LINKEDIN_CLIENT_SECRET: "lsec", LINKEDIN_ORG_ID: "777", GOOGLE_CLIENT_ID: "gid", GOOGLE_CLIENT_SECRET: "gsec", TIKTOK_CLIENT_KEY: "tkey", TIKTOK_CLIENT_SECRET: "tsec" }, "pw");
  const f = mockFetch([
    ["POST", /linkedin\.com\/oauth\/v2\/accessToken/, () => ({ json: { access_token: "LI", expires_in: 5184000, scope: "openid,profile,w_member_social" } })],
    ["GET", /api\.linkedin\.com\/v2\/userinfo/, () => ({ json: { sub: "abc", name: "Founder" } })],
    ["POST", /oauth2\.googleapis\.com\/token/, (u, o) => ({ json: String(o.body).includes("refresh_token=GR") ? { access_token: "GA2", expires_in: 3599 } : { access_token: "GA", refresh_token: "GR", expires_in: 3599, scope: "https://www.googleapis.com/auth/youtube.upload" } })],
    ["GET", /youtube\/v3\/channels\?part=snippet&mine=true/, () => ({ json: { items: [{ id: "UC1", snippet: { title: "DPA AD" } }] } })],
    ["POST", /open\.tiktokapis\.com\/v2\/oauth\/token\//, () => ({ json: { access_token: "TA", refresh_token: "TR", open_id: "OPEN1", expires_in: 86400, refresh_expires_in: 31536000, scope: "user.info.basic,video.publish" } })],
    ["GET", /open\.tiktokapis\.com\/v2\/user\/info/, () => ({ json: { data: { user: { open_id: "OPEN1", display_name: "dpa" } }, error: { code: "ok" } } })],
  ]);
  const li = await exchangeCode(cfg, "linkedin", "C", f);
  assert.equal(li.targets[0].author, "urn:li:person:abc"); assert.equal(li.targets[1].author, "urn:li:organization:777");
  assert.match(authUrl(cfg, "linkedin", "s"), /w_organization_social/);
  const g = await exchangeCode(cfg, "google", "C", f);
  assert.equal(g.tokens.refresh, "GR"); assert.equal(g.selected, "UC1");
  assert.match(authUrl(cfg, "google", "s"), /access_type=offline/);
  const r = await refreshTokens(cfg, "google", g.tokens, f);
  assert.equal(r.tokens.access, "GA2"); assert.equal(r.tokens.refresh, "GR");
  const tk = await exchangeCode(cfg, "tiktok", "C", f);
  assert.equal(tk.selected, "OPEN1"); assert.equal(tk.name, "dpa");
  assert.equal(await refreshTokens(cfg, "meta", { user: "x" }, f), null);
  assert.ok(!f.calls.some((c) => c.url.includes("lsec"))); // client secrets go in POST bodies, not URLs (except Meta's documented GET)
});

test("studio: every platform publisher calls the right endpoints (mocked)", async () => {
  const { socialConfig, PUBLISHERS, tiktokChunks, youtubeTitle } = await import("../lib/social.js");
  const cfg = socialConfig({ PUBLIC_URL: "https://wiz.test" }, "pw");
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "mwiz-pub-"));
  const file = path.join(d, "v.mp4"); fs.writeFileSync(file, MP4);
  const img = (n) => ({ kind: "image", ext: "jpg", mime: "image/jpeg", url: `https://wiz.test/media/i${n}.jpg`, local: file, size: MP4.length });
  const vid = { kind: "video", ext: "mp4", mime: "video/mp4", url: "https://wiz.test/media/v.mp4", local: file, size: MP4.length, duration: 20 };
  const variant = { caption_ar: "إعلان مصمم", caption_en: "Designed ad (new)", hashtags: ["#DPAAD"] };
  let statusN = 0;
  const f = mockFetch([
    ["POST", /\/IG1\/media$/, (u, o) => ({ json: { id: "C" + (new URLSearchParams(o.body).get("media_type") || "IMG") } })],
    ["GET", /\/C(REELS|CAROUSEL|STORIES|VIDEO)\?fields=status_code/, () => ({ json: { status_code: ++statusN % 2 ? "IN_PROGRESS" : "FINISHED" } })],
    ["POST", /\/IG1\/media_publish$/, () => ({ json: { id: "M1" } })],
    ["GET", /\/M1\?fields=permalink/, () => ({ json: { permalink: "https://instagram.com/p/x" } })],
    ["POST", /\/P1\/photos$/, (u, o) => ({ json: new URLSearchParams(o.body).get("published") === "false" ? { id: "PH" + Math.random() } : { id: "PH1", post_id: "P1_9" } })],
    ["POST", /\/P1\/feed$/, () => ({ json: { id: "P1_10" } })],
    ["POST", /graph-video\.facebook\.com\/v23\.0\/P1\/videos$/, () => ({ json: { id: "V1" } })],
    ["POST", /rest\/images\?action=initializeUpload/, () => ({ json: { value: { uploadUrl: "https://upload.linkedin.test/1", image: "urn:li:image:1" } } })],
    ["PUT", /upload\.linkedin\.test/, () => ({ status: 201 })],
    ["POST", /api\.linkedin\.com\/rest\/posts$/, () => ({ status: 201, text: "", headers: { "x-restli-id": "urn:li:share:9" } })],
    ["POST", /upload\/youtube\/v3\/videos\?uploadType=resumable/, () => ({ headers: { location: "https://upload.youtube.test/s1" } })],
    ["PUT", /upload\.youtube\.test\/s1/, () => ({ json: { id: "YT1" } })],
    ["POST", /creator_info\/query/, () => ({ json: { data: { privacy_level_options: ["PUBLIC_TO_EVERYONE", "SELF_ONLY"], creator_username: "dpa", max_video_post_duration_sec: 600 }, error: { code: "ok" } } })],
    ["POST", /publish\/video\/init/, () => ({ json: { data: { publish_id: "PUB1", upload_url: "https://upload.tiktok.test/u" }, error: { code: "ok" } } })],
    ["PUT", /upload\.tiktok\.test/, () => ({ status: 201 })],
    ["POST", /publish\/status\/fetch/, (u, o, n) => ({ json: { data: n < 2 ? { status: "PROCESSING_UPLOAD" } : { status: "PUBLISH_COMPLETE", publicaly_available_post_id: [] }, error: { code: "ok" } } })],
  ]);
  const base = { cfg, fetchImpl: f, sleep: async () => {}, pollEvery: 0, pollMax: 5, variant, item: {} };
  const meta = { ...base, target: { page_id: "P1", ig_id: "IG1" }, tokens: { pages: { P1: "PT" } } };
  try {
    // Instagram image, carousel, reel (polls until FINISHED), story.
    let r = await PUBLISHERS.meta({ ...meta, channel: "ig_post", files: [img(1)] });
    assert.equal(r.post_id, "M1"); assert.equal(r.url, "https://instagram.com/p/x");
    const first = new URLSearchParams(f.calls[0].body);
    assert.equal(first.get("image_url"), "https://wiz.test/media/i1.jpg"); assert.match(first.get("caption"), /إعلان مصمم\n\nDesigned ad \(new\)\n\n#DPAAD/); assert.equal(first.get("access_token"), "PT");
    f.calls.length = 0;
    await PUBLISHERS.meta({ ...meta, channel: "ig_carousel", files: [img(1), img(2), vid] });
    const kids = f.calls.filter((c) => /IG1\/media$/.test(c.url)).map((c) => new URLSearchParams(c.body));
    assert.equal(kids.filter((k) => k.get("is_carousel_item") === "true").length, 3);
    assert.equal(kids[2].get("media_type"), "VIDEO"); assert.equal(kids[3].get("media_type"), "CAROUSEL"); assert.equal(kids[3].get("children").split(",").length, 3);
    f.calls.length = 0;
    await PUBLISHERS.meta({ ...meta, channel: "ig_reel", files: [vid], cover: img(9) });
    const reel = new URLSearchParams(f.calls[0].body);
    assert.equal(reel.get("media_type"), "REELS"); assert.equal(reel.get("video_url"), vid.url); assert.equal(reel.get("cover_url"), img(9).url);
    assert.ok(f.calls.filter((c) => /status_code/.test(c.url)).length >= 1);
    f.calls.length = 0;
    await PUBLISHERS.meta({ ...meta, channel: "ig_story", files: [img(1)] });
    assert.equal(new URLSearchParams(f.calls[0].body).get("media_type"), "STORIES"); assert.equal(new URLSearchParams(f.calls[0].body).get("caption"), null);
    await assert.rejects(PUBLISHERS.meta({ ...meta, channel: "ig_reel", files: [img(1)] }), /MP4/);
    // Facebook Page: photo, multi-photo post, video by URL.
    f.calls.length = 0;
    r = await PUBLISHERS.meta({ ...meta, channel: "fb_post", files: [img(1)] });
    assert.equal(r.post_id, "P1_9"); assert.equal(new URLSearchParams(f.calls[0].body).get("url"), img(1).url);
    f.calls.length = 0;
    r = await PUBLISHERS.meta({ ...meta, channel: "fb_post", files: [img(1), img(2)] });
    const feed = new URLSearchParams(f.calls.at(-1).body);
    assert.equal(r.post_id, "P1_10"); assert.match(feed.get("attached_media[1]"), /media_fbid/);
    r = await PUBLISHERS.meta({ ...meta, channel: "fb_post", files: [vid] });
    assert.equal(r.post_id, "V1"); assert.equal(new URLSearchParams(f.calls.at(-1).body).get("file_url"), vid.url);
    // LinkedIn: image upload then the post, with the version headers and escaped text.
    f.calls.length = 0;
    r = await PUBLISHERS.linkedin({ ...base, channel: "linkedin", target: { author: "urn:li:person:abc" }, tokens: { access: "LI" }, files: [img(1)] });
    assert.equal(r.post_id, "urn:li:share:9"); assert.equal(r.url, "https://www.linkedin.com/feed/update/urn:li:share:9");
    const lp = f.calls.find((c) => /rest\/posts/.test(c.url));
    assert.equal(lp.headers["X-Restli-Protocol-Version"], "2.0.0"); assert.match(lp.headers["LinkedIn-Version"], /^\d{6}$/);
    const lb = JSON.parse(lp.body);
    assert.equal(lb.content.media.id, "urn:li:image:1"); assert.match(lb.commentary, /\\\(new\\\)/); assert.match(lb.commentary, /\{hashtag\|\\#\|DPAAD\}/);
    assert.ok(f.calls.some((c) => c.method === "PUT" && /upload\.linkedin\.test/.test(c.url)));
    // YouTube: resumable upload; Shorts get #Shorts; private until audited.
    f.calls.length = 0;
    r = await PUBLISHERS.google({ ...base, channel: "yt_short", tokens: { access: "GA" }, files: [vid] });
    assert.equal(r.url, "https://www.youtube.com/shorts/YT1"); assert.match(r.note, /private/);
    const ym = JSON.parse(f.calls[0].body);
    assert.match(ym.snippet.title, /#Shorts$/); assert.equal(ym.status.privacyStatus, "private"); assert.equal(f.calls[0].headers["X-Upload-Content-Type"], "video/mp4");
    assert.equal(youtubeTitle("yt_short", { caption_ar: "x".repeat(200) }).length, 100);
    await assert.rejects(PUBLISHERS.google({ ...base, channel: "yt_short", tokens: { access: "GA" }, files: [{ ...vid, duration: 75 }] }), /under 60/);
    // TikTok: creator info → init FILE_UPLOAD → PUT chunks → status. Unaudited: SELF_ONLY.
    f.calls.length = 0;
    r = await PUBLISHERS.tiktok({ ...base, channel: "tiktok", tokens: { access: "TA" }, files: [vid] });
    const init = JSON.parse(f.calls.find((c) => /video\/init/.test(c.url)).body);
    assert.equal(init.post_info.privacy_level, "SELF_ONLY"); assert.equal(init.source_info.source, "FILE_UPLOAD"); assert.equal(init.source_info.total_chunk_count, 1);
    assert.equal(f.calls.find((c) => c.method === "PUT").headers["Content-Range"], `bytes 0-${MP4.length - 1}/${MP4.length}`);
    assert.match(r.note, /SELF_ONLY/); assert.equal(r.post_id, "PUB1");
    assert.deepEqual(tiktokChunks(200 * 1024 * 1024), { chunk_size: 20 * 1024 * 1024, count: 10 });
    const aud = socialConfig({ TIKTOK_AUDITED: "1" }, "pw");
    f.calls.length = 0;
    await PUBLISHERS.tiktok({ ...base, cfg: aud, channel: "tiktok", tokens: { access: "TA" }, files: [vid] });
    assert.equal(JSON.parse(f.calls.find((c) => /video\/init/.test(c.url)).body).post_info.privacy_level, "PUBLIC_TO_EVERYONE");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("studio: scheduler publishes only approved+due items, Test mode only logs, retries stop at 3", async () => {
  let fail = true;
  const t = await studioApp({ routes: [
    ["POST", /\/IG1\/media$/, () => (fail ? { status: 400, json: { error: { message: "Media download failed" } } } : { json: { id: "C1" } })],
    ["POST", /\/IG1\/media_publish$/, () => ({ json: { id: "M7" } })],
    ["GET", /\/M7\?fields=permalink/, () => ({ json: { permalink: "https://instagram.com/p/m7" } })],
  ] });
  try {
    const { canAutoPublish, isDue } = await import("../lib/publisher.js");
    const m = await (await t.upload(JPG, "ad.jpg")).json();
    connectMeta(t.studio, t.w.id);
    const v = { ig_post: { caption_ar: "هلا", media: [m.id] }, x: { caption_ar: "هلا" } };
    const due = addItem(t.st, t.w.id, { channels: ["ig_post", "x"], variants: v });
    const review = addItem(t.st, t.w.id, { channels: ["ig_post"], variants: v, status: "review" });
    const approved = addItem(t.st, t.w.id, { channels: ["ig_post"], variants: v, status: "approved" }); // approved, not scheduled: waits for a person
    const later = addItem(t.st, t.w.id, { channels: ["ig_post"], variants: v, date: "2099-01-01" });
    assert.equal(isDue(due), true); assert.equal(isDue(later), false);
    const riyadhToday = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
    assert.equal(isDue({ status: "scheduled", date: riyadhToday, time: "23:59" }, Date.parse(`${riyadhToday}T20:58:00Z`)), false); // 23:58 Riyadh
    assert.equal(isDue({ status: "scheduled", date: riyadhToday, time: "23:59" }, Date.parse(`${riyadhToday}T21:00:00Z`)), true);
    // Auto-publish is off by default: due items wait for "Publish now".
    assert.equal(canAutoPublish(t.w), false);
    assert.deepEqual(await t.studio.tick(), { items: 0, waiting: 1 });
    assert.equal(t.st.db.creative_publish_log.length, 0);
    // Test mode + auto: logs "would publish" once, calls nothing.
    assert.equal((await t.j(`${t.P}/publish/settings`, { auto_publish: true }, "PUT")).body.can_auto_publish, true);
    await t.studio.tick(); await t.studio.tick();
    const logs = t.st.db.creative_publish_log.filter((l) => l.status === "test");
    assert.equal(logs.length, 1); assert.equal(logs[0].item_id, due.id); assert.match(logs[0].text, /would publish Instagram post → Meta \(@dpa\.ad\)/);
    assert.equal(t.fetchImpl.calls.length, 0);
    assert.equal(t.st.getOps("creative_items", t.w.id, due.id).status, "scheduled");
    // Live: the platform fails → retry later, max 3 tries.
    await t.j(`${t.P}/publish/settings`, { mode: "live" }, "PUT");
    await t.studio.tick();
    let st = t.st.getOps("creative_items", t.w.id, due.id).publish_state.ig_post;
    assert.equal(st.attempts, 1); assert.match(st.last_error, /Media download failed/); assert.ok(st.next_at);
    await t.studio.tick(); // too soon: waits for next_at
    assert.equal(t.st.getOps("creative_items", t.w.id, due.id).publish_state.ig_post.attempts, 1);
    await t.studio.tick(new Date(Date.now() + 6 * 60e3));
    await t.studio.tick(new Date(Date.now() + 30 * 60e3));
    st = t.st.getOps("creative_items", t.w.id, due.id).publish_state.ig_post;
    assert.equal(st.attempts, 3); assert.equal(st.failed, true);
    const before = t.fetchImpl.calls.length;
    await t.studio.tick(new Date(Date.now() + 90 * 60e3));
    assert.equal(t.fetchImpl.calls.length, before); // stopped after 3
    assert.ok(t.st.db.creative_publish_log.some((l) => l.status === "failed" && /Stopped after 3/.test(l.text)));
    // A person retries: works now. X has no API, so the item stays scheduled until someone posts it by hand.
    fail = false;
    const rt = (await t.j(`${t.P}/items/${due.id}/retry`, { channel: "ig_post" })).body;
    assert.deepEqual(rt.result.published, ["ig_post"]);
    const it = t.st.getOps("creative_items", t.w.id, due.id);
    assert.equal(it.published.ig_post.post_id, "M7"); assert.equal(it.published.ig_post.url, "https://instagram.com/p/m7"); assert.equal(it.published.ig_post.via, "api");
    assert.equal(it.status, "scheduled");
    assert.equal(rt.publishing.channels.x.direct, false);
    await t.j(`${t.P}/items/${due.id}/posted`, { channel: "x", url: "https://x.com/dpa/1" });
    assert.equal(t.st.getOps("creative_items", t.w.id, due.id).status, "published");
    // Nothing unapproved ever goes: not by the scheduler, not by "Publish now".
    for (const x of [review, approved, later]) assert.equal(t.st.getOps("creative_items", t.w.id, x.id).published.ig_post, undefined);
    assert.equal((await t.j(`${t.P}/items/${review.id}/publish`, {})).status, 422);
    const r = await t.studio.publishItem(t.w.id, review.id, { by: "test" });
    assert.match(r.skipped[0].reason, /Only approved or scheduled/);
    // "Publish now" works for approved content.
    const now = (await t.j(`${t.P}/items/${approved.id}/publish`, {})).body;
    assert.deepEqual(now.result.published, ["ig_post"]); assert.equal(now.item.status, "published");
    // Editing published content sends it back to review (phase 1 rule still holds).
    const ed = (await t.j(`${t.P}/items/${approved.id}`, { variants: { ig_post: { caption_ar: "تعديل", media: [m.id] } } }, "PUT")).body;
    assert.equal(ed.status, "review");
    // Item publishing view.
    const pv = (await t.j(`${t.P}/items/${due.id}/publishing`)).body;
    assert.equal(pv.mode, "live"); assert.equal(pv.channels.ig_post.account, "@dpa.ad"); assert.ok(pv.log.length >= 4);
    // A Creative user can't switch to Live or publish.
    await t.j("/api/admin/users", { name: "Cr", email: "cr@dpa.ad", password: "creative-pass", role_id: "creative" });
    const cc = (await fetch(t.b + "/login", { method: "POST", redirect: "manual", body: new URLSearchParams({ email: "cr@dpa.ad", password: "creative-pass" }) })).headers.get("set-cookie").split(";")[0];
    const asC = (p, body) => fetch(t.b + p, { method: "POST", headers: { "Content-Type": "application/json", cookie: cc }, body: JSON.stringify(body) });
    assert.equal((await fetch(t.b + `${t.P}/publish/settings`, { method: "PUT", headers: { "Content-Type": "application/json", cookie: cc }, body: JSON.stringify({ mode: "test" }) })).status, 403);
    assert.equal((await asC(`${t.P}/items/${due.id}/publish`, {})).status, 403);
  } finally { t.close(); }
});

test("studio: results every 6 hours (graceful metric errors), totals and AI summary from real numbers", async () => {
  const t = await studioApp({ routes: [
    ["GET", /\/M1\/insights\?metric=reach%2Cviews/, () => ({ status: 400, json: { error: { message: "metric views not supported" } } })],
    ["GET", /\/M1\/insights\?metric=views&/, () => ({ status: 400, json: { error: { message: "unsupported" } } })],
    ["GET", /\/M1\/insights\?metric=(reach|likes|comments|saved|shares)&/, (u) => { const k = /metric=(\w+)/.exec(u)[1]; return { json: { data: [{ name: k, values: [{ value: { reach: 900, likes: 40, comments: 6, saved: 12, shares: 3 }[k] }] }] } }; }],
    ["GET", /\/P1_9\?fields=shares/, () => ({ json: { shares: { count: 2 }, comments: { summary: { total_count: 1 } }, reactions: { summary: { total_count: 15 } } } })],
    ["GET", /\/P1_9\/insights/, () => ({ json: { data: [{ values: [{ value: 300 }] }] } })],
  ] });
  try {
    connectMeta(t.studio, t.w.id);
    const it = addItem(t.st, t.w.id, { channels: ["ig_reel", "fb_post"], variants: { ig_reel: { caption_ar: "a" }, fb_post: { caption_ar: "b" } }, status: "published" });
    it.published = { ig_reel: { at: new Date().toISOString(), via: "api", provider: "meta", post_id: "M1", url: "https://instagram.com/p/m1" }, fb_post: { at: new Date().toISOString(), via: "api", provider: "meta", post_id: "P1_9" } };
    t.st.save();
    assert.equal((await t.j(`${t.P}/results/fetch`, {})).status, 422); // Test mode calls nothing
    assert.equal(t.fetchImpl.calls.length, 0);
    await t.j(`${t.P}/publish/settings`, { mode: "live" }, "PUT");
    const f = (await t.j(`${t.P}/results/fetch`, {})).body;
    assert.equal(f.updated, 2);
    const r = t.st.getOps("creative_items", t.w.id, it.id).results;
    assert.deepEqual({ ...r.ig_reel.metrics }, { reach: 900, views: null, likes: 40, comments: 6, saves: 12, shares: 3 });
    assert.ok(r.ig_reel.errors.some((e) => /views/.test(e)));
    assert.equal(r.fb_post.metrics.likes, 15); assert.equal(r.fb_post.metrics.reach, 300);
    const res = (await t.j(`${t.P}/results`)).body;
    assert.equal(res.posts.length, 2); assert.equal(res.totals.reach, 1200); assert.equal(res.totals.views, null);
    assert.equal(res.by_pillar[0].name, "Product"); assert.equal(res.top[0].channel, "ig_reel");
    const sum = (await t.j(`${t.P}/results/summary`, {})).body;
    assert.match(sum.text, /What worked/);
    const { resultsPrompt, resultsSummary } = await import("../lib/publisher.js");
    const p = resultsPrompt(t.w, resultsSummary(t.st.listOps("creative_items", t.w.id)));
    assert.match(p, /reach 900/); assert.match(p, /never invent/);
  } finally { t.close(); }
});

test("studio: Instagram comments become AI Support tickets; replies go back by API (Test mode logs only)", async () => {
  const t = await studioApp({ routes: [
    ["GET", /\/M1\/comments\?fields=id%2Ctext/, () => ({ json: { data: [{ id: "CM1", text: "كم السعر؟", username: "noura.store", from: { id: "U9", username: "noura.store" } }, { id: "CM2", text: "شكراً", username: "dpa.ad", from: { id: "IG1" } }] } })],
    ["POST", /\/CM1\/replies$/, () => ({ json: { id: "R1" } })],
  ] });
  try {
    connectMeta(t.studio, t.w.id);
    const it = addItem(t.st, t.w.id, { channels: ["ig_post"], variants: { ig_post: { caption_ar: "a" } }, status: "published" });
    it.published = { ig_post: { at: new Date().toISOString(), via: "api", provider: "meta", post_id: "M1", url: "https://instagram.com/p/m1" } };
    t.st.save();
    assert.deepEqual(await t.studio.pollComments(), { new: 0, errors: 0 }); // Test mode: no API
    assert.equal(t.fetchImpl.calls.length, 0);
    await t.j(`${t.P}/publish/settings`, { mode: "live" }, "PUT");
    assert.equal((await t.studio.pollComments()).new, 1); // our own reply (from IG1) is skipped
    assert.equal((await t.studio.pollComments()).new, 0); // no duplicates
    const tk = t.st.db.support_tickets.find((x) => x.social?.comment_id === "CM1");
    assert.equal(tk.channel, "Instagram comment"); assert.equal(tk.customer_name, "@noura.store"); assert.equal(tk.social.item_id, it.id);
    assert.equal(tk.messages[0].text, "كم السعر؟"); assert.match(tk.ai_draft.text, /هلا/); // drafted, not posted
    assert.ok(!t.fetchImpl.calls.some((c) => /replies/.test(c.url)));
    const sup = (await t.j(`/api/support/meta`)).body;
    assert.ok(sup.channels.includes("Instagram comment") && sup.channels.includes("Messenger"));
    // Back in Test mode, a reply is logged, not sent.
    await t.j(`${t.P}/publish/settings`, { mode: "test" }, "PUT");
    let r = await t.j(`/api/workspaces/${t.w.id}/support/tickets/${tk.id}/messages`, { from: "ai", text: tk.ai_draft.text });
    assert.equal(r.status, 201); assert.equal(r.body.delivery, "test");
    assert.ok(!t.fetchImpl.calls.some((c) => /replies/.test(c.url)));
    await t.j(`${t.P}/publish/settings`, { mode: "live" }, "PUT");
    r = await t.j(`/api/workspaces/${t.w.id}/support/tickets/${tk.id}/messages`, { from: "you", text: "السعر في الرابط 🙏" });
    assert.equal(r.body.delivery, "sent");
    const call = t.fetchImpl.calls.find((c) => /CM1\/replies/.test(c.url));
    assert.equal(new URLSearchParams(call.body).get("message"), "السعر في الرابط 🙏");
    const after = t.st.getTicket(t.w.id, tk.id);
    assert.equal(after.messages.at(-1).delivery, "sent"); assert.equal(after.human_touched, true); assert.equal(after.ai_draft, null);
    // Normal tickets still use the normal route.
    const n = (await t.j(`/api/workspaces/${t.w.id}/support/tickets`, { message: "hi", channel: "Email" })).body;
    assert.equal((await t.j(`/api/workspaces/${t.w.id}/support/tickets/${n.id}/messages`, { from: "you", text: "ok" })).status, 201);
    assert.equal(t.st.getTicket(t.w.id, n.id).messages.at(-1).delivery, undefined);
  } finally { t.close(); }
});

test("studio: Meta webhook verifies, rejects bad signatures, turns DMs into tickets, 24h reply window", async () => {
  const crypto = await import("node:crypto");
  const t = await studioApp({ routes: [["POST", /\/P1\/messages\?access_token=PAGE-TOKEN/, () => ({ json: { recipient_id: "S1", message_id: "mid.out" } })]] });
  try {
    connectMeta(t.studio, t.w.id);
    assert.equal(await (await fetch(t.b + "/hooks/meta?hub.mode=subscribe&hub.verify_token=mverify&hub.challenge=42")).text(), "42");
    assert.equal((await fetch(t.b + "/hooks/meta?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=42")).status, 403);
    const body = JSON.stringify({ object: "instagram", entry: [{ id: "IG1", time: Date.now(), messaging: [{ sender: { id: "S1" }, recipient: { id: "IG1" }, timestamp: Date.now(), message: { mid: "mid.1", text: "ابي اجرب" } }, { sender: { id: "IG1" }, recipient: { id: "S1" }, message: { mid: "mid.2", text: "echo", is_echo: true } }] }] });
    const sig = (b, s = "msecret") => "sha256=" + crypto.createHmac("sha256", s).update(b).digest("hex");
    const hook = (b, s) => fetch(t.b + "/hooks/meta", { method: "POST", headers: { "Content-Type": "application/json", ...(s ? { "X-Hub-Signature-256": s } : {}) }, body: b });
    assert.equal((await hook(body)).status, 401);
    assert.equal((await hook(body, sig(body, "wrong-secret"))).status, 401);
    assert.equal((await hook(body.replace("ابي", "لا"), sig(body))).status, 401); // body changed after signing
    assert.equal(t.st.db.support_tickets.length, 0);
    assert.equal((await hook(body, sig(body))).status, 200);
    await new Promise((r) => setTimeout(r, 50));
    await hook(body, sig(body)); // Meta retries: no duplicate
    await new Promise((r) => setTimeout(r, 50));
    const dms = t.st.db.support_tickets.filter((x) => x.channel === "Instagram DM");
    assert.equal(dms.length, 1); assert.equal(dms[0].messages.length, 1); assert.equal(dms[0].messages[0].text, "ابي اجرب");
    // A Facebook Page comment through the webhook.
    const fb = JSON.stringify({ object: "page", entry: [{ id: "P1", changes: [{ field: "feed", value: { item: "comment", verb: "add", comment_id: "P1_9_1", post_id: "P1_9", from: { id: "U2", name: "Sara" }, message: "متوفر؟" } }] }] });
    await hook(fb, sig(fb)); await new Promise((r) => setTimeout(r, 50));
    assert.ok(t.st.db.support_tickets.some((x) => x.channel === "Facebook comment" && x.customer_name === "Sara"));
    // Reply inside 24 hours goes through the Send API (Live).
    await t.j(`${t.P}/publish/settings`, { mode: "live" }, "PUT");
    const r = await t.j(`/api/workspaces/${t.w.id}/support/tickets/${dms[0].id}/messages`, { from: "you", text: "أكيد! هذا الرابط" });
    assert.equal(r.body.delivery, "sent");
    const sent = JSON.parse(t.fetchImpl.calls.find((c) => /P1\/messages/.test(c.url)).body);
    assert.deepEqual(sent, { recipient: { id: "S1" }, messaging_type: "RESPONSE", message: { text: "أكيد! هذا الرابط" } });
    // Outside 24 hours Meta refuses: we say so and don't call.
    const tk = t.st.getTicket(t.w.id, dms[0].id);
    tk.social.last_in_at = new Date(Date.now() - 25 * 3600e3).toISOString(); t.st.save();
    const n = t.fetchImpl.calls.length;
    const late = await t.j(`/api/workspaces/${t.w.id}/support/tickets/${dms[0].id}/messages`, { from: "you", text: "hello" });
    assert.equal(late.status, 502); assert.match(late.body.detail, /24 hours/); assert.equal(t.fetchImpl.calls.length, n);
    // No app secret configured: every POST is refused.
    const t2 = await studioApp({ env: { META_APP_SECRET: "" } });
    try { assert.equal((await fetch(t2.b + "/hooks/meta", { method: "POST", headers: { "Content-Type": "application/json", "X-Hub-Signature-256": sig(body, "") }, body })).status, 401); } finally { t2.close(); }
  } finally { t.close(); }
});

test("studio: variant media ids, saved reel spec and per-channel media checks", async () => {
  const { cleanVariant } = await import("../lib/creative.js");
  const { mediaChecks, sniff, extFrom } = await import("../lib/media.js");
  const v = cleanVariant("ig_reel", { media: ["5", "5", "../x", 7], cover_id: "9", reel: { scenes: [{ media_id: "5", text: "مشهد", duration: 99, motion: "spin" }], audio_id: "8", volume: 3 } });
  assert.deepEqual(v.media, ["5", "7"]); assert.equal(v.cover_id, "9");
  assert.deepEqual(v.reel.scenes[0], { media_id: "5", text: "مشهد", duration: 15, motion: "zoom_in" }); assert.equal(v.reel.volume, 1);
  assert.equal(cleanVariant("ig_post", { reel: { scenes: [] } }).reel, undefined);
  assert.equal(sniff(MP3), "mp3"); assert.equal(sniff(JPG), "jpg"); assert.equal(sniff(Buffer.from("<html>hello there")), "");
  assert.equal(extFrom("a.JPEG"), "jpg"); assert.equal(extFrom("blob", "audio/x-m4a"), "m4a"); assert.equal(extFrom("a.gif"), "");
  const files = { 1: { kind: "image", ext: "png" }, 2: { kind: "video", ext: "mp4", width: 1920, height: 1080, duration: 75 }, 3: { kind: "audio", ext: "mp3" }, 4: { kind: "image", ext: "jpg", ai_generated: true } };
  const item = { channels: ["ig_post", "yt_short", "ig_carousel", "tiktok"], variants: { ig_post: { media: ["1"] }, yt_short: { media: ["2"] }, ig_carousel: { media: ["4"] }, tiktok: { media: ["3", "99"] } } };
  const out = mediaChecks(item, (id) => files[id]).map((c) => `${c.level}:${c.channel}:${c.text}`);
  assert.ok(out.some((t) => /^bad:ig_post:.*JPEG/.test(t)));
  assert.ok(out.some((t) => /^bad:yt_short:.*under 60/.test(t)) && out.some((t) => /^warn:yt_short:.*landscape/.test(t)));
  assert.ok(out.some((t) => /^warn:ig_carousel:.*2 to 10/.test(t)) && out.some((t) => /ig_carousel:.*AI label/.test(t)));
  assert.ok(out.some((t) => /^bad:tiktok:.*deleted/.test(t)) && out.some((t) => /^bad:tiktok:.*audio files/.test(t)));
});

test("auto-publish is the AI Publisher's level in AI Workforce (one switch, two places)", async () => {
  const [ws] = await json("/api/workspaces");
  await call(`/api/workspaces/${ws.id}/creative/publish/settings`, { method: "PUT", body: JSON.stringify({ auto_publish: true }) });
  assert.equal((await json("/api/workforce/agents/creative_publisher")).config.level, 2);
  await call("/api/workforce/agents/creative_publisher", { method: "PUT", body: JSON.stringify({ level: 1 }) });
  const acc = await json(`/api/workspaces/${ws.id}/creative/accounts`);
  assert.equal(acc.can_auto_publish, false); assert.equal(acc.settings.auto_publish, false);
});

test("AI workforce office: every person gets a room, open roles show as hiring desks", async () => {
  const s = await json("/api/workforce");
  assert.ok(s.people.every((p) => typeof p.room === "string" && p.room));
  assert.ok(Array.isArray(s.hiring));
});

// ---------------------------------------------------------------- Attendance, leave and payroll (India)
test("india payroll maths: PF cap, ESI threshold, PT slabs, new-regime TDS with 87A, gratuity", async () => {
  const m = await import("../lib/india-payroll.js");
  // EPF: 12% of PF wages capped at ₹15,000; employer 12% = EPS 8.33% (max ₹1,250) + EPF 3.67%
  assert.deepEqual([m.pfFor(30000).pf_wages, m.pfFor(30000).employee, m.pfFor(30000).eps, m.pfFor(30000).employer_epf], [15000, 1800, 1250, 550]);
  const full = m.pfFor(30000, { pf_on_full_basic: true });
  assert.deepEqual([full.employee, full.eps, full.employer_epf], [3600, 1250, 2350]);
  assert.deepEqual([m.pfFor(12000).employee, m.pfFor(12000).eps, m.pfFor(12000).employer_epf], [1440, 1000, 440]);
  assert.equal(m.pfFor(30000, { edli_on: true }).edli, 75);
  // ESI: covered at gross ≤ ₹21,000; 0.75% / 3.25%, rounded up
  assert.deepEqual(m.esiFor(20000, 20000), { eligible: true, wages: 20000, employee: 150, employer: 650 });
  assert.deepEqual([m.esiFor(21000, 21000).employee, m.esiFor(21000, 21000).employer], [158, 683]);
  assert.equal(m.esiFor(21001, 21001).eligible, false);
  // Professional Tax presets
  assert.equal(m.professionalTax({ state: "KA", gross: 30000, month: "2026-06" }).amount, 200);
  assert.equal(m.professionalTax({ state: "KA", gross: 30000, month: "2026-02" }).amount, 300);
  assert.equal(m.professionalTax({ state: "KA", gross: 24999, month: "2026-06" }).amount, 0);
  assert.equal(m.professionalTax({ state: "MH", gross: 9000, month: "2026-06", gender: "male" }).amount, 175);
  assert.equal(m.professionalTax({ state: "MH", gross: 15000, month: "2026-02", gender: "male" }).amount, 300);
  assert.equal(m.professionalTax({ state: "MH", gross: 20000, month: "2026-06", gender: "female" }).amount, 0);
  assert.equal(m.professionalTax({ state: "DL", gross: 90000, month: "2026-06" }).amount, 0);
  const tn = m.professionalTax({ state: "TN", gross: 30000, month: "2026-06" });
  assert.equal(tn.amount, 0); assert.match(tn.warn, /No Professional Tax preset/); // never invented
  assert.equal(m.professionalTax({ state: "TN", gross: 30000, month: "2026-06", custom: { slabs: [{ upto: 21000, amount: 0 }, { upto: Infinity, amount: 208 }] } }).amount, 208);
  // New regime FY 2025-26: nil up to ₹12 lakh taxable (87A), marginal relief just above, 4% cess
  assert.equal(m.incomeTax(1200000).total, 0);
  assert.equal(m.incomeTax(1210000).total, 10400); // tax capped at the ₹10,000 over ₹12 lakh, + cess
  assert.equal(m.incomeTax(1800000).total, 166400); // 20k + 40k + 60k + 40k = 1,60,000 + 6,400 cess
  assert.equal(m.incomeTax(800000, "old").total, 75400);
  assert.equal(m.incomeTax(500000, "old").total, 0);
  assert.equal(m.incomeTax(6000000).surcharge_missing, true);
  // Gratuity: 15/26 × last basic × years after 5 years; part year over 6 months rounds up
  assert.deepEqual([m.gratuityPayable(30000, "2019-01-01", "2026-08-10").years, m.gratuityPayable(30000, "2019-01-01", "2026-08-10").amount], [8, 138462]);
  assert.equal(m.gratuityPayable(30000, "2023-01-01", "2026-08-10").eligible, false);
  // Structure: basic 50% of gross, HRA 40% of basic, rest special; CTC = gross + employer PF + gratuity
  assert.deepEqual(m.structureFromGross(60000), { gross: 60000, basic: 30000, hra: 12000, special: 18000 });
  assert.equal(m.structureFromGross(60000, { metro: true }).hra, 15000);
  const st = m.structureFromCtc(758916);
  assert.equal(st.gross, 60000); assert.equal(st.monthly_ctc, 758916 / 12);
  assert.equal(m.fyOf("2026-03"), "2025-26"); assert.equal(m.fyOf("2026-04"), "2026-27");
  const due = m.dueDates("2026-06", ["KA"]);
  assert.deepEqual(due.map((d) => d.due), ["2026-07-07", "2026-07-15", "2026-07-15", "2026-07-20"]);
  assert.ok(due.every((d) => d.verify));
  assert.equal(m.dueDates("2026-03")[0].due, "2026-04-30");
});

test("payroll line: proration with loss-of-pay days, TDS spread, gratuity provision", async () => {
  const { payLine, settingsOf } = await import("../lib/people.js");
  const { incomeTax } = await import("../lib/india-payroll.js");
  const settings = settingsOf({ brief: { company_name: "X" } });
  const emp = { id: "e1", name: "T", doj: "2024-01-01", annual_ctc: 758916, work_state: "KA", pan: "ABCDE1234F" };
  const l = payLine({ emp, month: "2026-06", settings, att: { totals: { lop: 2, missing_out: 0 }, days: [] } });
  assert.deepEqual([l.days_in_month, l.lop_days, l.paid_days], [30, 2, 28]);
  assert.deepEqual(l.earnings, { basic: 28000, hra: 11200, special: 16800 });
  assert.equal(l.gross, 56000);
  assert.equal(l.pf.employee, 1800); assert.equal(l.esi.eligible, false); assert.equal(l.pt, 200);
  assert.equal(l.employer.gratuity, 1347); // 4.81% of earned basic
  assert.equal(l.net, l.gross - l.pf.employee - l.pt - l.tds);
  assert.equal(l.employer.cost, 56000 + 1800 + 1347);
  // ₹13 lakh CTC: taxable stays under ₹12 lakh after the ₹75,000 standard deduction → no TDS
  assert.equal(payLine({ emp: { ...emp, annual_ctc: 1300000 }, month: "2026-04", settings }).tds, 0);
  // ₹24 lakh CTC: annualised tax spread over the 12 months from April
  const hi = payLine({ emp: { ...emp, annual_ctc: 2400000 }, month: "2026-04", settings });
  assert.equal(hi.tds, Math.round(incomeTax(hi.structure.gross * 12 - 75000).total / 12));
  assert.ok(hi.tds > 0);
  // Later in the year, what's already deducted is taken off and the rest spread over the months left
  const later = payLine({ emp: { ...emp, annual_ctc: 2400000 }, month: "2026-10", settings, prior: Array.from({ length: 6 }, () => ({ taxable: hi.structure.gross, tds: 0, pt: 200 })) });
  assert.equal(later.tds, Math.round(incomeTax(hi.structure.gross * 12 - 75000).total / 6));
  // Months paid outside this dashboard: warned, and counted once entered as opening YTD
  const noHistory = payLine({ emp: { ...emp, annual_ctc: 2400000 }, month: "2026-10", settings });
  assert.ok(noHistory.warnings.some((w) => /6 earlier months of FY 2026-27/.test(w)));
  const opened = payLine({ emp: { ...emp, annual_ctc: 2400000, opening_fy: "2026-27", opening_taxable: hi.structure.gross * 6, opening_tds: 0 }, month: "2026-10", settings });
  assert.equal(opened.tds, later.tds); assert.ok(!opened.warnings.some((w) => /earlier month/.test(w)));
  // Additions and deductions; reimbursements aren't taxed or in ESI
  const adj = payLine({ emp, month: "2026-06", settings, adjustments: [{ kind: "bonus", label: "Bonus", amount: 5000 }, { kind: "reimbursement", label: "Travel", amount: 1000 }, { kind: "advance", label: "Advance", amount: 2000 }] });
  assert.equal(adj.gross, 66000); assert.equal(adj.taxable, 65000); assert.equal(adj.net, 66000 - adj.pf.employee - adj.pt - adj.tds - 2000);
  // Rates for another FY are flagged
  assert.ok(payLine({ emp, month: "2026-06", settings }).warnings.some((w) => /FY 2025-26/.test(w)));
});

test("attendance rules: IST, late, half day, absent, weekly off, holiday, leave, missing punch-out", async () => {
  const p = await import("../lib/people.js");
  assert.deepEqual(p.istParts(Date.parse("2026-06-03T04:10:00Z")), { date: "2026-06-03", time: "09:40", dow: 3 });
  assert.equal(p.istParts(Date.parse("2026-06-03T19:00:00Z")).date, "2026-06-04"); // 00:30 IST next day
  assert.equal(p.istToIso("2026-06-03", "09:40"), "2026-06-03T04:10:00.000Z");
  const settings = p.settingsOf({ brief: {} });
  const emp = { id: "e", doj: "2025-01-01" };
  const s = (inT, outT) => [{ id: "1", in_at: p.istToIso("2026-06-03", inT), out_at: outT ? p.istToIso("2026-06-03", outT) : null }];
  const day = (sessions, extra = {}) => p.dayStatus({ emp, date: "2026-06-03", sessions, settings, today: "2026-06-10", ...extra });
  assert.equal(day(s("09:40", "18:00")).status, "present"); // within 15 min grace of 09:30
  assert.equal(day(s("09:50", "18:30")).status, "late");
  assert.deepEqual([day(s("09:30", "14:30")).status, day(s("09:30", "14:30")).lop], ["half_day", 0.5]);
  assert.deepEqual([day(s("09:30", "11:00")).status, day(s("09:30", "11:00")).lop], ["absent", 1]);
  assert.deepEqual([day([]).status, day([]).lop], ["absent", 1]);
  assert.equal(day(s("09:30", null)).status, "missing_out");
  assert.equal(day(s("09:30", null), { today: "2026-06-03", nowMs: Date.parse("2026-06-03T06:00:00Z") }).status, "in");
  assert.equal(day([], { today: "2026-06-03" }).status, "not_in");
  assert.deepEqual([day(s("09:30", "11:00"), { today: "2026-06-03" }).status, day(s("09:30", "11:00"), { today: "2026-06-03" }).lop], ["out", 0]); // day not over yet
  assert.equal(day([], { today: "2026-06-01" }).status, "upcoming");
  assert.equal(p.dayStatus({ emp, date: "2026-06-07", sessions: [], settings, today: "2026-06-10" }).status, "weekly_off");
  assert.equal(p.dayStatus({ emp, date: "2026-06-06", sessions: [], settings, today: "2026-06-10" }).status, "absent"); // Saturday works by default
  assert.equal(p.dayStatus({ emp, date: "2026-06-06", sessions: [], settings: { ...settings, weekly_off: "sat_sun" }, today: "2026-06-10" }).status, "weekly_off");
  assert.equal(p.isWeeklyOff("2026-06-13", "sun_alt_sat"), true); assert.equal(p.isWeeklyOff("2026-06-06", "sun_alt_sat"), false); // 2nd vs 1st Saturday
  const hol = p.holidaysFor([], [2026]).find((h) => h.date === "2026-08-15");
  assert.equal(hol.name, "Independence Day");
  assert.equal(p.dayStatus({ emp, date: "2026-10-02", sessions: [], holiday: { name: "Gandhi Jayanti" }, settings, today: "2026-10-10" }).status, "holiday");
  assert.equal(p.dayStatus({ emp, date: "2026-10-02", sessions: s("10:00", "18:00").map((x) => ({ ...x, in_at: p.istToIso("2026-10-02", "10:00"), out_at: p.istToIso("2026-10-02", "18:00") })), holiday: { name: "Gandhi Jayanti" }, settings, today: "2026-10-10" }).worked_off, true);
  assert.deepEqual([day([], { leave: { type: "cl" } }).status, day([], { leave: { type: "cl" } }).lop], ["leave", 0]);
  assert.equal(day([], { leave: { type: "lop" } }).lop, 1);
  assert.deepEqual([day(s("09:30", "14:00"), { leave: { type: "cl", half_day: true } }).status, day(s("09:30", "14:00"), { leave: { type: "cl", half_day: true } }).lop], ["half_leave", 0]);
  assert.equal(day([], { leave: { type: "cl", half_day: true } }).lop, 0.5);
  assert.equal(p.dayStatus({ emp: { ...emp, attendance_from: "2026-06-05" }, date: "2026-06-03", sessions: [], settings, today: "2026-06-10" }).status, "untracked");
  assert.equal(p.dayStatus({ emp: { id: "n", doj: "2026-06-05" }, date: "2026-06-03", sessions: [], settings, today: "2026-06-10" }).status, "na");
  // Late rule: every 3 lates = half a day loss of pay
  const late = [3, 4, 5].map((d) => ({ id: String(d), employee_id: "e", date: `2026-06-0${d}`, in_at: p.istToIso(`2026-06-0${d}`, "10:00"), out_at: p.istToIso(`2026-06-0${d}`, "19:00") }));
  const att = p.monthAttendance({ employees: [{ ...emp, attendance_from: "2026-06-03", name: "E" }], month: "2026-06", punches: late, requests: [], holidays: [], settings: { ...settings, late_rule_on: true, late_rule_count: 3 }, today: "2026-06-05" });
  assert.deepEqual([att.rows[0].totals.late, att.rows[0].totals.late_penalty, att.rows[0].totals.lop], [3, 0.5, 0.5]);
});

test("leave balances: monthly earned-leave accrual, carry-forward cap, yearly credits, comp-off", async () => {
  const p = await import("../lib/people.js");
  const settings = p.settingsOf({ brief: {} });
  const emp = { id: "a", doj: "2025-03-10" };
  const b = p.leaveBalances({ emp, settings, requests: [], asOf: "2026-06-04" });
  const el = b.find((x) => x.type === "el"), cl = b.find((x) => x.type === "cl");
  assert.deepEqual([el.carried, el.accrued, el.balance], [12.5, 6.25, 18.75]); // 10 months of 2025, Jan–May 2026
  assert.equal(el.history.filter((h) => h.kind === "accrual").length, 5);
  assert.equal(cl.balance, 8); assert.equal(cl.carried, 0);
  const old = p.leaveBalances({ emp: { id: "o", doj: "2019-01-01" }, settings, requests: [], asOf: "2026-01-15" }).find((x) => x.type === "el");
  assert.equal(old.carried, 45); // capped
  const used = p.leaveBalances({ emp, settings, requests: [{ employee_id: "a", type: "cl", status: "approved", from: "2026-02-02", to: "2026-02-03", days: 2 }, { employee_id: "a", type: "cl", status: "pending", from: "2026-07-01", to: "2026-07-01", days: 1 }], asOf: "2026-06-04" }).find((x) => x.type === "cl");
  assert.deepEqual([used.used, used.pending, used.balance, used.available], [2, 1, 6, 5]);
  const co = p.leaveBalances({ emp, settings, requests: [], ledger: [{ employee_id: "a", type: "co", kind: "grant", days: 1, date: "2026-01-26", note: "Worked Republic Day" }], asOf: "2026-06-04" }).find((x) => x.type === "co");
  assert.equal(co.balance, 1);
  // Days in a request skip weekly offs and holidays; maternity counts calendar days
  const hol = p.holidaysFor([], [2026]);
  assert.equal(p.leaveDays({ from: "2026-08-14", to: "2026-08-17", type: "el", settings, holidays: hol }), 2); // Fri, (Sat 15 Aug holiday), (Sun), Mon
  assert.equal(p.leaveDays({ from: "2026-08-14", to: "2026-08-17", type: "ml", settings, holidays: hol }), 4);
});

test("people & payroll API: IST punches, regularization audit, leave approvals, locked runs, finance, permissions", async () => {
  const ws = await (await post("/api/workspaces", { company_name: "India Co" })).json();
  const W = `/api/workspaces/${ws.id}`, ME = `/api/me/people/${ws.id}`;
  let T = Date.parse("2026-06-03T04:10:00Z"); // Wednesday 09:40 IST
  appRef.locals.peopleClock = () => T;
  const signIn = async (email) => (await fetch(base + "/login", { method: "POST", redirect: "manual", body: new URLSearchParams({ email, password: "people-pass-1" }) })).headers.get("set-cookie").split(";")[0];
  const as = (c, p, opts = {}) => fetch(base + p, { redirect: "manual", ...opts, headers: { "Content-Type": "application/json", cookie: c } });
  const asPost = (c, p, body) => as(c, p, { method: "POST", body: JSON.stringify(body ?? {}) });
  const mk = async (name, email, role) => (await post("/api/admin/users", { name, email, password: "people-pass-1", role_id: role })).json();
  const uA = await mk("Asha Member", "asha@dpa.ad", "member"), uB = await mk("Bala Lead", "bala@dpa.ad", "member"), uF = await mk("Farah Finance", "farah-fin@dpa.ad", "finance");
  const [ca, cb, cf] = [await signIn("asha@dpa.ad"), await signIn("bala@dpa.ad"), await signIn("farah-fin@dpa.ad")];
  assert.ok(uF.id);

  // New module: payroll, with role defaults
  const roles = (await json("/api/admin")).roles;
  assert.deepEqual(Object.fromEntries(roles.filter((r) => r.builtin).map((r) => [r.id, r.perms.payroll])), { owner: "edit", admin: "edit", manager: "none", member: "none", finance: "edit", creative: "none", viewer: "none" });

  // Employees (Owner). PAN/UAN come back masked; salary only for Payroll viewers.
  const lead = await (await post(`${W}/people/employees`, { name: "Bala Lead", code: "E1", doj: "2020-01-15", work_state: "KA", user_id: uB.id, annual_ctc: 2400000, pan: "abcde1234f", uan: "100200300400" })).json();
  assert.equal(lead.pan, undefined); assert.equal(lead.pan_masked, "••••••234F"); assert.equal(lead.uan, undefined);
  assert.equal(lead.attendance_from, "2026-06-03");
  const asha = await (await post(`${W}/people/employees`, { name: "Asha Member", code: "E2", doj: "2025-03-10", work_state: "KA", user_id: uA.id, manager_id: lead.id, annual_ctc: 758916, gender: "female", attendance_from: "2026-06-01" })).json();
  assert.equal((await post(`${W}/people/employees`, { name: "Dup", code: "E2", doj: "2025-01-01" })).status, 422);
  assert.equal((await post(`${W}/people/employees`, { name: "Other", doj: "2025-01-01", user_id: uA.id })).status, 422); // one login, one employee
  assert.equal((await post(`${W}/people/employees`, { name: "Bad PAN", doj: "2025-01-01", pan: "12345" })).status, 422);

  // Self-service punch: server time, IST
  const in1 = await asPost(ca, `${ME}/punch`);
  assert.equal(in1.status, 201);
  const in1j = await in1.json();
  assert.deepEqual([in1j.action, in1j.date, in1j.time_ist, in1j.status.status, in1j.status.late], ["in", "2026-06-03", "09:40", "in", false]);
  assert.equal((await asPost(ca, `${ME}/punch`)).status, 429); // double tap
  T += 8.5 * 36e5;
  const out1 = await (await asPost(ca, `${ME}/punch`)).json();
  assert.deepEqual([out1.action, out1.time_ist], ["out", "18:10"]);
  T = Date.parse("2026-06-03T04:35:00Z"); // 10:05 IST
  const inB = await (await asPost(cb, `${ME}/punch`)).json();
  assert.equal(inB.status.late, true);
  assert.equal((await post(`${ME}/punch`)).status, 403); // the shared Owner login isn't an employee
  const mine = await (await as(ca, ME)).json();
  assert.equal(mine.linked, true); assert.equal(mine.employee.name, "Asha Member"); assert.equal(mine.sessions.length, 1);
  assert.equal(mine.balances.find((b) => b.type === "el").balance, 18.75); // 2025: Mar–Dec, 2026: Jan–May (June not complete)

  // Next day: attendance grid and statuses
  T = Date.parse("2026-06-04T06:30:00Z"); // Thursday 12:00 IST
  const att = await json(`${W}/people/attendance?month=2026-06`);
  const rowA = att.rows.find((r) => r.employee_id === asha.id), rowB = att.rows.find((r) => r.employee_id === lead.id);
  assert.deepEqual([rowA.days[0].status, rowA.days[1].status, rowA.days[2].status, rowA.days[3].status, rowA.days[4].status], ["absent", "absent", "present", "not_in", "upcoming"]);
  assert.equal(rowB.days[2].status, "missing_out"); assert.equal(rowB.days[0].status, "untracked");
  assert.equal(rowA.totals.lop, 2);

  // Regularization keeps who, when and why
  assert.equal((await post(`${W}/people/punches`, { employee_id: asha.id, date: "2026-06-01", in_time: "09:30", out_time: "18:00" })).status, 422); // reason required
  assert.equal((await post(`${W}/people/punches`, { employee_id: asha.id, date: "2026-06-01", in_time: "18:00", out_time: "09:00", reason: "x" })).status, 422);
  const reg = await (await post(`${W}/people/punches`, { employee_id: asha.id, date: "2026-06-01", in_time: "09:30", out_time: "18:00", reason: "Forgot to punch" })).json();
  assert.deepEqual([reg.in_time, reg.out_time, reg.history[0].reason, reg.history[0].by_name, reg.history[0].action], ["09:30", "18:00", "Forgot to punch", "Owner (team password)", "added"]);
  assert.equal((await post(`${W}/people/punches`, { employee_id: asha.id, date: "2026-06-01", in_time: "10:00", out_time: "11:00", reason: "dup" })).status, 422); // overlap
  const bPunch = (await json(`${W}/people/day?employee_id=${lead.id}&date=2026-06-03`)).sessions[0];
  assert.equal((await call(`${W}/people/punches/${bPunch.id}`, { method: "PUT", body: JSON.stringify({ out_time: "19:00" }) })).status, 422);
  const fixed = await (await call(`${W}/people/punches/${bPunch.id}`, { method: "PUT", body: JSON.stringify({ out_time: "19:00", reason: "Left without punching out" }) })).json();
  assert.deepEqual([fixed.history.length, fixed.history[0].before.out, fixed.history[0].after.out, fixed.history[0].after.in], [1, null, "19:00", "10:05"]);
  assert.equal((await asPost(ca, `${W}/people/punches`, { employee_id: asha.id, date: "2026-06-02", in_time: "09:30", reason: "self" })).status, 403); // members view team only
  const att2 = await json(`${W}/people/attendance?month=2026-06`);
  assert.equal(att2.rows.find((r) => r.employee_id === asha.id).days[0].status, "present");
  assert.equal(att2.rows.find((r) => r.employee_id === lead.id).days[2].status, "late");

  // Leave: apply, manager approves, balance moves; reject; not enough balance
  const lv = await (await asPost(ca, `${ME}/leave`, { type: "cl", from: "2026-06-10", to: "2026-06-10", reason: "Family" })).json();
  assert.deepEqual([lv.status, lv.days], ["pending", 1]);
  const cc = await (await as(ca, `${W}/command`)).json();
  assert.ok(cc.needs.some((n) => n.module === "People" && /1 leave request to approve/.test(n.text)));
  assert.ok(!cc.needs.some((n) => n.module === "Payroll")); // a member can't see payroll
  assert.ok((await json(`${W}/command`)).needs.some((n) => n.module === "Payroll" && /May 2026 payroll not run/.test(n.text)));
  assert.equal((await asPost(ca, `${ME}/approvals/${lv.id}`, { decision: "approve" })).status, 404); // not her own manager
  const bView = await (await as(cb, ME)).json();
  assert.equal(bView.approvals.length, 1);
  assert.equal((await (await asPost(cb, `${ME}/approvals/${lv.id}`, { decision: "approve" })).json()).status, "approved");
  assert.equal((await (await as(ca, ME)).json()).balances.find((b) => b.type === "cl").available, 7);
  assert.equal((await json(`${W}/people/attendance?month=2026-06`)).rows.find((r) => r.employee_id === asha.id).days[9].status, "leave");
  assert.equal((await asPost(ca, `${ME}/leave`, { type: "cl", from: "2026-06-10", to: "2026-06-10" })).status, 422); // overlap
  const big = await asPost(ca, `${ME}/leave`, { type: "el", from: "2026-06-15", to: "2026-07-31" });
  assert.equal(big.status, 422); assert.match((await big.json()).detail, /Loss of pay/);
  const sl = await (await asPost(ca, `${ME}/leave`, { type: "sl", from: "2026-06-11", to: "2026-06-11", half_day: true })).json();
  assert.equal(sl.days, 0.5);
  assert.equal((await (await post(`${W}/people/leave/${sl.id}/decide`, { decision: "reject", note: "Busy week" })).json()).status, "rejected");
  assert.equal((await (await as(ca, ME)).json()).balances.find((b) => b.type === "sl").available, 8);
  assert.equal((await asPost(ca, `${ME}/leave`, { type: "ml", from: "2026-07-01", to: "2027-06-30" })).status, 422); // over 26 weeks
  assert.equal((await post(`${W}/people/leave-ledger`, { employee_id: asha.id, kind: "grant", type: "co", days: 1, date: "2026-01-26", note: "Worked Republic Day" })).status, 201);
  assert.equal((await json(`${W}/people/employees/${asha.id}/leave`)).balances.find((b) => b.type === "co").balance, 1);
  // Unpaid leave in May for payroll
  const lop = await (await post(`${W}/people/leave`, { employee_id: asha.id, type: "lop", from: "2026-05-12", to: "2026-05-13", reason: "Personal" })).json();
  await post(`${W}/people/leave/${lop.id}/decide`, { decision: "approve" });
  assert.equal((await post(`${W}/people/holidays`, { date: "2026-08-15", name: "Dup" })).status, 422); // national holiday built in
  assert.equal((await post(`${W}/people/holidays`, { date: "2026-11-08", name: "Deepavali", kind: "festival" })).status, 201);

  // Permissions: a member never sees salaries; finance can
  const memEmps = (await (await as(ca, `${W}/people`)).json()).employees;
  assert.ok(memEmps.every((e) => e.annual_ctc === undefined && e.pan_masked === undefined && e.structure === undefined));
  assert.equal((await as(ca, `${W}/payroll`)).status, 403);
  assert.equal((await as(ca, `${W}/payroll/employees`)).status, 403);
  const finEmps = await (await as(cf, `${W}/payroll/employees`)).json();
  assert.equal(finEmps.find((e) => e.id === asha.id).annual_ctc, 758916);
  assert.equal((await as(cf, `${W}/people`)).status, 403); // finance has no attendance access by default
  assert.equal((await (await as(cf, `${W}/payroll/employees/${asha.id}`, { method: "PUT", body: JSON.stringify({ tax_regime: "new", name: "Hacked" }) })).json()).name, "Asha Member");

  // Payroll run for May: draft → approved (locked) → paid; reverse needs an Owner and a reason
  assert.equal((await post(`${W}/payroll/runs`, { month: "2026-07" })).status, 422); // future month
  const run = await (await post(`${W}/payroll/runs`, { month: "2026-05" })).json();
  assert.equal(run.status, "draft");
  assert.equal((await post(`${W}/payroll/runs`, { month: "2026-05" })).status, 409);
  const la = run.lines.find((l) => l.employee_id === asha.id), lb = run.lines.find((l) => l.employee_id === lead.id);
  assert.deepEqual([la.lop_days, la.paid_days, la.earnings.basic], [2, 29, Math.round(30000 * 29 / 31)]);
  assert.equal(lb.lop_days, 0); assert.ok(lb.tds > 0); assert.equal(lb.pf.employee, 1800);
  const adjd = await (await call(`${W}/payroll/runs/${run.id}/adjustments`, { method: "PUT", body: JSON.stringify({ employee_id: asha.id, items: [{ kind: "bonus", label: "Spot bonus", amount: 3000 }] }) })).json();
  assert.equal(adjd.lines.find((l) => l.employee_id === asha.id).gross, la.gross + 3000);
  assert.equal(adjd.statutory.pf.employee, adjd.totals.pf_employee);
  assert.equal((await asPost(cf, `${W}/payroll/runs/${run.id}/approve`)).status, 200); // Finance role can approve
  const approved = await json(`${W}/payroll/runs/${run.id}`);
  assert.equal(approved.status, "approved");
  assert.equal((await call(`${W}/payroll/runs/${run.id}/adjustments`, { method: "PUT", body: JSON.stringify({ employee_id: asha.id, items: [] }) })).status, 409);
  assert.equal((await post(`${W}/payroll/runs/${run.id}/approve`)).status, 409);
  assert.equal((await call(`${W}/payroll/runs/${run.id}`, { method: "DELETE" })).status, 409);
  // Editing the salary after approval doesn't change the locked run
  await call(`${W}/payroll/employees/${asha.id}`, { method: "PUT", body: JSON.stringify({ annual_ctc: 900000 }) });
  assert.equal((await json(`${W}/payroll/runs/${run.id}`)).lines.find((l) => l.employee_id === asha.id).gross, la.gross + 3000);
  // Outputs
  const slip = await (await call(`${W}/payroll/runs/${run.id}/payslips/${asha.id}`)).text();
  assert.match(slip, /India Co/); assert.match(slip, /May 2026/); assert.match(slip, /Spot bonus/); assert.match(slip, /Year to date/);
  const csv = await (await call(`${W}/payroll/runs/${run.id}/bank.csv`)).text();
  assert.match(csv, /^Employee code,Name,Bank account,IFSC,Net pay \(INR\)/); assert.match(csv, /\[ADD ACCOUNT NO\]/);
  const ecr = await (await call(`${W}/payroll/runs/${run.id}/ecr.txt`)).text();
  assert.match(ecr, /^100200300400#~#Bala Lead#~#/m);
  assert.equal(approved.due[0].due, "2026-06-07"); assert.equal(approved.due[1].due, "2026-06-15");
  // Self-service: own payslip only
  const aMe = await (await as(ca, ME)).json();
  assert.equal(aMe.payslips.length, 1); assert.equal(aMe.payslips[0].net, approved.lines.find((l) => l.employee_id === asha.id).net);
  const ownSlip = await as(ca, `${ME}/payslips/${run.id}`);
  assert.equal(ownSlip.status, 200); const ownHtml = await ownSlip.text();
  assert.match(ownHtml, /Asha Member/); assert.doesNotMatch(ownHtml, /Bala Lead/);
  assert.equal((await as(ca, `${W}/payroll/runs/${run.id}/payslips/${lead.id}`)).status, 403);
  // Post to Finance: needs a typed INR→SAR rate
  assert.equal((await asPost(cf, `${W}/payroll/runs/${run.id}/post-finance`, {})).status, 422);
  const posted = await (await asPost(cf, `${W}/payroll/runs/${run.id}/post-finance`, { inr_sar_rate: 0.044 })).json();
  assert.equal(posted.expense.category, "payroll"); assert.equal(posted.expense.amount_sar, Math.round(approved.totals.employer_cost * 0.044 * 100) / 100);
  assert.equal((await asPost(cf, `${W}/payroll/runs/${run.id}/post-finance`, { inr_sar_rate: 0.044 })).status, 409);
  assert.equal((await (await post(`${W}/payroll/runs/${run.id}/paid`)).json()).status, "paid");
  assert.equal((await asPost(cf, `${W}/payroll/runs/${run.id}/reverse`, { reason: "Wrong" })).status, 403); // Owner only
  assert.equal((await post(`${W}/payroll/runs/${run.id}/reverse`, {})).status, 422);
  const rev = await (await post(`${W}/payroll/runs/${run.id}/reverse`, { reason: "Bonus entered twice" })).json();
  assert.equal(rev.status, "reversed"); assert.equal(rev.finance_expense_removed, true);
  assert.ok(!(await json(`${W}/finance`)).expenses.some((e) => e.id === posted.expense.id));
  assert.equal((await as(ca, `${ME}/payslips/${run.id}`)).status, 404);
  assert.equal((await post(`${W}/payroll/runs`, { month: "2026-05" })).status, 201); // can run again
  // Audit trail of the run
  assert.deepEqual(rev.history.map((h) => h.action), ["created", "adjusted", "approved", "posted to Finance", "paid", "reversed"]);
  // Settings: rates need payroll edit; leave policy is editable; bad hours refused
  assert.equal((await call(`${W}/people/settings`, { method: "PUT", body: JSON.stringify({ half_day_hours: 9 }) })).status, 422);
  const st = await (await call(`${W}/people/settings`, { method: "PUT", body: JSON.stringify({ weekly_off: "sun_alt_sat", rates: { pf_on_full_basic: true }, leave: { el: { carry_cap: 30 } } }) })).json();
  assert.deepEqual([st.weekly_off, st.rates.pf_on_full_basic, st.leave.el.carry_cap, st.leave.el.per_month], ["sun_alt_sat", true, 30, 1.25]);
  delete appRef.locals.peopleClock;
});

test("people sample data: sample employees, punches and leave load and remove cleanly", async () => {
  const ws = await (await post("/api/workspaces", { company_name: "Sample India" })).json();
  const W = `/api/workspaces/${ws.id}`;
  const r = await (await post(`${W}/sample-data`)).json();
  assert.equal(r.employees, 4);
  const d = await json(`${W}/people`);
  assert.ok(d.employees.every((e) => e.sample && e.name.startsWith("Sample · ")));
  assert.equal(d.pending_leave.length, 1);
  const att = await json(`${W}/people/attendance`);
  assert.ok(att.rows.length === 4);
  const removed = await (await call(`${W}/sample-data`, { method: "DELETE" })).json();
  assert.equal(removed.employees, 4); assert.ok(removed.people_punches > 0);
  assert.equal((await json(`${W}/people`)).employees.length, 0);
  assert.ok(!store.db.people_punches.some((p) => p.workspace_id === ws.id));
});

// ---------------------------------------------------------------- Security & compliance, backups, status page
const BK = "a".repeat(64);
async function cxApp({ env = {}, backupOptions = {}, statusOptions = {} } = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "mwiz-cx-"));
  const st = new Store(d), pw = "cx-team-password-long";
  const a = createApp({ store: st, provider, password: pw, env: { BACKUP_KEY: BK, ...env }, backupOptions, statusOptions });
  const srv = a.listen(0);
  await new Promise((r) => srv.once("listening", r));
  const b = `http://127.0.0.1:${srv.address().port}`;
  const login = async (body) => (await fetch(b + "/login", { method: "POST", redirect: "manual", body: new URLSearchParams(body) })).headers.get("set-cookie").split(";")[0];
  const ck = await login({ password: pw });
  const req = (c, p, method = "GET", body) => fetch(b + p, { method, redirect: "manual", headers: { "Content-Type": "application/json", cookie: c }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = async (c, p, method, body) => { const r = await req(c, p, method, body); const t = await r.text(); let data = null; try { data = JSON.parse(t); } catch { data = t; } return { status: r.status, data }; };
  const user = async (name, role_id) => { const email = `${role_id}-${Date.now()}@dpa.ad`; await j(ck, "/api/admin/users", "POST", { name, email, password: "user-pass-123", role_id }); return login({ email, password: "user-pass-123" }); };
  const [ws] = st.listWorkspaces();
  return { d, st, a, b, ck, req, j, user, ws, crm: a.locals.crm, close: () => { srv.close(); a.locals.crm.flush(); fs.rmSync(d, { recursive: true, force: true }); } };
}

test("backups: create → encrypt → decrypt → verify round trip, with media; Owner-only download", async () => {
  const { openBackup } = await import("../lib/backup.js");
  const t = await cxApp();
  try {
    fs.mkdirSync(path.join(t.d, "media"), { recursive: true });
    fs.writeFileSync(path.join(t.d, "media", "a1.png"), Buffer.from("png-bytes-here"));
    t.crm.add(t.ws.id, { store_name: "Round Trip Store", email: "rt@shop.sa" });
    const r = await t.j(t.ck, "/api/compliance/backups", "POST", { media: true });
    assert.equal(r.status, 201); assert.ok(r.data.ok); assert.ok(r.data.encrypted); assert.match(r.data.name, /^mwiz-backup-\d{8}T\d{9}Z-manual\.tar\.gz\.enc$/);
    const file = path.join(t.d, "backups", r.data.name), raw = fs.readFileSync(file);
    assert.ok(!raw.includes("Round Trip Store") && !raw.includes("DPA AD"), "the file on disk is encrypted");
    const opened = await openBackup(raw, BK);
    assert.equal(opened.crm.contacts.find((c) => c.email === "rt@shop.sa").store_name, "Round Trip Store");
    assert.equal(opened.db.workspaces[0].brief.company_name, "DPA AD");
    assert.equal(opened.files.find((f) => f.name === "media/a1.png").data.toString(), "png-bytes-here");
    await assert.rejects(openBackup(raw, "b".repeat(64)), /wrong BACKUP_KEY/);
    await assert.rejects(openBackup(raw, ""), /BACKUP_KEY is needed/);
    const v = await t.j(t.ck, `/api/compliance/backups/${r.data.name}/verify`, "POST");
    assert.equal(v.status, 200); assert.equal(v.data.counts.crm.contacts, 1); assert.equal(v.data.counts.db.workspaces, 1); assert.equal(v.data.media_files, 1);
    assert.equal((await t.j(t.ck, "/api/compliance/backups/..%2Fdb.json/verify", "POST")).status, 404);
    // Owner downloads; an Admin can back up and verify but not download.
    const dl = await t.req(t.ck, `/api/compliance/backups/${r.data.name}/download`);
    assert.equal(dl.status, 200); assert.ok(Buffer.from(await dl.arrayBuffer()).equals(raw));
    const admin = await t.user("Ada Admin", "admin");
    assert.equal((await t.req(admin, `/api/compliance/backups/${r.data.name}/download`)).status, 403);
    assert.equal((await t.j(admin, `/api/compliance/backups/${r.data.name}/verify`, "POST")).status, 200);
    const ov = await t.j(admin, "/api/compliance");
    assert.equal(ov.data.backups.can_download, false); assert.equal(ov.data.backups.status.fresh, true);
    assert.ok(t.st.db.audit.some((a) => a.summary.startsWith("downloaded backup")));
  } finally { t.close(); }
});

test("backups: retention keeps 14 nightly + 8 weekly + 10 manual; nightly at 02:00 Riyadh; stale backups raise a need", async () => {
  const { createBackups } = await import("../lib/backup.js");
  const { complianceNeeds } = await import("../lib/complianceroutes.js");
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "mwiz-bk-"));
  try {
    const st = new Store(d);
    let now = Date.parse("2026-10-01T00:00:00Z");
    const bk = createBackups({ store: st, crm: null, env: { BACKUP_KEY: BK }, now: () => now, log: { error() {} } });
    for (let i = 0; i < 20; i++) { now += 864e5; await bk.create({ kind: "nightly", offsite: false }); }
    for (let i = 0; i < 10; i++) { now += 7 * 864e5; await bk.create({ kind: "weekly", offsite: false }); }
    for (let i = 0; i < 12; i++) { now += 60e3; await bk.create({ kind: "manual", offsite: false }); }
    const files = bk.files(), by = (k) => files.filter((f) => f.kind === k);
    assert.equal(by("nightly").length, 14); assert.equal(by("weekly").length, 8); assert.equal(by("manual").length, 10);
    assert.ok(by("nightly").every((f, i, a) => i === 0 || a[i - 1].at > f.at), "newest first");
    // The schedule: nothing at 01:30 Riyadh, a backup from 02:00, once per Riyadh day.
    const d2 = fs.mkdtempSync(path.join(os.tmpdir(), "mwiz-bk2-")), st2 = new Store(d2);
    now = Date.parse("2026-11-02T22:30:00Z"); // 01:30 Riyadh, Nov 3
    const s2 = createBackups({ store: st2, crm: null, env: { BACKUP_KEY: BK }, now: () => now, log: { error() {} } });
    assert.equal(s2.due(), false); assert.equal(await s2.tick(), null);
    assert.equal(complianceNeeds({ store: st2, backups: s2, now })[0].title, "Backups");
    now = Date.parse("2026-11-02T23:05:00Z"); // 02:05 Riyadh
    const first = await s2.tick();
    assert.equal(first.kind, "weekly"); assert.equal(first.by, "schedule");
    assert.equal(s2.due(), false); assert.equal(await s2.tick(), null);
    assert.equal(complianceNeeds({ store: st2, backups: s2, now }).length, 0);
    now += 864e5; // next night
    assert.equal((await s2.tick()).kind, "nightly");
    now += 27 * 3600e3 + 22 * 3600e3; // missed nights: not fresh until the next run
    assert.equal(s2.status().fresh, false);
    assert.match(complianceNeeds({ store: st2, backups: s2, now })[0].text, /No successful backup in 26 hours/);
    fs.rmSync(d2, { recursive: true, force: true });
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("SigV4 matches AWS's published test vectors", async () => {
  const { signV4 } = await import("../lib/backup.js");
  const empty = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
  // aws-sig-v4-test-suite "get-vanilla"
  const a = signV4({ method: "GET", url: "https://example.amazonaws.com/", payloadHash: empty, region: "us-east-1", service: "service", accessKey: "AKIDEXAMPLE", secretKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY", date: new Date("2015-08-30T12:36:00Z") });
  assert.equal(a.signature, "5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31");
  assert.equal(a.headers.authorization, "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31");
  // Amazon S3 API reference, "Example: GET Object"
  const b = signV4({ method: "GET", url: "https://examplebucket.s3.amazonaws.com/test.txt", headers: { Range: "bytes=0-9", "x-amz-content-sha256": empty }, payloadHash: empty, region: "us-east-1", service: "s3", accessKey: "AKIAIOSFODNN7EXAMPLE", secretKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", date: new Date("2013-05-24T00:00:00Z") });
  assert.equal(b.signature, "f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41");
});

test("backups off-site: S3 upload (mocked fetch) and email, refused without BACKUP_KEY", async () => {
  const crypto = await import("node:crypto");
  const { createBackups, signV4 } = await import("../lib/backup.js");
  const s3env = { BACKUP_S3_ENDPOINT: "https://acct.r2.cloudflarestorage.com", BACKUP_S3_BUCKET: "dpa-backups", BACKUP_S3_KEY: "AKTEST", BACKUP_S3_SECRET: "s3cret", BACKUP_S3_REGION: "auto",
    BACKUP_EMAIL_TO: "founder@dpa.ad", SMTP_HOST: "smtp.example", SMTP_USER: "u", SMTP_PASS: "p" };
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "mwiz-s3-"));
  try {
    const st = new Store(d), puts = [], mails = [];
    let fail = false;
    const fetchImpl = async (url, opts) => { puts.push({ url, ...opts }); return fail ? { ok: false, status: 403, text: async () => "<Error>SignatureDoesNotMatch</Error>", headers: new Map() } : { ok: true, status: 200, text: async () => "", headers: new Map([["etag", '"abc"']]) }; };
    const bk = createBackups({ store: st, crm: null, env: { ...s3env, BACKUP_KEY: BK }, fetchImpl, mailer: async (m) => mails.push(m), log: { error() {} } });
    const r = await bk.create({ kind: "manual" });
    assert.equal(puts.length, 1);
    const p = puts[0], body = fs.readFileSync(path.join(d, "backups", r.name));
    assert.equal(p.method, "PUT"); assert.equal(p.url, `https://acct.r2.cloudflarestorage.com/dpa-backups/marketing-wizard/${r.name}`);
    assert.ok(Buffer.from(p.body).equals(body));
    assert.equal(p.headers["x-amz-content-sha256"], crypto.createHash("sha256").update(body).digest("hex"));
    assert.match(p.headers.authorization, /^AWS4-HMAC-SHA256 Credential=AKTEST\/\d{8}\/auto\/s3\/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/);
    const amz = p.headers["x-amz-date"], date = new Date(`${amz.slice(0, 4)}-${amz.slice(4, 6)}-${amz.slice(6, 8)}T${amz.slice(9, 11)}:${amz.slice(11, 13)}:${amz.slice(13, 15)}Z`);
    const again = signV4({ method: "PUT", url: p.url, headers: { "content-type": "application/octet-stream", "x-amz-content-sha256": p.headers["x-amz-content-sha256"] }, payloadHash: p.headers["x-amz-content-sha256"], region: "auto", accessKey: "AKTEST", secretKey: "s3cret", date });
    assert.equal(p.headers.authorization, again.headers.authorization);
    assert.equal(mails.length, 1); assert.equal(mails[0].to, "founder@dpa.ad"); assert.ok(mails[0].attachments[0].content.equals(body));
    assert.equal(bk.status().last_ok.offsite.s3.ok, true); assert.equal(bk.status().last_ok.offsite.email.ok, true);
    fail = true;
    const r2 = await bk.create({ kind: "manual" });
    assert.equal(r2.offsite.s3.ok, false); assert.match(r2.offsite.s3.error, /HTTP 403.*SignatureDoesNotMatch/);
    // Too big to email.
    const small = createBackups({ store: st, crm: null, env: { ...s3env, BACKUP_KEY: BK, BACKUP_EMAIL_MAX_MB: "0.0001" }, fetchImpl: async () => ({ ok: true, headers: new Map() }), mailer: async (m) => mails.push(m), log: { error() {} } });
    assert.match((await small.create({ kind: "manual" })).offsite.email.error, /Too big to email/);
    // Without BACKUP_KEY: stays local, unencrypted, never sent.
    puts.length = 0; mails.length = 0;
    const nokey = createBackups({ store: st, crm: null, env: s3env, fetchImpl, mailer: async (m) => mails.push(m), log: { error() {} } });
    const r3 = await nokey.create({ kind: "manual" });
    assert.ok(r3.name.endsWith(".tar.gz")); assert.equal(puts.length, 0); assert.equal(mails.length, 0);
    assert.match(r3.offsite.s3.error, /set BACKUP_KEY/); assert.match(r3.offsite.email.error, /set BACKUP_KEY/);
    assert.equal((await nokey.verify(r3.name)).ok, true);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("data requests: find, export and delete across CRM, support, HR and sales; audit trail with no personal data left", async () => {
  const { dsrDue, dsrState } = await import("../lib/compliance.js");
  assert.equal(dsrDue("2026-01-15", 30), "2026-02-14"); assert.equal(dsrDue("2026-02-20", 10), "2026-03-02");
  assert.equal(dsrState({ received_at: "2026-01-01", status: "open" }, 30, Date.parse("2026-02-05T00:00:00Z")).overdue, true);
  assert.equal(dsrState({ received_at: "2026-01-01", status: "completed" }, 30, Date.parse("2026-02-05T00:00:00Z")).overdue, false);
  assert.equal(dsrState({ received_at: "2026-01-25", status: "open" }, 30, Date.parse("2026-02-20T00:00:00Z")).due_soon, true);
  const t = await cxApp();
  try {
    const ws = t.ws.id, EMAIL = "sara.person@shop-example.sa", PHONE = "0551234567";
    const c = t.crm.add(ws, { store_name: "Sara Store", email: EMAIL, phone: "966551234567", domain: "sara-shop.sa" });
    t.crm.addMessage({ workspace_id: ws, contact_id: c.id, direction: "in", channel: "email", body: "Please delete my data", status: "received" });
    t.crm.addNote(ws, c.id, "Called her", "you");
    const other = t.crm.add(ws, { store_name: "Other Store", email: "other@shop.sa" });
    const tk = t.st.addTicket(ws, { channel: "Website chat", customer_name: "Sara", contact: EMAIL });
    t.st.addTicketMessage(ws, tk.id, { from: "customer", text: "Hi, my number is +966 55 123 4567" });
    const cand = t.st.addHrCandidate(ws, { name: "Sara P", email: EMAIL.toUpperCase(), phone: "", cv_text: "CV" });
    const deal = t.st.addDeal(ws, { name: "Sara Store deal", contact_name: "Sara", contact_email: EMAIL, contact_phone: PHONE });
    t.st.addDealActivity(deal.id, { type: "note", by: "you", text: `Follow up with ${EMAIL} next week` });
    const viewer = await t.user("Vic Viewer", "viewer"), member = await t.user("Mo Member", "member");
    const bad = await t.j(t.ck, "/api/compliance/requests", "POST", { type: "deletion", subject: { name: "Sara" } });
    assert.equal(bad.status, 422);
    const r = (await t.j(t.ck, "/api/compliance/requests", "POST", { type: "deletion", received_at: "2026-11-01", channel: "email", subject: { name: "Sara P", email: EMAIL, phone: PHONE } })).data;
    assert.equal(r.ref, "DSR-0001"); assert.equal(r.due, "2026-12-01");
    // Viewers see the request without the person's details and can't search or delete.
    const vview = (await t.j(viewer, "/api/compliance")).data;
    assert.ok(!JSON.stringify(vview.requests).includes(EMAIL)); assert.equal(vview.can_edit, false);
    assert.equal((await t.j(viewer, `/api/compliance/requests/${r.id}/find`, "POST")).status, 403);
    assert.equal((await t.j(viewer, `/api/compliance/requests/${r.id}/delete`, "POST", { confirm: "DELETE" })).status, 403);
    assert.equal((await t.j(member, "/api/compliance")).status, 403);
    const f = (await t.j(t.ck, `/api/compliance/requests/${r.id}/find`, "POST")).data;
    assert.equal(f.crm_contacts.length, 1); assert.equal(f.crm_contacts[0].messages, 1); assert.equal(f.support_tickets.length, 1);
    assert.equal(f.hr_candidates.length, 1); assert.equal(f.sales_deals.length, 1); assert.equal(f.mentions.deal_activities, 1); assert.equal(f.total, 4);
    assert.equal((await t.j(t.ck, "/api/compliance/find", "POST", { phone: "+966 55 123 4567" })).data.crm_contacts.length, 1);
    const ex = await t.req(t.ck, `/api/compliance/requests/${r.id}/export`, "POST", {});
    assert.match(ex.headers.get("content-disposition"), /DSR-0001-export\.json/);
    const exd = await ex.json();
    assert.equal(exd.crm_contacts[0].store_name, "Sara Store"); assert.equal(exd.crm_contacts[0].messages[0].body, "Please delete my data");
    assert.equal(exd.crm_contacts[0].unsub_token, undefined); assert.equal(exd.support_tickets[0].messages.length, 1); assert.equal(exd.sales_deals[0].contact_email, EMAIL);
    const acc = (await t.j(t.ck, "/api/compliance/requests", "POST", { type: "access", subject: { email: EMAIL } })).data;
    assert.equal((await t.j(t.ck, `/api/compliance/requests/${acc.id}/delete`, "POST", { confirm: "DELETE" })).status, 422);
    // Deletion needs the typed confirmation.
    assert.equal((await t.j(t.ck, `/api/compliance/requests/${r.id}/delete`, "POST", { confirm: "delete" })).status, 422);
    const del = await t.j(t.ck, `/api/compliance/requests/${r.id}/delete`, "POST", { confirm: "DELETE" });
    assert.equal(del.status, 200);
    assert.deepEqual(del.data.result.deleted, { crm_contacts: 1, crm_messages: 1, support_tickets: 1, hr_candidates: 1, deal_contacts_cleared: 1, billing_contacts_cleared: 0, survey_responses: 0, mentions_redacted: 1, meeting_attendees_redacted: 0, partner_contacts_cleared: 0, legal_parties_removed: 0, legal_documents_retained: 0 });
    assert.equal(del.data.erased, true); assert.equal(del.data.status, "completed");
    // Nothing personal is left anywhere: not in db.json, crm.json, the request record or the activity log.
    t.crm.flush();
    const all = fs.readFileSync(path.join(t.d, "db.json"), "utf8") + fs.readFileSync(path.join(t.d, "crm.json"), "utf8");
    for (const needle of [EMAIL, EMAIL.toUpperCase(), "551234567", "55 123 4567", "Sara Store\"", "Sara P"]) assert.ok(!all.includes(needle), `found ${needle}`);
    assert.ok(t.crm.get(ws, other.id), "other stores are untouched");
    assert.equal(t.st.getDeal(ws, deal.id).name, "Sara Store deal"); assert.match(t.st.listDealActivities(deal.id).find((a) => a.type === "note").text, /\[removed\]/);
    const kept = t.st.db.compliance_requests.find((x) => x.id === r.id);
    assert.deepEqual(kept.subject, { name: "", email: "", phone: "" }); assert.ok(kept.log.some((l) => /deleted across modules/.test(l.text)));
    assert.ok(t.st.db.audit.some((a) => a.path === `/api/compliance/requests/${r.id}/delete`));
    assert.equal(t.st.db.compliance_requests.find((x) => x.id === acc.id).erased, true, "the same person's other requests drop their details too");
    assert.equal((await t.j(t.ck, `/api/compliance/requests/${r.id}/find`, "POST")).status, 409);
    assert.equal((await t.j(t.ck, `/api/compliance/requests/${r.id}/delete`, "POST", { confirm: "DELETE" })).status, 409);
  } finally { t.close(); }
});

test("security checks are computed from the live server settings", async () => {
  const { securityChecks } = await import("../lib/compliance.js");
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "mwiz-sec-"));
  try {
    const st = new Store(d);
    const fakeCrm = { db: { settings: { [st.listWorkspaces()[0].id]: { mode: "live" } } } };
    const s = (o) => Object.fromEntries(securityChecks({ store: st, crm: fakeCrm, ...o }).map((c) => [c.id, c]));
    let c = s({ env: {}, password: "short", backupStatus: { fresh: false, offsite: { s3: { configured: false }, email: { configured: false } } } });
    assert.equal(c.password.state, "fail"); assert.equal(c.owner.state, "fail"); assert.equal(c.token_key.state, "fail"); assert.equal(c.backup_key.state, "fail");
    assert.equal(c.backups.state, "fail"); assert.equal(c.https.state, "warn"); assert.equal(c.webhook_secret.state, "info"); assert.match(c.crm_mode.detail, /Live in: DPA AD/);
    st.db.users.push({ id: "u1", name: "Old Owner", email: "o@dpa.ad", role_id: "owner", active: true, created_at: "2025-01-01T00:00:00Z", last_login_at: "2025-01-02T00:00:00Z" });
    c = s({ env: { TOKEN_KEY: "f".repeat(64), BACKUP_KEY: BK, PUBLIC_URL: "https://wizard.dpa.ad", META_APP_ID: "1", META_APP_SECRET: "x", WA_TOKEN: "t" }, password: "a-very-long-team-password",
      backupStatus: { fresh: true, encrypted: true, last_ok: { at: new Date().toISOString() }, offsite: { s3: { configured: true }, email: { configured: false } } } });
    for (const k of ["password", "owner", "token_key", "backup_key", "backups", "offsite", "https"]) assert.equal(c[k].state, "pass", k);
    assert.equal(c.inactive.state, "warn"); assert.match(c.inactive.detail, /Old Owner/);
    assert.equal(c.webhook_secret.state, "fail"); assert.match(c.webhook_secret.detail, /WA_APP_SECRET/);
    assert.equal(s({ env: { PUBLIC_URL: "http://wizard.dpa.ad" }, password: "x", backupStatus: null }).https.state, "fail");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
  const t = await cxApp({ env: { PUBLIC_URL: "https://wizard.dpa.ad" } });
  try {
    const ov = (await t.j(t.ck, "/api/compliance")).data;
    assert.equal(ov.checks.find((x) => x.id === "backup_key").state, "pass"); assert.equal(ov.checks.find((x) => x.id === "https").state, "pass");
    assert.equal(ov.checks.find((x) => x.id === "password").state, "pass");
  } finally { t.close(); }
});

test("status page: public without login, incidents publish/unpublish from Operations, 90-day bars and self-check", async () => {
  const checks = [];
  const t = await cxApp({ statusOptions: { fetchImpl: async (url) => { checks.push(url); return { ok: checks.length !== 2 }; } } });
  try {
    const page = await fetch(t.b + "/status", { redirect: "manual" });
    assert.equal(page.status, 200); assert.match(await page.text(), /DPA AD status/);
    let s = await (await fetch(t.b + "/status.json")).json();
    assert.equal(s.overall, "operational"); assert.equal(s.components.length, 5); assert.ok(s.components.every((c) => c.days.length === 90));
    assert.deepEqual(s.components.map((c) => c.id), ["dashboard", "rendering", "publishing", "integrations", "messaging"]);
    assert.equal(s.components[1].name.ar, "تصميم الإعلانات");
    assert.equal(s.components[0].uptime_pct, null, "no uptime is claimed before any check");
    assert.equal(s.components[0].days[0].state, "nodata"); assert.equal(s.components[0].days[89].state, "operational");
    // An Operations incident, published by a person with customer-facing text.
    const inc = (await t.j(t.ck, `/api/workspaces/${t.ws.id}/ops/incidents`, "POST", { title: "Render queue stuck on db-02", severity: "SEV1", impact: "Internal: worker crashed" })).data;
    const draft = await t.j(t.ck, "/api/compliance/status/draft", "POST", { ops_ws: t.ws.id, ops_id: inc.id });
    assert.equal(draft.status, 200); assert.equal(draft.data.impact, "outage");
    assert.equal((await t.j(t.ck, "/api/compliance/status/incidents", "POST", { title_en: "x", components: [] })).status, 422);
    const si = (await t.j(t.ck, "/api/compliance/status/incidents", "POST", { ops_ws: t.ws.id, ops_id: inc.id, title_en: "Ad rendering is slow", title_ar: "تصميم الإعلانات بطيء", text_en: "We're on it.", text_ar: "نعمل على حلها.", impact: "outage", components: ["rendering"], ai_original: { ...draft.data } })).data;
    assert.equal(si.published, false);
    s = await (await fetch(t.b + "/status.json")).json();
    assert.equal(s.incidents.active.length, 0); assert.equal(s.overall, "operational");
    const viewer = await t.user("Vic Viewer", "viewer");
    assert.equal((await t.j(viewer, `/api/compliance/status/incidents/${si.id}`, "PUT", { published: true })).status, 403);
    assert.equal((await t.j(t.ck, `/api/compliance/status/incidents/${si.id}`, "PUT", { published: true })).status, 200);
    s = await (await fetch(t.b + "/status.json")).json();
    assert.equal(s.overall, "outage"); assert.equal(s.components.find((c) => c.id === "rendering").state, "outage");
    assert.equal(s.components.find((c) => c.id === "rendering").days[89].state, "outage");
    assert.equal(s.incidents.active[0].title.ar, "تصميم الإعلانات بطيء"); assert.equal(s.incidents.active[0].updates[0].text.en, "We're on it.");
    const pub = JSON.stringify(s);
    assert.ok(!pub.includes("db-02") && !pub.includes("worker crashed"), "internal details stay internal");
    await t.j(t.ck, `/api/compliance/status/incidents/${si.id}`, "PUT", { published: false });
    assert.equal((await (await fetch(t.b + "/status.json")).json()).incidents.active.length, 0);
    await t.j(t.ck, `/api/compliance/status/incidents/${si.id}`, "PUT", { published: true, state: "resolved", text_en: "Fixed.", text_ar: "تم الحل." });
    s = await (await fetch(t.b + "/status.json")).json();
    assert.equal(s.incidents.active.length, 0); assert.equal(s.incidents.past.length, 1); assert.equal(s.incidents.past[0].updates[0].text.en, "Fixed.");
    assert.equal(s.components.find((c) => c.id === "rendering").state, "operational");
    // Manual component state and the self-check.
    await t.j(t.ck, "/api/compliance/status/components/publishing", "PUT", { state: "maintenance" });
    assert.equal((await t.j(t.ck, "/api/compliance/status/components/publishing", "PUT", { state: "melting" })).status, 422);
    assert.equal((await (await fetch(t.b + "/status.json")).json()).overall, "maintenance");
    const st = t.a.locals.status;
    assert.equal(await st.selfCheck("https://wizard.dpa.ad/healthz"), true);
    assert.equal(await st.selfCheck("https://wizard.dpa.ad/healthz"), false);
    s = await (await fetch(t.b + "/status.json")).json();
    assert.equal(s.components[0].uptime_pct, 50); assert.equal(s.components[0].days[89].state, "outage");
    assert.equal((await t.j(t.ck, "/api/compliance/status/check", "POST")).status, 200);
    assert.ok(t.st.db.agent_events.some((e) => e.agent_id === "compliance_officer" && e.outcome === "edited"));
  } finally { t.close(); }
});

test("compliance: register, sub-processors, policies with the AI Compliance officer, access review, breach checklist and permissions", async () => {
  const { DEFAULT_ROLES, moduleFor } = await import("../lib/access.js");
  const { AGENTS, agentFor } = await import("../lib/agents.js");
  assert.equal(moduleFor("GET", "/api/compliance"), "compliance"); assert.equal(moduleFor("POST", "/api/compliance/backups"), "compliance");
  const perm = Object.fromEntries(DEFAULT_ROLES.map((r) => [r.id, r.perms.compliance]));
  assert.deepEqual(perm, { owner: "edit", admin: "edit", manager: "view", member: "none", finance: "none", creative: "none", viewer: "view" });
  const ag = AGENTS.find((a) => a.id === "compliance_officer");
  assert.equal(ag.team, "Leadership"); assert.equal(ag.max, 1); assert.equal(agentFor("POST", "/api/compliance/policies/1/ai"), "compliance_officer");
  const t = await cxApp();
  try {
    await t.j(t.ck, `/api/workspaces/${t.ws.id}/ops/vendors`, "POST", { name: "Hostinger", purpose: "hosting" });
    await t.j(t.ck, `/api/workspaces/${t.ws.id}/ops/vendors`, "POST", { name: "Figma", purpose: "design" });
    const ov = (await t.j(t.ck, "/api/compliance")).data;
    assert.ok(["Store CRM contacts", "Support tickets & website chat", "HR candidates", "Team users (dashboard logins)", "Finance records", "Media files (Creative Studio)"].every((n) => ov.register.some((r) => r.name === n)));
    assert.ok(ov.register.find((r) => r.key === "crm_contacts").access.some((a) => /^Owner/.test(a)));
    assert.ok(["Hostinger", "Anthropic", "Moyasar"].every((n) => ov.vendors.some((v) => v.name === n)));
    assert.ok(ov.vendors.every((v) => v.dpa === "unknown"), "no DPA is assumed signed");
    assert.equal(ov.vendors.find((v) => v.name === "Hostinger").in_tool_stack, true);
    assert.equal((await t.j(t.ck, "/api/compliance/vendors/from-ops", "POST")).data.added, 1);
    assert.equal(ov.policies.length, 6);
    for (const p of t.st.db.compliance_policies) { assert.match(p.body, /\[CONFIRM/); assert.doesNotMatch(p.body.replace(/does not hold[^.]*\./, ""), /ISO 27001|SOC 2/); }
    // A second visit doesn't duplicate the starters.
    assert.equal((await t.j(t.ck, "/api/compliance")).data.register.length, ov.register.length);
    // Policy: AI drafts, a person saves (outcome recorded), approval needs every [CONFIRM] filled.
    const pol = ov.policies[0];
    const stream = await (await t.req(t.ck, `/api/compliance/policies/${pol.id}/ai`, "POST", {})).text();
    assert.match(stream, /\[\[MWIZ_SAVED\]\]/);
    assert.match(prompts.at(-1), /Never claim a certification/); assert.match(prompts.at(-1), /Security checks:/);
    const withDraft = (await t.j(t.ck, `/api/compliance/policies/${pol.id}`)).data;
    assert.ok(withDraft.ai_draft);
    const saved = (await t.j(t.ck, `/api/compliance/policies/${pol.id}`, "PUT", { body: withDraft.ai_draft, from_ai: true })).data;
    assert.equal(saved.version, 2); assert.equal(saved.ai_draft, null);
    assert.ok(t.st.db.agent_events.some((e) => e.agent_id === "compliance_officer" && e.outcome === "accepted"));
    assert.equal((await t.j(t.ck, `/api/compliance/policies/${ov.policies[1].id}`, "PUT", { approve: true })).status, 422);
    const ok = (await t.j(t.ck, `/api/compliance/policies/${ov.policies[1].id}`, "PUT", { body: "# Access control\n\nEveryone has their own login.", owner: "Founder", approve: true })).data;
    assert.equal(ok.status, "approved"); assert.ok(ok.approved_by);
    // Access review: rows from Teams & roles; remove decisions can be applied.
    await t.user("Idle Ida", "member");
    const ida = t.st.db.users.find((u) => u.name === "Idle Ida");
    ida.created_at = new Date(Date.now() - 120 * 864e5).toISOString(); ida.last_login_at = new Date(Date.now() - 100 * 864e5).toISOString();
    const rows = (await t.j(t.ck, "/api/compliance")).data.access.rows;
    assert.equal(rows.find((r) => r.name === "Idle Ida").suggestion, "remove");
    const rev = (await t.j(t.ck, "/api/compliance/reviews", "POST", { decisions: [{ user_id: ida.id, decision: "remove", note: "left" }], shared_login: "change", apply: true })).data;
    assert.equal(rev.applied, 1); assert.equal(rev.reviewer, "Owner (team password)"); assert.match(rev.quarter, /^\d{4}-Q[1-4]$/);
    assert.equal(t.st.db.users.find((u) => u.id === ida.id).active, false);
    assert.ok(rev.decisions.some((d) => d.user_id === "owner" && d.decision === "change"));
    // Breach: the flag starts the checklist; deadlines count from when the team became aware.
    const inc = (await t.j(t.ck, `/api/workspaces/${t.ws.id}/ops/incidents`, "POST", { title: "Leaked CSV", severity: "SEV1" })).data;
    const aware = "2026-11-01T08:00:00.000Z";
    const fl = (await t.j(t.ck, `/api/compliance/incidents/${t.ws.id}/${inc.id}/breach`, "POST", { aware_at: aware, people_affected: "about 40" })).data;
    assert.equal(fl.personal_data_breach, true);
    const regulator = fl.breach.checklist.find((c) => c.id === "regulator");
    assert.equal(regulator.due_at, "2026-11-04T08:00:00.000Z"); assert.match(regulator.text, /Verify the current PDPL breach notification timeline/);
    assert.equal((await t.j(t.ck, `/api/compliance/incidents/${t.ws.id}/${inc.id}/breach`, "POST", {})).status, 409);
    await t.j(t.ck, `/api/compliance/incidents/${t.ws.id}/${inc.id}/breach`, "PUT", { item: "contain", done: true });
    const after = (await t.j(t.ck, "/api/compliance")).data;
    assert.ok(after.incidents.find((i) => i.id === inc.id).breach.checklist.find((c) => c.id === "contain").done_at);
    assert.ok(after.needs.some((n) => /Breach checklist overdue/.test(n.text)));
    const cmd = (await t.j(t.ck, `/api/workspaces/${t.ws.id}/command`)).data;
    assert.ok(cmd.needs.some((n) => n.module === "Compliance"));
    // Permissions: Team lead sees, can't change; Admin can change; settings validated.
    const lead = await t.user("Lee Lead", "manager"), admin = await t.user("Ada Admin", "admin");
    assert.equal((await t.j(lead, "/api/compliance")).status, 200);
    assert.equal((await t.j(lead, "/api/compliance/register", "POST", { name: "x" })).status, 403);
    assert.equal((await t.j(admin, "/api/compliance/register", "POST", { name: "Webinar sign-ups", data: "name, email", module: "marketing" })).status, 201);
    assert.equal((await t.j(admin, "/api/compliance/settings", "PUT", { dsr_days: 200 })).status, 422);
    assert.equal((await t.j(admin, "/api/compliance/settings", "PUT", { dsr_days: 45 })).data.dsr_days, 45);
    const me = (await t.j(lead, "/api/me")).data;
    assert.equal(me.perms.compliance, "view");
  } finally { t.close(); }
});

// ================================================================ Billing & customers, ZATCA, Moyasar
// A private store + billing engine on a fake clock (no network: gateway and ZATCA adapters are mocked).
async function billingKit({ vat = true, senders = null, mode = "test" } = {}) {
  const { createBilling } = await import("../lib/billing.js");
  const { createMoyasar } = await import("../lib/moyasar.js");
  const { createZatca } = await import("../lib/zatca.js");
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "mwiz-bill-")), st = new Store(d);
  const calls = [];
  const fetchImpl = async (url, o) => { calls.push({ url, o }); return { ok: true, status: 200, json: async () => ({ id: "inv_live_1", url: "https://checkout.moyasar.com/x", status: "initiated" }) }; };
  const clock = { t: new Date("2026-11-01T07:00:00Z") }; // 10:00 in Riyadh
  const b = createBilling({ store: st, senders, emailReady: () => !!senders, gateway: createMoyasar({ cfg: { secret: "sk_test_x", webhook_secret: "", ready: true, public_url: "https://x" }, fetchImpl }),
    zatca: createZatca({ cfg: { env: "sandbox", csid: "", secret: "", signing_ready: false }, fetchImpl }), log: { error() {} }, now: () => clock.t });
  const w = st.listWorkspaces()[0];
  if (vat) w.finance = { vat_registered: true };
  b.setSettings(w, { legal_name: "DPA AD Co", vat_number: "310122393500003", cr_number: "1010101010", mode, address: { street: "King Fahd Rd", building: "1234", district: "Olaya", city: "Riyadh", postal_code: "12211" } });
  return { b, st, w, clock, calls, at: (iso) => { clock.t = new Date(iso); }, done: () => fs.rmSync(d, { recursive: true, force: true }) };
}
const r2Num = (n) => Math.round(n * 100) / 100;

test("billing: yearly price, proration maths and plan changes", async () => {
  const { periodPrice, mrrSar, proration, planTable } = await import("../lib/billing.js");
  const { PLANS } = await import("../lib/sales.js");
  const growth = PLANS.find((p) => p.name === "Growth");
  assert.equal(periodPrice({ plan: "Growth", cycle: "yearly", currency: "USD" }), growth.usd * 10); // yearly = 10 × monthly
  assert.equal(periodPrice({ plan: "Growth", cycle: "yearly", currency: "SAR" }), 16837.5);
  assert.equal(mrrSar({ plan: "Growth", cycle: "yearly", status: "active" }), 1403.13); // a twelfth of the yearly price
  assert.equal(mrrSar({ plan: "Growth", cycle: "monthly", status: "trial" }), 0);
  assert.equal(periodPrice({ plan: "Enterprise", cycle: "monthly", currency: "USD", custom_price_usd: 6000 }), 6000);
  assert.equal(planTable().find((p) => p.name === "Scale").yearly_usd, 12990);
  // Growth → Scale halfway through a 30-day month: credit 15/30 of Growth, charge 15/30 of Scale.
  const c = { plan: "Growth", cycle: "monthly", currency: "SAR", status: "active", period_start: "2026-11-01", period_end: "2026-12-01" };
  const up = proration(c, "Scale", "2026-11-16");
  assert.deepEqual([up.total_days, up.remaining_days, up.credit, up.charge, up.net, up.direction], [30, 15, 841.88, 2435.63, 1593.75, "upgrade"]);
  const down = proration({ ...c, plan: "Scale" }, "Growth", "2026-11-16");
  assert.equal(down.net, -1593.75); assert.equal(down.direction, "downgrade");
  assert.equal(proration({ ...c, status: "trial" }, "Scale", "2026-11-16").net, 0);

  const k = await billingKit();
  const cust = k.b.addCustomer(k.w, { store_name: "Ward", plan: "Growth", status: "active", start_date: "2026-11-01" });
  await k.b.runWorkspace(k.w);
  k.at("2026-11-16T07:00:00Z");
  const r = await k.b.changePlan(k.w, cust, "Scale");
  assert.equal(r.invoice.lines[0].kind, "proration"); assert.equal(r.invoice.totals.taxable, 1593.75); assert.equal(r.invoice.status, "issued");
  const r3 = await k.b.changePlan(k.w, cust, "Growth");
  assert.equal(r3.invoice, null); assert.equal(cust.credit_balance, 1593.75); // downgrade → account credit
  // The credit comes off the next invoice.
  k.at("2026-12-01T07:00:00Z");
  await k.b.runWorkspace(k.w);
  const dec = k.b.invoices(k.w.id).find((i) => i.period_start === "2026-12-01");
  assert.equal(dec.totals.discount, 1593.75); assert.equal(dec.totals.taxable, r2Num(1683.75 - 1593.75)); assert.equal(cust.credit_balance, 0);
  k.done();
});

test("billing: VAT 15%, sequential numbers, render overage in arrears, void and credit-note rules", async () => {
  const k = await billingKit();
  const c = k.b.addCustomer(k.w, { store_name: "Oud House", plan: "Scale", status: "active", start_date: "2026-11-01", owner_email: "o@oud.sa", domain: "oud.sa" });
  await k.b.runWorkspace(k.w);
  const [nov] = k.b.invoices(k.w.id);
  assert.equal(nov.number, "INV-000001"); assert.equal(nov.zatca_type, "simplified");
  assert.deepEqual(nov.totals, { subtotal: 4871.25, discount: 0, taxable: 4871.25, vat: 730.69, total: 5601.94 }); // 15% VAT
  assert.equal(nov.due_date, "2026-11-08");
  await k.b.runWorkspace(k.w); // idempotent: no second invoice for the same period
  assert.equal(k.b.invoices(k.w.id).length, 1);
  k.b.recordPayment(k.w, nov, { amount: 5601.94, method: "bank_transfer" });
  // 17,250 renders on Scale (15,000 included): 2,250 extra → 3 blocks of 1,000 at $10 = $30, billed on the next invoice.
  k.b.setUsage(k.w, c, "2026-11", 17250);
  k.at("2026-12-01T07:00:00Z");
  await k.b.runWorkspace(k.w);
  const dec = k.b.invoices(k.w.id).find((i) => i.number === "INV-000002");
  const ov = dec.lines.find((l) => l.kind === "overage");
  assert.equal(ov.qty, 3); assert.equal(ov.unit_price, 37.5); assert.equal(ov.net, 112.5);
  assert.equal(dec.totals.taxable, 4983.75); assert.equal(dec.totals.vat, 747.56); assert.equal(dec.totals.total, 5731.31);
  k.at("2027-01-01T07:00:00Z"); k.b.recordPayment(k.w, dec, {});
  await k.b.runWorkspace(k.w);
  assert.ok(!k.b.invoices(k.w.id).find((i) => i.number === "INV-000003").lines.some((l) => l.kind === "overage")); // November is billed once only

  // A draft can be edited; issued never. Void needs a reason; an issued invoice is voided with a credit note.
  const manual = k.b.draft(k.w, c, { lines: [{ kind: "setup", description: "Onboarding", qty: 1, unit_price: 1000 }] });
  assert.equal(manual.number, null);
  await assert.rejects(k.b.voidInvoice(k.w, manual, ""), /reason/);
  await k.b.issue(k.w, manual);
  assert.equal(manual.number, "INV-000004");
  await assert.rejects(k.b.issue(k.w, manual), /Only drafts/);
  const v = await k.b.voidInvoice(k.w, manual, "Agreed to waive setup");
  assert.equal(manual.status, "void"); assert.equal(v.credit.kind, "credit_note"); assert.equal(v.credit.number, "CN-000001");
  assert.equal(v.credit.totals.total, 1150); assert.equal(v.credit.credit_of_number, "INV-000004");
  await assert.rejects(k.b.voidInvoice(k.w, dec, "x"), /Paid invoices can't be voided/);
  await assert.rejects(k.b.creditNote(k.w, dec, { amount: 99999, reason: "x" }), /Credit must be between/);
  const cn = await k.b.creditNote(k.w, dec, { amount: 112.5, reason: "Render bug" });
  assert.equal(cn.credit.number, "CN-000002"); assert.equal(cn.credit.totals.vat, 16.88);
  assert.ok(k.st.listOps("finance_income", k.w.id).some((i) => i.amount_sar < 0 && /CN-000002/.test(i.note))); // refund owed shows in Finance
  // Not VAT-registered: no VAT and no ZATCA data.
  k.w.finance.vat_registered = false;
  const plain = k.b.draft(k.w, c, { lines: [{ kind: "other", description: "Design", qty: 2, unit_price: 100, discount: 20 }], discount: 30 });
  await k.b.issue(k.w, plain);
  assert.deepEqual(plain.totals, { subtotal: 180, discount: 30, taxable: 150, vat: 0, total: 150 }); assert.equal(plain.zatca, undefined);
  k.done();
});

test("ZATCA: phase 1 TLV QR byte layout, UBL XML fields and the invoice hash chain", async () => {
  const { tlv, qrBase64, decodeTlv, INITIAL_PIH, ublXml, invoiceHash } = await import("../lib/zatca.js");
  const { qrMatrix, qrSvg } = await import("../lib/qr.js");
  // The example in ZATCA's QR guide.
  const b64 = qrBase64({ seller: "Bobs Records", vat_number: "310122393500003", timestamp: "2022-04-25T15:30:00Z", total: 1000, vat: 150 });
  assert.equal(b64, "AQxCb2JzIFJlY29yZHMCDzMxMDEyMjM5MzUwMDAwMwMUMjAyMi0wNC0yNVQxNTozMDowMFoEBzEwMDAuMDAFBjE1MC4wMA==");
  const bytes = Buffer.from(b64, "base64");
  assert.deepEqual([...bytes.subarray(0, 2)], [1, 12]); assert.equal(bytes.subarray(2, 14).toString(), "Bobs Records");
  assert.deepEqual([...bytes.subarray(14, 16)], [2, 15]);
  assert.deepEqual(decodeTlv(b64), { 1: "Bobs Records", 2: "310122393500003", 3: "2022-04-25T15:30:00Z", 4: "1000.00", 5: "150.00" });
  assert.equal(tlv(["متجر"])[1], 8); // length is in UTF-8 bytes, not characters
  assert.equal(INITIAL_PIH, "NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==");
  assert.equal(qrMatrix(b64).length, 41); assert.match(qrSvg(b64), /^<svg[^>]+viewBox="0 0 49 49"/);

  const k = await billingKit();
  const b2c = k.b.addCustomer(k.w, { store_name: "Ward", plan: "Starter", status: "active", start_date: "2026-11-01" });
  const b2b = k.b.addCustomer(k.w, { store_name: "Big Co", legal_name: "Big Co LLC", plan: "Growth", status: "active", start_date: "2026-11-01", vat_number: "300000000000003", billing_address: { street: "Tahlia", building: "2", district: "Rawdah", city: "Jeddah", postal_code: "23432" } });
  await k.b.runWorkspace(k.w);
  const [first, second] = k.b.invoices(k.w.id).sort((a, b) => a.zatca.icv - b.zatca.icv);
  assert.equal(first.zatca.pih, INITIAL_PIH); assert.equal(second.zatca.pih, first.zatca.hash); // each invoice carries the previous hash
  assert.deepEqual([first.zatca.icv, second.zatca.icv], [1, 2]);
  assert.equal(k.b.settings(k.w).last_hash, second.zatca.hash);
  const std = [first, second].find((i) => i.customer_id === b2b.id);
  assert.equal(std.zatca_type, "standard");
  const xml = ublXml(std, { seller: std.seller, buyer: std.buyer, uuid: std.zatca.uuid, icv: std.zatca.icv, pih: std.zatca.pih, qr: std.zatca.qr });
  for (const re of [/<cbc:ProfileID>reporting:1\.0<\/cbc:ProfileID>/, new RegExp(`<cbc:UUID>${std.zatca.uuid}</cbc:UUID>`), /<cbc:InvoiceTypeCode name="0100000">388<\/cbc:InvoiceTypeCode>/,
    /<cbc:DocumentCurrencyCode>SAR<\/cbc:DocumentCurrencyCode>/, /<cbc:TaxCurrencyCode>SAR<\/cbc:TaxCurrencyCode>/, new RegExp(`<cbc:ID>ICV</cbc:ID><cbc:UUID>${std.zatca.icv}</cbc:UUID>`),
    /<cbc:ID>PIH<\/cbc:ID>/, /<cbc:CompanyID>310122393500003<\/cbc:CompanyID>/, /<cbc:CompanyID>300000000000003<\/cbc:CompanyID>/, /<cbc:ID schemeID="CRN">1010101010<\/cbc:ID>/,
    /<cbc:TaxAmount currencyID="SAR">252\.56<\/cbc:TaxAmount>/, /<cbc:TaxInclusiveAmount currencyID="SAR">1936\.31<\/cbc:TaxInclusiveAmount>/, /<cbc:Percent>15<\/cbc:Percent>/, /<cbc:ActualDeliveryDate>2026-11-01/])
    assert.match(xml, re);
  assert.equal(invoiceHash(xml), std.zatca.hash); // regenerating gives the same hash
  assert.notEqual(invoiceHash(xml.replace("1936.31", "1936.32")), std.zatca.hash);
  assert.equal(invoiceHash(xml.replace(/<cbc:ID>QR<\/cbc:ID><cac:Attachment>[\s\S]*?<\/cac:Attachment>/, "<cbc:ID>QR</cbc:ID><cac:Attachment>other</cac:Attachment>")), std.zatca.hash); // the QR is outside the hash
  const simp = [first, second].find((i) => i.customer_id === b2c.id);
  assert.match(ublXml(simp, { ...simp.zatca, seller: simp.seller, buyer: simp.buyer }), /<cbc:InvoiceTypeCode name="0200000">388/);
  assert.equal(decodeTlv(simp.zatca.qr)[5], "111.94"); // 15% VAT on SAR 746.25 (Starter)
  assert.equal(std.zatca.submission.status, "test"); assert.equal(k.calls.length, 0); // Test mode: nothing sent to ZATCA or Moyasar
  // The credit note uses type 381, references the invoice and continues the chain.
  const lastHash = k.b.settings(k.w).last_hash;
  const cn = (await k.b.creditNote(k.w, std, { amount: 100, reason: "Goodwill" })).credit;
  const cnx = ublXml(cn, { ...cn.zatca, seller: cn.seller, buyer: cn.buyer });
  assert.match(cnx, /<cbc:InvoiceTypeCode name="0100000">381/); assert.match(cnx, new RegExp(`<cac:InvoiceDocumentReference><cbc:ID>${std.number}</cbc:ID>`));
  assert.equal(cn.zatca.pih, lastHash); assert.equal(cn.zatca.icv, 3);
  k.done();
});

test("billing: dunning on day 1, 3 and 7 in Test mode, pause after N days, recovery on payment", async () => {
  const sent = [];
  const k = await billingKit({ senders: { email: async (m) => { sent.push(m); return { provider_id: "m1" }; } } });
  const c = k.b.addCustomer(k.w, { store_name: "Late Co", plan: "Growth", status: "active", start_date: "2026-11-01", owner_email: "late@co.sa" });
  await k.b.runWorkspace(k.w);
  const [inv] = k.b.invoices(k.w.id);
  assert.equal(inv.due_date, "2026-11-08");
  const dunning = () => k.st.listOps("billing_log", k.w.id).filter((l) => l.kind === "dunning");
  k.at("2026-11-08T07:00:00Z"); await k.b.runWorkspace(k.w);
  assert.equal(dunning().length, 0); assert.equal(c.status, "active");
  k.at("2026-11-09T07:00:00Z"); await k.b.runWorkspace(k.w);
  assert.equal(c.status, "past_due"); assert.equal(dunning().length, 1); assert.equal(dunning()[0].status, "test"); assert.match(dunning()[0].text, /INV-000001/);
  await k.b.runWorkspace(k.w); assert.equal(dunning().length, 1); // no repeat the same day
  k.at("2026-11-11T07:00:00Z"); await k.b.runWorkspace(k.w);
  k.at("2026-11-15T07:00:00Z"); await k.b.runWorkspace(k.w);
  assert.deepEqual(inv.reminders.map((r) => r.step), [1, 3, 7]); assert.match(dunning()[2].subject, /Final reminder/);
  assert.equal(sent.length, 0); // Test mode: logged, never sent
  k.at("2026-11-22T07:00:00Z"); await k.b.runWorkspace(k.w);
  assert.equal(c.status, "paused"); assert.equal(c.paused_reason, "dunning");
  k.b.recordPayment(k.w, inv, {});
  assert.equal(c.status, "active"); assert.ok(c.events.some((e) => e.type === "recovered"));
  // Live mode with email connected: the invoice email and reminders are sent (outside 09:00–21:00 Riyadh reminders wait).
  k.b.setSettings(k.w, { mode: "live" });
  k.at("2026-12-01T07:00:00Z"); await k.b.runWorkspace(k.w);
  const dec = k.b.invoices(k.w.id).find((i) => i.period_start === "2026-12-01");
  assert.equal(sent.length, 1); assert.match(sent[0].subject, /INV-000002/);
  assert.equal(dec.payment_link.mode, "live"); assert.equal(k.calls.length, 1); assert.match(k.calls[0].url, /api\.moyasar\.com\/v1\/invoices$/);
  assert.equal(JSON.parse(k.calls[0].o.body).amount, Math.round(dec.totals.total * 100)); // halalas
  k.at("2026-12-09T20:00:00Z"); await k.b.runWorkspace(k.w); // 23:00 in Riyadh
  assert.equal(sent.length, 1);
  k.at("2026-12-10T07:00:00Z"); await k.b.runWorkspace(k.w);
  assert.equal(sent.length, 2); assert.equal(sent[1].to, "late@co.sa");
  // Trials convert on their end date; cancel at period end stops renewal.
  const t = k.b.addCustomer(k.w, { store_name: "Trial Co", plan: "Starter", status: "trial", trial_end: "2026-12-20" });
  k.b.recordPayment(k.w, dec, {});
  k.b.setStatus(k.w, c, "cancel");
  assert.equal(c.cancel_at_period_end, true);
  k.at("2026-12-20T07:00:00Z"); await k.b.runWorkspace(k.w);
  assert.equal(t.status, "active"); assert.ok(k.b.invoices(k.w.id).some((i) => i.customer_id === t.id && i.period_start === "2026-12-20"));
  k.at("2027-01-01T07:00:00Z"); await k.b.runWorkspace(k.w);
  assert.equal(c.status, "cancelled"); assert.ok(!k.b.invoices(k.w.id).some((i) => i.customer_id === c.id && i.period_start === "2027-01-01"));
  k.done();
});

test("billing: MRR movements, NRR and logo churn from subscription events", async () => {
  const { mrrMetrics } = await import("../lib/billing.js");
  const ev = (...xs) => xs.map(([date, mrr_sar]) => ({ date, mrr_sar }));
  const cs = [
    { events: ev(["2025-11-15", 1000]) },                        // steady
    { events: ev(["2026-01-05", 500], ["2026-11-10", 800]) },     // expansion +300 in November
    { events: ev(["2026-02-01", 400], ["2026-11-20", 0]) },       // churned 400
    { events: ev(["2026-11-03", 200]) },                          // new 200
    { events: ev(["2026-03-01", 1000], ["2026-11-15", 700]) },    // contraction 300
    { events: ev(["2026-04-01", 300], ["2026-06-01", 0], ["2026-11-02", 300]) }, // reactivation
  ];
  const m = mrrMetrics(cs, "2026-11-25");
  const nov = m.this_month;
  assert.deepEqual([nov.start, nov.new, nov.expansion, nov.contraction, nov.churned, nov.reactivation, nov.end], [2900, 200, 300, 300, 400, 300, 3000]);
  assert.equal(nov.nrr_pct, 86.2); // (2900 + 300 − 300 − 400) ÷ 2900
  assert.equal(nov.logo_churn_pct, 25); assert.equal(nov.logos_new, 1);
  assert.equal(m.months.length, 12); assert.equal(m.months[0].month, "2025-12");
  assert.equal(m.nrr_12m_pct, 100); // the one store paying 12 months ago still pays the same
  assert.equal(m.months.find((x) => x.month === "2026-06").churned, 300);
});

test("billing HTTP: customers, payments create Finance income, payouts reconcile, command center, health", async () => {
  const ws = await (await post("/api/workspaces", { company_name: "Bill Co" })).json();
  const B = `/api/workspaces/${ws.id}/billing`;
  assert.equal((await post(`${B}/customers`, { store_name: "" })).status, 422);
  assert.equal((await post(`${B}/customers`, { store_name: "X", vat_number: "123" })).status, 422);
  const today = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
  const c = await (await post(`${B}/customers`, { store_name: "متجر الورد", domain: "https://ward.sa/", plan: "Growth", owner_email: "owner@ward.sa", platform: "Salla", start_date: today })).json();
  assert.equal(c.domain, "ward.sa"); assert.equal(c.mrr_sar, 1683.75); assert.equal(c.open_invoices, 1); // first period invoiced at once
  const [inv] = await json(`${B}/invoices?customer=${c.id}`);
  assert.equal(inv.status, "issued"); assert.equal(inv.totals.vat, 0); // this workspace isn't VAT-registered
  assert.equal((await call(`${B}/invoices/${inv.id}`, { method: "PUT", body: JSON.stringify({ discount: 10 }) })).status, 409);
  const html = await (await call(`${B}/invoices/${inv.id}/print`)).text();
  assert.match(html, /فاتورة/); assert.match(html, /Invoice/); assert.match(html, /متجر الورد/);
  // Payout CSV (Arabic headers): one row pays the invoice, one matches nobody.
  const csv = "تاريخ التحويل,اسم المتجر,رابط المتجر,المبلغ,العمولة\n2026-11-02,متجر الورد,https://ward.sa,1683.75,50\n2026-11-02,Unknown,unknown.sa,100,0";
  const parsed = await (await post(`${B}/payouts/parse`, { text: csv, platform: "Salla" })).json();
  assert.deepEqual(parsed.rows.map((r) => r.match), ["invoice", "none"]); assert.equal(parsed.rows[0].invoice_id, inv.id);
  const applied = await (await post(`${B}/payouts/apply`, { rows: parsed.rows })).json();
  assert.deepEqual([applied.applied, applied.skipped, applied.fees_sar], [1, 1, 50]);
  const paid = await json(`${B}/invoices/${inv.id}`);
  assert.equal(paid.status, "paid"); assert.equal(paid.payments[0].method, "app_store");
  const fin = await json(`/api/workspaces/${ws.id}/finance`);
  const inc = fin.income.filter((i) => i.entry === "billing");
  assert.equal(inc.length, 1); assert.equal(inc[0].type, "subscription"); assert.equal(inc[0].amount_sar, 1683.75);
  assert.equal(fin.snapshot.revenue.source, "billing"); assert.equal(fin.snapshot.revenue.mrr_sar, 1684); assert.equal(fin.snapshot.revenue.one_off_month_sar, 0); // not counted twice
  assert.ok(fin.expenses.some((e) => /app-store fee/.test(e.vendor) && e.amount_sar === 50));
  // Manual payment on a second invoice; paying a paid invoice is refused.
  const inv2 = await (await post(`${B}/customers/${c.id}/invoices`, { lines: [{ kind: "setup", description: "Onboarding", qty: 1, unit_price: 500 }], issue: true })).json();
  assert.match(inv2.number, /^INV-00000\d$/);
  assert.equal((await post(`${B}/invoices/${inv2.id}/payments`, { amount: 500, method: "bank_transfer", reference: "TRX-1" })).status, 201);
  assert.equal((await post(`${B}/invoices/${inv2.id}/payments`, { amount: 1 })).status, 409);
  assert.ok((await json(`/api/workspaces/${ws.id}/finance`)).income.some((i) => i.type === "setup" && i.amount_sar === 500));
  // Proration preview before confirming.
  const prev = await (await post(`${B}/customers/${c.id}/plan/preview`, { plan: "Scale" })).json();
  assert.equal(prev.direction, "upgrade"); assert.ok(prev.explain.length > 20);
  assert.equal((await post(`${B}/customers/${c.id}/plan`, { plan: "Scale" })).status, 422); // must confirm
  // Usage, 360 and the health score with reasons.
  await post(`${B}/customers/${c.id}/usage`, { renders: 1200 });
  await post(`/api/workspaces/${ws.id}/support/tickets`, { channel: "Email", customer_name: "Owner", contact: "owner@ward.sa", message: "الإعلانات ما ظهرت" });
  const d = await json(`${B}/customers/${c.id}`);
  assert.equal(d.tickets.length, 1); assert.equal(d.usage_month.renders, 1200);
  assert.equal(d.customer.health.factors.length, 5); assert.ok(d.customer.health.factors.every((f) => f.why && f.points <= f.max));
  assert.equal(d.customer.health.factors.find((f) => f.id === "tickets").points, 10);
  // Command Center: billed MRR, and trials ending this week.
  await post(`${B}/customers`, { store_name: "Trial Store", plan: "Starter", status: "trial", start_date: today, trial_end: new Date(Date.parse(today) + 3 * 864e5).toISOString().slice(0, 10) });
  const cmd = await json(`/api/workspaces/${ws.id}/command`);
  assert.equal(cmd.revenue.paying_mrr, 449); assert.equal(cmd.revenue.source, "billing");
  assert.ok(cmd.needs.some((n) => n.module === "Billing" && /trial ends/.test(n.text)));
  const ov = await json(B);
  assert.equal(ov.metrics.paying, 1); assert.equal(ov.metrics.trials, 1); assert.equal(ov.counts.trial, 1);
  // A Sales deal moving to paying becomes a customer once.
  const deal = await (await post(`/api/workspaces/${ws.id}/deals`, { name: "Deal Store", skus: 800, stage: "paying", platform: "Zid" })).json();
  assert.ok((await json(B)).suggestions.some((s) => s.kind === "deal" && s.id === deal.id));
  const fromDeal = await (await post(`${B}/customers/from-deal/${deal.id}`, {})).json();
  assert.equal(fromDeal.plan, "Growth"); assert.equal(fromDeal.deal_id, deal.id);
  assert.equal((await post(`${B}/customers/from-deal/${deal.id}`, {})).status, 409);
});

test("billing: Moyasar webhook secret, card payment marks paid, AI Billing assistant drafts need approval", async () => {
  const d2 = fs.mkdtempSync(path.join(os.tmpdir(), "mwiz-moy-")), st2 = new Store(d2);
  const fake = { name: "fake", model: "fake", async generate() { return "Subject: تذكير بالفاتورة\nمرحباً، نذكركم بالفاتورة.\n### English\nHi, a reminder."; } };
  const app2 = createApp({ store: st2, provider: fake, password: "pw-bill", billingOptions: { env: { MOYASAR_WEBHOOK_SECRET: "whsec_1", BILLING_USAGE_TOKEN: "usage-tok" }, senders: { email: async () => ({}) } } });
  const srv = app2.listen(0); await new Promise((r) => srv.once("listening", r));
  const b2 = `http://127.0.0.1:${srv.address().port}`;
  const ck = (await fetch(b2 + "/login", { method: "POST", redirect: "manual", body: new URLSearchParams({ password: "pw-bill" }) })).headers.get("set-cookie").split(";")[0];
  const j = (p, b, m) => fetch(b2 + p, { method: m || (b ? "POST" : "GET"), headers: { "Content-Type": "application/json", cookie: ck }, body: b && JSON.stringify(b) });
  const [w] = await (await j("/api/workspaces")).json();
  const B = `/api/workspaces/${w.id}/billing`;
  const c = await (await j(`${B}/customers`, { store_name: "Card Co", plan: "Starter", domain: "card.sa" })).json();
  const [inv] = await (await j(`${B}/invoices`)).json();
  assert.equal(inv.payment_link.mode, "test");
  const hook = (body) => fetch(b2 + "/hooks/moyasar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const ev = { id: "evt_1", type: "payment_paid", live: false, data: { id: "pay_1", status: "paid", amount: Math.round(inv.totals.total * 100), currency: "SAR", invoice_id: inv.payment_link.id, metadata: {} } };
  assert.equal((await hook(ev)).status, 401); // no secret
  assert.equal((await hook({ ...ev, secret_token: "whsec_2" })).status, 401); // wrong secret
  assert.equal((await (await j(`${B}/invoices/${inv.id}`)).json()).status, "issued");
  assert.equal((await hook({ ...ev, secret_token: "whsec_1" })).status, 200);
  const paid = await (await j(`${B}/invoices/${inv.id}`)).json();
  assert.equal(paid.status, "paid"); assert.equal(paid.payments[0].provider_id, "pay_1");
  await hook({ ...ev, secret_token: "whsec_1" }); // replayed event: no second payment
  assert.equal((await (await j(`${B}/payments`)).json()).length, 1);
  assert.ok(st2.listOps("finance_income", w.id).some((i) => i.invoice_id === inv.id));
  // Usage API for the product.
  assert.equal((await fetch(b2 + "/hooks/billing/usage", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer nope" }, body: JSON.stringify({ domain: "card.sa", renders: 10 }) })).status, 401);
  const u = await (await fetch(b2 + "/hooks/billing/usage", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer usage-tok" }, body: JSON.stringify({ domain: "card.sa", renders: 10, mode: "add" }) })).json();
  assert.equal(u.renders, 10); assert.equal(u.customer_id, c.id);
  // Failed card payment (simulated, Test mode) starts dunning; AI drafts a reminder; approving logs it and scores the agent.
  const inv2 = await (await j(`${B}/customers/${c.id}/invoices`, { lines: [{ description: "Extra", qty: 1, unit_price: 100 }], issue: true })).json();
  await j(`${B}/invoices/${inv2.id}/simulate-card`, { outcome: "failed" });
  assert.ok((await (await j(`${B}/payments`)).json()).some((p) => p.status === "failed"));
  assert.ok((await (await j(B)).json()).needs.some((n) => n.kind === "failed"));
  const draft = await (await j(`${B}/invoices/${inv2.id}/ai/reminder`, {})).json();
  assert.equal(draft.status, "draft"); assert.equal(draft.subject, "تذكير بالفاتورة"); assert.doesNotMatch(draft.text, /Subject:/);
  const ap = await (await j(`${B}/drafts/${draft.id}/approve`, {})).json();
  assert.equal(ap.status, "approved"); assert.equal(ap.email.status, "test");
  assert.equal((await j(`${B}/drafts/${draft.id}/approve`, {})).status, 409);
  const agent = await (await j("/api/workforce/agents/billing_assistant")).json();
  assert.ok(agent.runs.length >= 1); assert.ok(agent.events.some((e) => e.outcome === "accepted"));
  const ex = await (await j(`${B}/invoices/${inv2.id}/ai/explain`, {})).json();
  await j(`${B}/drafts/${ex.id}/reject`, {});
  assert.ok((await (await j("/api/workforce/agents/billing_assistant")).json()).events.some((e) => e.outcome === "rejected"));
  srv.close(); app2.locals.crm.flush(); fs.rmSync(d2, { recursive: true, force: true });
});

test("billing permissions: Owner/Admin/Finance edit, Team lead and Viewer view, Member and Creative none", async () => {
  const { DEFAULT_ROLES } = await import("../lib/access.js");
  const perm = Object.fromEntries(DEFAULT_ROLES.map((r) => [r.id, r.perms.billing]));
  assert.deepEqual(perm, { owner: "edit", admin: "edit", manager: "view", member: "none", finance: "edit", creative: "none", viewer: "view" });
  const [ws] = await json("/api/workspaces");
  const B = `/api/workspaces/${ws.id}/billing`;
  const login = async (role) => {
    const email = `bill-${role}@dpa.ad`;
    await post("/api/admin/users", { name: `Bill ${role}`, email, password: `bill-${role}-pass`, role_id: role });
    return (await fetch(base + "/login", { method: "POST", redirect: "manual", body: new URLSearchParams({ email, password: `bill-${role}-pass` }) })).headers.get("set-cookie").split(";")[0];
  };
  const as = (ck, p, m = "GET", body) => fetch(base + p, { method: m, headers: { cookie: ck, "Content-Type": "application/json" }, body: body && JSON.stringify(body) }).then((r) => r.status);
  const [mem, lead, fin, view, cre] = await Promise.all(["member", "manager", "finance", "viewer", "creative"].map(login));
  assert.equal(await as(mem, B), 403); assert.equal(await as(cre, B), 403);
  assert.equal(await as(lead, B), 200); assert.equal(await as(lead, `${B}/settings`, "PUT", {}), 403);
  assert.equal(await as(view, B), 200); assert.equal(await as(view, `${B}/run`, "POST", {}), 403);
  assert.equal(await as(fin, B), 200); assert.equal(await as(fin, `${B}/settings`, "PUT", { terms_days: 7 }), 200);
  // Customer 360 without money: Team members (AI Support access) yes, Creative no.
  assert.equal(await as(mem, `/api/workspaces/${ws.id}/customers`), 200); assert.equal(await as(cre, `/api/workspaces/${ws.id}/customers`), 403);
  // The Command Center leaves billing out for people who can't see it.
  const cmd = await (await fetch(base + `/api/workspaces/${ws.id}/command`, { headers: { cookie: mem } })).json();
  assert.ok(!cmd.needs.some((n) => n.module === "Billing")); assert.equal(cmd.billing, undefined);
});

test("deleting a workspace also clears its billing, compliance and status rows", async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "mwiz-delws-")), st = new Store(d);
  try {
    const w = st.createWorkspace ? st.createWorkspace({ name: "Gone" }) : st.listWorkspaces()[0];
    const keep = "other-ws";
    st.db.billing_customers = [{ id: "1", workspace_id: w.id }, { id: "2", workspace_id: keep }];
    st.db.compliance_requests = [{ id: "3", workspace_id: w.id }];
    st.db.status_incidents = [{ id: "4", workspace_id: w.id }];
    st.db.ads_insights = [{ id: "5", workspace_id: w.id }];
    assert.ok(st.deleteWorkspace(w.id));
    assert.deepEqual(st.db.billing_customers.map((x) => x.id), ["2"]);
    assert.equal(st.db.compliance_requests.length, 0);
    assert.equal(st.db.status_incidents.length, 0);
    assert.equal(st.db.ads_insights.length, 0);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------- Paid Ads
async function adsApp({ env = {}, routes = [], provider: prov } = {}) {
  const { adsConfig } = await import("../lib/adsapi.js");
  const { socialConfig } = await import("../lib/social.js");
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "mwiz-ads-"));
  const st = new Store(d), fetchImpl = mockFetch(routes);
  const allEnv = { PUBLIC_URL: "https://wiz.test", META_APP_ID: "mapp", META_APP_SECRET: "msecret", SNAP_CLIENT_ID: "sid", SNAP_CLIENT_SECRET: "ssec", TIKTOK_ADS_APP_ID: "tapp", TIKTOK_ADS_SECRET: "tsec", ADS_LEAD_SECRET: "lead-secret-123", ...env };
  const aiProv = prov || { name: "fake", model: "fake", async generate() { return "no json here"; } };
  const app = createApp({ store: st, provider: aiProv, password: "pw-ads", adsOptions: { cfg: adsConfig(allEnv, "pw-ads"), fetchImpl, log: { error() {} } },
    studioOptions: { cfg: socialConfig(allEnv, "pw-ads"), fetchImpl, sleep: async () => {}, pollEvery: 0, pollMax: 5, log: { error() {} } } });
  const srv = app.listen(0);
  await new Promise((r) => srv.once("listening", r));
  const b = `http://127.0.0.1:${srv.address().port}`;
  const login = async (form) => (await fetch(b + "/login", { method: "POST", redirect: "manual", body: new URLSearchParams(form) })).headers.get("set-cookie").split(";")[0];
  const ck = await login({ password: "pw-ads" });
  const reqAs = (c) => (p, opts = {}) => fetch(b + p, { redirect: "manual", ...opts, headers: { "Content-Type": "application/json", cookie: c, ...(opts.headers || {}) } });
  const jAs = (c) => async (p, body, method) => { const r = await reqAs(c)(p, { method: method || (body !== undefined ? "POST" : "GET"), body: body !== undefined ? JSON.stringify(body) : undefined }); return { status: r.status, body: r.status === 204 ? null : await r.json().catch(() => null) }; };
  const j = jAs(ck);
  const userAs = async (role_id, email) => { await j("/api/admin/users", { name: role_id, email, password: "ads-pass-123", role_id }); const c = await login({ email, password: "ads-pass-123" }); const f = jAs(c); return (p, body, method) => f(p, body, method).then((r) => r.status); };
  const [w] = st.listWorkspaces();
  const close = () => { srv.close(); app.locals.crm.flush(); fs.rmSync(d, { recursive: true, force: true }); };
  return { st, app, ads: app.locals.ads, fetchImpl, b, ck, req: reqAs(ck), j, userAs, w, P: `/api/workspaces/${w.id}/ads`, close };
}
const isoDay = (k = 0) => new Date(Date.now() + 3 * 3600e3 + k * 864e5).toISOString().slice(0, 10);
function connectAds(ads, wsId, p, acct) {
  return ads.saveConnection(wsId, p, { name: "Test", tokens: p === "meta" ? { user: "U-ADS" } : { access: "A-TOK", refresh: "R-TOK", advertiser_ids: [acct.id] }, accounts: [acct], scopes: ["ads_read", "ads_management", "business_management"], expires_at: new Date(Date.now() + 30 * 864e5).toISOString() }, "test");
}

test("Paid Ads: insights from Meta, Snapchat, TikTok and Google normalise to one row shape (mocked APIs)", async () => {
  const A = await import("../lib/adsapi.js");
  const cfg = A.adsConfig({ META_APP_ID: "m", META_APP_SECRET: "s", ADS_GOOGLE: "1", GOOGLE_CLIENT_ID: "g", GOOGLE_CLIENT_SECRET: "gs", GOOGLE_ADS_DEVELOPER_TOKEN: "dev" }, "pw");
  const f = mockFetch([
    ["GET", /graph\.facebook\.com\/v[\d.]+\/act_1\/insights/, (u, o, n) => (n === 1
      ? { json: { data: [{ date_start: "2026-11-01", campaign_id: "C1", campaign_name: "Riyadh fashion", adset_id: "S1", adset_name: "Owners", ad_id: "A1", ad_name: "Reel [cs:7]", spend: "120.50", impressions: "10000", clicks: "300", inline_link_clicks: "150", reach: "8000", frequency: "1.25",
        actions: [{ action_type: "complete_registration", value: "4" }, { action_type: "offsite_conversion.fb_pixel_complete_registration", value: "4" }, { action_type: "lead", value: "2" }] }], paging: { next: "https://graph.facebook.com/v23.0/act_1/insights?after=X" } } }
      : { json: { data: [{ date_start: "2026-11-02", campaign_id: "C1", campaign_name: "Riyadh fashion", adset_id: "S1", adset_name: "Owners", ad_id: "A1", ad_name: "Reel [cs:7]", spend: "80", impressions: "5000", clicks: "100", reach: "4000", frequency: "1.25", actions: [] }] } })],
    ["GET", /adsapi\.snapchat\.com\/v1\/adaccounts\/SN1\/stats/, () => ({ json: { request_status: "SUCCESS", timeseries_stats: [{ timeseries_stat: { breakdown_stats: { ad: [{ id: "SA1", timeseries: [{ start_time: "2026-11-01T00:00:00.000+03:00", stats: { spend: 25500000, impressions: 4000, swipes: 40, uniques: 3500, frequency: 1.14, conversion_sign_ups: 3, conversion_purchases: 0 } }] }] } } }] } })],
    ["GET", /adsapi\.snapchat\.com\/v1\/adaccounts\/SN1\/ads$/, () => ({ json: { ads: [{ ad: { id: "SA1", name: "Snap ad", ad_squad_id: "SQ1" } }] } })],
    ["GET", /adsapi\.snapchat\.com\/v1\/adaccounts\/SN1\/adsquads$/, () => ({ json: { adsquads: [{ adsquad: { id: "SQ1", name: "Squad", campaign_id: "SC1" } }] } })],
    ["GET", /adsapi\.snapchat\.com\/v1\/adaccounts\/SN1\/campaigns$/, () => ({ json: { campaigns: [{ campaign: { id: "SC1", name: "Snap camp" } }] } })],
    ["GET", /business-api\.tiktok\.com\/open_api\/v1\.3\/report\/integrated\/get/, () => ({ json: { code: 0, data: { page_info: { total_page: 1 }, list: [{ dimensions: { ad_id: "TA1", stat_time_day: "2026-11-01 00:00:00" }, metrics: { campaign_id: "TC1", campaign_name: "TT camp", adgroup_id: "TG1", adgroup_name: "TT group", ad_name: "TT ad", spend: "40.00", impressions: "9000", clicks: "90", reach: "7000", frequency: "1.29", registration: "2", complete_payment: "1" } }] } } })],
    ["POST", /googleads\.googleapis\.com\/v21\/customers\/123\/googleAds:searchStream/, () => ({ json: [{ results: [{ campaign: { id: "G1", name: "Search" }, adGroup: { id: "GG1", name: "Brand" }, adGroupAd: { ad: { id: "GA1", name: "" } }, segments: { date: "2026-11-01" }, metrics: { costMicros: "15000000", impressions: "500", clicks: "50", conversions: 2.5 } }] }] })],
  ]);
  const meta = await A.fetchInsights(cfg, "meta", { user: "U" }, { id: "act_1" }, { since: "2026-11-01", until: "2026-11-02" }, f);
  assert.equal(meta.length, 2); // followed paging.next
  assert.deepEqual({ ...meta[0] }, { channel: "Meta", date: "2026-11-01", campaign_id: "C1", campaign_name: "Riyadh fashion", adset_id: "S1", adset_name: "Owners", ad_id: "A1", ad_name: "Reel [cs:7]", spend: 120.5, impressions: 10000, clicks: 150, reach: 8000, frequency: 1.25, leads: 2, signups: 4, purchases: 0 });
  assert.ok(f.calls[0].url.includes("level=ad") && f.calls[0].url.includes("time_increment=1"));
  const snap = await A.fetchInsights(cfg, "snap", { access: "A" }, { id: "SN1" }, { since: "2026-11-01", until: "2026-11-01" }, f);
  assert.deepEqual([snap[0].spend, snap[0].clicks, snap[0].signups, snap[0].campaign_name, snap[0].adset_name, snap[0].ad_name, snap[0].date], [25.5, 40, 3, "Snap camp", "Squad", "Snap ad", "2026-11-01"]); // micro-currency → units
  assert.equal(f.calls.find((c) => /stats/.test(c.url)).headers.Authorization, "Bearer A");
  const tt = await A.fetchInsights(cfg, "tiktok", { access: "T" }, { id: "ADV1" }, { since: "2026-11-01", until: "2026-11-01" }, f);
  assert.deepEqual([tt[0].channel, tt[0].spend, tt[0].signups, tt[0].purchases, tt[0].adset_id, tt[0].date], ["TikTok", 40, 2, 1, "TG1", "2026-11-01"]);
  assert.equal(f.calls.find((c) => /tiktok/.test(c.url)).headers["Access-Token"], "T");
  const g = await A.fetchInsights(cfg, "google", { access: "GT" }, { id: "123" }, { since: "2026-11-01", until: "2026-11-01" }, f);
  assert.deepEqual([g[0].spend, g[0].signups, g[0].channel], [15, 2.5, "Google"]);
  assert.equal(f.calls.at(-1).headers["developer-token"], "dev");
  // TikTok reports errors with HTTP 200 and a non-zero code.
  const bad = mockFetch([["GET", /tiktok/, () => ({ json: { code: 40001, message: "Access token invalid" } })]]);
  await assert.rejects(A.fetchInsights(cfg, "tiktok", { access: "T" }, { id: "ADV1" }, { since: "2026-11-01", until: "2026-11-01" }, bad), /Access token invalid/);
});

test("Paid Ads: CSV import from each Ads Manager, re-import replaces, API rows win over CSV for the same day", async () => {
  const { parseAdsInsightsCsv, effectiveRows } = await import("../lib/ads.js");
  const meta = parseAdsInsightsCsv("Day,Campaign name,Ad set name,Ad name,Amount spent (SAR),Impressions,Link clicks,Reach,Results\n2026-11-01,Riyadh fashion,Owners,Reel,\"1,200.50\",10000,150,8000,6\nTotal,,,,1200.5,10000,150,,6", { result: "signups" });
  assert.equal(meta.channel, "Meta"); assert.equal(meta.rows.length, 1);
  assert.deepEqual([meta.rows[0].spend, meta.rows[0].signups, meta.rows[0].clicks, meta.rows[0].adset_name, meta.rows[0].currency], [1200.5, 6, 150, "Owners", "SAR"]);
  const snap = parseAdsInsightsCsv("Date,Campaign Name,Ad Squad Name,Spend,Impressions,Swipe Ups,Sign Ups\n2026-11-01,Snap camp,Squad,50,4000,40,3", { currency: "USD" });
  assert.equal(snap.channel, "Snapchat"); assert.equal(snap.rows[0].signups, 3); assert.equal(snap.currency, "USD");
  const tt = parseAdsInsightsCsv("stat_time_day,Campaign name,Ad group name,Cost,Impressions,Clicks,Complete payment\n2026-11-01,TT,Group,40,9000,90,2");
  assert.equal(tt.channel, "TikTok"); assert.equal(tt.rows[0].purchases, 2);
  assert.match(parseAdsInsightsCsv("Campaign,Impressions\nX,10").error, /spend/);
  assert.match(parseAdsInsightsCsv("Name,Spend\nX,10").error, /Campaign name/);
  assert.deepEqual(effectiveRows([{ channel: "Meta", date: "2026-11-01", source: "csv" }, { channel: "Meta", date: "2026-11-01", source: "api" }, { channel: "Meta", date: "2026-11-02", source: "csv" }]).map((r) => r.source), ["api", "csv"]);

  const t = await adsApp();
  try {
    const csv = `Day,Campaign name,Ad set name,Ad name,Amount spent,Impressions,Link clicks,Results\n${isoDay(-1)},Riyadh fashion,Owners,Reel,100,10000,150,4`;
    const prev = await t.j(`${t.P}/import/parse`, { text: csv });
    assert.equal(prev.status, 200); assert.equal(prev.body.channel, "Meta"); assert.equal(prev.body.totals.spend, 100);
    const imp = await t.j(`${t.P}/import`, { text: csv });
    assert.equal(imp.status, 201); assert.equal(imp.body.added, 1);
    const again = await t.j(`${t.P}/import`, { text: csv.replace(",100,", ",120,") });
    assert.equal(again.body.added, 0); assert.equal(again.body.updated, 1);
    const ov = await t.j(t.P);
    assert.equal(ov.body.has_data, true);
    assert.equal(ov.body.trend.find((d) => d.date === isoDay(-1)).spend_sar, 120);
    // A USD file needs no typed rate (pegged at 3.75); EUR does.
    await t.j(`${t.P}/import`, { text: `Day,Campaign name,Amount spent,Impressions\n${isoDay(-1)},Euro camp,10,100`, channel: "TikTok", currency: "EUR" });
    assert.deepEqual((await t.j(t.P)).body.fx_missing, ["EUR"]);
    const batches = (await t.j(`${t.P}/accounts`)).body.batches;
    assert.equal(batches.length, 3);
    assert.equal((await t.j(`${t.P}/import/${batches[0].id}`, undefined, "DELETE")).status, 204);
    assert.deepEqual((await t.j(t.P)).body.fx_missing, []);
  } finally { t.close(); }
});

test("Paid Ads: pacing maths and the projected month-end", async () => {
  const { pacing, budgetPacing, adsSettings } = await import("../lib/ads.js");
  const on = pacing({ budget: 3000, spent: 1000, day: 10, days: 30 });
  assert.deepEqual([on.status, on.projected, on.expected, on.pct, on.daily_target], ["on_track", 3000, 1000, 33.3, 100]);
  const over = pacing({ budget: 3000, spent: 1500, day: 10, days: 30 });
  assert.deepEqual([over.status, over.projected, over.projected_pct], ["over", 4500, 150]);
  assert.equal(pacing({ budget: 3000, spent: 3000, day: 20, days: 30 }).status, "over"); // budget used up early
  assert.equal(pacing({ budget: 3000, spent: 500, day: 10, days: 30 }).status, "under");
  assert.equal(pacing({ budget: 3000, spent: 10, day: 1, days: 30 }).status, "on_track"); // too early to call "under"
  assert.equal(pacing({ budget: 3000, spent: 1050, day: 10, days: 30, tolerance: 10 }).status, "on_track"); // 5% over projection is inside 10%
  assert.equal(pacing({ budget: 0, spent: 100, day: 10, days: 30 }).status, "no_budget");
  // Real month: 10 Nov 2026 12:00 Riyadh, total budget from the channel budgets.
  const now = new Date("2026-11-10T09:00:00Z");
  const s = adsSettings({ ads: { budgets: { Meta: 3000, Snapchat: 0 } } });
  const rows = [{ channel: "Meta", date: "2026-11-05", spend_sar: 2000, signups: 4 }, { channel: "Meta", date: "2026-10-30", spend_sar: 900, signups: 1 }, { channel: "Snapchat", date: "2026-11-06", spend_sar: 300, signups: 1 }];
  const p = budgetPacing(rows, s, now);
  const m = p.channels.find((c) => c.channel === "Meta");
  assert.equal(p.month, "2026-11"); assert.equal(m.spent, 2000); assert.equal(m.status, "over"); assert.equal(m.results, 4);
  assert.equal(Math.round(m.projected), Math.round((2000 / 9.5) * 30));
  assert.equal(p.channels.find((c) => c.channel === "Snapchat").status, "no_budget");
  assert.equal(p.total.budget, 3000); assert.equal(p.total.spent, 2300);
});

test("Paid Ads: guardrails log in Test mode, need a person at level 1, act at level 2 in Live", async () => {
  const { evaluateRules, saveRows } = await import("../lib/ads.js");
  const y = isoDay(-1);
  const rows = [
    { channel: "Meta", source: "api", account_id: "act_1", date: y, campaign_id: "C1", campaign_name: "C", adset_id: "S1", adset_name: "No results", spend_sar: 400, impressions: 1000, clicks: 10, signups: 0 },
    { channel: "Meta", source: "api", account_id: "act_1", date: y, campaign_id: "C1", campaign_name: "C", adset_id: "S2", adset_name: "Working", spend_sar: 400, impressions: 1000, clicks: 10, signups: 8 },
    { channel: "Meta", source: "csv", date: y, campaign_id: "csv:c", campaign_name: "C", adset_id: "csv:s3", adset_name: "From CSV", spend_sar: 500, signups: 0 },
  ];
  const rules = [{ id: "r1", name: "No results", kind: "pause_cpa", channel: "all", max_cpa_sar: null, min_spend_sar: 300, window_days: 7, enabled: true },
    { id: "r2", name: "CPA", kind: "pause_cpa", channel: "Meta", max_cpa_sar: 40, min_spend_sar: 200, window_days: 7, enabled: true },
    { id: "r3", name: "Cap", kind: "cap_daily", channel: "all", cap_sar: 450, enabled: true }, { id: "r4", kind: "cap_daily", cap_sar: 1, enabled: false }];
  const test1 = evaluateRules({ rules, rows, mode: "test", level: 2 });
  assert.ok(test1.every((a) => a.decision === "logged"));
  assert.deepEqual(test1.filter((a) => a.rule_id === "r1").map((a) => a.adset_name).sort(), ["From CSV", "No results"]);
  assert.deepEqual(test1.filter((a) => a.rule_id === "r2").map((a) => a.adset_name).sort(), ["From CSV", "No results", "Working"]); // Working: 400 / 8 = SAR 50 per signup > 40
  assert.equal(evaluateRules({ rules: [{ ...rules[1], max_cpa_sar: 60 }], rows: [rows[1]], mode: "test" }).length, 0);
  assert.deepEqual(test1.filter((a) => a.rule_id === "r3").map((a) => [a.adset_name, a.value_sar]), [["From CSV", 450]]);
  const live1 = evaluateRules({ rules: [rules[0]], rows, mode: "live", level: 1 });
  assert.ok(live1.length === 2 && live1.every((a) => a.decision === "needs_person"));
  const live2 = evaluateRules({ rules: [rules[0]], rows, mode: "live", level: 2 });
  assert.equal(live2.find((a) => a.adset_id === "S1").decision, "apply");
  assert.equal(live2.find((a) => a.adset_id === "csv:s3").decision, "needs_person"); // nothing to act on through the API
  assert.equal(evaluateRules({ rules: [rules[0]], rows, mode: "live", level: 2, done: (k) => k.includes("S1") }).length, 1); // no repeats

  // Through the app: Live + level 2 pauses through the Meta API; level 1 leaves a "needs a person" item.
  const t = await adsApp({ routes: [["POST", /graph\.facebook\.com\/v[\d.]+\/S1$/, () => ({ json: { success: true } })]] });
  try {
    connectAds(t.ads, t.w.id, "meta", { id: "act_1", name: "DPA AD", currency: "SAR", timezone: "Asia/Riyadh", status: "active", active: true });
    saveRows(t.st, t.w.id, rows.slice(0, 1).map((r) => ({ ...r, currency: "SAR", spend: 400 })), { source: "api" });
    const rl = (await t.j(`${t.P}/rules`)).body; // seeds the starter rules
    assert.equal(rl.rules.length, 3); assert.equal(rl.rules.filter((r) => r.enabled).length, 1); assert.equal(rl.pacer_level, 1);
    const tm = (await t.j(`${t.P}/rules/evaluate`, {})).body;
    assert.equal(tm.logged, 1); assert.equal(t.fetchImpl.calls.length, 0); // Test mode: nothing sent
    t.st.db.ads_actions.length = 0;
    await t.j(`${t.P}/settings`, { mode: "live" }, "PUT");
    const l1 = (await t.j(`${t.P}/rules/evaluate`, {})).body;
    assert.equal(l1.needs_person, 1); assert.equal(t.fetchImpl.calls.length, 0);
    const cmd = await t.j(`/api/workspaces/${t.w.id}/command`);
    assert.ok(cmd.body.needs.some((n) => n.module === "Paid Ads" && /Guardrail/.test(n.text)));
    const open = (await t.j(`${t.P}/rules`)).body.actions.find((a) => a.status === "open");
    const ap = await t.j(`${t.P}/actions/${open.id}/apply`, {});
    assert.equal(ap.status, 200); assert.equal(ap.body.status, "done");
    assert.match(t.fetchImpl.calls[0].body, /status=PAUSED/);
    t.st.db.ads_actions.length = 0;
    await t.j("/api/workforce/agents/ads_pacer", { level: 2 }, "PUT");
    const l2 = (await t.j(`${t.P}/rules/evaluate`, {})).body;
    assert.equal(l2.applied, 1); assert.equal(t.fetchImpl.calls.length, 2);
    const ev = (await t.j("/api/workforce/agents/ads_pacer")).body.events;
    assert.ok(ev.some((e) => e.outcome === "auto")); assert.ok(ev.some((e) => e.outcome === "accepted"));
    assert.equal((await t.j(`${t.P}/rules/evaluate`, {})).body.applied, 0); // not again within 7 days
  } finally { t.close(); }
});

test("Paid Ads: UTM builder and parsing", async () => {
  const { buildUtmUrl, parseUtm, channelFromSource, slug } = await import("../lib/ads.js");
  const r = buildUtmUrl("https://dpa.ad/start?ref=x&utm_source=old", { source: "Meta", medium: "paid_social", campaign: "Riyadh Fashion Nov", content: "Reel 1" });
  assert.equal(r.url, "https://dpa.ad/start?ref=x&utm_source=meta&utm_medium=paid_social&utm_campaign=riyadh-fashion-nov&utm_content=reel-1");
  assert.deepEqual(parseUtm(r.url), { source: "meta", medium: "paid_social", campaign: "riyadh-fashion-nov", content: "reel-1" });
  assert.match(buildUtmUrl("dpa.ad", { source: "meta", campaign: "x" }).error, /https/);
  assert.match(buildUtmUrl("https://dpa.ad", { source: "meta" }).error, /campaign/);
  assert.equal(parseUtm("https://dpa.ad/"), null);
  assert.deepEqual(["facebook", "ig", "snapchat", "TikTok", "google", "newsletter"].map(channelFromSource), ["Meta", "Meta", "Snapchat", "TikTok", "Google", null]);
  assert.equal(slug("عروض رمضان 2027"), "عروض-رمضان-2027");
  const t = await adsApp();
  try {
    const u = await t.j(`${t.P}/utm`, { channel: "Snapchat", campaign: "Jeddah beauty", save: true, label: "Snap story" });
    assert.equal(u.status, 200);
    assert.equal(u.body.url, "https://dpa.ad/?utm_source=snapchat&utm_medium=paid_social&utm_campaign=jeddah-beauty");
    assert.equal((await t.j(`${t.P}/links`)).body.length, 1);
  } finally { t.close(); }
});

test("Paid Ads: attribution matches CRM stores and Sales deals by UTM to cost per lead, trial and paying store", async () => {
  const { attribution } = await import("../lib/ads.js");
  const month = isoDay(0).slice(0, 7), at = `${month}-02T10:00:00Z`;
  const contacts = [
    { id: "c1", store_name: "Abaya One", stage: "engaged", created_at: at, utm: { source: "meta", campaign: "riyadh-fashion" } },
    { id: "c2", store_name: "Oud Two", stage: "onboarding", created_at: at, landing_url: "https://dpa.ad/?utm_source=facebook&utm_campaign=riyadh-fashion" },
    { id: "c3", store_name: "Linked", stage: "qualified", created_at: at, deal_id: "d1", utm: { source: "snapchat", campaign: "snap-camp" } },
    { id: "c4", store_name: "No UTM", stage: "engaged", created_at: at },
  ];
  const deals = [{ id: "d1", name: "Linked", stage: "paying", created_at: at }, { id: "d2", name: "Deal only", stage: "trial", created_at: at, utm: { source: "tiktok", campaign: "tt" } }, { id: "d3", name: "Old", stage: "paying", created_at: "2020-01-01T00:00:00Z", utm: { source: "meta" } }];
  const rows = [{ channel: "Meta", date: `${month}-02`, campaign_id: "C1", campaign_name: "Riyadh Fashion", spend_sar: 600, signups: 2 }, { channel: "Snapchat", date: `${month}-02`, campaign_id: "S1", campaign_name: "Snap camp", spend_sar: 300, signups: 1 }];
  const a = attribution({ contacts, deals, rows, month });
  const meta = a.channels.find((c) => c.channel === "Meta"), snap = a.channels.find((c) => c.channel === "Snapchat"), tt = a.channels.find((c) => c.channel === "TikTok");
  assert.deepEqual([meta.leads, meta.trials, meta.paying, meta.cost_per_lead, meta.cost_per_trial, meta.cost_per_paying], [2, 1, 0, 300, 600, null]);
  assert.deepEqual([snap.leads, snap.trials, snap.paying, snap.cost_per_paying], [1, 1, 1, 300]); // the deal counts once, with its CRM store
  assert.deepEqual([tt.leads, tt.trials, tt.spend_sar, tt.cost_per_lead], [1, 1, 0, 0]);
  assert.equal(a.total.leads, 4);
  assert.equal(a.campaigns.find((c) => c.campaign_name === "Riyadh Fashion").leads, 2);
  assert.ok(a.unmatched.some((u) => u.name === "Deal only"));

  // The lead hook stores the UTM on the CRM store; a person can set it on a deal; both feed the report.
  const t = await adsApp();
  try {
    assert.equal((await fetch(`${t.b}/hooks/ads/lead/wrong-secret-xx`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status, 403);
    const lead = await fetch(`${t.b}/hooks/ads/lead/lead-secret-123`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ store_name: "Hook Store", email: "owner@hook.sa", url: "https://dpa.ad/?utm_source=tiktok&utm_medium=paid_social&utm_campaign=tt-nov", signup: true }) });
    assert.equal(lead.status, 201);
    const c = t.app.locals.crm.contacts(t.w.id).find((x) => x.email === "owner@hook.sa");
    assert.deepEqual([c.utm.source, c.utm.campaign, c.stage, c.tags.includes("ads")], ["tiktok", "tt-nov", "onboarding", true]);
    const d = t.st.addDeal(t.w.id, { name: "Manual deal", stage: "paying" });
    assert.equal((await t.j(`${t.P}/attribution/deals/${d.id}`, { url: "https://dpa.ad/?utm_source=ig&utm_campaign=x" }, "PUT")).status, 200);
    const rep = (await t.j(`${t.P}/attribution`)).body;
    assert.equal(rep.channels.find((x) => x.channel === "TikTok").trials, 1);
    assert.equal(rep.channels.find((x) => x.channel === "Meta").paying, 1);
  } finally { t.close(); }
});

test("Paid Ads: ad spend goes to Finance as monthly marketing expenses per channel, without duplicates", async () => {
  const t = await adsApp();
  try {
    const m = isoDay(0).slice(0, 7);
    const csv = `Day,Campaign name,Amount spent,Impressions\n${m}-01,A,100,10\n${m}-02,A,50,10`;
    await t.j(`${t.P}/import`, { text: csv, channel: "Meta" });
    await t.j(`${t.P}/import`, { text: `Day,Campaign name,Spend,Impressions\n${m}-01,S,40,10`, channel: "Snapchat", currency: "USD" });
    const ads = () => t.st.listExpenses(t.w.id).filter((e) => e.source === "ads");
    assert.deepEqual(ads().map((e) => [e.vendor, e.amount_sar, e.category, e.date]).sort(), [["Meta Ads", 150, "marketing", `${m}-01`], ["Snapchat Ads", 150, "marketing", `${m}-01`]]);
    await t.j(`${t.P}/import`, { text: csv, channel: "Meta" }); // same file again
    assert.deepEqual((await t.j(`${t.P}/finance/sync`, {})).body, { added: 0, updated: 0, removed: 0 });
    assert.equal(ads().length, 2);
    await t.j(`${t.P}/import`, { text: csv.replace(",50,", ",70,"), channel: "Meta" });
    assert.equal(ads().find((e) => e.vendor === "Meta Ads").amount_sar, 170);
    const fin = (await t.j(`/api/workspaces/${t.w.id}/finance`)).body;
    assert.ok(JSON.stringify(fin).includes("Meta Ads"));
    const batch = (await t.j(`${t.P}/accounts`)).body.batches.find((b) => b.channel === "Snapchat");
    await t.j(`${t.P}/import/${batch.id}`, undefined, "DELETE");
    assert.deepEqual(ads().map((e) => e.vendor), ["Meta Ads"]);
  } finally { t.close(); }
});

test("Paid Ads: plans are drafted, approved by a person, created PAUSED (payloads mocked), activated only by an approver", async () => {
  const planJson = { name: "Riyadh fashion trials", summary: "s", campaigns: [{ channel: "Meta", name: "Riyadh fashion Nov", objective: "signups", budget_pct: 75, schedule: { days: "Sat-Thu", hours: "19:00-01:00" }, placements: ["Instagram Reels"],
    ad_sets: [{ name: "Owners", budget_pct: 60, audience: { summary: "Salla owners", cities: ["Riyadh"], age_min: 24, age_max: 50, interests: ["Salla"], job_titles: ["Business Owner"] } }, { name: "Marketers", budget_pct: 40, audience: { interests: ["Digital marketing"] } }],
    ads: [{ name: "Reel", creative_item_id: "", adset_index: 0, primary_text_ar: "إعلانات مصممة لمتجرك", headline_ar: "جرّب مجاناً", cta: "SIGN_UP" }] },
    { channel: "TikTok", name: "TT Nov", budget_pct: 25, ad_sets: [{ name: "All", budget_pct: 100, audience: {} }], ads: [] }, { channel: "X", name: "not allowed" }] };
  const prov = { name: "fake", model: "fake", async generate({ prompt }) { if (prompt.includes("AI Media buyer")) return "Here:\n" + JSON.stringify(planJson); return "{}"; } };
  const routes = [
    ["GET", /\/search\?/, (u) => ({ json: { data: [{ id: u.includes("adworkposition") ? "W1" : "I1", name: "x" }] } })],
    ["POST", /\/act_1\/campaigns$/, () => ({ json: { id: "MC1" } })],
    ["POST", /\/act_1\/adsets$/, (u, o, n) => ({ json: { id: `MS${n}` } })],
    ["POST", /\/act_1\/adcreatives$/, () => ({ json: { id: "CR1" } })],
    ["POST", /\/act_1\/ads$/, () => ({ json: { id: "MA1" } })],
    ["POST", /business-api\.tiktok\.com\/open_api\/v1\.3\/campaign\/create/, () => ({ json: { code: 0, data: { campaign_id: "TC9" } } })],
    ["POST", /business-api\.tiktok\.com\/open_api\/v1\.3\/adgroup\/create/, () => ({ json: { code: 0, data: { adgroup_id: "TG9" } } })],
    ["POST", /graph\.facebook\.com\/v[\d.]+\/M[CSA]\d$/, () => ({ json: { success: true } })],
  ];
  const t = await adsApp({ routes, provider: prov });
  try {
    // An approved Studio item with an image, so the Meta ad gets a creative.
    const media = t.st.addOps("creative_media", t.w.id, { file: "abc.png", kind: "image", ext: "png", name: "reel cover" });
    const item = t.st.addOps("creative_items", t.w.id, { title: "Before/after reel", status: "approved", channels: ["ig_reel"], variants: { ig_reel: { caption_ar: "قبل وبعد", media: [media.id] } }, comments: [], history: [], published: {} });
    planJson.campaigns[0].ads[0].creative_item_id = item.id;
    assert.equal((await t.j(`${t.P}/plans`, { goal: "x", budget_sar: 0, channels: ["Meta"] })).status, 422);
    const start = isoDay(1), end = isoDay(10);
    const r = await t.j(`${t.P}/plans`, { goal: "20 trials from Riyadh fashion stores", budget_sar: 8000, channels: ["Meta", "TikTok"], start_date: start, end_date: end });
    assert.equal(r.status, 201);
    const p = r.body;
    assert.equal(p.status, "draft"); assert.equal(p.campaigns.length, 2); // X dropped
    const mc = p.campaigns[0];
    assert.equal(mc.budget_sar, 6000); assert.equal(p.campaigns[1].budget_sar, 2000); // from the person's budget
    assert.equal(mc.ad_sets[0].daily_budget_sar, 360); // 6000 × 60% / 10 days
    assert.match(mc.ads[0].name, new RegExp(`\\[cs:${item.id}\\]$`));
    assert.equal(mc.ads[0].link, "https://dpa.ad/?utm_source=meta&utm_medium=paid_social&utm_campaign=riyadh-fashion-nov&utm_content=reel");
    assert.ok(t.st.db.agent_runs.some((x) => x.agent_id === "ads_media_buyer"));
    // A member (view) can't approve or create; a team lead can approve.
    const member = await t.userAs("member", "member@dpa.ad");
    assert.equal(await member(`${t.P}/plans/${p.id}/approve`, {}), 403);
    assert.equal(await member(`${t.P}/plans`), 200);
    const lead = await t.userAs("manager", "lead@dpa.ad");
    assert.equal(await lead(`${t.P}/plans/${p.id}/approve`, {}), 200);
    // Test mode: the exact payloads are stored, nothing is sent, all PAUSED / DISABLE.
    const tm = (await t.j(`${t.P}/plans/${p.id}/create`, {})).body;
    assert.equal(t.fetchImpl.calls.length, 0);
    const pl = tm.campaigns[0].platform.payloads;
    assert.equal(pl.campaign.status, "PAUSED"); assert.ok(pl.adsets.every((s) => s.status === "PAUSED")); assert.ok(pl.ads.every((a) => a.status === "PAUSED"));
    assert.equal(pl.adsets[0].daily_budget, 36000); // SAR 360 in halalas
    assert.equal(tm.campaigns[1].platform.payloads.campaign.operation_status, "DISABLE");
    assert.equal(tm.status, "approved");
    // Live: Meta and TikTok calls, campaign created paused, never activated.
    connectAds(t.ads, t.w.id, "meta", { id: "act_1", name: "DPA AD", currency: "SAR", timezone: "Asia/Riyadh", status: "active", active: true });
    connectAds(t.ads, t.w.id, "tiktok", { id: "ADV1", name: "DPA AD TT", currency: "USD", timezone: "Asia/Riyadh", status: "enable", active: true });
    await t.j(`${t.P}/settings`, { mode: "live", meta_page_id: "PG1", meta_pixel_id: "PX1" }, "PUT");
    const lv = (await t.j(`${t.P}/plans/${p.id}/create`, {})).body;
    assert.equal(lv.status, "created");
    assert.deepEqual([lv.campaigns[0].platform.campaign_id, lv.campaigns[0].platform.adset_ids, lv.campaigns[0].platform.ad_ids, lv.campaigns[0].platform.status], ["MC1", ["MS1", "MS2"], ["MA1"], "PAUSED"]);
    const sent = t.fetchImpl.calls.filter((c) => c.method === "POST").map((c) => ({ url: c.url, body: c.body }));
    const camp = new URLSearchParams(sent.find((c) => /act_1\/campaigns$/.test(c.url)).body);
    assert.equal(camp.get("status"), "PAUSED"); assert.equal(camp.get("objective"), "OUTCOME_LEADS");
    const set1 = new URLSearchParams(sent.find((c) => /act_1\/adsets$/.test(c.url)).body);
    assert.equal(set1.get("status"), "PAUSED"); assert.equal(set1.get("campaign_id"), "MC1"); assert.equal(set1.get("daily_budget"), "36000");
    assert.deepEqual(JSON.parse(set1.get("promoted_object")), { pixel_id: "PX1", custom_event_type: "COMPLETE_REGISTRATION" });
    assert.deepEqual(JSON.parse(set1.get("targeting")).flexible_spec, [{ interests: [{ id: "I1", name: "Salla" }], work_positions: [{ id: "W1", name: "Business Owner" }] }]);
    const cr = JSON.parse(new URLSearchParams(sent.find((c) => /adcreatives$/.test(c.url)).body).get("object_story_spec"));
    assert.equal(cr.page_id, "PG1"); assert.equal(cr.link_data.picture, "https://wiz.test/media/abc.png"); assert.equal(cr.link_data.message, "إعلانات مصممة لمتجرك");
    assert.equal(new URLSearchParams(sent.find((c) => /act_1\/ads$/.test(c.url)).body).get("status"), "PAUSED");
    const ttc = JSON.parse(sent.find((c) => /campaign\/create/.test(c.url)).body);
    assert.equal(ttc.operation_status, "DISABLE"); assert.equal(ttc.advertiser_id, "ADV1");
    assert.equal(JSON.parse(sent.find((c) => /adgroup\/create/.test(c.url)).body).budget, 53.33); // SAR 2000 / 10 days / 3.75
    assert.ok(!sent.some((c) => /ACTIVE|ENABLE/.test(c.body || "")), "nothing activated automatically");
    // Activate: approver only, explicit confirm.
    assert.equal(await member(`${t.P}/plans/${p.id}/activate`, { confirm: true }), 403);
    assert.equal((await t.j(`${t.P}/plans/${p.id}/activate`, {})).status, 422);
    const act = (await t.j(`${t.P}/plans/${p.id}/activate`, { confirm: true, channel: "Meta" })).body;
    assert.equal(act.status, "active"); assert.equal(act.campaigns[0].platform.status, "ACTIVE"); assert.equal(act.campaigns[1].platform.status, "PAUSED"); // only the channel asked for
    assert.ok(t.fetchImpl.calls.some((c) => /MC1$/.test(c.url) && /status=ACTIVE/.test(c.body)));
    // Outcome: approved unchanged → accepted.
    const ev = (await t.j("/api/workforce/agents/ads_media_buyer")).body.events;
    assert.equal(ev[0].outcome, "accepted");
  } finally { t.close(); }
});

test("Paid Ads: plan outcomes (edited, rejected), the starter plan without AI, and creative rotation into Studio ideas", async () => {
  const t = await adsApp();
  try {
    const p = (await t.j(`${t.P}/plans`, { goal: "Trials", budget_sar: 3000, channels: ["Meta", "Snapchat"] })).body;
    assert.equal(p.by_ai, false); assert.match(p.note, /starter structure/); assert.equal(p.campaigns.length, 2);
    assert.equal((await t.j(`${t.P}/plans/${p.id}/approve`, {})).status, 422); // [ADD] left in
  } finally { t.close(); }
  const ai = { name: "fake", model: "fake", async generate({ prompt }) {
    if (prompt.includes("AI Media buyer")) return JSON.stringify({ name: "P", campaigns: [{ channel: "Meta", name: "M", budget_pct: 100, ad_sets: [{ name: "A", budget_pct: 100, audience: {} }], ads: [{ name: "Ad", primary_text_ar: "نص", headline_ar: "عنوان" }] }] });
    if (prompt.includes("AI Creative rotator")) return JSON.stringify({ ideas: [{ title: "New hook reel", brief: "b", why: "w" }] });
    return "{}";
  } };
  const t2 = await adsApp({ provider: ai });
  try {
    const a = (await t2.j(`${t2.P}/plans`, { goal: "g", budget_sar: 1000, channels: ["Meta"] })).body;
    const edited = { ...a, campaigns: a.campaigns.map((c) => ({ ...c, ads: c.ads.map((x) => ({ ...x, headline_ar: "عنوان جديد" })) })) };
    assert.equal((await t2.j(`${t2.P}/plans/${a.id}`, edited, "PUT")).status, 200);
    assert.equal((await t2.j(`${t2.P}/plans/${a.id}/approve`, {})).status, 200);
    const b = (await t2.j(`${t2.P}/plans`, { goal: "g2", budget_sar: 1000, channels: ["Meta"] })).body;
    assert.equal((await t2.j(`${t2.P}/plans/${b.id}/reject`, { reason: "wrong audience" })).status, 200);
    const ev = (await t2.j("/api/workforce/agents/ads_media_buyer")).body.events.map((e) => e.outcome);
    assert.deepEqual(ev.slice(0, 2), ["rejected", "edited"]);
    // Creative rotation: fatigue = frequency up and CTR down week on week; ranked by cost per result.
    const { saveRows } = await import("../lib/ads.js");
    const item = t2.st.addOps("creative_items", t2.w.id, { title: "Winner reel", status: "published", channels: [], variants: {}, comments: [], history: [], published: {} });
    const rows = [];
    for (let k = 1; k <= 14; k++) {
      const recent = k <= 7;
      rows.push({ channel: "Meta", date: isoDay(-k), currency: "SAR", campaign_id: "C", campaign_name: "C", adset_id: "S", adset_name: "S", ad_id: "A1", ad_name: `Tired [cs:${item.id}]`, spend: 50, impressions: 2000, clicks: recent ? 10 : 30, reach: recent ? 800 : 1500, signups: 1 });
      rows.push({ channel: "Meta", date: isoDay(-k), currency: "SAR", campaign_id: "C", campaign_name: "C", adset_id: "S", adset_name: "S", ad_id: "A2", ad_name: "Fresh", spend: 50, impressions: 2000, clicks: 30, reach: 1500, signups: 0 });
    }
    saveRows(t2.st, t2.w.id, rows, { source: "api" });
    const cr = (await t2.j(`${t2.P}/creatives`)).body;
    assert.deepEqual(cr.fatigued.map((x) => x.ad_id), ["A1"]);
    assert.equal(cr.ads[0].ad_id, "A1"); // has a cost per result; A2 has none
    assert.equal(cr.studio[0].title, "Winner reel");
    assert.ok(cr.suggestions.some((s) => s.key.startsWith("fatigue:")));
    const sug = (await t2.j(`${t2.P}/creatives/suggest`, {})).body;
    const aiIdea = sug.suggestions.find((s) => s.key.startsWith("ai:"));
    assert.equal(aiIdea.title, "New hook reel");
    const idea = await t2.j(`${t2.P}/creatives/ideas`, aiIdea);
    assert.equal(idea.status, 201); assert.equal(idea.body.status, "idea"); assert.equal(idea.body.source, "ads_rotator");
    assert.ok(!(await t2.j(`${t2.P}/creatives`)).body.suggestions.some((s) => s.key === aiIdea.key));
    await t2.j(`${t2.P}/creatives/dismiss`, { key: cr.suggestions[0].key });
    const rev = (await t2.j("/api/workforce/agents/ads_rotator")).body.events.map((e) => e.outcome);
    assert.deepEqual(rev.slice(0, 2), ["rejected", "accepted"]);
  } finally { t2.close(); }
});

test("Paid Ads: permissions per role, approver-only budgets and Live mode, OAuth with sealed tokens", async () => {
  const { MODULES, DEFAULT_ROLES, moduleFor } = await import("../lib/access.js");
  assert.ok(MODULES.some((m) => m.id === "ads" && m.name === "Paid Ads"));
  assert.equal(moduleFor("GET", "/api/workspaces/1/ads/plans"), "ads");
  assert.deepEqual(Object.fromEntries(DEFAULT_ROLES.map((r) => [r.id, r.perms.ads])), { owner: "edit", admin: "edit", manager: "edit", member: "view", finance: "view", creative: "view", viewer: "view" });
  const t = await adsApp({ routes: [
    ["GET", /oauth\/access_token\?client_id=/, () => ({ json: { access_token: "SHORT" } })],
    ["GET", /oauth\/access_token\?grant_type=fb_exchange_token/, () => ({ json: { access_token: "LONG-USER", expires_in: 5184000 } })],
    ["GET", /\/me\?fields=id%2Cname/, () => ({ json: { id: "U1", name: "Founder" } })],
    ["GET", /\/me\/permissions/, () => ({ json: { data: [{ permission: "ads_read", status: "granted" }, { permission: "ads_management", status: "granted" }] } })],
    ["GET", /\/me\/adaccounts/, () => ({ json: { data: [{ id: "act_8", name: "Old", currency: "SAR", account_status: 2 }, { id: "act_9", name: "DPA AD", currency: "USD", timezone_name: "Asia/Riyadh", account_status: 1 }] } })],
  ] });
  try {
    for (const role of ["member", "creative", "finance", "viewer"]) {
      const as = await t.userAs(role, `${role}@dpa.ad`);
      assert.equal(await as(t.P), 200, role);
      assert.equal(await as(`${t.P}/utm`, { campaign: "x", channel: "Meta" }), 403, role);
    }
    const lead = await t.userAs("manager", "lead2@dpa.ad");
    assert.equal(await lead(`${t.P}/settings`, { budgets: { Meta: 5000 } }, "PUT"), 200);
    // A custom role with Edit on Paid Ads but not an approver: can work, can't change budgets, rules or go Live.
    const role = (await t.j("/api/admin/roles", { name: "Ads editor", perms: { ads: "edit", command: "view" } })).body;
    await t.j("/api/admin/users", { name: "Editor", email: "ed@dpa.ad", password: "ads-pass-123", role_id: role.id });
    const edCk = (await fetch(t.b + "/login", { method: "POST", redirect: "manual", body: new URLSearchParams({ email: "ed@dpa.ad", password: "ads-pass-123" }) })).headers.get("set-cookie").split(";")[0];
    const ed = async (p, body, method) => (await fetch(t.b + p, { method: method || "POST", headers: { "Content-Type": "application/json", cookie: edCk }, body: JSON.stringify(body) })).status;
    assert.equal(await ed(`${t.P}/settings`, { budgets: { Meta: 1 } }, "PUT"), 403);
    assert.equal(await ed(`${t.P}/settings`, { mode: "live" }, "PUT"), 403);
    assert.equal(await ed(`${t.P}/settings`, { meta_pixel_id: "PX" }, "PUT"), 200);
    assert.equal(await ed(`${t.P}/rules`, { kind: "cap_daily", cap_sar: 100 }), 403);
    assert.equal(await ed(`${t.P}/utm`, { campaign: "x", channel: "Meta" }), 200);
    assert.equal((await t.j(`${t.P}/settings`, {}, "PUT")).body.budgets.Meta, 5000);

    // OAuth: start redirects to Meta with the ads scopes; the callback stores a sealed token and lists ad accounts.
    const st = await t.req(`/oauth/ads/meta/start?ws=${t.w.id}`);
    assert.equal(st.status, 302);
    const loc = new URL(st.headers.get("location"));
    assert.equal(loc.searchParams.get("scope"), "ads_read,ads_management,business_management");
    assert.equal(loc.searchParams.get("redirect_uri"), "https://wiz.test/oauth/ads/meta/callback");
    const nonce = /mwiz_ads_oauth=([^;]+)/.exec(st.headers.get("set-cookie"))[1];
    const cb = await t.req(`/oauth/ads/meta/callback?code=C&state=${encodeURIComponent(loc.searchParams.get("state"))}`, { headers: { cookie: `${t.ck}; mwiz_ads_oauth=${nonce}` } });
    assert.equal(cb.status, 302); assert.match(cb.headers.get("location"), /\/ads\/accounts$/);
    assert.equal((await t.req("/oauth/ads/meta/callback?code=C&state=bad")).status, 403);
    const acc = (await t.j(`${t.P}/accounts`)).body;
    const meta = acc.platforms.find((x) => x.id === "meta");
    assert.equal(meta.connection.account.id, "act_9"); // the active one is picked
    assert.deepEqual(meta.connection.accounts.map((a) => [a.currency, a.timezone, a.status]), [["SAR", "", "disabled"], ["USD", "Asia/Riyadh", "active"]]);
    assert.deepEqual(meta.connection.missing_scopes, ["business_management"]);
    assert.equal(meta.review_done, false);
    assert.match(acc.notice.text, /Meta connected: 2 ad accounts/);
    assert.ok(!JSON.stringify(acc).includes("LONG-USER")); assert.ok(!JSON.stringify(t.st.db.ads_accounts).includes("LONG-USER")); // sealed at rest
    assert.ok(!acc.platforms.some((x) => x.id === "google")); // behind ADS_GOOGLE=1
    assert.equal((await t.req(`/oauth/ads/google/start?ws=${t.w.id}`)).status, 404);
    assert.equal((await t.j(t.P)).body.mode, "test"); // Test mode by default
  } finally { t.close(); }
});

test("Paid Ads: Meta reuses Creative Studio's login when it has the ads permissions; scheduled pulls only in Live", async () => {
  const t = await adsApp({ routes: [
    ["GET", /\/me\?fields=id%2Cname/, () => ({ json: { id: "U1", name: "Founder" } })],
    ["GET", /\/me\/permissions/, (u) => ({ json: { data: u.includes("NO-ADS") ? [{ permission: "pages_show_list", status: "granted" }] : [{ permission: "ads_read", status: "granted" }] } })],
    ["GET", /\/me\/adaccounts/, () => ({ json: { data: [{ id: "act_5", name: "DPA AD", currency: "SAR", timezone_name: "Asia/Riyadh", account_status: 1 }] } })],
    ["GET", /act_5\/insights/, () => ({ json: { data: [{ date_start: isoDay(-1), campaign_id: "C", campaign_name: "C", adset_id: "S", adset_name: "S", ad_id: "A", ad_name: "A", spend: "10", impressions: "100", clicks: "1", actions: [] }] } })],
  ] });
  try {
    assert.equal((await t.j(`${t.P}/accounts/meta/reuse`, {})).status, 422); // no Studio login yet
    const studio = t.app.locals.studio;
    studio.saveAccount(t.w.id, "meta", { name: "DPA AD", tokens: { user: "NO-ADS", pages: {} }, targets: [{ id: "P1", page_id: "P1", page_name: "DPA AD", ig_id: "" }], selected: "P1", scopes: [] }, "test");
    assert.match((await t.j(`${t.P}/accounts/meta/reuse`, {})).body.detail, /doesn't include ads permissions/);
    studio.saveAccount(t.w.id, "meta", { name: "DPA AD", tokens: { user: "WITH-ADS", pages: {} }, targets: [{ id: "P1", page_id: "P1", page_name: "DPA AD", ig_id: "" }], selected: "P1", scopes: [] }, "test");
    const r = await t.j(`${t.P}/accounts/meta/reuse`, {});
    assert.equal(r.status, 200); assert.equal(r.body.via, "studio"); assert.equal(r.body.account.id, "act_5");
    assert.deepEqual(await t.ads.pullAll(), []); // Test mode: the 6-hour schedule pulls nothing
    assert.equal((await t.j(`${t.P}/pull`, {})).body.pulled[0].added, 1); // a person can still pull (read-only)
    await t.j(`${t.P}/settings`, { mode: "live" }, "PUT");
    const all = await t.ads.pullAll();
    assert.equal(all.length, 1); assert.equal(all[0].pulled[0].updated, 1);
    assert.equal(t.st.listExpenses(t.w.id).filter((e) => e.source === "ads").length, 1);
  } finally { t.close(); }
});

// ---------------------------------------------------------------- Customer Success
async function successKit() {
  const { createBilling } = await import("../lib/billing.js");
  const { createSuccess } = await import("../lib/success.js");
  const { CrmStore } = await import("../lib/crmstore.js");
  const { createMoyasar } = await import("../lib/moyasar.js");
  const { createZatca } = await import("../lib/zatca.js");
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "mwiz-sx-")), st = new Store(d), crm = new CrmStore(path.join(d, "crm"));
  const fetchImpl = async () => { throw new Error("no network in tests"); };
  const clock = { t: new Date("2026-11-03T07:00:00Z") }; // Tuesday, 10:00 in Riyadh
  const b = createBilling({ store: st, crm, gateway: createMoyasar({ cfg: { secret: "", webhook_secret: "", ready: false, public_url: "" }, fetchImpl }),
    zatca: createZatca({ cfg: { env: "sandbox", csid: "", secret: "", signing_ready: false }, fetchImpl }), log: { error() {} }, now: () => clock.t });
  const sent = [];
  const outreach = { cfg: { public_url: "https://wiz.test" }, sendOne: async (ws, c, m) => { sent.push({ c, m }); return { id: "m" + sent.length, status: "sent" }; } };
  const s = createSuccess({ store: st, billing: b, crm, outreach, now: () => clock.t, log: { error() {} } });
  const w = st.listWorkspaces()[0];
  return { b, s, st, crm, w, clock, sent, at: (iso) => { clock.t = new Date(iso); }, done: () => { crm.flush(); fs.rmSync(d, { recursive: true, force: true }); } };
}

test("success: daily health snapshot (one row per customer per day, five parts) and the health-drop trend", async () => {
  const k = await successKit();
  try {
    const c = k.b.addCustomer(k.w, { store_name: "Snap Co", plan: "Growth", status: "active", start_date: "2026-10-01", already_billed: true });
    k.s.runWorkspace(k.w); k.s.runWorkspace(k.w); // safe to repeat the same day
    let snaps = k.s.snapsOf(k.w, c.id);
    assert.equal(snaps.length, 1); assert.equal(snaps[0].date, "2026-11-03");
    assert.deepEqual(Object.keys(snaps[0].parts).sort(), ["activity", "onboarding", "payment", "tickets", "usage"]);
    assert.equal(snaps[0].score, k.b.health(k.w, c, "2026-11-03").score);
    assert.equal(snaps[0].score, Object.values(snaps[0].parts).reduce((a, x) => a + x, 0));
    k.at("2026-11-04T07:00:00Z"); k.s.runWorkspace(k.w);
    snaps = k.s.snapsOf(k.w, c.id);
    assert.deepEqual(snaps.map((x) => x.date), ["2026-11-03", "2026-11-04"]);
    // A snapshot 10 days ago that was 35 points higher: the health-drop alert explains which parts fell.
    k.st.addOps("success_health", k.w.id, { customer_id: c.id, date: "2026-10-25", score: snaps[1].score + 35, label: "healthy", parts: { payment: 30, usage: 25, tickets: 15, onboarding: 5, activity: 15 } });
    k.at("2026-11-05T07:00:00Z"); k.s.runWorkspace(k.w);
    const alerts = k.st.listOps("success_alerts", k.w.id);
    const drop = alerts.find((a) => a.type === "health_drop");
    assert.ok(drop); assert.match(drop.reason, new RegExp(`Health fell 35 points, from ${snaps[1].score + 35} on 2026-10-25`)); assert.match(drop.reason, /usage -15/); assert.match(drop.reason, /activity -15/);
    assert.equal(drop.status, "open"); assert.ok(drop.steps.length >= 3 && drop.steps.every((x) => x.done === false)); // the playbook as a checklist
    assert.ok(alerts.some((a) => a.type === "inactive" && /35 days since the start/.test(a.reason)));
    k.s.runWorkspace(k.w); // repeating doesn't double alerts
    assert.equal(k.st.listOps("success_alerts", k.w.id).length, alerts.length);
    // Cancelled customers get no snapshot.
    k.b.setStatus(k.w, c, "cancel", { at_period_end: false });
    k.at("2026-11-06T07:00:00Z"); k.s.runWorkspace(k.w);
    assert.equal(k.s.snapsOf(k.w, c.id).length, 4); // 3 real + the inserted one, none today
  } finally { k.done(); }
});

test("success: each churn rule fires with its reason, and alerts are deduplicated, cooled down and snoozed", async () => {
  const S = await import("../lib/success.js");
  const s = S.DEFAULT_SETTINGS, today = "2026-11-03";
  // Health drop: 15+ points within 14 days; an older peak doesn't count.
  const cur = { score: 60, parts: { payment: 30, usage: 0, tickets: 15, onboarding: 5, activity: 10 } };
  assert.equal(S.healthDropRule([{ date: "2026-10-25", score: 74, parts: {} }], cur, today, s), null);
  assert.match(S.healthDropRule([{ date: "2026-10-25", score: 75, parts: { usage: 25 } }], cur, today, s).reason, /fell 15 points.*usage -25/);
  assert.equal(S.healthDropRule([{ date: "2026-10-18", score: 99, parts: {} }], cur, today, s), null); // 16 days ago
  // Usage: last full month vs the month before, 40%+.
  assert.match(S.usageDropRule([{ month: "2026-09", renders: 1000 }, { month: "2026-10", renders: 600 }], today, s).reason, /fell 40%: 1,000 in 2026-09, 600 in 2026-10/);
  assert.equal(S.usageDropRule([{ month: "2026-09", renders: 1000 }, { month: "2026-10", renders: 650 }], today, s), null);
  assert.equal(S.usageDropRule([{ month: "2026-10", renders: 10 }, { month: "2026-11", renders: 0 }], today, s), null); // the current month never counts
  assert.ok(S.usageDropRule([{ month: "2026-09", renders: 500 }], today, s)); // no renders at all last month
  // Past due, with the worst invoice.
  const inv = { kind: "invoice", status: "issued", number: "INV-000009", due_date: "2026-10-24", totals: { total: 100 }, paid_amount: 0 };
  assert.match(S.pastDueRule({ status: "past_due" }, [inv], today).reason, /INV-000009 is 10 days overdue/);
  assert.match(S.pastDueRule({ status: "paused", paused_reason: "dunning" }, [inv], today).reason, /paused for non-payment/);
  assert.equal(S.pastDueRule({ status: "paused", paused_reason: "manual" }, [inv], today), null);
  assert.equal(S.pastDueRule({ status: "active" }, [inv], today), null);
  // No activity for 14 days.
  assert.match(S.inactiveRule({ status: "active", start_date: "2026-01-01" }, "2026-10-20", today, s).reason, /14 days \(last activity 2026-10-20\)/);
  assert.equal(S.inactiveRule({ status: "active", start_date: "2026-01-01" }, "2026-10-21", today, s), null);
  assert.equal(S.inactiveRule({ status: "trial", start_date: "2026-10-25" }, null, today, s), null); // 9 days old
  // Open tickets over N (resolved don't count) and unhappy tickets (each its own alert).
  const t = (id, status, text) => ({ id, status, channel: "WhatsApp", messages: [{ from: "customer", text }] });
  assert.equal(S.ticketsRule([t(1, "new", "hi"), t(2, "needs_human", "x"), t(3, "resolved", "x")], s), null);
  assert.match(S.ticketsRule([t(1, "new", "hi"), t(2, "needs_human", "x"), t(3, "ai_answered", "x")], s).reason, /3 open support tickets \(more than 2\)/);
  const neg = S.negativeTicketRules([t(7, "needs_human", "السلام عليكم، ابي استرجاع فلوسي لأن الإعلانات ما اشتغلت"), t(8, "resolved", "I want a refund"), t(9, "new", "How do I add a template?"), t(10, "new", "I want to cancel my plan")]);
  assert.deepEqual(neg.map((x) => x.key), ["negative_ticket|7", "negative_ticket|10"]); assert.match(neg[0].reason, /استرجاع/); assert.match(neg[1].reason, /cancel/);
  // Cancel at period end.
  assert.match(S.cancelRule({ status: "active", cancel_at_period_end: true, period_end: "2026-12-01" }).reason, /cancels on 2026-12-01/);
  assert.equal(S.cancelRule({ status: "active", cancel_at_period_end: false }), null);
  // Dedupe, cool-down after done, specific keys never come back, snooze returns on its date.
  const k = await successKit();
  try {
    const c = k.b.addCustomer(k.w, { store_name: "Rule Co", plan: "Starter", status: "active", start_date: "2026-10-01", already_billed: true });
    const hit = { type: "past_due", key: "past_due", reason: "Invoice X is 2 days overdue" };
    const a = k.s.raise(k.w, c, hit, "2026-11-03").alert;
    assert.equal(k.s.raise(k.w, c, { ...hit, reason: "Invoice X is 3 days overdue" }, "2026-11-04").created, false);
    assert.equal(a.reason, "Invoice X is 3 days overdue"); // refreshed, not doubled
    Object.assign(a, { status: "done", done_at: "2026-11-04T10:00:00Z", outcome: "fixed" });
    assert.equal(k.s.raise(k.w, c, hit, "2026-11-10").alert, null); // within 14 days of done
    assert.equal(k.s.raise(k.w, c, hit, "2026-11-19").created, true);
    const spec = k.s.raise(k.w, c, { type: "negative_ticket", key: "negative_ticket|7", reason: "x" }, "2026-11-03").alert;
    Object.assign(spec, { status: "done", done_at: "2026-11-03T10:00:00Z" });
    assert.equal(k.s.raise(k.w, c, { type: "negative_ticket", key: "negative_ticket|7", reason: "x" }, "2026-12-30").alert, null);
    const sn = k.s.raise(k.w, c, { type: "tickets", key: "tickets", reason: "3 open" }, "2026-11-03").alert;
    Object.assign(sn, { status: "snoozed", snooze_until: "2026-11-05" });
    k.at("2026-11-04T07:00:00Z"); k.s.runWorkspace(k.w); assert.equal(sn.status, "snoozed");
    k.at("2026-11-05T07:00:00Z"); k.s.runWorkspace(k.w); assert.equal(sn.status, "open");
    // A store cancelling at period end and a past-due store raise their alerts in the daily run.
    k.b.setStatus(k.w, c, "cancel");
    c.status = "past_due";
    k.s.runWorkspace(k.w);
    const types = k.st.listOps("success_alerts", k.w.id).filter((x) => x.status === "open").map((x) => x.type);
    assert.ok(types.includes("cancel_scheduled")); assert.ok(types.includes("past_due"));
  } finally { k.done(); }
});

test("success: expansion signals use the Pricing render limits and PLANS prices, never invented numbers", async () => {
  const { expansionSignals } = await import("../lib/success.js");
  const { DEFAULT_PRICING, cleanPricing } = await import("../lib/pricing.js");
  const { PLANS, SAR_PER_USD } = await import("../lib/sales.js");
  const usd = (n) => PLANS.find((p) => p.name === n).usd;
  const today = "2026-11-20";
  // Scale at 80% of its 15,000 renders → Enterprise (a "from" price).
  let r = expansionSignals({ c: { plan: "Scale", status: "active", cycle: "monthly" }, usage: [{ month: "2026-11", renders: 12000 }], today });
  assert.deepEqual(r.signals.map((x) => x.id), ["render_usage"]); assert.match(r.signals[0].reason, /12,000 renders in 2026-11 so far: 80% of the 15,000 included in Scale/);
  assert.equal(r.suggested.plan, "Enterprise"); assert.equal(r.suggested.from, true); assert.equal(r.suggested.diff_usd, usd("Enterprise") - usd("Scale"));
  assert.equal(expansionSignals({ c: { plan: "Scale", status: "active" }, usage: [{ month: "2026-11", renders: 11999 }], today }).signals.length, 0); // 79.99%
  // Catalog over the plan band → the plan that fits; price difference from PLANS in USD and SAR.
  r = expansionSignals({ c: { plan: "Growth", status: "active" }, skus: 6200, today });
  assert.equal(r.signals[0].id, "sku_band"); assert.equal(r.suggested.plan, "Scale");
  assert.equal(r.suggested.diff_usd, usd("Scale") - usd("Growth")); assert.equal(r.suggested.diff_sar, (usd("Scale") - usd("Growth")) * SAR_PER_USD);
  assert.equal(expansionSignals({ c: { plan: "Starter", status: "active" }, skus: 20000, today }).suggested.plan, "Scale"); // jumps to the band that fits
  // Overage two complete months running.
  r = expansionSignals({ c: { plan: "Scale", status: "active" }, usage: [{ month: "2026-09", renders: 15500 }, { month: "2026-10", renders: 17001 }], today });
  const ov = r.signals.find((x) => x.id === "overage_2m");
  assert.ok(ov); assert.equal(ov.overage_usd, 10 + 30); assert.match(ov.reason, /500 and 2,001 extra renders/);
  assert.equal(expansionSignals({ c: { plan: "Scale", status: "active" }, usage: [{ month: "2026-09", renders: 15500 }, { month: "2026-10", renders: 100 }], today }).signals.find((x) => x.id === "overage_2m"), undefined);
  // Limits come from Finance → Pricing: a Growth limit makes Growth eligible too.
  const pr = cleanPricing({ plans: DEFAULT_PRICING.plans.map((p) => (p.name === "Growth" ? { ...p, render_limit: 5000 } : p)) }, DEFAULT_PRICING);
  assert.equal(expansionSignals({ c: { plan: "Growth", status: "active" }, usage: [{ month: "2026-11", renders: 4000 }], pricing: pr, today }).suggested.plan, "Scale");
  assert.equal(expansionSignals({ c: { plan: "Growth", status: "active" }, usage: [{ month: "2026-11", renders: 4000 }], today }).signals.length, 0);
  // Enterprise has nothing above: no invented price, an [ADD] note.
  r = expansionSignals({ c: { plan: "Enterprise", status: "active" }, usage: [{ month: "2026-11", renders: 45000 }], today });
  assert.equal(r.suggested.plan, null); assert.match(r.suggested.note, /\[ADD\]/);
  assert.equal(expansionSignals({ c: { plan: "Scale", status: "cancelled" }, usage: [{ month: "2026-11", renders: 15000 }], today }).signals.length, 0);
});

test("success: renewals list (yearly and trials, auto renewed/lost, status records) and the onboarding view", async () => {
  const { renewalRows, onboardingRow } = await import("../lib/success.js");
  const today = "2026-11-03";
  const cs = [
    { id: "1", store_name: "Yearly", plan: "Growth", cycle: "yearly", status: "active", period_end: "2026-12-01", start_date: "2025-12-01" },
    { id: "2", store_name: "Trial", plan: "Starter", cycle: "monthly", status: "trial", trial_end: "2026-11-10", start_date: "2026-10-27" },
    { id: "3", store_name: "Monthly", plan: "Starter", cycle: "monthly", status: "active", period_end: "2026-11-20", start_date: "2026-01-20" },
    { id: "4", store_name: "Leaving", plan: "Scale", cycle: "yearly", status: "active", period_end: "2027-01-15", cancel_at_period_end: true, start_date: "2026-01-15" },
    { id: "5", store_name: "Far", plan: "Growth", cycle: "yearly", status: "active", period_end: "2027-06-01", start_date: "2026-06-01" },
    { id: "6", store_name: "Renewed", plan: "Growth", cycle: "yearly", status: "active", period_end: "2026-10-25", start_date: "2025-10-25" },
    { id: "7", store_name: "Gone", plan: "Growth", cycle: "yearly", status: "cancelled", cancelled_at: "2026-10-20", period_end: "2026-10-20", start_date: "2025-10-20" },
  ];
  const rows = renewalRows(cs, today, [{ id: "r1", customer_id: "1", date: "2026-12-01", status: "in_talks", owner_id: "u1", lost_reason: "", note: "Call booked" }]);
  assert.deepEqual(rows.map((r) => r.store_name), ["Gone", "Renewed", "Trial", "Yearly", "Leaving"]); // monthly and >90 days left out
  const by = Object.fromEntries(rows.map((r) => [r.store_name, r]));
  assert.deepEqual([by.Yearly.status, by.Yearly.days, by.Yearly.owner_id, by.Yearly.auto], ["in_talks", 28, "u1", false]);
  assert.deepEqual([by.Trial.kind, by.Trial.date, by.Trial.status], ["trial", "2026-11-10", "not_started"]);
  assert.deepEqual([by.Leaving.status, by.Leaving.auto], ["lost", true]); assert.match(by.Leaving.lost_reason, /Cancel at period end/);
  assert.deepEqual([by.Renewed.status, by.Renewed.auto], ["renewed", true]); assert.equal(by.Gone.status, "lost");
  assert.equal(by.Yearly.mrr_sar, 1403.13);
  assert.equal(renewalRows(cs, today, [], 30).length, 4);
  // Onboarding: progress from the CRM checklist, stuck after 7 days without a tick.
  const c = { id: "9", store_name: "Onb", start_date: "2026-10-01" };
  assert.equal(onboardingRow(c, null, today).linked, false);
  const o = onboardingRow(c, { id: "x", stage: "onboarding", onboarding: { app: true, catalog: true }, onboarding_at: { app: "2026-10-03T10:00:00Z", catalog: "2026-10-26T10:00:00Z" } }, today);
  assert.deepEqual([o.done, o.total, o.pct, o.last_progress, o.quiet_days, o.days], [2, 7, 29, "2026-10-26", 8, 33]);
  assert.deepEqual(o.stuck, ["Brand kit set (logo, colors, fonts)"]);
  assert.deepEqual(onboardingRow(c, { id: "x", onboarding: { app: true }, onboarding_at: { app: "2026-10-30T10:00:00Z" } }, today).stuck, []);
});

test("success: survey sending follows Test mode, opt-outs, WhatsApp opt-in, Saudi hours and sample stores", async () => {
  const k = await successKit();
  try {
    const ct = k.crm.add(k.w.id, { store_name: "Ward", domain: "ward.sa", email: "owner@ward.sa", owner_name: "نورة", phone: "966500000001", wa_opt_in: true });
    const opt = k.crm.add(k.w.id, { store_name: "Opt", domain: "opt.sa", email: "o@opt.sa", email_opt_out: true });
    const c1 = k.b.addCustomer(k.w, { store_name: "Ward", domain: "ward.sa", plan: "Growth", status: "active", crm_contact_id: ct.id, already_billed: true });
    const c2 = k.b.addCustomer(k.w, { store_name: "Opt", domain: "opt.sa", plan: "Starter", status: "active", already_billed: true }); // linked by domain
    const c3 = k.b.addCustomer(k.w, { store_name: "No CRM", plan: "Starter", status: "active", already_billed: true });
    const c4 = k.b.addCustomer(k.w, { store_name: "Sample", domain: "ward.sa", plan: "Starter", status: "active", crm_contact_id: ct.id, already_billed: true });
    c4.sample = true;
    assert.equal(k.s.contactFor(k.w, c2).id, opt.id);
    const sv = k.s.createSurvey(k.w, { kind: "nps", channel: "email" });
    assert.match(sv.question_ar, /من 0 إلى 10/); assert.match(sv.question_en, /recommend/);
    let r = await k.s.sendSurvey(k.w, sv);
    const rows = () => Object.fromEntries(k.st.listOps("success_responses", k.w.id).filter((x) => x.survey_id === sv.id).map((x) => [x.customer_id, x]));
    assert.equal(r.created, 4); assert.equal(k.sent.length, 0);
    assert.deepEqual([rows()[c1.id].send_status, rows()[c2.id].send_status, rows()[c3.id].send_status, rows()[c4.id].send_status], ["test", "skipped", "link", "test"]);
    assert.match(rows()[c2.id].send_note, /Unsubscribed/); assert.match(rows()[c4.id].send_note, /Sample/); assert.match(rows()[c1.id].send_note, /Test mode/);
    const tokens = Object.values(rows()).map((x) => x.token);
    assert.equal(new Set(tokens).size, 4); assert.ok(tokens.every((t) => t.length >= 24)); // one unguessable token per customer
    r = await k.s.sendSurvey(k.w, sv); assert.equal(r.created, 0); assert.equal(k.st.listOps("success_responses", k.w.id).length, 4); // no new tokens
    // Live: only the opted-in, linked, real store is sent, through the CRM's sendOne, with the link.
    k.s.setSettings(k.w, { mode: "live" });
    const sv2 = k.s.createSurvey(k.w, { kind: "csat", channel: "email" });
    await k.s.sendSurvey(k.w, sv2);
    assert.equal(k.sent.length, 1); assert.equal(k.sent[0].c.id, ct.id); assert.equal(k.sent[0].m.channel, "email");
    const link = k.s.link(k.st.listOps("success_responses", k.w.id).find((x) => x.survey_id === sv2.id && x.customer_id === c1.id));
    assert.match(link, /^https:\/\/wiz\.test\/s\/[\w-]{24}$/); assert.ok(k.sent[0].m.body.includes(link)); assert.match(k.sent[0].m.body, /نورة/); assert.match(k.sent[0].m.body, /How are we doing|satisfied/);
    // Friday (Riyadh): queued, then sent on Sunday inside 09:00–21:00.
    k.at("2026-11-06T08:00:00Z");
    const sv3 = k.s.createSurvey(k.w, { kind: "nps", channel: "email" });
    await k.s.sendSurvey(k.w, sv3, [c1.id]);
    const q = k.st.listOps("success_responses", k.w.id).find((x) => x.survey_id === sv3.id);
    assert.equal(q.send_status, "queued"); assert.equal(k.sent.length, 1);
    assert.equal(await k.s.sendQueued(k.w), 0);
    k.at("2026-11-08T19:00:00Z"); assert.equal(await k.s.sendQueued(k.w), 0); // 22:00 in Riyadh
    k.at("2026-11-08T07:00:00Z"); await k.s.tick();
    assert.equal(q.send_status, "sent"); assert.equal(k.sent.length, 2);
    // WhatsApp needs an approved template; then the link goes as a template parameter.
    const sv4 = k.s.createSurvey(k.w, { kind: "nps", channel: "whatsapp" });
    await k.s.sendSurvey(k.w, sv4, [c1.id, c2.id]);
    const wa = Object.fromEntries(k.st.listOps("success_responses", k.w.id).filter((x) => x.survey_id === sv4.id).map((x) => [x.customer_id, x]));
    assert.match(wa[c1.id].send_note, /template/); assert.match(wa[c2.id].send_note, /No WhatsApp number|opt-in/);
    k.s.setSettings(k.w, { wa_template: "nps_survey_ar" }); wa[c1.id].send_status = "new";
    await k.s.sendSurvey(k.w, sv4, [c1.id]);
    assert.equal(k.sent.length, 3); assert.equal(k.sent[2].m.wa_template, "nps_survey_ar"); assert.deepEqual(k.sent[2].m.wa_params, ["owner_name", "survey_link"]); assert.match(k.sent[2].c.survey_link, /\/s\//);
  } finally { k.done(); }
});

test("success HTTP: overview, alerts as tasks, renewals, public survey page, detractor alert, token reuse and rate limit", async () => {
  const ws = await (await post("/api/workspaces", { company_name: "Success Co" })).json();
  const B = `/api/workspaces/${ws.id}/billing`, X = `/api/workspaces/${ws.id}/success`;
  const today = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
  const addD = (n) => new Date(Date.parse(today) + n * 864e5).toISOString().slice(0, 10);
  const ct = await (await post(`/api/workspaces/${ws.id}/crm/contacts`, { store_name: "Riyadh Oud", domain: "riyadhoud.sa", email: "owner@riyadhoud.sa", products: 7000 })).json();
  const a = await (await post(`${B}/customers`, { store_name: "Riyadh Oud", domain: "riyadhoud.sa", plan: "Growth", owner_email: "owner@riyadhoud.sa", crm_contact_id: ct.id, already_billed: true, start_date: addD(-40) })).json();
  const t = await (await post(`${B}/customers`, { store_name: "Trial Shop", plan: "Starter", status: "trial", start_date: addD(-9), trial_end: addD(5) })).json();
  // A past-due store with no usage: at risk.
  const late = await (await post(`${B}/customers`, { store_name: "Late Shop", plan: "Starter", start_date: addD(-60), already_billed: true })).json();
  const bill = appRef.locals.billing, lc = bill.getCustomer(ws.id, late.id), w = store.getWorkspace(ws.id);
  const inv = bill.draft(w, lc, { lines: [{ kind: "subscription", description: "Starter", qty: 1, unit_price: 746.25 }] });
  Object.assign(inv, { status: "issued", number: "T-1", issue_date: addD(-27), due_date: addD(-20) }); lc.status = "past_due"; store.save();
  assert.equal((await post(`${X}/run`, {})).status, 200);
  const ov = await json(X);
  assert.equal(ov.customers.length, 3); assert.equal(ov.bands.at_risk, 1); assert.ok(ov.at_risk_mrr_sar > 0);
  assert.equal(ov.trend.length, 1); assert.equal(ov.trend[0].n, 3);
  assert.equal(ov.renewals.d30, 1); // the trial
  assert.ok(ov.expansion.some((x) => x.customer_id === a.id && x.suggested.plan === "Scale")); // 7,000 products in the CRM
  assert.equal(ov.settings.mode, "test");
  const alerts = await json(`${X}/alerts?customer=${late.id}`);
  const pd = alerts.find((x) => x.type === "past_due");
  assert.match(pd.reason, /T-1 is 20 days overdue/);
  // Alerts are tasks: owner, checklist, snooze needs a future date, done needs an outcome and a note.
  const put = (p, body) => call(p, { method: "PUT", body: JSON.stringify(body) });
  assert.equal((await put(`${X}/alerts/${pd.id}`, { owner_id: "nobody" })).status, 422);
  assert.equal((await (await put(`${X}/alerts/${pd.id}`, { owner_id: "owner", steps: [true] })).json()).steps[0].done, true);
  assert.equal((await (await put(`${X}/alerts/${pd.id}`, { steps: [null, true] })).json()).steps.filter((x) => x.done).length, 2);
  assert.equal((await put(`${X}/alerts/${pd.id}`, { status: "snoozed", snooze_until: today })).status, 422);
  assert.equal((await (await put(`${X}/alerts/${pd.id}`, { status: "snoozed", snooze_until: addD(3) })).json()).status, "snoozed");
  assert.equal((await put(`${X}/alerts/${pd.id}`, { status: "done", outcome: "saved" })).status, 422);
  const done = await (await put(`${X}/alerts/${pd.id}`, { status: "done", outcome: "saved", outcome_note: "Paid by bank transfer after a call" })).json();
  assert.deepEqual([done.status, done.outcome], ["done", "saved"]); assert.ok(done.history.some((h) => /Paid by bank transfer/.test(h.text)));
  // Renewals: set a status; "lost" needs a reason.
  const ren = await json(`${X}/renewals`);
  assert.deepEqual(ren.map((r) => r.customer_id), [t.id]); assert.equal(ren[0].kind, "trial");
  assert.equal((await put(`${X}/renewals/${t.id}`, { status: "lost" })).status, 422);
  assert.equal((await (await put(`${X}/renewals/${t.id}`, { status: "in_talks", note: "Demo on Sunday" })).json()).status, "in_talks");
  assert.equal((await json(`${X}/renewals`))[0].status, "in_talks");
  // Onboarding: ticking a CRM step records when (stuck detection reads it).
  await put(`/api/workspaces/${ws.id}/crm/contacts/${ct.id}`, { onboarding: { app: true, catalog: true } });
  const onb = (await json(`${X}/onboarding`)).find((r) => r.customer_id === a.id);
  assert.deepEqual([onb.done, onb.last_progress, onb.stuck.length], [2, today, 0]);
  // Survey: create, send in Test mode (link only for stores without a CRM email), public page without login.
  const sv = await (await post(`${X}/surveys`, { name: "NPS Q4", kind: "nps", channel: "email" })).json();
  assert.equal((await post(`${X}/surveys`, { kind: "stars" })).status, 422);
  const sent = await (await post(`${X}/surveys/${sv.id}/send`, {})).json();
  assert.equal(sent.created, 3); assert.equal(sent.results.sent, undefined);
  const detail = await json(`${X}/surveys/${sv.id}`);
  const ra = detail.responses.find((r) => r.customer_id === a.id), rt = detail.responses.find((r) => r.customer_id === t.id);
  assert.equal(ra.send_status, "test"); assert.equal(rt.send_status, "link"); assert.match(ra.link, /\/s\/[\w-]+$/);
  const pub = await fetch(`${base}/s/${ra.token}`);
  assert.equal(pub.status, 200); const html = await pub.text();
  assert.match(html, /dir="rtl"/); assert.match(html, /من 0 إلى 10/); assert.match(html, /recommend/); assert.match(html, /name="score" value="10"/);
  assert.equal((await fetch(`${base}/s/not-a-token`)).status, 404);
  const answer = (token, body, json = true) => fetch(`${base}/s/${token}`, { method: "POST", headers: { "Content-Type": json ? "application/json" : "application/x-www-form-urlencoded" }, body: json ? JSON.stringify(body) : new URLSearchParams(body) });
  assert.equal((await answer(ra.token, { score: 11 })).status, 422);
  const ok = await answer(ra.token, { score: "3", comment: "الفيديوهات تتأخر كثير <b>" }, false);
  assert.equal(ok.status, 200); assert.match(await ok.text(), /شكراً/);
  assert.equal((await answer(ra.token, { score: 9 })).status, 409); // one answer per token
  assert.equal((await fetch(`${base}/s/${ra.token}`)).status, 200); // shows "already answered"
  const det = (await json(`${X}/alerts?customer=${a.id}&type=detractor`))[0];
  assert.ok(det); assert.match(det.reason, /NPS 3\/10: "الفيديوهات تتأخر كثير <b>"/); assert.equal(det.status, "open");
  assert.equal((await answer(rt.token, { score: 10 })).status, 200); // a promoter: no alert
  assert.equal((await json(`${X}/alerts?customer=${t.id}&type=detractor`)).length, 0);
  const ov2 = await json(X);
  assert.deepEqual([ov2.nps.n, ov2.nps.nps], [2, 0]); assert.equal(ov2.customers.find((c) => c.id === a.id).last_response.score, 3);
  assert.equal((await json(`${X}/surveys`)).find((x) => x.id === sv.id).score.nps, 0);
  // Command Center: at-risk customers, renewals in 14 days without status, unanswered detractors.
  await put(`${X}/renewals/${t.id}`, { status: "not_started" });
  const cmd = await json(`/api/workspaces/${ws.id}/command`);
  const sx = cmd.needs.filter((n) => n.module === "Success").map((n) => n.text).join(" | ");
  assert.match(sx, /1 customer at risk: SAR/); assert.match(sx, /1 unanswered detractor/);
  // A renewal record (even "not started") means a person looked: only renewals nobody touched are listed.
  assert.doesNotMatch(sx, /renewal/);
  store.db.success_renewals = store.db.success_renewals.filter((r) => r.customer_id !== t.id);
  assert.match((await json(`/api/workspaces/${ws.id}/command`)).needs.filter((n) => n.module === "Success").map((n) => n.text).join(" "), /1 renewal in the next 14 days with no status: Trial Shop/);
  // Rate limit on the public page: 10 answers per IP per 10 minutes.
  let limited = 0;
  for (let i = 0; i < 12; i++) if ((await answer("rate-test-" + i, { score: 5 })).status === 429) limited++;
  assert.ok(limited >= 1);
  // Playbooks and settings are editable and validated.
  assert.deepEqual((await (await put(`${X}/playbooks/past_due`, { steps: "Call the owner\nSend the bank details" })).json()).past_due, ["Call the owner", "Send the bank details"]);
  assert.equal((await put(`${X}/playbooks/nope`, { steps: "x" })).status, 404);
  assert.equal((await put(`${X}/settings`, { usage_drop_pct: 500 })).status, 422);
  assert.equal((await (await put(`${X}/settings`, { usage_drop_pct: 30 })).json()).usage_drop_pct, 30);
  // The customer view for Billing's drawer.
  const one = await json(`${X}/customers/${a.id}`);
  assert.equal(one.alerts.length >= 1, true); assert.equal(one.last_response.score, 3); assert.equal(one.onboarding.done, 2);
});

test("success AI agents: Retention watcher and Expansion & renewal writer draft, a person approves, outcomes recorded", async () => {
  const [ws] = await json("/api/workspaces");
  const B = `/api/workspaces/${ws.id}/billing`, X = `/api/workspaces/${ws.id}/success`;
  const c = await (await post(`${B}/customers`, { store_name: "AI Store", plan: "Growth", already_billed: true })).json();
  store.db.billing_customers.find((x) => x.id === c.id).skus = 9000; store.save();
  const before = prompts.length;
  const plan = await (await post(`${X}/customers/${c.id}/ai/save-plan`, {})).json();
  assert.equal(plan.status, "draft"); assert.equal(plan.agent, "retention_watcher");
  assert.match(prompts[before], /Retention watcher/); assert.match(prompts[before], /<health score="\d+"/); assert.match(prompts[before], /\[ADD\]/);
  const ap = await (await post(`${X}/drafts/${plan.id}/approve`, {})).json();
  assert.equal(ap.status, "approved");
  assert.equal((await post(`${X}/drafts/${plan.id}/approve`, {})).status, 409);
  const exp = await (await post(`${X}/customers/${c.id}/ai/expansion`, {})).json();
  assert.equal(exp.agent, "success_writer"); assert.equal(exp.money, true);
  const ep = prompts.at(-1);
  assert.match(ep, /Expansion & renewal writer/); assert.match(ep, /9,000 products: over the Growth band/); assert.match(ep, /difference \$850\/month/); assert.match(ep, /Never invent results/);
  assert.equal((await post(`${X}/customers/${c.id}/ai/renewal`, {})).status, 409); // monthly plan: no renewal date
  const sentE = await (await post(`${X}/drafts/${exp.id}/approve`, { text: exp.text + "\n[edited]", send: true })).json();
  assert.equal(sentE.sent.status, "link"); // not linked to a CRM store: the person sends it
  assert.equal((await post(`${X}/customers/${c.id}/ai/nope`, {})).status, 404);
  const ex2 = await (await post(`${X}/customers/${c.id}/ai/expansion`, {})).json();
  await post(`${X}/drafts/${ex2.id}/reject`, {});
  const rw = await json("/api/workforce/agents/retention_watcher"), sw = await json("/api/workforce/agents/success_writer");
  assert.ok(rw.runs.length >= 1); assert.ok(rw.events.some((e) => e.outcome === "accepted"));
  assert.ok(sw.runs.length >= 2); assert.ok(sw.events.some((e) => e.outcome === "edited")); assert.ok(sw.events.some((e) => e.outcome === "rejected"));
  const { agentDef } = await import("../lib/agents.js");
  assert.equal(agentDef("retention_watcher").max, 1); assert.equal(agentDef("success_writer").max, 1);
  // Switched off in AI Workforce: refused before any AI call.
  appRef.locals.workforce.set("retention_watcher", { paused: true });
  const n = prompts.length;
  assert.equal((await post(`${X}/customers/${c.id}/ai/save-plan`, {})).status, 409); assert.equal(prompts.length, n);
  appRef.locals.workforce.set("retention_watcher", { paused: false, level: 1 });
});

test("success permissions: Owner/Admin/Team lead/Member edit, Finance and Viewer view, Creative none; money hidden without Billing", async () => {
  const { DEFAULT_ROLES, moduleFor } = await import("../lib/access.js");
  assert.deepEqual(Object.fromEntries(DEFAULT_ROLES.map((r) => [r.id, r.perms.success])), { owner: "edit", admin: "edit", manager: "edit", member: "edit", finance: "view", creative: "none", viewer: "view" });
  assert.equal(moduleFor("GET", "/api/workspaces/1/success/alerts"), "success");
  // ensureRoles adds the module to roles saved before it existed.
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "mwiz-sxr-"));
  fs.writeFileSync(path.join(d, "db.json"), JSON.stringify({ roles: [{ id: "member", name: "Team member", perms: { command: "view" } }] }));
  const st = new Store(d);
  assert.equal(st.db.roles.find((r) => r.id === "member").perms.success, "edit"); fs.rmSync(d, { recursive: true, force: true });
  const ws = (await json("/api/workspaces")).find((x) => x.brief.company_name === "Success Co");
  const X = `/api/workspaces/${ws.id}/success`;
  const login = async (role) => {
    const email = `sx-${role}@dpa.ad`;
    await post("/api/admin/users", { name: `Sx ${role}`, email, password: `sx-${role}-pass`, role_id: role });
    return (await fetch(base + "/login", { method: "POST", redirect: "manual", body: new URLSearchParams({ email, password: `sx-${role}-pass` }) })).headers.get("set-cookie").split(";")[0];
  };
  const as = (ck, p, m = "GET", body) => fetch(base + p, { method: m, headers: { cookie: ck, "Content-Type": "application/json" }, body: body && JSON.stringify(body) });
  const [mem, lead, fin, view, cre] = await Promise.all(["member", "manager", "finance", "viewer", "creative"].map(login));
  assert.equal((await as(cre, X)).status, 403);
  assert.equal((await as(fin, X)).status, 200); assert.equal((await as(fin, `${X}/settings`, "PUT", { stuck_days: 7 })).status, 403);
  assert.equal((await as(view, X)).status, 200); assert.equal((await as(view, `${X}/run`, "POST", {})).status, 403);
  assert.equal((await as(lead, `${X}/settings`, "PUT", { stuck_days: 7 })).status, 200);
  assert.equal((await as(mem, `${X}/run`, "POST", {})).status, 200);
  // Team members can't see Billing: no MRR, no prices, anywhere in the payload.
  const memOv = await (await as(mem, X)).text();
  assert.doesNotMatch(memOv, /mrr_sar|diff_usd|suggested_usd|current_usd|diff_sar/); assert.match(memOv, /"at_risk":1/);
  const finOv = await (await as(fin, X)).json();
  assert.ok(finOv.at_risk_mrr_sar > 0); assert.ok(finOv.expansion[0].suggested.diff_usd > 0);
  const anyC = finOv.customers[0].id;
  assert.doesNotMatch(await (await as(mem, `${X}/customers/${anyC}`)).text(), /mrr_sar/);
  assert.doesNotMatch(await (await as(mem, `${X}/renewals`)).text(), /mrr_sar/);
  // Command Center: Success needs for Team members without money; nothing for Creative.
  const cm = await (await as(mem, `/api/workspaces/${ws.id}/command`)).json();
  const memNeeds = cm.needs.filter((n) => n.module === "Success").map((n) => n.text).join(" ");
  assert.match(memNeeds, /at risk/); assert.doesNotMatch(memNeeds, /SAR/);
  const cc = await (await as(cre, `/api/workspaces/${ws.id}/command`)).json();
  assert.ok(!cc.needs.some((n) => n.module === "Success"));
  // A draft with prices can't be handled (or read) by someone without Billing view.
  const owner = (await json(X)).expansion[0];
  const dr = await (await post(`${X}/customers/${owner.customer_id}/ai/expansion`, {})).json();
  assert.equal((await as(mem, `${X}/drafts/${dr.id}/approve`, "POST", {})).status, 403);
  assert.match((await (await as(mem, `${X}/drafts`)).json()).find((x) => x.id === dr.id).text, /Hidden/);
  // The public survey page needs no login; the module's API does.
  assert.equal((await fetch(base + X)).status, 401);
});

test("success sample data loads with Billing customers and the CRM link, and removes cleanly; deleting a workspace clears success rows", async () => {
  const d2 = fs.mkdtempSync(path.join(os.tmpdir(), "mwiz-sxs-")), st2 = new Store(d2);
  const app2 = createApp({ store: st2, provider, password: "pw-sx" });
  const srv = app2.listen(0); await new Promise((r) => srv.once("listening", r));
  try {
    const b2 = `http://127.0.0.1:${srv.address().port}`;
    const ck = (await fetch(b2 + "/login", { method: "POST", redirect: "manual", body: new URLSearchParams({ password: "pw-sx" }) })).headers.get("set-cookie").split(";")[0];
    const j = (p, b, m) => fetch(b2 + p, { method: m || (b ? "POST" : "GET"), headers: { "Content-Type": "application/json", cookie: ck }, body: b && JSON.stringify(b) });
    const [w] = await (await j("/api/workspaces")).json();
    await j(`/api/workspaces/${w.id}/crm/sample`, {});
    const loaded = await (await j(`/api/workspaces/${w.id}/sample-data`, {})).json();
    assert.equal(loaded.success_customers, 6);
    const ov = await (await j(`/api/workspaces/${w.id}/success`)).json();
    assert.equal(ov.customers.length, 6); assert.ok(ov.customers.every((c) => c.sample && c.linked));
    assert.ok(ov.bands.at_risk >= 1); assert.ok(ov.trend.length >= 20); assert.ok(ov.expansion.length >= 2); assert.equal(ov.nps.n, 3);
    const types = new Set((await (await j(`/api/workspaces/${w.id}/success/alerts`)).json()).map((a) => a.type));
    for (const t of ["past_due", "usage_drop", "health_drop", "cancel_scheduled", "detractor", "inactive"]) assert.ok(types.has(t), t);
    assert.ok((await (await j(`/api/workspaces/${w.id}/success/onboarding`)).json()).some((r) => r.stuck.length));
    assert.ok(st2.db.billing_invoices.filter((i) => i.sample).every((i) => /^SAMPLE-/.test(i.number))); // outside the invoice sequence
    const rm = await (await j(`/api/workspaces/${w.id}/sample-data`, null, "DELETE")).json();
    assert.equal(rm.customers, 6);
    assert.equal(st2.db.billing_customers.filter((c) => c.workspace_id === w.id).length, 0);
    for (const k of ["success_health", "success_alerts", "success_responses", "success_surveys", "billing_usage", "billing_invoices"]) assert.equal(st2.db[k].filter((x) => x.workspace_id === w.id).length, 0, k);
    // Deleting a workspace clears its success_* rows.
    st2.db.success_alerts.push({ id: "z1", workspace_id: w.id }, { id: "z2", workspace_id: "other" });
    st2.db.success_health.push({ id: "z3", workspace_id: w.id });
    assert.ok(st2.deleteWorkspace(w.id));
    assert.deepEqual(st2.db.success_alerts.map((x) => x.id), ["z2"]); assert.equal(st2.db.success_health.length, 0);
  } finally { srv.close(); app2.locals.crm.flush(); fs.rmSync(d2, { recursive: true, force: true }); }
});

test("billing: sample customers get SAMPLE- numbers and never use the real invoice sequence or ZATCA chain", async () => {
  const k = await billingKit();
  const s = k.b.addCustomer(k.w, { store_name: "Sample · Demo", plan: "Growth", status: "active", start_date: "2026-11-01", sample: true });
  await k.b.runWorkspace(k.w);
  const si = k.b.invoices(k.w.id).find((i) => i.customer_id === s.id);
  assert.match(si.number, /^SAMPLE-/); assert.ok(!si.zatca);
  const before = k.b.settings(k.w);
  assert.equal(before.next_invoice_no, 1); assert.equal(before.icv || 0, 0);
  const r = k.b.addCustomer(k.w, { store_name: "Real", plan: "Growth", status: "active", start_date: "2026-11-01" });
  await k.b.runWorkspace(k.w);
  assert.equal(k.b.invoices(k.w.id).find((i) => i.customer_id === r.id).number, "INV-000001");
  k.done();
});

test("data requests also cover billing contacts (invoices kept) and Customer Success survey answers", async () => {
  const { findSubject, exportSubject, deleteSubject } = await import("../lib/compliance.js");
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "mwiz-dsr-bill-")), st = new Store(d);
  try {
    const w = st.listWorkspaces()[0];
    st.db.billing_customers = [{ id: "b1", workspace_id: w.id, store_name: "Oud", owner_name: "Nora", owner_email: "nora@oud.sa", owner_phone: "+966500000001" }];
    st.db.billing_invoices = [{ id: "i1", workspace_id: w.id, customer_id: "b1", number: "INV-000001", status: "issued", totals: { total: 100 }, currency: "SAR" }];
    st.db.success_responses = [{ id: "r1", workspace_id: w.id, customer_id: "b1", kind: "nps", score: 3, comment: "slow", answered_at: "2026-11-01" }, { id: "r2", workspace_id: w.id, customer_id: "other", score: 9 }];
    const f = findSubject({ store: st, crm: null }, { email: "NORA@oud.sa" });
    assert.equal(f.billing_customers.length, 1); assert.equal(f.survey_responses.length, 1);
    const x = exportSubject({ store: st, crm: null }, { phone: "0500000001" });
    assert.equal(x.billing_customers[0].invoices[0].number, "INV-000001"); assert.equal(x.survey_responses[0].comment, "slow");
    const c = deleteSubject({ store: st, crm: null }, { email: "nora@oud.sa" });
    assert.equal(c.billing_contacts_cleared, 1); assert.equal(c.survey_responses, 1);
    assert.equal(st.db.billing_customers[0].owner_email, ""); assert.equal(st.db.billing_invoices.length, 1);
    assert.deepEqual(st.db.success_responses.map((r) => r.id), ["r2"]);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

// ---- Market intel. Competitor pages are fetched only through safeGet with an injected fetch and DNS (never the real internet).
async function intelKit({ pages = {}, providerImpl = provider, assistantClient = null } = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "mwiz-mi-")), st = new Store(d), calls = [];
  const app2 = createApp({ store: st, provider: providerImpl, password: "pw-mi", assistantClient, intelOptions: { fetchImpl: mockWeb(pages, calls), lookup: publicDns } });
  const srv = app2.listen(0); await new Promise((r) => srv.once("listening", r));
  const b2 = `http://127.0.0.1:${srv.address().port}`;
  const login = async (body) => (await fetch(b2 + "/login", { method: "POST", redirect: "manual", body: new URLSearchParams(body) })).headers.get("set-cookie").split(";")[0];
  const ck = await login({ password: "pw-mi" });
  const as = (c, p, m = "GET", body) => fetch(b2 + p, { method: m, headers: { "Content-Type": "application/json", cookie: c }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = async (p, body, m) => { const r = await as(ck, p, m || (body === undefined ? "GET" : "POST"), body); return { status: r.status, body: r.status === 204 ? null : await r.json() }; };
  const [w] = await (await as(ck, "/api/workspaces")).json();
  const user = async (role) => { const email = `mi-${role}@dpa.ad`; await j("/api/admin/users", { name: `Mi ${role}`, email, password: `mi-${role}-pass1`, role_id: role }); return login({ email, password: `mi-${role}-pass1` }); };
  return { app: app2, st, w, X: `/api/workspaces/${w.id}/intel`, W: `/api/workspaces/${w.id}`, j, as, ck, user, calls, b2,
    done: () => { srv.close(); app2.locals.crm.flush(); fs.rmSync(d, { recursive: true, force: true }); } };
}

test("intel competitors: add, edit with a change log, notes, duplicates refused, pricing needs its source, delete", async () => {
  const k = await intelKit();
  try {
    assert.equal((await k.j(`${k.X}/competitors`, { name: "" })).status, 422);
    const c = (await k.j(`${k.X}/competitors`, { name: "Rival Ads", site: "rival.example", platforms: ["Meta", "TikTok"], segment: "AI ad generator" })).body;
    assert.equal(c.site, "https://rival.example/"); assert.deepEqual(c.platforms, ["Meta", "TikTok"]); assert.equal(c.changes[0].kind, "created");
    assert.equal((await k.j(`${k.X}/competitors`, { name: "rival ads" })).status, 409);
    // Pricing as typed by a person needs the link where it was read.
    const noSrc = await k.j(`${k.X}/competitors/${c.id}`, { pricing: [{ tier: "Pro", price: "$99/mo" }] }, "PUT");
    assert.equal(noSrc.status, 422); assert.match(noSrc.body.detail, /source/);
    const up = (await k.j(`${k.X}/competitors/${c.id}`, { pricing: [{ tier: "Pro", price: "$99/mo" }], pricing_source_url: "https://rival.example/pricing", pricing_checked_on: "2026-11-01", weaknesses: "No Arabic" }, "PUT")).body;
    assert.deepEqual(up.pricing, [{ tier: "Pro", price: "$99/mo", notes: "" }]);
    const edit = up.changes.find((x) => x.kind === "edit");
    assert.ok(edit.lines.some((l) => /^Pricing: none → Pro \$99\/mo$/.test(l))); assert.ok(edit.lines.some((l) => /^Weaknesses: empty → No Arabic$/.test(l)));
    assert.equal((await k.j(`${k.X}/competitors/${c.id}`, { pricing_checked_on: "yesterday" }, "PUT")).status, 422);
    // Saving the same values adds no log line.
    const n = up.changes.length;
    assert.equal((await k.j(`${k.X}/competitors/${c.id}`, { weaknesses: "No Arabic" }, "PUT")).body.changes.length, n);
    const note = await k.j(`${k.X}/competitors/${c.id}/changes`, { text: "Launched in UAE (heard on a demo call)", url: "https://rival.example/blog" });
    assert.equal(note.status, 201); assert.equal(note.body.kind, "note");
    assert.equal((await k.j(`${k.X}/competitors/${c.id}/changes`, { text: "x", url: "javascript:alert(1)" })).status, 422);
    const list = (await k.j(`${k.X}/competitors`)).body;
    assert.equal(list.length, 1); assert.equal(list[0].watch.snapshot, undefined); assert.ok(list[0].changes_count >= 3);
    assert.equal((await k.j(`${k.X}/competitors/${c.id}`, undefined, "DELETE")).status, 204);
    assert.equal(k.st.db.intel_changes.filter((x) => x.competitor_id === c.id).length, 0);
  } finally { k.done(); }
});

test("intel page watch: baseline, weekly limit, change detected with a diff and prices, a need until reviewed, SSRF refused", async () => {
  const { pageLines, diffSummary } = await import("../lib/intel.js");
  assert.deepEqual(pageLines("<html><script>var x=1</script><style>p{}</style><h1>Plans</h1><p>Pro &amp; Team</p><p>$99 / month</p><!-- c --></html>"), ["Plans", "Pro & Team", "$99 / month"]);
  const ds = diffSummary(["Plans", "Pro $99/mo"], ["Plans", "Pro $129/mo", "New: video"]);
  assert.equal(ds.price_changed, true); assert.deepEqual(ds.added, ["Pro $129/mo", "New: video"]); assert.match(ds.summary, /2 lines added, 1 removed; prices on the page now: \$129\/mo/);
  const pages = { "https://rival.example/pricing": { body: "<h1>Pricing</h1><p>Starter $49/mo</p><p>Pro $99/mo</p>" } };
  const k = await intelKit({ pages });
  try {
    const c = (await k.j(`${k.X}/competitors`, { name: "Rival", watch_url: "https://rival.example/pricing", watch_enabled: true })).body;
    const first = await k.j(`${k.X}/competitors/${c.id}/check`, {});
    assert.equal(first.status, 200); assert.equal(first.body.baseline, true); assert.equal(first.body.changed, false);
    const saved = k.st.db.intel_competitors.find((x) => x.id === c.id).watch;
    assert.match(saved.hash, /^[0-9a-f]{64}$/); assert.equal(saved.snapshot, "Pricing\nStarter $49/mo\nPro $99/mo");
    // At most once a week per page.
    const again = await k.j(`${k.X}/competitors/${c.id}/check`, {});
    assert.equal(again.status, 429); assert.match(again.body.detail, /once a week/);
    assert.equal(k.calls.length, 1);
    // A week later the page changed: diff summary, a need on Home until a person reviews it.
    pages["https://rival.example/pricing"].body = "<h1>Pricing</h1><p>Starter $59/mo</p><p>Pro $99/mo</p><p>New: TikTok video ads</p>";
    const t0 = Date.now(); k.app.locals.intel.clock = () => t0 + 8 * 864e5;
    const r = (await k.j(`${k.X}/competitors/${c.id}/check`, {})).body;
    assert.equal(r.changed, true); assert.deepEqual(r.change.added, ["Starter $59/mo", "New: TikTok video ads"]); assert.deepEqual(r.change.removed, ["Starter $49/mo"]);
    assert.equal(r.change.price_changed, true); assert.equal(r.change.reviewed_at, null);
    let cc = (await k.j(`${k.W}/command`)).body;
    const need = cc.needs.find((x) => x.module === "Market intel" && x.title === "Rival");
    assert.ok(need); assert.equal(need.route, "intel"); assert.match(need.text, /Watched page changed: 2 lines added, 1 removed/);
    assert.equal((await k.j(k.X)).body.unreviewed, 1);
    // Unchanged page on the next weekly check: no new change. The scheduler only fetches due pages.
    k.app.locals.intel.clock = () => t0 + 16 * 864e5;
    assert.deepEqual(await k.app.locals.intel.tick(), { checked: 1, changed: 0, failed: 0 });
    assert.deepEqual(await k.app.locals.intel.tick(), { checked: 0, changed: 0, failed: 0 });
    assert.equal(k.calls.length, 3);
    assert.equal((await k.j(`${k.X}/changes/${r.change.id}/review`, { note: "Price up" })).status, 200);
    cc = (await k.j(`${k.W}/command`)).body;
    assert.ok(!cc.needs.some((x) => x.module === "Market intel" && x.title === "Rival"));
    // A private address is refused before any request is made (DNS answer and literal IP), and the error is kept.
    const before = k.calls.length;
    const evil = (await k.j(`${k.X}/competitors`, { name: "Evil", watch_url: "https://evil.example/pricing" })).body;
    const ref = await k.j(`${k.X}/competitors/${evil.id}/check`, {});
    assert.equal(ref.status, 422); assert.equal(ref.body.refused, true); assert.match(ref.body.detail, /Private/);
    const lo = (await k.j(`${k.X}/competitors`, { name: "Loopback", watch_url: "http://127.0.0.1:8080/admin" })).body;
    assert.match((await k.j(`${k.X}/competitors/${lo.id}/check`, {})).body.detail, /Private/);
    assert.equal(k.calls.length, before);
    assert.match(k.st.db.intel_competitors.find((x) => x.id === evil.id).watch.last_error, /Private/);
    // A new watched page starts a new baseline.
    const moved = (await k.j(`${k.X}/competitors/${evil.id}`, { watch_url: "https://rival.example/pricing" }, "PUT")).body;
    assert.equal(moved.watch.last_checked_at, null); assert.equal(moved.watch.due, true);
  } finally { k.done(); }
});

test("intel signals: quick add with validation, filters and themes, import from deals, tickets, feedback and CRM replies once", async () => {
  const k = await intelKit();
  try {
    assert.equal((await k.j(`${k.X}/signals`, { title: "Snap changed something", type: "platform_change" })).status, 422); // needs the platform
    assert.equal((await k.j(`${k.X}/signals`, { title: "x", type: "rumour" })).status, 422);
    assert.equal((await k.j(`${k.X}/signals`, { title: "x", type: "trend", source_url: "ftp://x" })).status, 422);
    const s = (await k.j(`${k.X}/signals`, { title: "Snap catalog feed rule change", type: "platform_change", platform: "Snap", tags: "Catalog Feeds, video", impact: "high", module: "product", source_url: "https://businesshelp.snapchat.com/x" })).body;
    assert.deepEqual(s.tags, ["catalog-feeds", "video"]); assert.equal(s.date, new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10)); // Riyadh day
    await k.j(`${k.X}/signals`, { title: "More stores ask for video", type: "trend", tags: ["video"], impact: "low", date: "2026-01-02" });
    const d = (await k.j(`${k.X}/signals`)).body;
    assert.equal(d.total, 2); assert.deepEqual(d.themes.tags[0], { tag: "video", n: 2, high: 1 }); assert.equal(d.themes.types.find((t) => t.id === "trend").n, 1);
    assert.equal((await k.j(`${k.X}/signals?tag=catalog-feeds`)).body.signals.length, 1);
    assert.equal((await k.j(`${k.X}/signals?days=30`)).body.signals.length, 1);
    assert.equal((await k.j(`${k.X}/signals/${s.id}`, { impact: "med" }, "PUT")).body.impact, "med");
    // Import: a lost deal with a reason (one without is skipped), a feature-request ticket, product feedback, CRM triage labels.
    const lost = (await k.j(`${k.W}/deals`, { name: "Lamsa", skus: 300 })).body;
    await k.j(`${k.W}/deals/${lost.id}`, { stage: "lost", lost_reason: "Staying with Canva for now", competitor: "Canva" }, "PUT");
    const noReason = (await k.j(`${k.W}/deals`, { name: "Quiet" })).body;
    await k.j(`${k.W}/deals/${noReason.id}`, { stage: "lost" }, "PUT");
    const t = k.st.addTicket(k.w.id, { channel: "Email", customer_name: "Reem", contact: "", store: "", category: "feature-request" });
    k.st.addTicketMessage(k.w.id, t.id, { from: "customer", text: "Can you support Zid?" });
    k.st.addOps("product_feedback", k.w.id, { text: "Need Arabic fonts", customer: "Abaya Lane", source: "demo", item_id: null, dismissed: false });
    k.st.addOps("product_feedback", k.w.id, { text: "Dismissed one", customer: "", source: "", item_id: null, dismissed: true });
    const crm = k.app.locals.crm, ct = crm.add(k.w.id, { store_name: "Oud House", domain: "oudhouse.sa" });
    crm.addMessage({ workspace_id: k.w.id, contact_id: ct.id, channel: "email", direction: "in", body: "Not now, maybe after Ramadan", intent: "not_now", summary: "Wants to wait until after Ramadan" });
    crm.addMessage({ workspace_id: k.w.id, contact_id: ct.id, channel: "email", direction: "in", body: "Interested!", intent: "interested", summary: "Interested" });
    const imp = (await k.j(`${k.X}/signals/import`, {})).body;
    assert.deepEqual(imp.added, { deal: 1, ticket: 1, feedback: 1, crm: 1 }); assert.deepEqual(imp.skipped, { deals: 1 });
    const sig = k.st.db.intel_signals.filter((x) => x.workspace_id === k.w.id);
    const fromDeal = sig.find((x) => x.origin === `deal:${lost.id}`);
    assert.equal(fromDeal.type, "win_loss"); assert.deepEqual(fromDeal.tags, ["lost", "status-quo", "canva"]); assert.match(fromDeal.text, /Competitor named: Canva/);
    assert.equal(sig.find((x) => x.origin === `ticket:${t.id}`).type, "customer_request");
    assert.match(sig.find((x) => /^crm:/.test(x.origin)).title, /not now.*Oud House.*Ramadan/);
    // Importing again adds nothing.
    assert.equal((await k.j(`${k.X}/signals/import`, {})).body.imported, 0);
    // Creative only views intel: no import.
    const cre = await k.user("creative");
    assert.equal((await k.as(cre, `${k.X}/signals/import`, "POST", {})).status, 403);
    assert.equal((await k.j(`${k.X}/signals/${s.id}`, undefined, "DELETE")).status, 204);
  } finally { k.done(); }
});

test("intel win/loss: won and lost deals by reason and competitor; names hidden without Sales view", async () => {
  const { winLoss } = await import("../lib/intel.js");
  const now = Date.parse("2026-11-03T10:00:00Z");
  const wl = winLoss([
    { id: "1", name: "A", stage: "paying", won_reason: "Arabic templates", stage_changed_at: "2026-11-01T00:00:00Z" },
    { id: "2", name: "B", stage: "lost", lost_reason: "Price", competitor: "Rival", stage_changed_at: "2026-11-02T00:00:00Z" },
    { id: "3", name: "C", stage: "lost", lost_reason: "price", competitor: "rival", stage_changed_at: "2026-10-01T00:00:00Z" },
    { id: "4", name: "D", stage: "lost", lost_reason: "Staying with Canva", stage_changed_at: "2026-10-20T00:00:00Z" },
    { id: "5", name: "E", stage: "lost", stage_changed_at: "2026-10-21T00:00:00Z" },
    { id: "6", name: "F", stage: "demo" },
  ], { now });
  assert.equal(wl.won, 1); assert.equal(wl.lost, 4); assert.equal(wl.win_rate, 0.2); assert.equal(wl.lost_to_status_quo, 1); assert.equal(wl.missing_reason, 1);
  assert.deepEqual(wl.by_reason[0], { label: "Price", won: 0, lost: 2 }); assert.deepEqual(wl.by_competitor[0], { label: "(no competitor named)", won: 1, lost: 2 });
  assert.deepEqual(wl.by_competitor[1], { label: "Rival", won: 0, lost: 2 });
  assert.equal(winLoss([{ id: "3", stage: "lost", stage_changed_at: "2026-10-01T00:00:00Z" }], { now, days: 7 }).rows.length, 0);
  assert.equal(winLoss([], { now }).win_rate, null);
  const k = await intelKit();
  try {
    const d = (await k.j(`${k.W}/deals`, { name: "Won Store", skus: 100 })).body;
    await k.j(`${k.W}/deals/${d.id}`, { stage: "paying", won_reason: "Zid import", competitor: "Agency" }, "PUT");
    const r = (await k.j(`${k.X}/winloss`)).body;
    assert.equal(r.won, 1); assert.equal(r.rows[0].reason, "Zid import"); assert.equal(r.rows[0].competitor, "Agency"); assert.equal(r.can_edit_deals, true);
    const cre = await k.user("creative"); // views intel, no Sales
    const rc = await (await k.as(cre, `${k.X}/winloss`)).json();
    assert.equal(rc.rows[0].name, `Deal #${d.id}`); assert.equal(rc.can_edit_deals, false);
  } finally { k.done(); }
});

test("intel sizing: empty inputs give no numbers; typed inputs with sources give TAM/SAM/SOM and the path to $100M ARR", async () => {
  const { sizing, cleanSizing } = await import("../lib/intel.js");
  const { PLANS } = await import("../lib/sales.js");
  const empty = sizing({});
  for (const k2 of ["stores", "tam_stores", "sam_stores", "som_stores", "arpa_usd", "tam_arr_usd", "sam_arr_usd", "som_arr_usd", "mix_sum"]) assert.equal(empty[k2], null, k2);
  assert.equal(empty.goal.blended_stores_needed, null); assert.equal(empty.goal.pct_of_sam, null);
  // The path per plan comes only from the PLANS list prices.
  assert.deepEqual(empty.goal.per_plan.map((p) => p.stores_needed), PLANS.map((p) => Math.ceil(100e6 / (p.usd * 12))));
  const { out, err } = cleanSizing({ stores_salla: { value: "10,000", source: "Salla report (link)" }, stores_zid: { value: 5000, source: "" }, pct_ad_spend: { value: 40, source: "survey" }, pct_fit: { value: 50 }, pct_som: { value: 10 },
    mix_starter: { value: 50 }, mix_growth: { value: 30 }, mix_scale: { value: 15 }, mix_enterprise: { value: 5 } });
  assert.deepEqual(err, []);
  const r = sizing(out);
  assert.equal(r.stores, 15000); assert.equal(r.tam_stores, 6000); assert.equal(r.sam_stores, 3000); assert.equal(r.som_stores, 300);
  const arpa = PLANS.reduce((a, p) => a + ({ Starter: 0.5, Growth: 0.3, Scale: 0.15, Enterprise: 0.05 })[p.name] * p.usd, 0);
  assert.equal(r.arpa_usd, Math.round(arpa * 100) / 100); assert.equal(r.som_arr_usd, Math.round(300 * r.arpa_usd * 12));
  assert.equal(r.goal.blended_stores_needed, Math.ceil(100e6 / (r.arpa_usd * 12)));
  assert.ok(r.unsourced.includes("stores_zid") && !r.unsourced.includes("stores_salla"));
  // A plan mix that doesn't add up to 100% gives no ARPA (and no money numbers).
  const half = sizing({ ...out, mix_enterprise: { value: null } });
  assert.equal(half.arpa_usd, null); assert.equal(half.tam_arr_usd, null); assert.equal(half.mix_sum, 95); assert.equal(half.tam_stores, 6000);
  assert.ok(cleanSizing({ pct_fit: { value: 140 } }).err.length); assert.ok(cleanSizing({ stores_zid: { value: -1 } }).err.length);
  const k = await intelKit();
  try {
    const g = (await k.j(`${k.X}/sizing`)).body;
    assert.equal(g.result.tam_stores, null); assert.deepEqual(g.inputs, {});
    const p = (await k.j(`${k.X}/sizing`, { inputs: { stores_salla: { value: 2000, source: "x" }, pct_ad_spend: { value: 25, source: "y" } } }, "PUT")).body;
    assert.equal(p.result.tam_stores, 500); assert.equal(p.result.sam_stores, null);
    assert.equal((await k.j(`${k.X}/sizing`, { inputs: { pct_som: { value: "lots" } } }, "PUT")).status, 422);
    assert.equal((await k.j(`${k.X}/sizing`)).body.inputs.stores_salla.source, "x");
  } finally { k.done(); }
});

test("intel weekly brief: demo AI gives the factual list (no invented facts), a person approves; a cited AI draft records accepted/edited/rejected", async () => {
  const { checkBrief } = await import("../lib/intel.js");
  const k = await intelKit();
  try {
    // Nothing recorded yet: a brief that only says [ADD].
    const none = (await k.j(`${k.X}/briefs`, {})).body;
    assert.match(none.text, /\[ADD\]/); assert.equal(none.items, 0);
    await k.j(`${k.X}/briefs/${none.id}`, undefined, "DELETE");
    const s1 = (await k.j(`${k.X}/signals`, { title: "TikTok catalog ads opened in KSA", type: "platform_change", platform: "TikTok", impact: "high", source_url: "https://ads.tiktok.com/x" })).body;
    const c = (await k.j(`${k.X}/competitors`, { name: "Rival" })).body;
    await k.j(`${k.X}/competitors/${c.id}`, { weaknesses: "No Zid" }, "PUT");
    const b = (await k.j(`${k.X}/briefs`, { lang: "en" })).body;
    assert.equal(b.status, "draft"); assert.equal(b.by_ai, false); assert.match(b.note, /factual list/);
    assert.match(b.text, new RegExp(`TikTok catalog ads opened in KSA \\(TikTok\\) \\[S${s1.id}\\]`)); assert.match(b.text, /\[ADD\]/);
    const refs = [...b.text.matchAll(/\[([SCD]\d+)\]/g)].map((m) => m[1]);
    assert.ok(refs.length >= 2 && refs.every((r) => b.refs.includes(r)));
    assert.ok(k.st.db.agent_events.some((e) => e.agent_id === "market_analyst" && e.outcome === "escalated"));
    assert.ok(k.st.db.agent_runs.some((r) => r.agent_id === "market_analyst"));
    // The Command Center shows it waiting; an edit citing an item that isn't in the data can't be approved.
    assert.ok((await k.j(`${k.W}/command`)).body.needs.some((n) => n.module === "Market intel" && /waiting for approval/.test(n.text)));
    const bad = (await k.j(`${k.X}/briefs/${b.id}`, { text: b.text + "\n- Rival raised prices by 40% [S999999]" }, "PUT")).body;
    assert.ok(bad.issues.some((x) => /S999999/.test(x)) && bad.issues.some((x) => /40/.test(x)));
    assert.equal((await k.j(`${k.X}/briefs/${b.id}/approve`, {})).status, 422);
    await k.j(`${k.X}/briefs/${b.id}`, { text: b.text }, "PUT");
    const ok = (await k.j(`${k.X}/briefs/${b.id}/approve`, {})).body;
    assert.equal(ok.status, "approved"); assert.equal(ok.approved_by, "Owner (team password)");
    assert.equal((await k.j(`${k.X}/briefs/${b.id}`, { text: "x" }, "PUT")).status, 422); // approved briefs are locked
    assert.equal((await k.j(`${k.X}/briefs/${b.id}`, undefined, "DELETE")).status, 422);
    assert.equal((await k.j(`${k.X}/briefs`)).body.briefs.find((x) => x.id === b.id).status, "approved");
    assert.ok(!(await k.j(`${k.W}/command`)).body.needs.some((n) => /waiting for approval/.test(n.text)));
    // checkBrief catches uncited bullets and numbers not in the data.
    const chk = checkBrief("- Rival has 500 customers\n- TikTok opened [S1]", { since: "2026-11-01", until: "2026-11-03", items: [{ ref: "S1", title: "TikTok opened" }] });
    assert.equal(chk.uncited, 1); assert.deepEqual(chk.unsourced_numbers, ["500"]); assert.deepEqual(chk.cited, ["S1"]);
  } finally { k.done(); }
  // An AI that cites the items: its text is kept; outcomes go to AI Workforce.
  const citing = { name: "test", model: "test", async generate({ prompt }) {
    const items = JSON.parse(/<items count="\d+">\n([\s\S]*)\n<\/items>/.exec(prompt)[1]);
    assert.match(prompt, /Never add facts/); assert.match(prompt, /\[ADD\]/);
    return /Write in Saudi Arabic/.test(prompt) ? `## العناوين\n- ${items[0].title} [${items[0].ref}]\n- المسؤول: [ADD]` : `## Headlines\n- ${items[0].title} [${items[0].ref}]\n## What we should do\n- Owner and date: [ADD]`;
  } };
  const k2 = await intelKit({ providerImpl: citing });
  try {
    await k2.j(`${k2.X}/signals`, { title: "Zid opened an app store category for ads", type: "platform_change", platform: "Zid" });
    const ev = () => k2.st.db.agent_events.filter((e) => e.agent_id === "market_analyst").map((e) => e.outcome);
    const a = (await k2.j(`${k2.X}/briefs`, {})).body;
    assert.equal(a.by_ai, true); assert.match(a.text, /Zid opened an app store category for ads \[S\d+\]/); assert.deepEqual(a.issues, []);
    await k2.j(`${k2.X}/briefs/${a.id}/approve`, {});
    const e2 = (await k2.j(`${k2.X}/briefs`, { lang: "ar" })).body;
    assert.equal(e2.lang, "ar"); assert.match(e2.text, /العناوين/);
    await k2.j(`${k2.X}/briefs/${e2.id}`, { text: e2.text + "\n- ملاحظة: [ADD]" }, "PUT");
    assert.equal((await k2.j(`${k2.X}/briefs/${e2.id}/approve`, {})).body.edited, true);
    const r3 = (await k2.j(`${k2.X}/briefs`, {})).body;
    await k2.j(`${k2.X}/briefs/${r3.id}/reject`, { reason: "too thin" });
    assert.deepEqual(ev(), ["accepted", "edited", "rejected"]);
    // Switched off in AI Workforce: no draft.
    await k2.j("/api/workforce/agents/market_analyst", { level: 0 }, "PUT");
    assert.equal((await k2.j(`${k2.X}/briefs`, {})).status, 422);
  } finally { k2.done(); }
});

test("intel: AI Market analyst agent, Ask DPA AD tools, permissions per role, Command Center redaction", async () => {
  const { AGENTS, agentFor } = await import("../lib/agents.js");
  const { TOOLS } = await import("../lib/assistant.js");
  const { DEFAULT_ROLES, moduleFor, MODULE_IDS } = await import("../lib/access.js");
  const ag = AGENTS.find((a) => a.id === "market_analyst");
  assert.equal(ag.name, "AI Market analyst"); assert.equal(ag.max, 1); assert.equal(ag.module, "intel"); assert.ok(["Marketing", "Leadership"].includes(ag.team));
  assert.equal(agentFor("POST", "/api/workspaces/1/intel/briefs"), "market_analyst");
  const lt = TOOLS.find((t) => t.name === "list_market_signals"), at = TOOLS.find((t) => t.name === "add_market_signal");
  assert.equal(lt.module, "intel"); assert.ok(!lt.write); assert.equal(at.module, "intel"); assert.equal(at.write, true); assert.equal(at.risk, "low"); assert.equal(typeof at.preview, "function");
  assert.ok(MODULE_IDS.includes("intel"));
  assert.deepEqual(Object.fromEntries(DEFAULT_ROLES.map((r) => [r.id, r.perms.intel])), { owner: "edit", admin: "edit", manager: "edit", member: "edit", finance: "none", creative: "view", viewer: "view" });
  assert.equal(moduleFor("GET", "/api/workspaces/1/intel/signals"), "intel");
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "mwiz-mir-"));
  fs.writeFileSync(path.join(d, "db.json"), JSON.stringify({ roles: [{ id: "creative", name: "Creative", perms: { command: "view" } }] }));
  assert.equal(new Store(d).db.roles.find((r) => r.id === "creative").perms.intel, "view"); fs.rmSync(d, { recursive: true, force: true });

  let script = [];
  const seen = [];
  const fakeClient = async (p) => { seen.push(p); const n = script.shift(); return typeof n === "function" ? n(p) : n; };
  const use = (id, name, input) => ({ stop_reason: "tool_use", model: "m", usage: { input_tokens: 10, output_tokens: 5 }, content: [{ type: "tool_use", id, name, input }] });
  const say = (text) => ({ stop_reason: "end_turn", model: "m", usage: { input_tokens: 10, output_tokens: 5 }, content: [{ type: "text", text }] });
  const k = await intelKit({ assistantClient: fakeClient });
  try {
    await k.j(`${k.X}/signals`, { title: "Meta Advantage+ catalog change", type: "platform_change", platform: "Meta", tags: ["catalog"], impact: "high" });
    script = [use("i1", "list_market_signals", { type: "platform_change" }), (p) => { const r = JSON.parse(p.messages.at(-1).content[0].content); assert.equal(r.shown, 1); assert.equal(r.signals[0].platform, "Meta"); return say("One platform change: Meta."); }];
    const a1 = await (await k.as(k.ck, "/api/assistant", "POST", { message: "Any platform changes?", ws: k.w.id })).json();
    assert.match(a1.reply, /Meta/);
    script = [use("i2", "add_market_signal", { title: "Salla raised app fees", type: "trend", impact: "med", source_url: "https://salla.sa/x" })];
    const a2 = await (await k.as(k.ck, "/api/assistant", "POST", { thread_id: a1.thread_id, message: "Log that Salla raised app fees", ws: k.w.id })).json();
    assert.match(a2.pending.summary, /Add the market signal "Salla raised app fees" \(trend, med impact\) from https:\/\/salla\.sa\/x/);
    assert.equal(k.st.db.intel_signals.length, 1);
    script = [say("Added.")];
    await k.as(k.ck, "/api/assistant/confirm", "POST", { thread_id: a1.thread_id, action_id: a2.pending.id, approve: true });
    assert.ok(k.st.db.intel_signals.some((s) => s.title === "Salla raised app fees"));

    // Permissions per role.
    const [mem, lead, fin, view, cre] = await Promise.all(["member", "manager", "finance", "viewer", "creative"].map(k.user));
    assert.equal((await k.as(fin, k.X)).status, 403); assert.equal((await k.as(fin, `${k.X}/signals`)).status, 403);
    assert.equal((await k.as(view, `${k.X}/signals`)).status, 200); assert.equal((await k.as(view, `${k.X}/signals`, "POST", { title: "x", type: "trend" })).status, 403);
    assert.equal((await k.as(cre, `${k.X}/competitors`)).status, 200); assert.equal((await k.as(cre, `${k.X}/competitors`, "POST", { name: "X" })).status, 403);
    assert.equal((await k.as(mem, `${k.X}/signals`, "POST", { title: "Member signal", type: "trend" })).status, 201);
    assert.equal((await k.as(lead, `${k.X}/sizing`, "PUT", { inputs: { pct_fit: { value: 20 } } })).status, 200);
    // The Viewer's assistant gets the read tool but not the write tool; Finance gets neither.
    script = [say("ok")]; await k.as(view, "/api/assistant", "POST", { message: "hi", ws: k.w.id });
    assert.ok(seen.at(-1).tools.some((t) => t.name === "list_market_signals") && !seen.at(-1).tools.some((t) => t.name === "add_market_signal"));
    script = [say("ok")]; await k.as(fin, "/api/assistant", "POST", { message: "hi", ws: k.w.id });
    assert.ok(!seen.at(-1).tools.some((t) => /market_signal/.test(t.name)));
    // Command Center: a brief waiting shows for Team members, not for Finance.
    await k.j(`${k.X}/briefs`, {});
    const cm = await (await k.as(mem, `${k.W}/command`)).json();
    assert.ok(cm.needs.some((n) => n.module === "Market intel"));
    const cf = await (await k.as(fin, `${k.W}/command`)).json();
    assert.ok(!cf.needs.some((n) => n.module === "Market intel"));
    assert.equal((await fetch(k.b2 + k.X)).status, 401);
  } finally { k.done(); }
});

test("intel sample data loads clearly marked rows and removes them; deleting a workspace clears intel rows", async () => {
  const k = await intelKit();
  try {
    const W = k.W;
    await k.j(`${k.X}/signals`, { title: "Real signal", type: "trend" });
    const loaded = (await k.j(`${W}/sample-data`, {})).body;
    assert.equal(loaded.intel_competitors, 2); assert.ok(loaded.intel_signals >= 5);
    const comps = (await k.j(`${k.X}/competitors`)).body;
    assert.ok(comps.every((c) => c.sample && c.name.startsWith("Sample · ")));
    // Imports from sample deals, tickets and feedback are sample rows too.
    const imp = (await k.j(`${k.X}/signals/import`, {})).body;
    assert.ok(imp.added.deal >= 1 && imp.added.ticket >= 1 && imp.added.feedback >= 1);
    const wl = (await k.j(`${k.X}/winloss`)).body;
    assert.ok(wl.won >= 3 && wl.lost >= 1); assert.ok(wl.by_competitor.some((r) => r.label === "Canva (in-house)"));
    await k.j(`${k.X}/briefs`, {});
    const rm = (await k.j(`${W}/sample-data`, undefined, "DELETE")).body;
    assert.equal(rm.intel_competitors, 2); assert.ok(rm.intel_signals >= 8);
    assert.deepEqual(k.st.db.intel_signals.filter((s) => s.workspace_id === k.w.id).map((s) => s.title), ["Real signal"]);
    assert.equal(k.st.db.intel_changes.filter((s) => s.workspace_id === k.w.id).length, 0);
    // Deleting a workspace clears its intel_* rows (and keeps other workspaces').
    k.st.db.intel_briefs.push({ id: "zb", workspace_id: "other" });
    assert.ok(k.st.deleteWorkspace(k.w.id));
    for (const c of ["intel_competitors", "intel_changes", "intel_signals", "intel_briefs"]) assert.equal(k.st.db[c].filter((x) => x.workspace_id === k.w.id).length, 0, c);
    assert.deepEqual(k.st.db.intel_briefs.map((b) => b.id), ["zb"]);
  } finally { k.done(); }
});

// ---- Goals & review (OKRs + weekly business review)
// A test app whose OKR clock can be moved (`k.at(iso)`) and whose AI can be swapped (`k.ai(fn)`; null = demo provider).
async function okrKit({ clock = null, assistantClient = null } = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "mwiz-okr-")), st = new Store(d);
  let t = clock ? Date.parse(clock) : null, ai = null;
  const prov = { name: "test", model: "test", async generate(a) { return ai ? ai(a.prompt) : demoProvider().generate(a); } };
  const app2 = createApp({ store: st, provider: prov, password: "pw-okr", assistantClient, okrOptions: { clock: () => (t == null ? Date.now() : t) } });
  const srv = app2.listen(0); await new Promise((r) => srv.once("listening", r));
  const b2 = `http://127.0.0.1:${srv.address().port}`;
  const login = async (body) => (await fetch(b2 + "/login", { method: "POST", redirect: "manual", body: new URLSearchParams(body) })).headers.get("set-cookie").split(";")[0];
  const ck = await login({ password: "pw-okr" });
  const as = async (c, p, m = "GET", body) => { const r = await fetch(b2 + p, { method: m, headers: { "Content-Type": "application/json", cookie: c }, body: body === undefined ? undefined : JSON.stringify(body) }); const txt = await r.text(); let j = null; try { j = JSON.parse(txt); } catch { j = txt; } return { status: r.status, body: j }; };
  const j = (p, body, m) => as(ck, p, m || (body === undefined ? "GET" : "POST"), body);
  const [w] = (await j("/api/workspaces")).body;
  const user = async (role) => { const email = `okr-${role}@dpa.ad`; await j("/api/admin/users", { name: `Okr ${role}`, email, password: `okr-${role}-pass1`, role_id: role }); return { ck: await login({ email, password: `okr-${role}-pass1` }), id: st.db.users.find((u) => u.email === email).id }; };
  return { app: app2, st, w, X: `/api/workspaces/${w.id}/okr`, W: `/api/workspaces/${w.id}`, j, as, ck, user, b2,
    at: (iso) => { t = Date.parse(iso); }, ai: (fn) => { ai = fn; },
    done: () => { srv.close(); app2.locals.crm.flush(); fs.rmSync(d, { recursive: true, force: true }); } };
}

test("okr objectives: create, key results (linked and manual), 2–5 rule, activate, edit, grade and close, locked when closed, delete", async () => {
  const k = await okrKit({ clock: "2026-11-02T09:00:00Z" });
  try {
    const meta = (await k.j(`${k.X}/meta`)).body;
    assert.equal(meta.current_quarter, "2026-Q4"); assert.deepEqual(meta.quarters, ["2026-Q3", "2026-Q4", "2027-Q1"]);
    assert.ok(meta.metrics.some((m) => m.id === "mrr_sar") && meta.metrics.some((m) => m.id === "cost_per_lead_sar"));
    assert.equal((await k.j(`${k.X}/objectives`, { title: "" })).status, 422);
    assert.equal((await k.j(`${k.X}/objectives`, { title: "Team goal", level: "team" })).status, 422); // a team objective needs its team
    assert.equal((await k.j(`${k.X}/objectives`, { title: "X", quarter: "Q4" })).status, 422);
    const o = (await k.j(`${k.X}/objectives`, { title: "Win the first paying stores", description: "Why" })).body;
    assert.equal(o.status, "draft"); assert.equal(o.quarter, "2026-Q4"); assert.equal(o.level, "company"); assert.equal(o.owner_id, "owner");
    assert.equal((await k.j(`${k.X}/objectives/${o.id}/krs`, { title: "Linked without metric", kind: "linked", target: 5 })).status, 422);
    assert.equal((await k.j(`${k.X}/objectives/${o.id}/krs`, { title: "No target", kind: "manual" })).status, 422);
    const a = (await k.j(`${k.X}/objectives/${o.id}/krs`, { title: "Deals won", kind: "linked", metric: "deals_won", target: 10 })).body;
    assert.equal((await k.j(`${k.X}/objectives/${o.id}/activate`, {})).status, 422); // only 1 key result
    const b = (await k.j(`${k.X}/objectives/${o.id}/krs`, { title: "Salla listing approved", kind: "manual", start: 0, target: 1, unit: "listing" })).body;
    const lk = a.krs.find((x) => x.kind === "linked"), mk = b.krs.find((x) => x.kind === "manual");
    assert.equal(lk.start, 0); assert.equal(lk.current, 0); assert.equal(lk.progress, 0); assert.equal(lk.ref, `K${lk.id}`); assert.match(lk.source, /Sales/);
    assert.equal(mk.current, 0); assert.equal(mk.unit, "listing");
    for (const n of [3, 4, 5]) assert.equal((await k.j(`${k.X}/objectives/${o.id}/krs`, { title: `KR ${n}`, kind: "manual", target: n })).status, 201);
    assert.equal((await k.j(`${k.X}/objectives/${o.id}/krs`, { title: "KR 6", kind: "manual", target: 6 })).status, 422); // at most 5
    // Check-ins wait for activation.
    assert.equal((await k.j(`${k.X}/krs/${mk.id}/checkins`, { value: 1 })).status, 422);
    const act = (await k.j(`${k.X}/objectives/${o.id}/activate`, {})).body;
    assert.equal(act.status, "active"); assert.ok(act.activated_at);
    const ed = (await k.j(`${k.X}/objectives/${o.id}`, { title: "Win 25 paying stores" }, "PUT")).body;
    assert.equal(ed.title, "Win 25 paying stores");
    const kr2 = (await k.j(`${k.X}/krs/${mk.id}`, { target: 2, current: 99, confidence: "off_track" }, "PUT")).body.krs.find((x) => x.id === mk.id);
    assert.equal(kr2.target, 2); assert.equal(kr2.current, 0); assert.equal(kr2.confidence, "on_track"); // value and confidence only change through a check-in
    // Close: a person's score from 0 to 1.0 and a retro; the rule-based suggestion is offered.
    const sug = (await k.j(`${k.X}/objectives/${o.id}/suggest-score`, {})).body;
    assert.equal(sug.score, 0); assert.equal(sug.by_ai, false);
    assert.equal((await k.j(`${k.X}/objectives/${o.id}/close`, { score: 1.4, retro: "x" })).status, 422);
    assert.equal((await k.j(`${k.X}/objectives/${o.id}/close`, { score: 0.6 })).status, 422);
    const cl = (await k.j(`${k.X}/objectives/${o.id}/close`, { score: 0.6, retro: "Listing took longer than planned." })).body;
    assert.equal(cl.status, "closed"); assert.equal(cl.score, 0.6); assert.equal(cl.can_edit, false);
    assert.equal((await k.j(`${k.X}/objectives/${o.id}`, { title: "y" }, "PUT")).status, 422);
    assert.equal((await k.j(`${k.X}/objectives/${o.id}`, undefined, "DELETE")).status, 422);
    assert.equal((await k.j(`${k.X}/krs/${mk.id}/checkins`, { value: 1 })).status, 422);
    // A draft deletes with its key results.
    const dr = (await k.j(`${k.X}/objectives`, { title: "Draft", krs: [{ title: "A", kind: "manual", target: 1 }, { title: "B", kind: "manual", target: 2 }] })).body;
    assert.equal(dr.krs.length, 2);
    assert.equal((await k.j(`${k.X}/objectives/${dr.id}`, undefined, "DELETE")).status, 204);
    assert.equal(k.st.db.okr_krs.filter((x) => x.objective_id === dr.id).length, 0);
    const list = (await k.j(`${k.X}/objectives?quarter=2026-Q4`)).body;
    assert.deepEqual(list.objectives.map((x) => x.id), [o.id]); assert.ok(list.log.some((l) => l.kind === "status" && l.to === "closed"));
    assert.equal((await k.j(`${k.X}/objectives?quarter=2026-Q3`)).body.objectives.length, 0);
  } finally { k.done(); }
});

test("okr linked metrics read the modules' own data (sample data), manual check-ins keep a history, members check in only on their own key results", async () => {
  const { mrrAt, addDays } = await import("../lib/billing.js");
  const { quarterOf, quarterRange, todayOf } = await import("../lib/okr.js");
  const k = await okrKit();
  try {
    await k.j(`${k.W}/crm/sample`, {});
    const loaded = (await k.j(`${k.W}/sample-data`, {})).body;
    assert.equal(loaded.okr_objectives, 3); assert.equal(loaded.okr_krs, 8);
    const list = (await k.j(`${k.X}/objectives`)).body;
    assert.equal(list.quarter, quarterOf(Date.now()));
    assert.ok(list.objectives.every((o) => o.sample && o.title.startsWith("Sample · ")));
    const krs = list.objectives.flatMap((o) => o.krs), by = (m) => krs.find((x) => x.metric === m);
    const tomorrow = addDays(todayOf(Date.now()), 1), cust = k.st.db.billing_customers.filter((c) => c.workspace_id === k.w.id && !c.archived);
    assert.ok(cust.length > 0);
    assert.equal(by("paying_stores").current, cust.filter((c) => mrrAt(c, tomorrow) > 0).length);
    const mrr = Math.round(cust.reduce((a, c) => a + mrrAt(c, tomorrow), 0) * 100) / 100;
    assert.equal(by("arr_usd").current, Math.round((mrr * 12) / 3.75));
    const { start } = quarterRange(list.quarter);
    assert.equal(by("deals_won").current, k.st.listDeals(k.w.id).filter((d) => d.stage === "paying" && d.stage_changed_at >= new Date(Date.parse(`${start}T00:00:00Z`) - 3 * 3600e3).toISOString()).length);
    assert.equal(by("paying_stores").progress, Math.round((by("paying_stores").current / 25) * 1000) / 10);

    // Manual check-in: value, confidence change logged, history newest first; linked check-ins never take a typed value.
    const manual = krs.find((x) => x.kind === "manual");
    assert.equal((await k.j(`${k.X}/krs/${manual.id}/checkins`, { confidence: "on_track" })).status, 422); // manual needs a value
    assert.equal((await k.j(`${k.X}/krs/${manual.id}/checkins`, { value: 1, confidence: "nope" })).status, 422);
    const ci = (await k.j(`${k.X}/krs/${manual.id}/checkins`, { value: 1, confidence: "on_track", note: "Approved by Salla" })).body;
    const mk = ci.objective.krs.find((x) => x.id === manual.id);
    assert.equal(mk.current, 1); assert.equal(mk.progress, 100); assert.equal(mk.confidence, "on_track"); assert.equal(mk.stale, false);
    assert.equal(mk.checkins[0].note, "Approved by Salla"); assert.equal(mk.checkins.length, 2);
    assert.ok(k.st.db.okr_log.some((l) => l.kr_id === manual.id && l.kind === "confidence" && l.from === "at_risk" && l.to === "on_track"));
    const lin = by("deals_won");
    const lc = (await k.j(`${k.X}/krs/${lin.id}/checkins`, { value: 999, confidence: "at_risk" })).body;
    assert.equal(lc.checkin.value, lin.current); // the live metric, not the typed number

    // Team member: no objective changes; check-ins only on key results they own. Viewer: read only.
    const mem = await k.user("member"), view = await k.user("viewer");
    const mine = (await k.j(`${k.X}/krs/${manual.id}`, { owner_id: mem.id }, "PUT")).body.krs.find((x) => x.id === manual.id);
    assert.equal(mine.owner_id, mem.id); assert.equal(mine.owner_name, "Okr member");
    assert.equal((await k.as(mem.ck, `${k.X}/objectives`, "POST", { title: "Mine" })).status, 403);
    assert.equal((await k.as(mem.ck, `${k.X}/objectives/${manual.objective_id}`, "PUT", { title: "Changed" })).status, 403);
    assert.equal((await k.as(mem.ck, `${k.X}/krs/${manual.id}`, "PUT", { target: 9 })).status, 403);
    const other = krs.find((x) => x.kind === "linked" && x.metric === "crm_replies");
    assert.equal((await k.as(mem.ck, `${k.X}/krs/${other.id}/checkins`, "POST", { confidence: "on_track" })).status, 403);
    const own = await k.as(mem.ck, `${k.X}/krs/${manual.id}/checkins`, "POST", { value: 1, note: "Still live" });
    assert.equal(own.status, 201); assert.equal(own.body.checkin.by, "Okr member");
    assert.equal((await k.as(view.ck, `${k.X}/objectives`)).status, 200);
    assert.equal((await k.as(view.ck, `${k.X}/krs/${manual.id}/checkins`, "POST", { value: 1 })).status, 403);
    // Metrics from modules a role can't view are hidden: Team members have no Finance or Billing (MRR, ARR, paying stores).
    const ml = (await k.as(mem.ck, `${k.X}/objectives`)).body.objectives.flatMap((o) => o.krs);
    const arr = ml.find((x) => x.metric === "arr_usd");
    assert.equal(arr.hidden, true); assert.equal(arr.current, null); assert.equal(arr.target, null); assert.match(arr.hidden_hint, /Finance or Billing/);
    assert.equal(ml.find((x) => x.metric === "deals_won").hidden, false);
    assert.ok((await k.as(mem.ck, `${k.X}/meta`)).body.metrics.find((m) => m.id === "mrr_sar").hidden);
    const o1 = (await k.as(mem.ck, `${k.X}/objectives`)).body.objectives.find((o) => o.krs.some((x) => x.metric === "arr_usd"));
    assert.equal(o1.partial, true);
    assert.ok(!JSON.stringify(o1).includes(String(by("arr_usd").current)));
  } finally { k.done(); }
});

test("okr weekly business review: drafted from Monday 07:00 Riyadh, safe to repeat, week-over-week maths, factual narrative from the demo AI", async () => {
  const { checkNarrative } = await import("../lib/okr.js");
  const k = await okrKit({ clock: "2026-11-01T21:30:00Z" }); // Monday 00:30 Riyadh
  try {
    const okr = k.app.locals.okr;
    // Deals won: 2 this week (26 Oct – 1 Nov), 1 last week, 0 two weeks ago, 1 three weeks ago.
    for (const [n, at] of [["A", "2026-10-27T10:00:00Z"], ["B", "2026-10-31T10:00:00Z"], ["C", "2026-10-21T10:00:00Z"], ["D", "2026-10-07T10:00:00Z"], ["E", "2026-11-02T10:00:00Z"]]) {
      const d = k.st.addDeal(k.w.id, { name: `Store ${n}`, stage: "paying" }); Object.assign(k.st.db.deals.find((x) => x.id === d.id), { stage: "paying", stage_changed_at: at, won_reason: n === "A" ? "Zid import" : "" });
    }
    const o = (await k.j(`${k.X}/objectives`, { title: "Close stores", krs: [{ title: "Deals won", kind: "linked", metric: "deals_won", target: 10 }, { title: "Case study", kind: "manual", target: 1 }] })).body;
    await k.j(`${k.X}/objectives/${o.id}/activate`, {});
    assert.equal((await okr.tick()).created, 0); // Monday, but before 07:00 Riyadh
    k.at("2026-11-02T03:59:00Z"); assert.equal((await okr.tick()).created, 0);
    k.at("2026-11-02T04:30:00Z"); assert.equal((await okr.tick()).created, 1);
    assert.equal((await okr.tick()).created, 0); // idempotent
    k.at("2026-11-04T10:00:00Z"); assert.equal((await okr.tick()).created, 0);
    assert.equal(k.st.db.okr_wbrs.length, 1);
    const list = (await k.j(`${k.X}/wbr`)).body;
    assert.equal(list.reviews.length, 1); assert.equal(list.reviews[0].week_start, "2026-11-02"); assert.equal(list.reviews[0].status, "draft");
    const r = (await k.j(`${k.X}/wbr/${list.reviews[0].id}`)).body;
    assert.equal(r.from, "2026-10-26"); assert.equal(r.to, "2026-11-01");
    const dw = r.data.metrics.find((m) => m.id === "deals_won");
    assert.deepEqual(dw.weeks, [2, 1, 0, 1]); assert.equal(dw.this_week, 2); assert.equal(dw.last_week, 1); assert.equal(dw.avg_4w, 1); assert.equal(dw.change, 1); assert.equal(dw.change_pct, 100);
    assert.deepEqual(r.data.winloss.map((x) => x.name).sort(), ["Store A", "Store B"]);
    assert.ok(r.data.okrs.some((g) => g.id === o.id)); assert.ok(r.data.cash && r.data.cash.ref === "F1");
    // The demo AI doesn't cite rows: the factual narrative is used; every number in it is in the rows.
    assert.equal(r.by_ai, false); assert.match(r.note, /factual summary/);
    assert.match(r.narrative, /Deals won: 2 this week vs 1 last week \(\+100%\), 4-week average 1 \[M\d+\]/);
    assert.match(r.narrative, /\[ADD\]/);
    const chk = checkNarrative(r.narrative, k.st.db.okr_wbrs[0].data);
    assert.deepEqual(chk.unsourced_numbers, []); assert.deepEqual(chk.unknown, []); assert.equal(chk.ok, true);
    assert.ok(k.st.db.agent_events.some((e) => e.agent_id === "chief_of_staff" && e.outcome === "escalated"));
    // A person drafting again gets the same review (no duplicate).
    const again = await k.j(`${k.X}/wbr`, {});
    assert.equal(again.status, 200); assert.equal(again.body.id, r.id); assert.equal(k.st.db.okr_wbrs.length, 1);
    // Print view.
    const pr = await k.j(`${k.X}/wbr/${r.id}/print`);
    assert.equal(pr.status, 200); assert.match(pr.body, /Weekly business review/); assert.match(pr.body, /Store A/);
  } finally { k.done(); }
});

test("okr narrative: an AI that invents numbers or rows is replaced by the facts; a cited one is kept; review lock, comments and hidden rows per role", async () => {
  const { checkNarrative, ruleNarrative } = await import("../lib/okr.js");
  const k = await okrKit({ clock: "2026-11-02T05:00:00Z" });
  try {
    const rowsOf = (p) => JSON.parse(/<rows count="\d+">\n([\s\S]*)\n<\/rows>/.exec(p)[1]);
    let seen = null;
    k.ai((p) => { seen = p; return "## Headlines\n- Revenue grew 37% thanks to Noon [M1]\n- Ask [Z9]"; });
    const bad = (await k.j(`${k.X}/wbr`, {})).body;
    assert.match(seen, /Never add facts/); assert.match(seen, /\[ADD\]/);
    assert.equal(bad.by_ai, false); assert.match(bad.note, /numbers that aren't in the rows|cited rows/); assert.doesNotMatch(bad.narrative, /37%|Noon/);
    // Uncited bullets are not accepted either.
    k.ai(() => "## Headlines\n- Everything is fine");
    assert.equal((await k.j(`${k.X}/wbr`, { refresh: true })).body.by_ai, false);
    // A narrative that cites rows and copies their values is kept as the AI's draft.
    k.ai((p) => { const rows = rowsOf(p), m = rows.find((x) => x.ref === "M1"); return `## Headlines\n- ${m.metric}: ${m.this_week ?? "no data"} [M1]\n- Why it moved: [ADD]\n- Deals this week: see [M8]`; });
    const good = (await k.j(`${k.X}/wbr`, { refresh: true })).body;
    assert.equal(good.by_ai, true); assert.match(good.narrative, /\[M1\]/); assert.deepEqual(good.issues, []);
    assert.equal(k.st.db.okr_wbrs.length, 1);
    // checkNarrative directly.
    const data = k.st.db.okr_wbrs[0].data;
    const c = checkNarrative("- MRR is 123456 [M2]\n- note\n- [Q1] x", data);
    assert.deepEqual(c.unsourced_numbers, ["123456"]); assert.equal(c.uncited, 2); assert.equal(c.ok, false);
    assert.equal(checkNarrative(ruleNarrative(data), data).ok, true);

    // Comments per section, edits, Owner marks reviewed → locked.
    const mem = await k.user("member"), lead = await k.user("manager"), fin = await k.user("finance");
    assert.equal((await k.j(`${k.X}/wbr/${good.id}/comments`, { section: "nope", text: "x" })).status, 422);
    const cm = await k.as(mem.ck, `${k.X}/wbr/${good.id}/comments`, "POST", { section: "metrics", text: "تأخر الربط مع زد" });
    assert.equal(cm.status, 201); assert.equal(cm.body.comments[0].by, "Okr member");
    assert.equal((await k.as(fin.ck, `${k.X}/wbr/${good.id}/comments`, "POST", { section: "cash", text: "x" })).status, 403); // Finance: view only
    assert.equal((await k.j(`${k.X}/wbr/${good.id}`, { narrative: good.narrative + "\n- Also [M999]" }, "PUT")).status, 422);
    const edited = (await k.j(`${k.X}/wbr/${good.id}`, { narrative: good.narrative + "\n- Owner for next step: [ADD]" }, "PUT")).body;
    assert.match(edited.narrative, /Owner for next step/);
    assert.equal((await k.as(lead.ck, `${k.X}/wbr/${good.id}/review`, "POST", {})).status, 403); // Team lead edits but doesn't mark reviewed
    assert.equal((await k.as(mem.ck, `${k.X}/wbr/${good.id}`, "PUT", { narrative: "x [M1]" })).status, 403);
    // Hidden rows: a Team member (no Finance or Billing) doesn't see MRR/ARR rows, the cash section, or any note line citing them.
    const mv = (await k.as(mem.ck, `${k.X}/wbr/${good.id}`)).body;
    assert.ok(!mv.data.metrics.some((m) => ["mrr_sar", "arr_usd", "paying_stores"].includes(m.id)));
    assert.equal(mv.data.cash, null); assert.equal(mv.partial, true); assert.doesNotMatch(mv.narrative, /\[M1\]/); assert.match(mv.narrative, /\[M8\]/);
    assert.equal(mv.can_edit, false); assert.equal(mv.can_review, false);
    const pm = (await k.as(mem.ck, `${k.X}/wbr/${good.id}/print`)).body;
    assert.doesNotMatch(pm, /ARR \(USD\)/); assert.doesNotMatch(pm, /Runway/);
    const fv = (await k.as(fin.ck, `${k.X}/wbr/${good.id}`)).body;
    assert.ok(fv.data.metrics.some((m) => m.id === "mrr_sar")); assert.ok(fv.data.cash);
    const rv = (await k.j(`${k.X}/wbr/${good.id}/review`, {})).body;
    assert.equal(rv.status, "reviewed"); assert.equal(rv.edited, true); assert.equal(rv.can_edit, false);
    assert.ok(k.st.db.agent_events.some((e) => e.agent_id === "chief_of_staff" && e.outcome === "edited"));
    assert.equal((await k.j(`${k.X}/wbr/${good.id}`, { narrative: "x" }, "PUT")).status, 422);
    assert.equal((await k.j(`${k.X}/wbr/${good.id}/comments`, { section: "metrics", text: "late" })).status, 422);
    assert.equal((await k.j(`${k.X}/wbr`, { refresh: true })).status, 409); // this week's review is locked
    assert.equal((await okrTickCount(k)), 0);
    // Switched off in AI Workforce: the next week's review is the factual summary, no AI call.
    await k.j("/api/workforce/agents/chief_of_staff", { level: 0 }, "PUT");
    k.at("2026-11-09T05:00:00Z"); seen = null; k.ai((p) => { seen = p; return "- x [M1]"; });
    const off = (await k.j(`${k.X}/wbr`, {})).body;
    assert.equal(off.by_ai, false); assert.match(off.note, /switched off/); assert.equal(seen, null);
    assert.equal((await k.j(`${k.X}/wbr`)).body.reviews.length, 2);
  } finally { k.done(); }
});
async function okrTickCount(k) { return (await k.app.locals.okr.tick()).created; }

test("okr Command Center: Home card with this quarter's company goals, stale check-ins and a review waiting as needs, redacted per role", async () => {
  const k = await okrKit({ clock: "2026-11-02T09:00:00Z" });
  try {
    const mem = await k.user("member"), cre = await k.user("creative");
    const o = (await k.j(`${k.X}/objectives`, { title: "Revenue", krs: [{ title: "MRR", kind: "linked", metric: "mrr_sar", start: 0, target: 100000 }, { title: "Listing", kind: "manual", target: 1, owner_id: mem.id }] })).body;
    await k.j(`${k.X}/objectives/${o.id}/activate`, {});
    const home = (await k.j(`${k.W}/command`)).body;
    assert.equal(home.okr.quarter, "2026-Q4"); assert.equal(home.okr.objectives[0].title, "Revenue"); assert.equal(home.okr.objectives[0].krs, 2);
    assert.ok(!home.needs.some((n) => n.module === "Goals & review"));
    k.at("2026-11-10T09:00:00Z"); // 8 days without a check-in
    const h2 = (await k.j(`${k.W}/command`)).body.needs.filter((n) => n.module === "Goals & review");
    assert.ok(h2.some((n) => n.title === "MRR" && /No check-in for 8 days/.test(n.text))); // the Owner's own KR
    assert.ok(h2.some((n) => n.title === "Key result check-ins" && /1 key result has/.test(n.text))); // others' KRs, for managers
    const hm = (await k.as(mem.ck, `${k.W}/command`)).body;
    assert.deepEqual(hm.needs.filter((n) => n.module === "Goals & review").map((n) => n.title), ["Listing"]);
    assert.equal(hm.okr.objectives[0].partial, true); // MRR hidden without Finance or Billing view
    assert.equal(hm.okr.objectives[0].progress, 0); // only the Listing KR counts
    const ch = (await k.as(cre.ck, `${k.W}/command`)).body;
    assert.ok(ch.okr); assert.ok(!ch.needs.some((n) => n.module === "Goals & review"));
    // A check-in clears the need; a draft review is a need for Owner/Admin only.
    await k.as(mem.ck, `${k.X}/krs/${o.krs.find((x) => x.title === "Listing").id}/checkins`, "POST", { value: 0, confidence: "at_risk" });
    assert.ok(!(await k.as(mem.ck, `${k.W}/command`)).body.needs.some((n) => n.module === "Goals & review"));
    await k.j(`${k.X}/wbr`, {});
    assert.ok((await k.j(`${k.W}/command`)).body.needs.some((n) => n.title === "Weekly business review"));
    assert.ok(!(await k.as(mem.ck, `${k.W}/command`)).body.needs.some((n) => n.title === "Weekly business review"));
    // Without the module: no card, no needs. The review job stored no Goals & review needs of its own.
    k.st.db.roles.find((r) => r.id === "creative").perms.okr = "none"; k.st.save();
    const cn = (await k.as(cre.ck, `${k.W}/command`)).body;
    assert.equal(cn.okr, null); assert.equal((await k.as(cre.ck, `${k.X}/objectives`)).status, 403);
    assert.ok(!k.st.db.okr_wbrs[0].data.needs.some((n) => n.module === "Goals & review"));
  } finally { k.done(); }
});

test("okr: AI Chief of staff agent, roles and module defaults, Ask DPA AD tools, sample data removal, workspace delete", async () => {
  const { AGENTS, agentFor } = await import("../lib/agents.js");
  const { TOOLS } = await import("../lib/assistant.js");
  const { DEFAULT_ROLES, moduleFor, MODULE_IDS } = await import("../lib/access.js");
  const ag = AGENTS.find((a) => a.id === "chief_of_staff");
  assert.equal(ag.name, "AI Chief of staff"); assert.equal(ag.team, "Leadership"); assert.equal(ag.max, 1); assert.equal(ag.module, "okr");
  assert.equal(agentFor("POST", "/api/workspaces/1/okr/wbr"), "chief_of_staff");
  assert.ok(MODULE_IDS.includes("okr")); assert.equal(moduleFor("POST", "/api/workspaces/1/okr/krs/3/checkins"), "okr");
  assert.deepEqual(Object.fromEntries(DEFAULT_ROLES.map((r) => [r.id, r.perms.okr])), { owner: "edit", admin: "edit", manager: "edit", member: "edit", finance: "view", creative: "view", viewer: "view" });
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "mwiz-okrr-"));
  fs.writeFileSync(path.join(d, "db.json"), JSON.stringify({ roles: [{ id: "finance", name: "Finance", perms: { command: "view" } }] }));
  assert.equal(new Store(d).db.roles.find((r) => r.id === "finance").perms.okr, "view"); fs.rmSync(d, { recursive: true, force: true });
  const lt = TOOLS.find((t) => t.name === "list_okrs"), ct = TOOLS.find((t) => t.name === "okr_check_in");
  assert.equal(lt.module, "okr"); assert.ok(!lt.write); assert.equal(ct.module, "okr"); assert.equal(ct.write, true); assert.equal(ct.risk, "low"); assert.equal(typeof ct.preview, "function");

  let script = [];
  const fakeClient = async (p) => { const n = script.shift(); return typeof n === "function" ? n(p) : n; };
  const use = (id, name, input) => ({ stop_reason: "tool_use", model: "m", usage: { input_tokens: 10, output_tokens: 5 }, content: [{ type: "tool_use", id, name, input }] });
  const say = (text) => ({ stop_reason: "end_turn", model: "m", usage: { input_tokens: 10, output_tokens: 5 }, content: [{ type: "text", text }] });
  const k = await okrKit({ assistantClient: fakeClient });
  try {
    const real = (await k.j(`${k.X}/objectives`, { title: "Real goal", krs: [{ title: "Listing approved", kind: "manual", target: 1 }, { title: "Deals", kind: "linked", metric: "deals_won", target: 5 }] })).body;
    await k.j(`${k.X}/objectives/${real.id}/activate`, {});
    const kr = real.krs.find((x) => x.kind === "manual");
    script = [use("o1", "list_okrs", {}), (p) => { const r = JSON.parse(p.messages.at(-1).content[0].content); assert.equal(r.objectives[0].title, "Real goal"); assert.equal(r.objectives[0].key_results.length, 2); return say("One objective."); }];
    const a1 = (await k.as(k.ck, "/api/assistant", "POST", { message: "How are our goals?", ws: k.w.id })).body;
    assert.match(a1.reply, /One objective/);
    script = [use("o2", "okr_check_in", { kr_id: kr.id, value: 1, confidence: "on_track", note: "Approved today" })];
    const a2 = (await k.as(k.ck, "/api/assistant", "POST", { thread_id: a1.thread_id, message: "Salla approved the listing", ws: k.w.id })).body;
    assert.match(a2.pending.summary, /Check in on "Listing approved": value 1, on track, note "Approved today"/);
    assert.equal(k.st.db.okr_checkins.length, 0);
    script = [say("Done.")];
    await k.as(k.ck, "/api/assistant/confirm", "POST", { thread_id: a1.thread_id, action_id: a2.pending.id, approve: true });
    const ci = k.st.db.okr_checkins.find((c) => c.kr_id === kr.id);
    assert.equal(ci.value, 1); assert.equal(ci.via, "assistant");

    // Sample objectives go with Remove sample data; real ones stay.
    await k.j(`${k.W}/sample-data`, {});
    assert.equal(k.st.db.okr_objectives.filter((o) => o.sample).length, 3);
    const rm = (await k.j(`${k.W}/sample-data`, undefined, "DELETE")).body;
    assert.equal(rm.okr_objectives, 3); assert.equal(rm.okr_krs, 8);
    assert.deepEqual(k.st.db.okr_objectives.map((o) => o.title), ["Real goal"]);
    assert.ok(!k.st.db.okr_krs.some((x) => x.sample) && !k.st.db.okr_checkins.some((x) => x.sample) && !k.st.db.okr_log.some((x) => x.sample));
    // Deleting a workspace clears its okr_* rows and keeps other workspaces'.
    await k.j(`${k.X}/wbr`, {});
    k.st.db.okr_objectives.push({ id: "zo", workspace_id: "other" });
    assert.ok(k.st.deleteWorkspace(k.w.id));
    for (const c of ["okr_objectives", "okr_krs", "okr_checkins", "okr_log", "okr_wbrs"]) assert.equal(k.st.db[c].filter((x) => x.workspace_id === k.w.id).length, 0, c);
    assert.deepEqual(k.st.db.okr_objectives.map((o) => o.id), ["zo"]);
  } finally { k.done(); }
});

// ---- Meetings → tasks
// A test app whose Meetings clock can be moved (`k.at(iso)`) and whose AI can be swapped (`k.ai(fn)`; null = demo provider).
async function mtKit({ clock = null, assistantClient = null, outreachOptions = {} } = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "mwiz-mt-")), st = new Store(d);
  let t = clock ? Date.parse(clock) : null, ai = null;
  const prov = { name: "test", model: "test", async generate(a) { return ai ? ai(a.prompt) : demoProvider().generate(a); } };
  const app2 = createApp({ store: st, provider: prov, password: "pw-mt", assistantClient, outreachOptions, meetingsOptions: { clock: () => (t == null ? Date.now() : t) } });
  const srv = app2.listen(0); await new Promise((r) => srv.once("listening", r));
  const b2 = `http://127.0.0.1:${srv.address().port}`;
  const login = async (body) => (await fetch(b2 + "/login", { method: "POST", redirect: "manual", body: new URLSearchParams(body) })).headers.get("set-cookie").split(";")[0];
  const ck = await login({ password: "pw-mt" });
  const as = async (c, p, m = "GET", body) => { const r = await fetch(b2 + p, { method: m, headers: { "Content-Type": "application/json", cookie: c }, body: body === undefined ? undefined : JSON.stringify(body) }); const txt = await r.text(); let j = null; try { j = JSON.parse(txt); } catch { j = txt; } return { status: r.status, body: j }; };
  const j = (p, body, m) => as(ck, p, m || (body === undefined ? "GET" : "POST"), body);
  const [w] = (await j("/api/workspaces")).body;
  const user = async (role, tag = role) => { const email = `mt-${tag}@dpa.ad`; await j("/api/admin/users", { name: `Mt ${tag}`, email, password: `mt-${tag}-pass1`, role_id: role }); return { ck: await login({ email, password: `mt-${tag}-pass1` }), id: st.db.users.find((u) => u.email === email).id, name: `Mt ${tag}` }; };
  return { app: app2, st, w, X: `/api/workspaces/${w.id}/meetings`, W: `/api/workspaces/${w.id}`, j, as, ck, user, b2,
    at: (iso) => { t = Date.parse(iso); }, ai: (fn) => { ai = fn; },
    done: () => { srv.close(); app2.locals.crm.flush(); fs.rmSync(d, { recursive: true, force: true }); } };
}
// A minimal .docx (zip with word/document.xml, deflated) for the upload test.
async function mtDocx(paragraphs) {
  const zlib = await import("node:zlib");
  const xml = Buffer.from(`<?xml version="1.0"?><w:document xmlns:w="x"><w:body>${paragraphs.map((p) => `<w:p><w:r><w:t>${p.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</w:t></w:r></w:p>`).join("")}</w:body></w:document>`, "utf8");
  const data = zlib.deflateRawSync(xml), name = Buffer.from("word/document.xml");
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(xml.length, 22); local.writeUInt16LE(name.length, 26);
  const cen = Buffer.alloc(46); cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(8, 10); cen.writeUInt32LE(data.length, 20); cen.writeUInt32LE(xml.length, 24); cen.writeUInt16LE(name.length, 28); cen.writeUInt32LE(0, 42);
  const body = Buffer.concat([local, name, data]), dir = Buffer.concat([cen, name]);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(body.length, 16);
  return Buffer.concat([body, dir, end]);
}

test("meetings: create, list, edit and delete with validation; investor and hiring meetings only for Owner/Admin, attendees and the creator", async () => {
  const k = await mtKit({ clock: "2026-11-03T09:00:00Z" });
  try {
    const meta = (await k.j(`${k.X}/meta`)).body;
    assert.deepEqual(meta.types.map((t) => t.id), ["internal", "sales_call", "customer", "partner", "investor", "hiring"]);
    assert.equal(meta.today, "2026-11-03"); assert.ok(meta.targets.every((t) => t.allowed));
    assert.equal((await k.j(k.X, { title: "", date: "2026-11-03" })).status, 422);
    assert.equal((await k.j(k.X, { title: "X", date: "03/11/2026" })).status, 422);
    assert.equal((await k.j(k.X, { title: "X", date: "2026-11-03", time: "25:00" })).status, 422);
    assert.equal((await k.j(k.X, { title: "X", date: "2026-11-03", type: "party" })).status, 422);
    assert.equal((await k.j(k.X, { title: "X", date: "2026-11-03", attendees: [{ name: "A", email: "not-an-email" }] })).status, 422);
    assert.equal((await k.j(k.X, { title: "X", date: "2026-11-03", links: { deal_id: "999" } })).status, 422);
    const lead = await k.user("manager", "lead"), mem = await k.user("member", "mem"), fin = await k.user("finance", "fin"), view = await k.user("viewer", "view");
    const m = (await k.j(k.X, { title: "Weekly sync", date: "2026-11-03", time: "13:30", agenda: "Pipeline", attendees: [{ user_id: mem.id }, { user_id: mem.id }, { name: "Nora", email: "NORA@oud.sa", org: "Oud" }] })).body;
    assert.equal(m.type, "internal"); assert.equal(m.time, "13:30"); assert.equal(m.starts_at, "2026-11-03T10:30:00.000Z"); // Riyadh is UTC+3
    assert.equal(m.attendees.length, 2); assert.equal(m.attendees[0].name, "Mt mem"); assert.deepEqual(m.attendees[1], { kind: "external", name: "Nora", email: "nora@oud.sa", org: "Oud" });
    assert.equal(m.external, true); assert.equal(m.created_by_id, "owner");
    const ed = (await k.j(`${k.X}/${m.id}`, { title: "Weekly team sync", time: "09:00" }, "PUT")).body;
    assert.equal(ed.title, "Weekly team sync"); assert.equal(ed.starts_at, "2026-11-03T06:00:00.000Z"); assert.equal(ed.agenda, "Pipeline");
    assert.equal((await k.j(`${k.X}/${m.id}`, { title: "" }, "PUT")).status, 422);
    // Roles: Finance views, Viewer has no access, members edit.
    assert.equal((await k.as(fin.ck, k.X)).status, 200); assert.equal((await k.as(fin.ck, k.X, "POST", { title: "F", date: "2026-11-03" })).status, 403);
    assert.equal((await k.as(view.ck, k.X)).status, 403);
    // Investor and hiring: Owner/Admin, attendees and the creator only (404 for everyone else, also by id).
    const inv = (await k.j(k.X, { title: "Seed round", date: "2026-11-04", type: "investor", attendees: [{ user_id: lead.id }] })).body;
    const hire = (await k.as(mem.ck, k.X, "POST", { title: "Interview", date: "2026-11-05", type: "hiring" })).body;
    const seen = async (c) => (await k.as(c, k.X)).body.meetings.map((x) => x.title).sort();
    assert.deepEqual(await seen(k.ck), ["Interview", "Seed round", "Weekly team sync"]);
    assert.deepEqual(await seen(lead.ck), ["Seed round", "Weekly team sync"]);
    assert.deepEqual(await seen(mem.ck), ["Interview", "Weekly team sync"]);
    assert.deepEqual(await seen(fin.ck), ["Weekly team sync"]);
    assert.equal((await k.as(mem.ck, `${k.X}/${inv.id}`)).status, 404); assert.equal((await k.as(fin.ck, `${k.X}/${hire.id}`)).status, 404);
    assert.equal((await k.as(mem.ck, `${k.X}/${inv.id}/notes`, "POST", { text: "x" })).status, 404);
    assert.equal((await k.as(lead.ck, `${k.X}/${inv.id}`, "PUT", { attendees: [] })).status, 422); // would lock the lead out
    assert.equal((await k.j(`${k.X}?type=investor`)).body.meetings.length, 1);
    assert.equal((await k.j(`${k.X}/${m.id}`, undefined, "DELETE")).status, 204);
    assert.equal((await k.j(`${k.X}/${m.id}`)).status, 404);
  } finally { k.done(); }
});

test("meetings notes: paste, .txt/.vtt/.srt/.docx upload to plain speaker lines, audio refused, 200 KB limit", async () => {
  const { parseVtt, parseSrt, notesFromFile } = await import("../lib/meetings.js");
  const vtt = "WEBVTT\n\nNOTE recorded\n\n1\n00:00:01.000 --> 00:00:03.500\n<v Sara Ali>Hello everyone.</v>\n\n2\n00:00:03.500 --> 00:00:05.000\n<v Sara Ali>Action: send the deck</v>\n\n00:00:05.000 --> 00:00:07.000 align:start\n<v Omar><i>سوف أرسل العرض</i></v>\n\n00:00:07.000 --> 00:00:09.000\nKhalid: TODO book the demo\n";
  assert.equal(parseVtt(vtt), "Sara Ali: Hello everyone. Action: send the deck\nOmar: سوف أرسل العرض\nKhalid: TODO book the demo");
  const srt = "1\r\n00:00:01,000 --> 00:00:02,000\r\n[Nora] We need video ads.\r\n\r\n2\r\n00:00:02,000 --> 00:00:04,000\r\n[Nora] Mostly for oud.\r\n\r\n3\r\n00:00:04,000 --> 00:00:06,000\r\n<i>Owner: - [ ] share pricing</i>\r\n";
  assert.equal(parseSrt(srt), "Nora: We need video ads. Mostly for oud.\nOwner: - [ ] share pricing");
  assert.match(notesFromFile("call.m4a", { text: "x" }).error, /can't be transcribed/);
  assert.match(notesFromFile("deck.pdf", { text: "x" }).error, /\.txt, \.vtt, \.srt or \.docx/);
  assert.equal(notesFromFile("a.vtt", { b64: Buffer.from(vtt).toString("base64") }).text.split("\n").length, 3);
  const k = await mtKit();
  try {
    const m = (await k.j(k.X, { title: "Call", date: "2026-11-03", type: "customer" })).body;
    assert.equal((await k.j(`${k.X}/${m.id}/notes`, { text: "  " })).status, 422);
    const a = (await k.j(`${k.X}/${m.id}/notes`, { text: "Line one\r\nLine two" })).body;
    assert.equal(a.notes, "Line one\nLine two"); assert.equal(a.notes_source, "paste"); assert.ok(a.notes_at);
    const b = (await k.j(`${k.X}/${m.id}/notes`, { filename: "zoom.vtt", text: vtt, append: true })).body;
    assert.match(b.notes, /^Line one\nLine two\n\nSara Ali: Hello everyone\./); assert.equal(b.notes_source, "file:zoom.vtt");
    const c = (await k.j(`${k.X}/${m.id}/notes`, { filename: "meet.srt", file_b64: Buffer.from(srt).toString("base64") })).body;
    assert.equal(c.notes, "Nora: We need video ads. Mostly for oud.\nOwner: - [ ] share pricing");
    const docx = await mtDocx(["Decision: launch on Salla first", "Action: Owner to call Nora & Co", "المطلوب: تجهيز العينات"]);
    const dx = (await k.j(`${k.X}/${m.id}/notes`, { filename: "notes.docx", file_b64: docx.toString("base64") })).body;
    assert.equal(dx.notes, "Decision: launch on Salla first\nAction: Owner to call Nora & Co\nالمطلوب: تجهيز العينات");
    assert.equal((await k.j(`${k.X}/${m.id}/notes`, { filename: "bad.docx", file_b64: Buffer.from("hello").toString("base64") })).status, 422);
    assert.equal((await k.j(`${k.X}/${m.id}/notes`, { filename: "rec.mp3", file_b64: "AAAA" })).status, 422);
    assert.equal((await k.j(`${k.X}/${m.id}/notes`, { text: "x".repeat(200_001) })).status, 413);
    assert.equal((await k.j(k.X, { title: "Big", date: "2026-11-03", notes: "y".repeat(200_001) })).status, 413);
  } finally { k.done(); }
});

test("meetings secretary: rule-based extractor (English and Arabic); demo and invalid JSON fall back; checked AI JSON is kept; invented numbers, quotes and ungrounded items are refused", async () => {
  const { ruleExtract, checkDraft } = await import("../lib/meetings.js");
  const att = [{ kind: "user", user_id: "u1", name: "Sara Ali" }, { kind: "external", name: "Nora", email: "" }];
  const notes = "Sara Ali: Hello all\n- Action: Sara to send the deck by 2026-11-06\n* TODO: update the help center\n- [ ] book the Zid test\nOmar: Next steps: Nora shares the product feed\nسوف نرسل العينات يوم الأحد\nالمطلوب: تجهيز قوالب رمضان\nمهمة: مراجعة الأسعار\nDecision: start with 3 perfume stores\nقررنا: نبدأ بسلة\nWho owns the Snap pixel?\nهل نحتاج موافقة؟\nJust a normal line.";
  const r = ruleExtract(notes, att);
  assert.deepEqual(r.items.map((x) => x.text), ["Sara to send the deck by 2026-11-06", "update the help center", "book the Zid test", "Nora shares the product feed", "سوف نرسل العينات يوم الأحد", "تجهيز قوالب رمضان", "مراجعة الأسعار"]);
  assert.equal(r.items[0].owner_id, "u1"); assert.equal(r.items[0].due, "2026-11-06"); assert.equal(r.items[3].owner_name, "Nora"); assert.equal(r.items[1].owner_id, null); assert.equal(r.items[1].due, null);
  assert.deepEqual(r.decisions, ["start with 3 perfume stores", "نبدأ بسلة"]);
  assert.deepEqual(r.questions, ["Who owns the Snap pixel?", "هل نحتاج موافقة؟"]);
  const m0 = { title: "T", notes, attendees: att, links: { deal_id: "5" } };
  assert.equal(checkDraft("not json", m0, "2026-11-03").ok, false);
  assert.equal(checkDraft(JSON.stringify({ summary: "We agreed on 12 stores.", action_items: [] }), m0, "2026-11-03").ok, false); // 12 isn't in the notes
  assert.equal(checkDraft(JSON.stringify({ summary: 'Sara said "we will win everything".', action_items: [] }), m0, "2026-11-03").ok, false);
  const good = checkDraft(JSON.stringify({ summary: 'Kick-off: start with 3 perfume stores, "book the Zid test".', decisions: ["Start with 3 perfume stores"], open_questions: ["Who owns the Snap pixel?"],
    action_items: [{ text: "Send the deck", owner: "Sara Ali", due: "2026-11-06", module: "deal", source: "- Action: Sara to send the deck by 2026-11-06" },
      { text: "Share the feed", owner: "Someone", due: "[ADD]", module: "crm", source: "Nora shares the product feed" },
      { text: "Invented", owner: "[ADD]", due: "[ADD]", module: "ops", source: "a line that isn't there" }] }), m0, "2026-11-03");
  assert.equal(good.ok, true); assert.equal(good.draft.items.length, 2); assert.match(good.issues[0], /Dropped "Invented"/);
  assert.deepEqual(good.draft.items.map((x) => [x.owner_id, x.due, x.target]), [["u1", "2026-11-06", "deal"], [null, null, "ops"]]); // no store linked: crm → ops

  const k = await mtKit({ clock: "2026-11-03T09:00:00Z" });
  try {
    const m = (await k.j(k.X, { title: "Kick-off", date: "2026-11-03", attendees: [{ name: "Nora", email: "" }] })).body;
    assert.equal((await k.j(`${k.X}/${m.id}/draft`, {})).status, 422); // no notes yet
    await k.j(`${k.X}/${m.id}/notes`, { text: notes });
    // Demo provider: not JSON → factual draft built by the rules, an escalated outcome.
    const d1 = (await k.j(`${k.X}/${m.id}/draft`, {})).body.draft;
    assert.equal(d1.by_ai, false); assert.match(d1.note, /expected JSON/); assert.match(d1.summary, /^\[ADD\]/);
    assert.equal(d1.items.length, 7); assert.ok(d1.items.every((x) => x.target === "ops" && x.state === "draft" && x.id));
    assert.ok(k.st.db.agent_events.some((e) => e.agent_id === "meeting_secretary" && e.outcome === "escalated"));
    let seen = "";
    k.ai((p) => { seen = p; return JSON.stringify({ summary: "Kick-off with Nora.", decisions: [], open_questions: [], action_items: [{ text: "Update the help center", owner: "[ADD]", due: "[ADD]", module: "ops", source: "* TODO: update the help center" }] }); });
    const d2 = (await k.j(`${k.X}/${m.id}/draft`, {})).body.draft;
    assert.equal(d2.by_ai, true); assert.equal(d2.summary, "Kick-off with Nora."); assert.equal(d2.items.length, 1);
    assert.match(seen, /Never invent numbers/); assert.match(seen, /<notes>\n[\s\S]*Just a normal line\./); assert.match(seen, /- Nora \(outside DPA AD\)/);
    k.ai(() => JSON.stringify({ summary: "Revenue will grow 40%.", action_items: [] }));
    const d3 = (await k.j(`${k.X}/${m.id}/draft`, {})).body.draft;
    assert.equal(d3.by_ai, false); assert.match(d3.note, /numbers that aren't in the notes \(40\)/);
    // Switched off in AI Workforce: rules only, no AI call.
    k.app.locals.workforce.set("meeting_secretary", { level: 0 });
    seen = ""; const d4 = (await k.j(`${k.X}/${m.id}/draft`, {})).body.draft;
    assert.equal(seen, ""); assert.equal(d4.by_ai, false); assert.match(d4.note, /switched off/);
    // A person edits the draft: summary, an item's owner/date/module, and adds one.
    const ed = (await k.j(`${k.X}/${m.id}/draft`, { summary: "Kick-off.", items: [{ id: d4.items[0].id, owner_id: "owner", due: "2026-11-10", target: "ops" }, { text: "New item", target: "ops" }] }, "PUT")).body.draft;
    assert.equal(ed.summary, "Kick-off."); assert.equal(ed.items.length, 2); assert.equal(ed.items[0].owner_name, "Owner"); assert.equal(ed.items[1].added, true);
    assert.equal((await k.j(`${k.X}/${m.id}/draft`, { items: [{ id: d4.items[0].id, due: "soon" }] }, "PUT")).status, 422);
    assert.equal((await k.j(`${k.X}/${m.id}/draft`, { items: [{ id: d4.items[0].id, target: "finance" }] }, "PUT")).status, 422);
  } finally { k.done(); }
});

test("meetings review and create: ops task, deal next action, CRM note, Success task, hiring note and OKR note, each linked back; refused without Edit on the target", async () => {
  const k = await mtKit({ clock: "2026-11-03T09:00:00Z" });
  try {
    await k.j(`${k.W}/crm/sample`, {}); await k.j(`${k.W}/sample-data`, {});
    const crm = k.app.locals.crm;
    const deal = (await k.j(`${k.W}/deals`, { name: "Oud Co" })).body;
    const store = crm.add(k.w.id, { store_name: "Oud Co store", domain: "oudco.sa", email: "nora@oudco.sa" });
    const cust = k.st.db.billing_customers.find((c) => c.workspace_id === k.w.id && c.sample);
    const cand = (await k.j(`${k.W}/hr/candidates`, { name: "Huda" })).body;
    const obj = (await k.j(`${k.W}/okr/objectives`, { title: "Win stores", krs: [{ title: "Listing", kind: "manual", target: 1 }, { title: "Deals", kind: "linked", metric: "deals_won", target: 5 }] })).body;
    await k.j(`${k.W}/okr/objectives/${obj.id}/activate`, {});
    const kr = obj.krs.find((x) => x.kind === "manual");
    const mem = await k.user("member", "mem2"), cre = await k.user("creative", "cre");
    const m = (await k.j(k.X, { title: "Customer call", date: "2026-11-03", type: "customer", attendees: [{ user_id: mem.id }, { name: "Nora", email: "nora@oudco.sa" }],
      links: { deal_id: deal.id, store_id: store.id, customer_id: cust.id, candidate_id: cand.id } })).body;
    assert.equal(m.link_info.deal.label, "Oud Co"); assert.equal(m.link_info.store.label, "Oud Co store"); assert.equal(m.link_info.candidate.label, "Huda");
    await k.j(`${k.X}/${m.id}/notes`, { text: "Action: Mt mem2 to fix the feed by 2026-11-05\nTODO: send the proposal\nTODO: log the call\nTODO: renewal check\nTODO: second interview\nTODO: listing update\nTODO: skip me" });
    const d = (await k.j(`${k.X}/${m.id}/draft`, {})).body.draft;
    assert.equal(d.items[0].owner_id, mem.id); assert.equal(d.items[0].due, "2026-11-05");
    const [i1, i2, i3, i4, i5, i6, i7] = d.items.map((x) => x.id);
    // The Creative role can edit Meetings but not Operations or Sales: those items are refused, nothing is created.
    const refused = (await k.as(cre.ck, `${k.X}/${m.id}/create`, "POST", { items: [{ id: i1, target: "ops" }, { id: i2, target: "deal" }] })).body;
    assert.equal(refused.created, 0); assert.equal(refused.refused.length, 2); assert.match(refused.refused[0].error, /can't change Operations task/); assert.equal(refused.refused[0].status, 403);
    // A Team member can't edit Team & hiring (view only): the hiring item is refused, the rest go through.
    const r1 = (await k.as(mem.ck, `${k.X}/${m.id}/create`, "POST", { items: [{ id: i1, target: "ops" }, { id: i2, target: "deal", due: "2026-11-04" }, { id: i3, target: "crm" }, { id: i5, target: "hiring" }] })).body;
    assert.equal(r1.created, 3); assert.deepEqual(r1.refused.map((x) => x.id), [i5]);
    const task = k.st.db.ops_tasks.find((t) => t.meeting_id === m.id);
    assert.equal(task.title, "Mt mem2 to fix the feed by 2026-11-05"); assert.equal(task.owner, "Mt mem2"); assert.equal(task.owner_kind, "human"); assert.equal(task.due, "2026-11-05"); assert.equal(task.source, "meeting"); assert.match(task.notes, new RegExp(`Meetings #${m.id}`));
    const dl = (await k.j(`${k.W}/deals/${deal.id}`)).body;
    assert.equal(dl.deal.next_step.text, "send the proposal"); assert.equal(dl.deal.next_step.meeting_id, m.id);
    assert.equal(dl.deal.next.owner, "you"); assert.match(dl.deal.next.text, /^send the proposal, due 2026-11-04/); assert.equal(dl.deal.next.meeting_id, m.id);
    assert.ok(dl.activities.some((a) => a.type === "note" && /Next action: send the proposal/.test(a.text) && a.meeting_id === m.id));
    const note = crm.notesFor(store.id).find((n) => n.meeting_id === m.id);
    assert.match(note.text, /^log the call\nFrom meeting "Customer call" on 2026-11-03/);
    // The Owner creates the rest: Success task, hiring note, OKR note (needs a key result), and skips one.
    assert.equal((await k.j(`${k.X}/${m.id}/create`, { items: [{ id: i6, target: "okr" }] })).body.refused[0].error, "Pick the key result this note is for.");
    const r2 = (await k.j(`${k.X}/${m.id}/create`, { items: [{ id: i4, target: "success", owner_id: mem.id }, { id: i5, target: "hiring" }, { id: i6, target: "okr", kr_id: kr.id }, { id: i7, selected: false }, { id: i1, target: "ops" }] })).body;
    assert.equal(r2.created, 3); assert.equal(r2.refused[0].error, "Already created");
    const al = k.st.db.success_alerts.find((a) => a.meeting_id === m.id);
    assert.equal(al.type, "meeting_action"); assert.equal(al.owner_id, mem.id); assert.equal(al.customer_id, cust.id); assert.match(al.reason, /^renewal check/); assert.ok(al.steps.length >= 3);
    const ha = k.st.listHrActivities("candidate", cand.id).find((a) => a.meeting_id === m.id);
    assert.match(ha.text, /^second interview/);
    const ol = k.st.db.okr_log.find((l) => l.meeting_id === m.id);
    assert.equal(ol.kr_id, kr.id); assert.match(ol.text, /^Note: listing update/);
    const full = (await k.j(`${k.X}/${m.id}`)).body;
    assert.equal(full.draft.status, "reviewed"); assert.equal(full.items.length, 6);
    assert.deepEqual(full.draft.items.map((x) => x.state), ["created", "created", "created", "created", "created", "created", "skipped"]);
    assert.ok(full.items.every((x) => x.meeting_id === m.id && x.ref_id && x.route));
    assert.equal(full.items.find((x) => x.target === "deal").route, "pipeline");
    // A rule-based draft records no AI outcome; an AI draft that a person edits records "edited".
    assert.ok(!k.st.db.agent_events.some((e) => e.agent_id === "meeting_secretary" && ["accepted", "edited", "rejected"].includes(e.outcome)));
    const m2 = (await k.j(k.X, { title: "Ops sync", date: "2026-11-03", notes: "TODO: renew the domain" })).body;
    k.ai(() => JSON.stringify({ summary: "Domain renewal.", action_items: [{ text: "Renew the domain", owner: "[ADD]", due: "[ADD]", module: "ops", source: "TODO: renew the domain" }] }));
    const d2 = (await k.j(`${k.X}/${m2.id}/draft`, {})).body.draft;
    await k.j(`${k.X}/${m2.id}/create`, { items: [{ id: d2.items[0].id, due: "2026-11-20" }] });
    assert.ok(k.st.db.agent_events.some((e) => e.agent_id === "meeting_secretary" && e.outcome === "edited"));
    assert.equal((await k.j(`${k.X}/${m2.id}/draft`, {})).status, 409); // reviewed: drafting again needs force
  } finally { k.done(); }
});

test("meetings follow-up: Arabic-first draft for outside attendees; never sent in Test mode or to sample stores; [ADD], links, CRM rights and Saudi hours checked", async () => {
  const sent = [];
  const { channelConfig } = await import("../lib/outreach.js");
  const cfg = channelConfig({ SMTP_HOST: "smtp.test", SMTP_USER: "u", SMTP_PASS: "p", MAIL_FROM: "hi@dpa.ad", PUBLIC_URL: "https://wizard.dpa.ad" });
  const k = await mtKit({ clock: "2026-11-03T09:00:00Z", outreachOptions: { cfg, senders: { email: async (x) => { sent.push(x); return { provider_id: "p1" }; }, whatsapp: async () => { throw new Error("no"); } } } });
  try {
    const crm = k.app.locals.crm;
    const store = crm.add(k.w.id, { store_name: "Oud Co", domain: "oudco.sa", email: "nora@oudco.sa" });
    const internal = (await k.j(k.X, { title: "Team", date: "2026-11-03" })).body;
    assert.equal((await k.j(`${k.X}/${internal.id}/followup`, {})).status, 422);
    const m = (await k.j(k.X, { title: "Demo call", date: "2026-11-03", type: "sales_call", attendees: [{ name: "Nora", email: "nora@oudco.sa" }], notes: "TODO: send samples" })).body;
    await k.j(`${k.X}/${m.id}/draft`, {});
    const f = (await k.j(`${k.X}/${m.id}/followup`, {})).body.followup;
    assert.equal(f.by_ai, false); assert.match(f.body, /^هلا Nora،/); assert.match(f.body, /- send samples/); assert.match(f.body, /---\n\nHi Nora,/); assert.match(f.body, /\[ADD name\]/);
    assert.equal((await k.j(`${k.X}/${m.id}/followup/send`, {})).status, 422); // no Store CRM link
    await k.j(`${k.X}/${m.id}`, { links: { store_id: store.id } }, "PUT");
    assert.match((await k.j(`${k.X}/${m.id}/followup/send`, {})).body.detail, /Fill in every \[ADD\]/);
    const body = f.body.replace(/\[ADD الاسم\]/g, "سارة").replace(/\[ADD name\]/g, "Sara");
    const t = (await k.j(`${k.X}/${m.id}/followup/send`, { body })).body;
    assert.equal(t.message.status, "test"); assert.equal(t.message.error, "Test mode: not sent"); assert.equal(sent.length, 0);
    assert.equal(t.meeting.followup.sent.status, "test");
    // Roles without Store CRM edit can't send (they copy the email).
    const fin = await k.user("finance", "fin2");
    assert.equal((await k.as(fin.ck, `${k.X}/${m.id}/followup/send`, "POST", { body })).status, 403);
    // Live: only 09:00–21:00 Riyadh, not Friday; then through the CRM.
    await k.j(`${k.W}/crm/settings`, { mode: "live" }, "PUT");
    k.at("2026-11-06T10:00:00Z"); // a Friday
    assert.match((await k.j(`${k.X}/${m.id}/followup/send`, { body })).body.detail, /09:00–21:00 Riyadh/);
    k.at("2026-11-03T20:00:00Z"); // 23:00 Riyadh
    assert.equal((await k.j(`${k.X}/${m.id}/followup/send`, { body })).status, 422);
    k.at("2026-11-03T09:00:00Z");
    const live = (await k.j(`${k.X}/${m.id}/followup/send`, { body })).body;
    assert.equal(live.message.status, "sent"); assert.equal(sent.length, 1); assert.equal(sent[0].to, "nora@oudco.sa"); assert.match(sent[0].text, /سارة/);
    // Opted-out stores and sample stores are never sent.
    crm.update(k.w.id, store.id, { email_opt_out: true });
    const off = await k.j(`${k.X}/${m.id}/followup/send`, { body });
    assert.equal(off.status, 422); assert.match(off.body.detail, /Unsubscribed/); assert.equal(sent.length, 1);
    const smp = crm.add(k.w.id, { store_name: "Sample · Store", domain: "s.example.com", email: "s@example.com", sample: true });
    await k.j(`${k.X}/${m.id}`, { links: { store_id: smp.id } }, "PUT");
    const sm = (await k.j(`${k.X}/${m.id}/followup/send`, { body })).body;
    assert.equal(sm.message.status, "test"); assert.match(sm.message.error, /Sample store/); assert.equal(sent.length, 1);
    // A checked AI draft is kept; one with invented numbers falls back to the template.
    k.ai(() => JSON.stringify({ subject: "متابعة", body: "هلا نورة، نرسل العينات. --- Hi Nora, we'll send samples." }));
    assert.equal((await k.j(`${k.X}/${m.id}/followup`, {})).body.followup.by_ai, true);
    k.ai(() => JSON.stringify({ subject: "Offer", body: "We'll give you 30% off." }));
    const fb = (await k.j(`${k.X}/${m.id}/followup`, {})).body.followup;
    assert.equal(fb.by_ai, false); assert.match(fb.note, /numbers that aren't in the meeting \(30\)/);
  } finally { k.done(); }
});

test("meetings: my action items and overdue ones, marking done (ops tasks done count), Command Center needs for overdue items and notes waiting 2+ days", async () => {
  const k = await mtKit({ clock: "2026-11-03T09:00:00Z" });
  try {
    const mem = await k.user("member", "mem3"), lead = await k.user("manager", "lead3"), cre = await k.user("creative", "cre3");
    const m = (await k.j(k.X, { title: "Planning", date: "2026-11-03", attendees: [{ user_id: mem.id }], notes: "TODO: Mt mem3 writes the brief by 2026-11-04\nTODO: Mt mem3 updates the deck by 2026-11-20\nTODO: owner thing" })).body;
    const d = (await k.j(`${k.X}/${m.id}/draft`, {})).body.draft;
    await k.j(`${k.X}/${m.id}/create`, { items: d.items.map((x) => ({ id: x.id })) });
    const empty = (await k.as(mem.ck, `${k.X}/my-items`)).body;
    assert.equal(empty.open.length, 2); assert.equal(empty.overdue.length, 0);
    k.at("2026-11-06T09:00:00Z");
    const mine = (await k.as(mem.ck, `${k.X}/my-items`)).body;
    assert.deepEqual(mine.overdue.map((x) => x.due), ["2026-11-04"]); assert.equal(mine.open[0].meeting_title, "Planning");
    // Command Center: the owner of an overdue item sees it; a Team lead sees the count; a Creative user sees nothing about others.
    const needs = async (c) => (await k.as(c, `${k.W}/command`)).body.needs.filter((n) => n.module === "Meetings");
    assert.match((await needs(mem.ck))[0].text, /was due 2026-11-04/);
    assert.ok((await needs(lead.ck)).some((n) => /1 meeting action item is overdue/.test(n.text)));
    assert.equal((await needs(cre.ck)).length, 0);
    // Marking done: only the owner, the meeting's creator or a manager.
    const it = mine.overdue[0];
    assert.equal((await k.as(cre.ck, `${k.X}/items/${it.id}`, "PUT", { status: "done" })).status, 403);
    assert.equal((await k.as(mem.ck, `${k.X}/items/${it.id}`, "PUT", { status: "done" })).body.status, "done");
    assert.equal((await needs(mem.ck)).length, 0);
    // An ops task marked done in Operations counts as done here.
    const other = mine.open.find((x) => x.due === "2026-11-20");
    await k.j(`${k.W}/ops/tasks/${other.ref_id}`, { status: "done" }, "PUT");
    assert.equal((await k.as(mem.ck, `${k.X}/my-items`)).body.open.length, 0);
    // Notes with no reviewed draft after 2 days: a need for the creator, attendees and managers.
    const w2 = (await k.as(mem.ck, k.X, "POST", { title: "Partner chat", date: "2026-11-06", type: "partner", notes: "We talked." })).body;
    assert.equal((await needs(mem.ck)).length, 0);
    k.at("2026-11-09T10:00:00Z");
    assert.match((await needs(mem.ck)).find((n) => n.title === "Meeting notes waiting").text, /1 meeting has notes but no reviewed action items after 2 days: Partner chat/);
    assert.ok((await needs(k.ck)).some((n) => n.title === "Meeting notes waiting"));
    assert.ok(!(await needs(cre.ck)).some((n) => n.title === "Meeting notes waiting"));
    assert.equal((await k.j(k.X)).body.meetings.find((x) => x.id === w2.id).waiting_review, true);
    await k.j(`${k.X}/${w2.id}/draft`, {}); await k.j(`${k.X}/${w2.id}/review`, {});
    assert.ok(!(await needs(mem.ck)).some((n) => n.title === "Meeting notes waiting"));
    // Viewers have no Meetings access, so no needs either.
    const vw = await k.user("viewer", "vw3");
    assert.equal((await needs(vw.ck)).length, 0);
  } finally { k.done(); }
});

test("meetings: AI Meeting secretary agent, roles, Ask DPA AD tools, data requests cover outside attendees, sample data removal, workspace delete", async () => {
  const { AGENTS, agentFor } = await import("../lib/agents.js");
  const { TOOLS } = await import("../lib/assistant.js");
  const { DEFAULT_ROLES, moduleFor, MODULE_IDS } = await import("../lib/access.js");
  const { findSubject, exportSubject, deleteSubject, REGISTER_STARTER } = await import("../lib/compliance.js");
  const ag = AGENTS.find((a) => a.id === "meeting_secretary");
  assert.equal(ag.name, "AI Meeting secretary"); assert.equal(ag.team, "Operations"); assert.equal(ag.max, 1); assert.equal(ag.module, "meetings");
  assert.equal(agentFor("POST", "/api/workspaces/1/meetings/4/draft"), "meeting_secretary");
  assert.ok(MODULE_IDS.includes("meetings")); assert.equal(moduleFor("POST", "/api/workspaces/1/meetings/4/create"), "meetings");
  assert.deepEqual(Object.fromEntries(DEFAULT_ROLES.map((r) => [r.id, r.perms.meetings])), { owner: "edit", admin: "edit", manager: "edit", member: "edit", finance: "view", creative: "edit", viewer: "none" });
  const dd = fs.mkdtempSync(path.join(os.tmpdir(), "mwiz-mtr-"));
  fs.writeFileSync(path.join(dd, "db.json"), JSON.stringify({ roles: [{ id: "viewer", name: "Viewer", perms: { command: "view" } }] }));
  assert.equal(new Store(dd).db.roles.find((r) => r.id === "viewer").perms.meetings, "none"); fs.rmSync(dd, { recursive: true, force: true });
  assert.ok(REGISTER_STARTER.some((r) => r.key === "meetings_notes" && r.module === "meetings"));
  const lt = TOOLS.find((t) => t.name === "list_meetings"), at = TOOLS.find((t) => t.name === "add_meeting_notes");
  assert.equal(lt.module, "meetings"); assert.ok(!lt.write); assert.equal(at.module, "meetings"); assert.equal(at.write, true); assert.equal(at.risk, "low"); assert.equal(typeof at.preview, "function");

  let script = [];
  const fakeClient = async (p) => { const n = script.shift(); return typeof n === "function" ? n(p) : n; };
  const use = (id, name, input) => ({ stop_reason: "tool_use", model: "m", usage: { input_tokens: 10, output_tokens: 5 }, content: [{ type: "tool_use", id, name, input }] });
  const say = (text) => ({ stop_reason: "end_turn", model: "m", usage: { input_tokens: 10, output_tokens: 5 }, content: [{ type: "text", text }] });
  const k = await mtKit({ assistantClient: fakeClient });
  try {
    const real = (await k.j(k.X, { title: "Board prep", date: "2026-11-03", type: "investor", attendees: [{ name: "Investor A", email: "a@vc.example" }] })).body;
    await k.j(k.X, { title: "Weekly", date: "2026-11-02" });
    script = [use("m1", "list_meetings", {}), (p) => { const r = JSON.parse(p.messages.at(-1).content[0].content); assert.equal(r.total, 2); assert.equal(r.meetings[0].title, "Board prep"); assert.equal(r.meetings[0].has_notes, false); return say("Two meetings."); }];
    const a1 = (await k.as(k.ck, "/api/assistant", "POST", { message: "Which meetings?", ws: k.w.id })).body;
    assert.match(a1.reply, /Two meetings/);
    script = [use("m2", "add_meeting_notes", { meeting_id: real.id, notes: "Action: send the deck to a@vc.example" })];
    const a2 = (await k.as(k.ck, "/api/assistant", "POST", { thread_id: a1.thread_id, message: "Save these notes", ws: k.w.id })).body;
    assert.match(a2.pending.summary, /^Save 37 characters of notes on "Board prep" \(2026-11-03\)/);
    assert.equal(k.st.db.meetings_meetings.find((x) => x.id === real.id).notes, "");
    script = [say("Saved.")];
    await k.as(k.ck, "/api/assistant/confirm", "POST", { thread_id: a1.thread_id, action_id: a2.pending.id, approve: true });
    const saved = k.st.db.meetings_meetings.find((x) => x.id === real.id);
    assert.equal(saved.notes, "Action: send the deck to a@vc.example"); assert.equal(saved.notes_source, "assistant");
    script = [use("m3", "add_meeting_notes", { title: "Call with Zid", date: "2026-11-04", time: "11:00", type: "partner", notes: "We agreed to test." })];
    const a3 = (await k.as(k.ck, "/api/assistant", "POST", { thread_id: a1.thread_id, message: "New meeting", ws: k.w.id })).body;
    assert.match(a3.pending.summary, /Create the meeting "Call with Zid" on 2026-11-04 11:00 \(partner\)/);
    script = [say("Created.")];
    await k.as(k.ck, "/api/assistant/confirm", "POST", { thread_id: a1.thread_id, action_id: a3.pending.id, approve: true });
    assert.ok(k.st.db.meetings_meetings.some((x) => x.title === "Call with Zid" && x.notes === "We agreed to test."));

    // Data requests: outside attendee emails and mentions in notes are found, exported and redacted on delete.
    const f = findSubject({ store: k.st, crm: k.app.locals.crm }, { email: "A@vc.example" });
    assert.equal(f.meetings.length, 1); assert.equal(f.meetings[0].attendee, true);
    const x = exportSubject({ store: k.st, crm: k.app.locals.crm }, { email: "a@vc.example" });
    assert.equal(x.meetings[0].attendee.name, "Investor A"); assert.deepEqual(x.meetings[0].notes_lines, ["Action: send the deck to a@vc.example"]);
    const c = deleteSubject({ store: k.st, crm: k.app.locals.crm }, { email: "a@vc.example" });
    assert.equal(c.meeting_attendees_redacted, 1);
    const red = k.st.db.meetings_meetings.find((y) => y.id === real.id);
    assert.deepEqual(red.attendees[0], { kind: "external", name: "[removed]", email: "", org: "" }); assert.equal(red.notes, "Action: send the deck to [removed]");
    assert.equal(findSubject({ store: k.st, crm: k.app.locals.crm }, { email: "a@vc.example" }).meetings.length, 0);

    // Sample meetings: two "Sample ·" meetings with notes and a rule-based draft; removed with Remove sample data.
    await k.j(`${k.W}/crm/sample`, {});
    const loaded = (await k.j(`${k.W}/sample-data`, {})).body;
    assert.equal(loaded.meetings, 2);
    const smp = k.st.db.meetings_meetings.filter((y) => y.sample);
    assert.ok(smp.every((y) => y.title.startsWith("Sample · ") && y.notes && y.draft && y.draft.by_ai === false && y.draft.items.length >= 2));
    assert.ok(smp.some((y) => y.links.deal_id && y.links.store_id));
    const sd = smp[0];
    await k.j(`${k.X}/${sd.id}/create`, { items: [{ id: sd.draft.items[0].id }] });
    assert.ok(k.st.db.ops_tasks.some((t) => t.meeting_id === sd.id && t.sample));
    const rm = (await k.j(`${k.W}/sample-data`, undefined, "DELETE")).body;
    assert.equal(rm.meetings, 2); assert.equal(rm.meeting_items, 1);
    assert.ok(!k.st.db.meetings_meetings.some((y) => y.sample)); assert.ok(!k.st.db.ops_tasks.some((t) => t.meeting_id === sd.id));
    assert.equal(k.st.db.meetings_meetings.length, 3);
    // Deleting a workspace clears its meetings_* rows and keeps other workspaces'.
    k.st.db.meetings_meetings.push({ id: "zm", workspace_id: "other" });
    assert.ok(k.st.deleteWorkspace(k.w.id));
    for (const coll of ["meetings_meetings", "meetings_items"]) assert.equal(k.st.db[coll].filter((y) => y.workspace_id === k.w.id).length, 0, coll);
    assert.deepEqual(k.st.db.meetings_meetings.map((y) => y.id), ["zm"]);
  } finally { k.done(); }
});

test("CRM campaign window keeps hour 0 (midnight) instead of falling back to 9", async () => {
  const [ws] = await json("/api/workspaces");
  const P = `/api/workspaces/${ws.id}/crm`;
  const c = await (await post(`${P}/campaigns`, { name: "Window 0", type: "outreach", window: { from: 0, to: 24, skip_friday: false }, steps: [{ channel: "email", delay_days: 0, subject: "S", body: "B" }] })).json();
  assert.deepEqual(c.window, { from: 0, to: 24, skip_friday: false });
  const d = await (await post(`${P}/campaigns`, { name: "Window default", type: "outreach", window: { from: "", to: null }, steps: [{ channel: "email", delay_days: 0, subject: "S", body: "B" }] })).json();
  assert.deepEqual([d.window.from, d.window.to], [9, 21]);
  for (const x of [c, d]) await call(`${P}/campaigns/${x.id}`, { method: "DELETE" });
});

// ---- Partners & referrals
async function ptKit({ clock = null, assistantClient = null, outreachOptions = {}, env = { ...process.env, PUBLIC_URL: "https://wizard.dpa.ad" }, adsOptions = {} } = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "mwiz-pt-")), st = new Store(d);
  let t = clock ? Date.parse(clock) : null, ai = null;
  const prov = { name: "test", model: "test", async generate(a) { return ai ? ai(a.prompt) : demoProvider().generate(a); } };
  const app2 = createApp({ store: st, provider: prov, password: "pw-pt", assistantClient, outreachOptions, adsOptions, env, partnersOptions: { clock: () => (t == null ? Date.now() : t) } });
  const srv = app2.listen(0); await new Promise((r) => srv.once("listening", r));
  const b2 = `http://127.0.0.1:${srv.address().port}`;
  const login = async (body) => (await fetch(b2 + "/login", { method: "POST", redirect: "manual", body: new URLSearchParams(body) })).headers.get("set-cookie").split(";")[0];
  const ck = await login({ password: "pw-pt" });
  const as = async (c, p, m = "GET", body, headers = {}) => { const r = await fetch(b2 + p, { method: m, redirect: "manual", headers: { "Content-Type": "application/json", cookie: c, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }); const txt = await r.text(); let j = null; try { j = JSON.parse(txt); } catch { j = txt; } return { status: r.status, body: j, headers: r.headers }; };
  const j = (p, body, m) => as(ck, p, m || (body === undefined ? "GET" : "POST"), body);
  const [w] = (await j("/api/workspaces")).body;
  const user = async (role, tag = role) => { const email = `pt-${tag}@dpa.ad`; await j("/api/admin/users", { name: `Pt ${tag}`, email, password: `pt-${tag}-pass1`, role_id: role }); return { ck: await login({ email, password: `pt-${tag}-pass1` }), id: st.db.users.find((u) => u.email === email).id }; };
  const visit = (p, headers = {}) => fetch(b2 + p, { redirect: "manual", headers: { "User-Agent": "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/130.0 Safari/537.36", ...headers } });
  return { app: app2, st, w, X: `/api/workspaces/${w.id}/partners`, W: `/api/workspaces/${w.id}`, j, as, ck, user, b2, visit,
    at: (iso) => { t = Date.parse(iso); }, ai: (fn) => { ai = fn; },
    done: () => { srv.close(); app2.locals.crm.flush(); fs.rmSync(d, { recursive: true, force: true }); } };
}
// A Billing customer with paid invoices, straight through the Billing engine.
async function ptCustomer(k, f, pays = []) {
  const bl = k.app.locals.billing;
  const c = bl.addCustomer(k.w, { store_name: f.name, plan: "Growth", cycle: "monthly", currency: "SAR", status: f.status || "active", already_billed: true, ...(f.crm_contact_id ? { crm_contact_id: f.crm_contact_id } : {}), ...(f.deal_id ? { deal_id: f.deal_id } : {}) }, "test");
  const invs = [];
  for (const [date, amount] of pays) {
    const inv = bl.draft(k.w, c, { lines: [{ kind: "subscription", description: "Plan", qty: 1, unit_price: amount }], by: "test" });
    await bl.issue(k.w, inv, { by: "test" });
    bl.recordPayment(k.w, inv, { amount: inv.totals.total, date, method: "bank_transfer", by: "test" });
    invs.push(inv);
  }
  return { c, invs };
}

test("partners: create with validation and a first referral link, pipeline by status, change log on edits, delete rules", async () => {
  const k = await ptKit({ clock: "2026-11-03T09:00:00Z" });
  try {
    const meta = (await k.j(`${k.X}/meta`)).body;
    assert.deepEqual(meta.types.map((t) => t.id), ["agency", "freelancer", "platform", "tech", "reseller", "customer"]);
    assert.deepEqual(meta.statuses.map((s) => s.id), ["prospect", "talking", "signed", "active", "paused", "ended"]);
    assert.equal(meta.today, "2026-11-03"); assert.equal(meta.settings.landing_url, "https://dpa.ad"); assert.deepEqual(meta.settings.allowed_hosts, ["dpa.ad"]);
    assert.equal((await k.j(k.X, { name: "" })).status, 422);
    assert.equal((await k.j(k.X, { name: "X", type: "influencer" })).status, 422);
    assert.equal((await k.j(k.X, { name: "X", status: "maybe" })).status, 422);
    assert.equal((await k.j(k.X, { name: "X", contact: { email: "not-an-email" } })).status, 422);
    assert.match((await k.j(k.X, { name: "X", agreement: { commission_pct: 20 } })).body.detail, /recurring_months/);
    assert.equal((await k.j(k.X, { name: "X", agreement: { commission_pct: 120, recurring_months: 3 } })).status, 422);
    assert.equal((await k.j(k.X, { name: "X", contract: { url: "http://x.example/c.pdf" } })).status, 422);
    assert.equal((await k.j(k.X, { name: "X", contract: { media_id: "999" } })).status, 422);
    const r = await k.j(k.X, { name: "Najd Digital Agency", type: "agency", city: "Riyadh", contact: { name: "Faisal", email: "Faisal@Najd.example", phone: "0551234567" }, agreement: { commission_pct: 20, recurring_months: 12, tier: "Gold" }, contract: { url: "https://drive.example/contract.pdf" } });
    assert.equal(r.status, 201);
    const p = r.body;
    assert.equal(p.status, "prospect"); assert.equal(p.contact.email, "faisal@najd.example"); assert.equal(p.country, "SA"); assert.equal(p.agreement.commission_pct, 20);
    assert.equal(p.codes.length, 1); assert.match(p.codes[0].code, /^najd-digital-agency-[0-9a-f]{4}$/); assert.equal(p.codes[0].link, `https://wizard.dpa.ad/r/${p.codes[0].code}`);
    assert.match(p.log[0].text, /^Partner added \(agency, prospect\)/);
    const u = (await k.j(`${k.X}/${p.id}`, { status: "talking", agreement: { commission_pct: 15, recurring_months: 12, tier: "Gold" }, notes: "Met at Salla meetup" }, "PUT")).body;
    assert.deepEqual(u.log.slice(1).map((l) => l.text), ["status: prospect → talking", "notes edited", "commission %: 20 → 15"]);
    assert.equal(u.log.length, 4);
    assert.equal(u.status_at, "2026-11-03T09:00:00.000Z");
    await k.j(k.X, { name: "Zid apps listing", type: "platform", status: "signed" });
    const list = (await k.j(`${k.X}?status=talking`)).body;
    assert.deepEqual(list.partners.map((x) => x.name), ["Najd Digital Agency"]);
    assert.equal((await k.j(k.X)).body.partners.length, 2);
    // A code of one's own (unique across the dashboard), and its validation.
    assert.equal((await k.j(`${k.X}/${p.id}/codes`, { code: "N" })).status, 422);
    const c2 = (await k.j(`${k.X}/${p.id}/codes`, { code: "najd-ramadan" })).body;
    assert.equal(c2.link, "https://wizard.dpa.ad/r/najd-ramadan");
    assert.equal((await k.j(`${k.X}/${p.id}/codes`, { code: "najd-ramadan" })).status, 409);
    // Delete: refused once a statement is approved or paid; otherwise removes its codes and clicks.
    const tmp = (await k.j(k.X, { name: "Tmp" })).body;
    k.st.db.partners_statements.push({ id: "s-x", workspace_id: k.w.id, partner_id: tmp.id, partner_name: "Tmp", month: "2026-10", status: "approved", lines: [], total_sar: 10, log: [] });
    assert.equal((await k.j(`${k.X}/${tmp.id}`, undefined, "DELETE")).status, 409);
    k.st.db.partners_statements = k.st.db.partners_statements.filter((s) => s.id !== "s-x");
    assert.equal((await k.j(`${k.X}/${tmp.id}`, undefined, "DELETE")).status, 200);
    assert.ok(!k.st.db.partners_codes.some((c) => c.partner_id === tmp.id));
  } finally { k.done(); }
});

test("partners referral link: click recorded once per hashed IP and day, cookie, redirect only to allowlisted hosts (no open redirect), bots not counted", async () => {
  const k = await ptKit({ clock: "2026-11-03T09:00:00Z" });
  try {
    const p = (await k.j(k.X, { name: "Creator Sara", type: "freelancer" })).body;
    const code = p.codes[0].code;
    const r1 = await k.visit(`/r/${code}`, { "X-Forwarded-For": "203.0.113.7" });
    assert.equal(r1.status, 302);
    assert.equal(r1.headers.get("location"), `https://dpa.ad/?utm_source=partner&utm_medium=referral&utm_campaign=${code}`);
    assert.match(r1.headers.get("set-cookie"), new RegExp(`^dpa_ref=${code}; Path=/; Max-Age=5184000; SameSite=Lax; HttpOnly; Secure$`));
    await k.visit(`/r/${code.toUpperCase()}?to=https://evil.example`, { "X-Forwarded-For": "203.0.113.7" }).then((r) => assert.equal(new URL(r.headers.get("location")).host, "dpa.ad"));
    await k.visit(`/r/${code}`, { "X-Forwarded-For": "198.51.100.2" });
    await k.visit(`/r/${code}`, { "X-Forwarded-For": "198.51.100.3", "User-Agent": "facebookexternalhit/1.1" });
    let clicks = k.st.db.partners_clicks.filter((c) => c.partner_id === p.id);
    assert.equal(clicks.length, 2); assert.equal(clicks.find((c) => c.hits === 2).ua, "Chrome"); assert.ok(clicks.every((c) => c.day === "2026-11-03" && /^[A-Za-z0-9_-]{16}$/.test(c.ip_hash)));
    assert.ok(!JSON.stringify(k.st.db.partners_clicks).includes("203.0.113.7"), "no raw IP stored");
    k.at("2026-11-04T09:00:00Z");
    await k.visit(`/r/${code}`, { "X-Forwarded-For": "203.0.113.7" });
    clicks = k.st.db.partners_clicks.filter((c) => c.partner_id === p.id);
    assert.equal(clicks.length, 3); assert.notEqual(clicks[2].ip_hash, clicks[0].ip_hash, "the hash changes with the day");
    assert.equal((await k.j(`${k.X}/${p.id}`)).body.stats.clicks, 3);
    // Unknown and switched-off codes go to the default page with no cookie and no click.
    const un = await k.visit("/r/nope-code");
    assert.equal(un.headers.get("location"), "https://dpa.ad"); assert.equal(un.headers.get("set-cookie"), null);
    // Landing pages: https on an allowed host (or subdomain) only.
    for (const bad of ["https://evil.example/x", "https://dpa.ad.evil.example/", "http://dpa.ad/", "https://user@dpa.ad/", "javascript:alert(1)"]) assert.equal((await k.j(`${k.X}/${p.id}/codes`, { landing_url: bad })).status, 422, bad);
    const sub = (await k.j(`${k.X}/${p.id}/codes`, { code: "sara-app", landing_url: "https://app.dpa.ad/start?x=1" })).body;
    assert.equal((await k.visit("/r/sara-app")).headers.get("location"), "https://app.dpa.ad/start?x=1&utm_source=partner&utm_medium=referral&utm_campaign=sara-app");
    // Settings: hosts and landing checked; a code whose host is no longer allowed falls back to the default page.
    assert.equal((await k.j(`${k.X}/settings`, { landing_url: "https://evil.example" }, "PUT")).status, 422);
    assert.equal((await k.j(`${k.X}/settings`, { allowed_hosts: ["partners.example"] }, "PUT")).status, 422, "current landing not allowed");
    const s2 = (await k.j(`${k.X}/settings`, { allowed_hosts: "partners.example, dpa.ad", landing_url: "https://partners.example/join", cookie_days: 30 }, "PUT")).body;
    assert.deepEqual(s2.allowed_hosts, ["partners.example", "dpa.ad"]);
    const r3 = await k.visit(`/r/${code}`);
    assert.match(r3.headers.get("location"), /^https:\/\/partners\.example\/join\?utm_source=partner/); assert.match(r3.headers.get("set-cookie"), /Max-Age=2592000/);
    await k.j(`${k.X}/settings`, { allowed_hosts: ["partners.example"] }, "PUT");
    assert.match((await k.visit("/r/sara-app")).headers.get("location"), /^https:\/\/partners\.example\/join\?/);
    await k.j(`${k.X}/codes/${sub.id}`, { active: false }, "PUT");
    const off = await k.visit("/r/sara-app");
    assert.equal(off.headers.get("location"), "https://partners.example/join"); assert.equal(off.headers.get("set-cookie"), null);
    assert.ok((await k.j(`${k.X}/${p.id}`)).body.log.some((l) => l.text === "Code sara-app switched off"));
  } finally { k.done(); }
});

test("partners attribution: by a person, by the lead hook's ref or the dpa_ref cookie, by utm_campaign; deals and customers inherit; funnel; MRR only with Billing view", async () => {
  const { adsConfig } = await import("../lib/adsapi.js");
  const k = await ptKit({ clock: "2026-11-03T09:00:00Z", adsOptions: { cfg: adsConfig({ ADS_LEAD_SECRET: "lead-secret-1" }, "pw") } });
  try {
    const crm = k.app.locals.crm;
    const p = (await k.j(k.X, { name: "Agency A", type: "agency", status: "active", agreement: { commission_pct: 10, recurring_months: 6 } })).body, code = p.codes[0].code;
    const q = (await k.j(k.X, { name: "Agency B" })).body;
    // Lead hook: `ref` field, the cookie set by /r/<code>, and UTMs from the landing URL.
    const hook = (b, headers = {}) => fetch(`${k.b2}/hooks/ads/lead/lead-secret-1`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(b) }).then((r) => r.json());
    const h1 = await hook({ email: "one@store.example", ref: code.toUpperCase() });
    assert.equal(h1.ref, code);
    const h2 = await hook({ email: "two@store.example" }, { cookie: `dpa_ref=${code}` });
    assert.equal(h2.ref, code);
    const h3 = await hook({ email: "three@store.example", url: `https://dpa.ad/?utm_source=partner&utm_medium=referral&utm_campaign=${q.codes[0].code}` });
    assert.equal(h3.utm.campaign, q.codes[0].code);
    await hook({ email: "one@store.example", ref: q.codes[0].code }); // first touch wins
    assert.equal(crm.get(k.w.id, h1.id).ref_code, code);
    // A deal linked from an attributed store inherits; a manual deal attribution; customers inherit from their store.
    const deal = k.st.addDeal(k.w.id, { name: "Two Store deal" });
    crm.update(k.w.id, h2.id, { deal_id: deal.id });
    const deal2 = k.st.addDeal(k.w.id, { name: "Direct deal" });
    assert.equal((await k.j(`${k.X}/attributions`, { kind: "deal", ref_id: deal2.id, code: "missing" })).status, 422);
    assert.equal((await k.j(`${k.X}/attributions`, { kind: "deal", ref_id: "999", code_id: p.codes[0].id })).status, 422);
    assert.equal((await k.j(`${k.X}/attributions`, { kind: "deal", ref_id: deal2.id, code_id: p.codes[0].id })).status, 201);
    const paying = await ptCustomer(k, { name: "One Store", crm_contact_id: h1.id });
    const trial = await ptCustomer(k, { name: "Trial Store", status: "trial" });
    assert.equal((await k.j(`${k.X}/attributions`, { kind: "customer", ref_id: trial.c.id, code_id: p.codes[0].id })).status, 201);
    const viaDeal = await ptCustomer(k, { name: "Deal Store", deal_id: deal2.id, status: "cancelled" });
    const rows = (await k.j(`${k.X}/attribution`)).body.rows;
    const by = Object.fromEntries(rows.map((r) => [`${r.kind}:${r.ref_id}`, r]));
    assert.equal(by[`store:${h1.id}`].source, "ref"); assert.equal(by[`store:${h2.id}`].source, "ref"); assert.equal(by[`store:${h3.id}`].source, "utm"); assert.equal(by[`store:${h3.id}`].partner, "Agency B");
    assert.equal(by[`deal:${deal.id}`].source, "via store"); assert.equal(by[`deal:${deal2.id}`].source, "manual");
    assert.equal(by[`customer:${paying.c.id}`].source, "via store"); assert.equal(by[`customer:${trial.c.id}`].source, "manual"); assert.equal(by[`customer:${viaDeal.c.id}`].source, "via deal");
    const full = (await k.j(`${k.X}/${p.id}`)).body;
    assert.deepEqual({ ...full.stats, mrr_sar: undefined }, { clicks: 0, hits: 0, leads: 3, stores: 2, deals: 2, trials: 1, paying: 1, customers: 3, mrr_sar: undefined });
    assert.ok(full.stats.mrr_sar > 0, "MRR referred for the Owner");
    assert.equal(full.attributed.length, 7);
    // Team member: view only, no money (no MRR, no agreement terms, no lines); Creative: no access.
    const mem = await k.user("member", "m1");
    const mv = (await k.as(mem.ck, `${k.X}/${p.id}`)).body;
    assert.equal(mv.stats.mrr_sar, undefined); assert.deepEqual(mv.agreement, { tier: "" }); assert.deepEqual(mv.lines, []); assert.equal(mv.money, false);
    assert.equal((await k.as(mem.ck, `${k.X}/attributions`, "POST", { kind: "deal", ref_id: deal.id, code_id: p.codes[0].id })).status, 403);
    const cr = await k.user("creative", "c1");
    assert.equal((await k.as(cr.ck, k.X)).status, 403);
    // A customer referrer never earns from its own account.
    const self = (await k.j(k.X, { name: "One Store referrer", type: "customer", customer_id: paying.c.id })).body;
    assert.equal((await k.j(`${k.X}/attributions`, { kind: "customer", ref_id: paying.c.id, code_id: self.codes[0].id })).status, 422);
  } finally { k.done(); }
});

test("partners commission maths: percent for N months before VAT from the first payment, flat bounty once, refunds by credit note; through the real Billing engine", async () => {
  const { commissionLines, statementLines, monthsBetween } = await import("../lib/partners.js");
  assert.equal(monthsBetween("2026-11", "2027-02"), 3);
  const invoices = [
    { id: "i1", kind: "invoice", number: "INV-1", customer_id: "c1", totals: { taxable: 1000, total: 1150 }, paid_amount: 1150 },
    { id: "i2", kind: "invoice", number: "INV-2", customer_id: "c1", totals: { taxable: 1000, total: 1150 }, paid_amount: 1150 },
    { id: "i3", kind: "invoice", number: "INV-3", customer_id: "c1", totals: { taxable: 1000, total: 1150 }, paid_amount: 1150 },
    { id: "i4", kind: "invoice", number: "INV-4", customer_id: "c1", totals: { taxable: 1000, total: 1150 }, paid_amount: 1150 },
    { id: "n1", kind: "credit_note", number: "CN-1", customer_id: "c1", status: "issued", credit_of: "i2", credit_of_number: "INV-2", issue_date: "2027-01-05", totals_sar: { taxable: 400, total: 460 } },
    { id: "n2", kind: "credit_note", number: "CN-2", customer_id: "c1", status: "issued", credit_of: "i4", issue_date: "2027-03-05", totals_sar: { taxable: 1000, total: 1150 } },
    { id: "n3", kind: "credit_note", number: "CN-3", customer_id: "c1", status: "void", credit_of: "i1", issue_date: "2027-01-05", totals_sar: { taxable: 1000, total: 1150 } },
  ];
  const payments = [
    { id: "1", customer_id: "c1", invoice_id: "i1", status: "paid", date: "2026-11-20", amount_sar: 1150 },
    { id: "2", customer_id: "c1", invoice_id: "i2", status: "paid", date: "2026-12-20", amount_sar: 1150 },
    { id: "3", customer_id: "c1", invoice_id: "i3", status: "paid", date: "2027-01-20", amount_sar: 1150 },
    { id: "4", customer_id: "c1", invoice_id: "i4", status: "paid", date: "2027-02-20", amount_sar: 1150 }, // month 4: outside a 3-month window
    { id: "5", customer_id: "c1", invoice_id: "i4", status: "failed", date: "2027-02-10", amount_sar: 1150 },
  ];
  const customers = [{ id: "c1", store_name: "Oud Co" }];
  const pct = commissionLines({ partner: { agreement: { commission_pct: 10, recurring_months: 3, bounty_sar: 0 } }, customers, payments, invoices });
  assert.deepEqual(pct.map((l) => [l.kind, l.date, l.base_sar, l.amount_sar]), [["commission", "2026-11-20", 1000, 100], ["commission", "2026-12-20", 1000, 100], ["refund", "2027-01-05", -400, -40], ["commission", "2027-01-20", 1000, 100]]);
  const bounty = commissionLines({ partner: { agreement: { commission_pct: 0, recurring_months: 0, bounty_sar: 500 } }, customers, payments, invoices });
  assert.deepEqual(bounty.map((l) => [l.kind, l.date, l.amount_sar]), [["bounty", "2026-11-20", 500]]);
  assert.equal(commissionLines({ partner: { agreement: {} }, customers, payments, invoices }).length, 0);
  assert.equal(commissionLines({ partner: { agreement: { commission_pct: 10, recurring_months: 3 } }, customers: [{ id: "c2" }], payments, invoices }).length, 0, "no payments, no commission");
  // Lines already on another live statement are not repeated; later months pick up what came late.
  const fake = { listOps: () => [{ partner_id: "p", status: "approved", id: "s1", lines: [{ source_id: "pay:1" }] }, { partner_id: "p", status: "void", id: "s0", lines: [{ source_id: "pay:2" }] }] };
  assert.deepEqual(statementLines(fake, { id: "1" }, "p", "2026-12", pct).map((l) => l.source_id), ["pay:2"]);

  // Through Billing: VAT 15% (VAT number set), payments recorded on dates, a credit note on a paid invoice.
  const k = await ptKit({ clock: "2026-12-10T09:00:00Z" });
  try {
    k.w.finance = { ...(k.w.finance || {}), vat_registered: true };
    k.app.locals.billing.setSettings(k.w, { vat_number: "300000000000003" });
    const p = (await k.j(k.X, { name: "Agency VAT", status: "active", agreement: { commission_pct: 20, recurring_months: 12, bounty_sar: 250 } })).body;
    const { c, invs } = await ptCustomer(k, { name: "VAT Store" }, [["2026-11-15", 1000], ["2026-12-01", 1000]]);
    await k.j(`${k.X}/attributions`, { kind: "customer", ref_id: c.id, code_id: p.codes[0].id });
    assert.equal(invs[0].totals.total, 1150);
    await k.app.locals.billing.creditNote(k.w, invs[1], { amount: 500, reason: "Refund half" }, "test");
    const lines = (await k.j(`${k.X}/${p.id}`)).body.lines;
    assert.deepEqual(lines.map((l) => [l.kind, l.base_sar, l.amount_sar]).sort((a, b) => a[0].localeCompare(b[0]) || a[2] - b[2]), [["bounty", null, 250], ["commission", 1000, 200], ["commission", 1000, 200], ["refund", -500, -100]]);
  } finally { k.done(); }
});

test("partners statements: draft → approved by Owner/Finance → paid with date and reference, posted to Finance once; permissions; late payments move to the next statement; money hidden", async () => {
  const k = await ptKit({ clock: "2026-11-20T09:00:00Z" });
  try {
    const p = (await k.j(k.X, { name: "Agency S", status: "active", agreement: { commission_pct: 10, recurring_months: 12 } })).body;
    const { c } = await ptCustomer(k, { name: "Stmt Store" }, [["2026-10-05", 2000], ["2026-11-05", 2000]]);
    await k.j(`${k.X}/attributions`, { kind: "customer", ref_id: c.id, code_id: p.codes[0].id });
    assert.equal((await k.j(`${k.X}/statements/generate`, { month: "2026-13" })).status, 422);
    assert.equal((await k.j(`${k.X}/statements/generate`, { month: "2026-12" })).status, 422, "future month");
    const g = (await k.j(`${k.X}/statements/generate`, { month: "2026-10" })).body;
    assert.equal(g.created, 1);
    const s = g.statements[0];
    assert.equal(s.status, "draft"); assert.equal(s.total_sar, 200); assert.equal(s.currency, "SAR"); assert.match(s.tax_note, /\[CONFIRM\]/);
    assert.equal((await k.j(`${k.X}/statements/generate`, { month: "2026-10" })).body.refreshed, 1, "safe to repeat");
    assert.equal(k.st.db.partners_statements.length, 1);
    // Who approves: Owner or Finance Edit. Team lead (Finance view) can't; Team member can't even generate.
    const lead = await k.user("manager", "lead"), fin = await k.user("finance", "fin"), mem = await k.user("member", "mem");
    assert.match((await k.as(lead.ck, `${k.X}/statements/${s.id}/approve`, "POST", {})).body.detail, /Owner or someone with Finance Edit/);
    assert.equal((await k.as(mem.ck, `${k.X}/statements/generate`, "POST", { month: "2026-10" })).status, 403);
    const mv = (await k.as(mem.ck, `${k.X}/statements`)).body;
    assert.equal(mv.money, false); assert.equal(mv.statements[0].total_sar, null); assert.equal(mv.statements[0].lines[0].amount_sar, null);
    assert.equal((await k.as(lead.ck, `${k.X}/statements`)).body.statements[0].total_sar, 200, "Team lead has Billing view");
    assert.equal((await k.as(fin.ck, `${k.X}/statements/${s.id}/pay`, "POST", { reference: "TR-1" })).status, 409, "approve first");
    const ap = (await k.as(fin.ck, `${k.X}/statements/${s.id}/approve`, "POST", {})).body;
    assert.equal(ap.status, "approved"); assert.equal(ap.approved_by, "Pt fin"); assert.equal(ap.approved_at, "2026-11-20T09:00:00.000Z");
    assert.equal((await k.j(`${k.X}/statements/${s.id}/approve`, {})).status, 409);
    assert.equal((await k.as(lead.ck, `${k.X}/statements/${s.id}/pay`, "POST", { reference: "TR-1" })).status, 403);
    assert.equal((await k.j(`${k.X}/statements/${s.id}/pay`, {})).status, 422, "reference required");
    assert.equal((await k.j(`${k.X}/statements/${s.id}/pay`, { reference: "TR-1", date: "20/11/2026" })).status, 422);
    const paid = (await k.j(`${k.X}/statements/${s.id}/pay`, { reference: "TR-1", date: "2026-11-19" })).body;
    assert.equal(paid.status, "paid"); assert.equal(paid.paid_date, "2026-11-19"); assert.equal(paid.paid_reference, "TR-1");
    assert.equal((await k.j(`${k.X}/statements/${s.id}/pay`, { reference: "TR-2" })).status, 409);
    const ex = k.st.db.finance_expenses.filter((e) => e.source === "partners");
    assert.equal(ex.length, 1); assert.equal(ex[0].amount_sar, 200); assert.equal(ex[0].statement_id, s.id); assert.equal(ex[0].date, "2026-11-19"); assert.equal(ex[0].vendor, "Agency S"); assert.equal(ex[0].category, "marketing");
    assert.equal((await k.j(`${k.X}/statements/${s.id}/void`, { reason: "x" })).status, 409, "paid can't be voided");
    // A payment for October recorded late lands on November's statement, with November's own.
    const bl = k.app.locals.billing;
    const inv = bl.draft(k.w, c, { lines: [{ kind: "subscription", description: "Late", qty: 1, unit_price: 500 }], by: "test" }); await bl.issue(k.w, inv); bl.recordPayment(k.w, inv, { amount: 500, date: "2026-10-28" });
    const nov = (await k.j(`${k.X}/statements/generate`, { month: "2026-11" })).body.statements[0];
    assert.deepEqual(nov.lines.map((l) => l.date), ["2026-10-28", "2026-11-05"]); assert.equal(nov.total_sar, 250);
    assert.equal((await k.j(`${k.X}/statements/generate`, { month: "2026-10" })).body.skipped[0].reason, "Already paid");
    assert.equal((await k.j(`${k.X}/statements/${nov.id}/void`, {})).status, 422, "reason required");
    assert.equal((await k.as(fin.ck, `${k.X}/statements/${nov.id}/void`, "POST", { reason: "Wrong month" })).body.status, "void");
    const again = (await k.j(`${k.X}/statements/generate`, { month: "2026-11" })).body;
    assert.equal(again.created, 1, "void frees the lines");
    // A statement of 0 or less can't be approved.
    k.st.db.partners_statements.push({ id: "s-neg", workspace_id: k.w.id, partner_id: p.id, partner_name: "Agency S", month: "2026-09", status: "draft", lines: [], total_sar: -5, log: [] });
    assert.equal((await k.j(`${k.X}/statements/s-neg/approve`, {})).status, 422);
  } finally { k.done(); }
});

test("partners portal: a revocable token page with link, clicks, counts and statements; no customer names unless the setting allows; rate-limited", async () => {
  const k = await ptKit({ clock: "2026-11-03T09:00:00Z" });
  try {
    const p = (await k.j(k.X, { name: "Portal Agency", status: "active", agreement: { commission_pct: 10, recurring_months: 12 } })).body;
    const { c } = await ptCustomer(k, { name: "Secret Customer Store" }, [["2026-10-05", 1000]]);
    await k.j(`${k.X}/attributions`, { kind: "customer", ref_id: c.id, code_id: p.codes[0].id });
    await k.visit(`/r/${p.codes[0].code}`);
    const s = (await k.j(`${k.X}/statements/generate`, { month: "2026-10" })).body.statements[0];
    await k.j(`${k.X}/statements/${s.id}/approve`, {});
    assert.equal((await fetch(`${k.b2}/p/${"x".repeat(32)}`)).status, 404);
    const url = (await k.j(`${k.X}/${p.id}/portal`, {})).body.portal_url;
    assert.match(url, /^https:\/\/wizard\.dpa\.ad\/p\/[A-Za-z0-9_-]{32}$/);
    const path1 = new URL(url).pathname;
    assert.equal((await k.j(`${k.X}/${p.id}`)).body.portal_token, undefined, "the token itself is not in the API");
    const page = await fetch(k.b2 + path1);
    assert.equal(page.status, 200); assert.equal(page.headers.get("x-robots-tag"), "noindex");
    const html = await page.text();
    assert.match(html, /Portal Agency/); assert.match(html, new RegExp(`https://wizard.dpa.ad/r/${p.codes[0].code}`)); assert.match(html, /2026-10/); assert.match(html, /SAR 100\.00/);
    assert.doesNotMatch(html, /Secret Customer Store/);
    await k.j(`${k.X}/settings`, { portal_show_names: true }, "PUT");
    assert.match(await (await fetch(k.b2 + path1)).text(), /Secret Customer Store/);
    // Escaped: a partner name can't inject HTML.
    await k.j(`${k.X}/${p.id}`, { name: "<script>alert(1)</script>" }, "PUT");
    assert.doesNotMatch(await (await fetch(k.b2 + path1)).text(), /<script>alert/);
    // A new link replaces the old one; revoke stops it.
    const url2 = (await k.j(`${k.X}/${p.id}/portal`, {})).body.portal_url;
    assert.equal((await fetch(k.b2 + path1)).status, 404);
    const path2 = new URL(url2).pathname;
    assert.equal((await fetch(k.b2 + path2)).status, 200);
    await k.j(`${k.X}/${p.id}/portal`, undefined, "DELETE");
    assert.equal((await fetch(k.b2 + path2)).status, 404);
    assert.ok((await k.j(`${k.X}/${p.id}`)).body.log.some((l) => l.text === "Partner portal link revoked"));
    let last = 200; for (let i = 0; i < 30; i++) last = (await fetch(k.b2 + path2)).status;
    assert.equal(last, 429);
  } finally { k.done(); }
});

test("partners AI Partnerships manager: Arabic-first templates with [ADD]; checked AI JSON kept; invented numbers refused; outcomes on use/discard; sending only through the Store CRM", async () => {
  const sent = [];
  const { channelConfig } = await import("../lib/outreach.js");
  const cfg = channelConfig({ SMTP_HOST: "smtp.test", SMTP_USER: "u", SMTP_PASS: "p", MAIL_FROM: "hi@dpa.ad", PUBLIC_URL: "https://wizard.dpa.ad" });
  const k = await ptKit({ clock: "2026-11-03T09:00:00Z", outreachOptions: { cfg, senders: { email: async (x) => { sent.push(x); return { provider_id: "p1" }; }, whatsapp: async () => { throw new Error("no"); } } } });
  try {
    const wf = k.app.locals.workforce, ev = () => k.st.db.agent_events.filter((e) => e.agent_id === "partnerships_manager");
    const p = (await k.j(k.X, { name: "Agency AI", status: "signed", contact: { name: "Faisal" }, agreement: { commission_pct: 15, recurring_months: 6 } })).body;
    assert.equal((await k.j(`${k.X}/${p.id}/ai/poem`, {})).status, 422);
    const d1 = (await k.j(`${k.X}/${p.id}/ai/onboarding`, {})).body;
    assert.equal(d1.by_ai, false); assert.match(d1.body, /^هلا Faisal،/); assert.match(d1.body, new RegExp(`https://wizard.dpa.ad/r/${p.codes[0].code}`)); assert.match(d1.body, /15% لمدة 6 شهر/); assert.match(d1.body, /---\n\nHi Faisal,/); assert.match(d1.body, /\[ADD name\]/);
    assert.ok(k.st.db.agent_runs.some((r) => r.agent_id === "partnerships_manager"), "the AI call is attributed to the agent");
    k.ai(() => JSON.stringify({ subject: "أهلاً", body: "هلا Faisal، عمولتك 15% لمدة 6 أشهر.\n---\nHi Faisal, 15% for 6 months." }));
    const d2 = (await k.j(`${k.X}/${p.id}/ai/onboarding`, {})).body;
    assert.equal(d2.by_ai, true); assert.match(d2.body, /15%/);
    k.ai(() => JSON.stringify({ subject: "Hi", body: "Our partners earn 40,000 SAR a month." }));
    const d3 = (await k.j(`${k.X}/${p.id}/ai/outreach`, {})).body;
    assert.equal(d3.by_ai, false); assert.match(d3.note, /numbers that aren't in the facts \(40000\)/);
    assert.equal(ev().at(-1).outcome, "escalated");
    // Outcomes: used unchanged = accepted, used after edits = edited, discarded = rejected.
    await k.j(`${k.X}/drafts/${d2.id}/use`, {}); assert.equal(ev().at(-1).outcome, "accepted");
    k.ai(() => JSON.stringify({ subject: "أهلاً", body: "هلا Faisal، عمولتك 15% لمدة 6 أشهر." }));
    const d4 = (await k.j(`${k.X}/${p.id}/ai/onboarding`, {})).body;
    await k.j(`${k.X}/drafts/${d4.id}/use`, { body: d4.body + "\nThanks" }); assert.equal(ev().at(-1).outcome, "edited");
    const d5 = (await k.j(`${k.X}/${p.id}/ai/onboarding`, {})).body;
    await k.j(`${k.X}/drafts/${d5.id}/discard`, {}); assert.equal(ev().at(-1).outcome, "rejected");
    const n = ev().length; await k.j(`${k.X}/drafts/${d5.id}/discard`, {}); assert.equal(ev().length, n, "judged once");
    // Monthly update: facts are this month's clicks and counts, never invented.
    k.ai(null);
    await k.visit(`/r/${p.codes[0].code}`);
    const up = (await k.j(`${k.X}/${p.id}/ai/update`, { month: "2026-11" })).body;
    assert.match(up.body, /- النقرات: 1/); assert.match(up.body, /- Clicks: 1/); assert.match(up.body, /This month's statement: \[ADD\]/);
    // Switched off: plain template.
    wf.set("partnerships_manager", { paused: true });
    const off = (await k.j(`${k.X}/${p.id}/ai/outreach`, {})).body;
    assert.equal(off.by_ai, false); assert.match(off.note, /switched off/);
    wf.set("partnerships_manager", { paused: false });
    // Sending: only through the Store CRM (linked store), never with [ADD], Test mode logs only.
    assert.match((await k.j(`${k.X}/drafts/${d1.id}/send`, {})).body.detail, /Link the partner to a Store CRM store/);
    const st = k.app.locals.crm.add(k.w.id, { store_name: "Agency AI", domain: "agency-ai.example", email: "faisal@agency-ai.example" });
    await k.j(`${k.X}/${p.id}`, { crm_store_id: st.id }, "PUT");
    assert.match((await k.j(`${k.X}/drafts/${d1.id}/send`, {})).body.detail, /Fill in every \[ADD\]/);
    const clean = d1.body.replace(/\[ADD[^\]]*\]/g, "سارة");
    const t = (await k.j(`${k.X}/drafts/${d1.id}/send`, { body: clean, subject: "Welcome" })).body;
    assert.equal(t.message.status, "test"); assert.equal(sent.length, 0); assert.equal(t.draft.sent.status, "test");
    const fin = await k.user("finance", "f9");
    assert.equal((await k.as(fin.ck, `${k.X}/drafts/${d1.id}/send`, "POST", { body: clean })).status, 403);
  } finally { k.done(); }
});

test("partners Command Center needs (statements to approve, approved unpaid 14+ days, signed partners quiet 30 days) redacted without the module; agent, roles, Ask DPA AD tools", async () => {
  const { AGENTS, agentFor } = await import("../lib/agents.js");
  const { TOOLS } = await import("../lib/assistant.js");
  const { DEFAULT_ROLES, moduleFor, MODULE_IDS } = await import("../lib/access.js");
  const ag = AGENTS.find((a) => a.id === "partnerships_manager");
  assert.equal(ag.name, "AI Partnerships manager"); assert.equal(ag.team, "Sales"); assert.equal(ag.max, 1); assert.equal(ag.module, "partners");
  assert.equal(agentFor("POST", "/api/workspaces/1/partners/4/ai/outreach"), "partnerships_manager");
  assert.ok(MODULE_IDS.includes("partners")); assert.equal(moduleFor("POST", "/api/workspaces/1/partners/statements/4/pay"), "partners");
  assert.deepEqual(Object.fromEntries(DEFAULT_ROLES.map((r) => [r.id, r.perms.partners])), { owner: "edit", admin: "edit", manager: "edit", member: "view", finance: "edit", creative: "none", viewer: "view" });
  const dd = fs.mkdtempSync(path.join(os.tmpdir(), "mwiz-ptr-"));
  fs.writeFileSync(path.join(dd, "db.json"), JSON.stringify({ roles: [{ id: "member", name: "Team member", perms: { command: "view" } }] }));
  assert.equal(new Store(dd).db.roles.find((r) => r.id === "member").perms.partners, "view"); fs.rmSync(dd, { recursive: true, force: true });
  const lt = TOOLS.find((t) => t.name === "list_partners"), at = TOOLS.find((t) => t.name === "add_partner");
  assert.equal(lt.module, "partners"); assert.ok(!lt.write); assert.equal(at.module, "partners"); assert.equal(at.write, true); assert.equal(at.risk, "low"); assert.equal(typeof at.preview, "function");

  let script = [];
  const fakeClient = async (p) => { const n = script.shift(); return typeof n === "function" ? n(p) : n; };
  const use = (id, name, input) => ({ stop_reason: "tool_use", model: "m", usage: { input_tokens: 10, output_tokens: 5 }, content: [{ type: "tool_use", id, name, input }] });
  const say = (text) => ({ stop_reason: "end_turn", model: "m", usage: { input_tokens: 10, output_tokens: 5 }, content: [{ type: "text", text }] });
  const k = await ptKit({ clock: "2026-09-01T09:00:00Z", assistantClient: fakeClient });
  try {
    const needs = async (c = k.ck) => (await k.as(c, `${k.W}/command`)).body.needs.filter((n) => n.module === "Partners");
    await k.j(k.X, { name: "Quiet Agency", status: "signed" });
    const busy = (await k.j(k.X, { name: "Busy Agency", status: "active", agreement: { commission_pct: 10, recurring_months: 12 } })).body;
    k.at("2026-10-05T09:00:00Z");
    await k.visit(`/r/${busy.codes[0].code}`);
    const { c } = await ptCustomer(k, { name: "Need Store" }, [["2026-09-20", 1000]]);
    await k.j(`${k.X}/attributions`, { kind: "customer", ref_id: c.id, code_id: busy.codes[0].id });
    let n = await needs();
    assert.deepEqual(n.map((x) => x.title), ["Quiet partners"]); assert.match(n[0].text, /1 signed partner has had no clicks or referrals in 30 days: Quiet Agency/);
    const s = (await k.j(`${k.X}/statements/generate`, { month: "2026-09" })).body.statements[0];
    n = await needs();
    assert.ok(n.some((x) => x.title === "Partner statements to approve" && /1 partner statement is waiting/.test(x.text)));
    await k.j(`${k.X}/statements/${s.id}/approve`, {});
    k.at("2026-10-20T09:00:00Z");
    n = await needs();
    assert.ok(n.some((x) => x.title === "Approved statements not paid" && /Busy Agency 2026-09/.test(x.text)));
    assert.ok(!n.some((x) => x.title === "Partner statements to approve"));
    const cr = await k.user("creative", "cc");
    assert.equal((await needs(cr.ck)).length, 0, "redacted without the module");
    await k.j(`${k.X}/statements/${s.id}/pay`, { reference: "TR-9" });
    assert.ok(!(await needs()).some((x) => x.title === "Approved statements not paid"));

    // Ask DPA AD: list partners (read) and add a partner (write, after a confirm).
    script = [use("p1", "list_partners", {}), (p) => { const r = JSON.parse(p.messages.at(-1).content[0].content); assert.equal(r.total, 2); assert.ok(r.partners.every((x) => x.links.length === 1)); return say("Two partners."); }];
    const a1 = (await k.as(k.ck, "/api/assistant", "POST", { message: "Partners?", ws: k.w.id })).body;
    assert.match(a1.reply, /Two partners/);
    script = [use("p2", "add_partner", { name: "Salla Partners", type: "platform", contact_name: "Lama", contact_email: "lama@salla.example" })];
    const a2 = (await k.as(k.ck, "/api/assistant", "POST", { thread_id: a1.thread_id, message: "Add Salla Partners", ws: k.w.id })).body;
    assert.equal(a2.pending.summary, 'Add the partner "Salla Partners" (platform, prospect), contact Lama lama@salla.example, with a new referral link');
    assert.ok(!k.st.db.partners_partners.some((x) => x.name === "Salla Partners"));
    script = [say("Added.")];
    await k.as(k.ck, "/api/assistant/confirm", "POST", { thread_id: a1.thread_id, action_id: a2.pending.id, approve: true });
    const added = k.st.db.partners_partners.find((x) => x.name === "Salla Partners");
    assert.equal(added.contact.email, "lama@salla.example"); assert.match(added.log[0].text, /via Ask DPA AD/);
  } finally { k.done(); }
});

test("partners: data requests cover partner contacts (statements kept), sample partners with clicks and a draft statement removed with sample data, workspace delete", async () => {
  const { findSubject, exportSubject, deleteSubject, REGISTER_STARTER } = await import("../lib/compliance.js");
  assert.ok(REGISTER_STARTER.some((r) => r.key === "partner_contacts" && r.module === "partners"));
  const k = await ptKit({ clock: "2026-11-03T09:00:00Z" });
  try {
    const p = (await k.j(k.X, { name: "DSR Agency", contact: { name: "Huda", email: "huda@dsr.example", phone: "+966 55 123 4567" }, notes: "Call huda@dsr.example on Sunday" })).body;
    const d = (await k.j(`${k.X}/${p.id}/ai/outreach`, {})).body;
    k.st.db.partners_drafts.find((x) => x.id === d.id).body += "\nhuda@dsr.example";
    k.st.db.partners_statements.push({ id: "s-dsr", workspace_id: k.w.id, partner_id: p.id, partner_name: "DSR Agency", month: "2026-10", status: "paid", lines: [], total_sar: 10, log: [] });
    const ctx = { store: k.st, crm: k.app.locals.crm };
    assert.equal(findSubject(ctx, { email: "HUDA@dsr.example" }).partners.length, 1);
    assert.equal(findSubject(ctx, { phone: "0551234567" }).partners.length, 1);
    const x = exportSubject(ctx, { email: "huda@dsr.example" });
    assert.equal(x.partners[0].contact.name, "Huda"); assert.equal(x.partners[0].drafts.length, 1);
    const c = deleteSubject(ctx, { email: "huda@dsr.example" });
    assert.equal(c.partner_contacts_cleared, 1);
    const after = k.st.db.partners_partners.find((y) => y.id === p.id);
    assert.deepEqual(after.contact, { name: "", email: "", phone: "" }); assert.equal(after.notes, "Call [removed] on Sunday");
    assert.doesNotMatch(k.st.db.partners_drafts.find((y) => y.id === d.id).body, /huda@dsr\.example/);
    assert.ok(k.st.db.partners_statements.some((s) => s.id === "s-dsr"), "statements kept for accounting");
    assert.equal(findSubject(ctx, { email: "huda@dsr.example" }).partners.length, 0);

    // Sample data: two "Sample ·" partners with clicks and one draft statement; removed with Remove sample data.
    await k.j(`${k.W}/crm/sample`, {});
    const loaded = (await k.j(`${k.W}/sample-data`, {})).body;
    assert.equal(loaded.partners, 2);
    const smp = k.st.db.partners_partners.filter((y) => y.sample);
    assert.equal(smp.length, 2); assert.ok(smp.every((y) => y.name.startsWith("Sample · ")));
    assert.ok(k.st.db.partners_clicks.filter((y) => y.sample).length >= 4);
    const sst = k.st.db.partners_statements.filter((y) => y.sample);
    assert.equal(sst.length, 1); assert.equal(sst[0].status, "draft");
    const list = (await k.j(k.X)).body;
    assert.ok(list.partners.find((y) => y.name === "Sample · Riyadh Growth Agency").stats.clicks >= 4);
    const rm = (await k.j(`${k.W}/sample-data`, undefined, "DELETE")).body;
    assert.equal(rm.partners, 2); assert.equal(rm.partner_statements, 1);
    for (const coll of ["partners_partners", "partners_codes", "partners_clicks", "partners_statements", "partners_attributions"]) assert.ok(!k.st.db[coll].some((y) => y.sample), coll);
    assert.ok(k.st.db.partners_partners.some((y) => y.id === p.id), "real partner kept");
    // Deleting a workspace clears its partners_* rows and keeps other workspaces'.
    k.st.db.partners_partners.push({ id: "zp", workspace_id: "other" });
    assert.ok(k.st.deleteWorkspace(k.w.id));
    for (const coll of ["partners_partners", "partners_codes", "partners_clicks", "partners_statements", "partners_drafts", "partners_attributions"]) assert.equal(k.st.db[coll].filter((y) => y.workspace_id === k.w.id).length, 0, coll);
    assert.deepEqual(k.st.db.partners_partners.map((y) => y.id), ["zp"]);
  } finally { k.done(); }
});
