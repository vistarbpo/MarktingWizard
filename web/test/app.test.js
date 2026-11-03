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
  const routes = ["workforce", "studio", "crm", "access", "results", "product", "ops", "finance", "command", "support", "team", "pipeline", "sop", "overview", "brief", "knowledge", "kpis", "playbooks", "library"];
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
