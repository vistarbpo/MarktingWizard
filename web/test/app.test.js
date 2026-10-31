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
let server, base, cookie, store, dir;
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
  server = createApp({ store, provider, password: PASSWORD }).listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

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
  const routes = ["results", "product", "ops", "finance", "command", "support", "team", "pipeline", "sop", "overview", "brief", "knowledge", "kpis", "playbooks", "library"];
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
  assert.deepEqual(d.work.modules.map((m) => m.module), ["Marketing", "Sales", "Support", "Hiring"]);
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
