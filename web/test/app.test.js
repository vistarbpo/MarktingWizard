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
  assert.ok(Array.isArray(d.needs) && d.needs.every((n) => ["Sales", "Support", "Hiring", "Finance", "Operations", "Product"].includes(n.module)));
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
