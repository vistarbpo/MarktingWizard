// HTTP routes and the background service for Paid Ads (module "ads" in Teams & roles).
// Test mode by default: nothing changes on any ad platform until an approver switches the workspace to Live.
// Campaigns are created PAUSED; only an approver activates them, with an explicit click. Never automatically.
import crypto from "node:crypto";
import { withAgent } from "./agents.js";
import { LLMError } from "./engine.js";
import { normDomain, normEmail, normPhone, riyadhDay } from "./crm.js";
import { mediaView } from "./media.js";
import { cleanCode } from "./partners.js";
import { checkState, makeState, seal, unseal } from "./social.js";
import { AD_PLATFORMS, AD_PLATFORM_IDS, adsAuthUrl, adsConfig, adsConfigured, adsExchange, adsPlatformEnabled, adsRedirectUri, buildCreatePayloads, createPausedCampaign, fetchInsights, listAdAccounts,
  metaFromUserToken, metaTargetingIds, refreshAdsTokens, revokeAdsTokens, setAdsStatus, setDailyBudget } from "./adsapi.js";
import { CHANNELS, CHANNEL_IDS, COLL, DEFAULT_RULES, RESULT_TYPES, RULE_KINDS, adsSettings, aggregate, attribution, budgetPacing, buildUtmUrl, channelOf, channelOfPlatform, cleanAdsSettings, cleanPlan, cleanRule, cleanUtm,
  creativeReport, creativeSuggestions, dailySeries, effectiveRows, ensureAdsCollections, evaluateRules, fxRate, metricsOf, missingFx, parseAdsInsightsCsv, parseIdeas, parsePlanJson, planEdited, planPrompt, planShape,
  plannerContext, riyadhMonth, rotatorPrompt, saveRows, skeletonPlan, syncFinance, withSar } from "./ads.js";

export const APPROVER_ROLES = ["owner", "admin", "manager"]; // Owner, Admin, Team lead
export const AGENT = { buyer: "ads_media_buyer", pacer: "ads_pacer", rotator: "ads_rotator" };
const page = (title, body) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><link rel="stylesheet" href="/app.css"></head><body style="padding:32px;max-width:560px;margin:auto;font-family:system-ui">${body}</body></html>`;
const escHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const addDays = (d, k) => new Date(Date.parse(d + "T00:00:00Z") + k * 864e5).toISOString().slice(0, 10);

// ---- the service: connections, pulls, guardrails, finance push, the 6-hour schedule
export function createAds({ store, provider, workforce = null, crm = null, studio = null, cfg = adsConfig(), fetchImpl = (...a) => fetch(...a), log = console } = {}) {
  ensureAdsCollections(store);
  const level = (id) => (workforce ? workforce.level(id) : 1);
  const outcome = (id, ws, o, note) => workforce?.event(id, ws, o, note);
  const conns = (wsId) => store.listOps(COLL.accounts, wsId);
  const connFor = (wsId, p) => conns(wsId).find((a) => a.provider === p && a.status === "connected") || null;
  const accountOf = (a) => (a?.accounts || []).find((x) => x.id === a.selected) || null;
  const addLog = (wsId, e) => {
    const x = store.addOps(COLL.log, wsId, { at: new Date().toISOString(), ...e }, false);
    if (store.db[COLL.log].length > 3000) store.db[COLL.log].splice(0, store.db[COLL.log].length - 3000);
    return x;
  };

  function saveConnection(wsId, p, r, by, via = "own") {
    const cur = conns(wsId).find((a) => a.provider === p);
    const keep = cur?.selected && r.accounts.some((x) => x.id === cur.selected) ? cur.selected : (r.accounts.find((x) => x.active) || r.accounts[0])?.id || "";
    const fields = { provider: p, status: "connected", name: r.name, accounts: r.accounts, selected: keep, token_enc: seal({ ...r.tokens, own: via === "own" }, cfg.key), scopes: r.scopes || [], via,
      expires_at: r.expires_at || null, connected_by: by, connected_at: new Date().toISOString(), last_error: "" };
    return cur ? store.updateOps(COLL.accounts, wsId, cur.id, fields) : store.addOps(COLL.accounts, wsId, fields);
  }
  async function freshTokens(wsId, a) {
    let t = unseal(a.token_enc, cfg.key);
    if (!t) { store.updateOps(COLL.accounts, wsId, a.id, { status: "error", last_error: "Saved login can't be read (TOKEN_KEY or the password changed). Reconnect." }); throw new Error(`${AD_PLATFORMS[a.provider].short}: reconnect (saved login can't be read).`); }
    if (a.expires_at && Date.parse(a.expires_at) < Date.now() + 5 * 60e3) {
      const r = await refreshAdsTokens(cfg, a.provider, t, fetchImpl).catch((e) => { throw new Error(`${AD_PLATFORMS[a.provider].short}: token refresh failed (${e.message}). Reconnect.`); });
      if (r) { t = r.tokens; store.updateOps(COLL.accounts, wsId, a.id, { token_enc: seal(t, cfg.key), expires_at: r.expires_at }); }
      else if (a.provider === "meta") throw new Error("Meta: the login expired (they last about 60 days). Reconnect.");
    }
    return t;
  }
  const rowsOf = (w) => withSar(effectiveRows(store.listOps(COLL.rows, w.id)), adsSettings(w));
  const recently = (wsId) => {
    const acts = store.listOps(COLL.actions, wsId), now = Date.now();
    return (key) => acts.some((a) => a.key === key && a.status !== "failed" && now - Date.parse(a.at) < 7 * 864e5);
  };

  // Act on one guardrail action through the platform (Live only). Returns the updated action.
  async function applyAction(wsId, act, by = "ai") {
    const w = store.getWorkspace(wsId), s = adsSettings(w);
    const p = channelOf(act.channel)?.platform, a = p && connFor(wsId, p);
    const fail = (msg) => store.updateOps(COLL.actions, wsId, act.id, { status: "failed", error: msg, by, done_at: new Date().toISOString() });
    if (s.mode !== "live") return fail("Test mode: nothing is changed on the platforms.");
    if (!a) return fail(`${act.channel} isn't connected.`);
    const acct = a.accounts.find((x) => x.id === act.account_id) || accountOf(a);
    try {
      const t = await freshTokens(wsId, a), target = { level: "adset", id: act.adset_id, campaign_id: act.campaign_id };
      if (act.kind === "pause") await setAdsStatus(cfg, p, t, acct, target, false, fetchImpl);
      else { const fx = fxRate(s, acct?.currency); if (!fx) return fail(`Type the ${acct?.currency} → SAR rate in Budgets first.`); await setDailyBudget(cfg, p, t, acct, target, act.value_sar / fx, fetchImpl); }
      addLog(wsId, { kind: "guardrail", channel: act.channel, by, text: `${act.kind === "pause" ? "Paused" : `Capped at SAR ${act.value_sar}/day:`} ${act.adset_name || act.adset_id} (${act.reason})` });
      return store.updateOps(COLL.actions, wsId, act.id, { status: "done", by, done_at: new Date().toISOString(), error: "" });
    } catch (e) { return fail(String(e?.message || e).slice(0, 300)); }
  }

  // After every pull or import: guardrail rules, then the Finance push.
  async function afterData(wsId, { now = new Date() } = {}) {
    const w = store.getWorkspace(wsId); if (!w) return null;
    const s = adsSettings(w), lvl = level(AGENT.pacer), rows = rowsOf(w);
    const out = { logged: 0, applied: 0, needs_person: 0, failed: 0, finance: null };
    if (lvl > 0) {
      const acts = evaluateRules({ rules: store.listOps(COLL.rules, wsId), rows, now, mode: s.mode, level: lvl, result: s.result, done: recently(wsId) });
      for (const a of acts) {
        const rec = store.addOps(COLL.actions, wsId, { ...a, at: new Date().toISOString(), mode: s.mode, status: a.decision === "logged" ? "logged" : a.decision === "apply" ? "pending" : "open", by: "ai" }, false);
        if (a.decision === "logged") out.logged++;
        else if (a.decision === "needs_person") out.needs_person++;
        else {
          const r = await applyAction(wsId, rec, "ai");
          if (r.status === "done") { out.applied++; outcome(AGENT.pacer, wsId, "auto", `${a.kind} ${a.adset_name}: ${a.reason}`); }
          else { out.failed++; outcome(AGENT.pacer, wsId, "error", r.error); }
        }
      }
    }
    out.finance = syncFinance(store, wsId, rows);
    store.save();
    return out;
  }

  // Pull ad-level daily insights for every connected platform (read-only).
  async function pull(wsId, { now = new Date() } = {}) {
    const w = store.getWorkspace(wsId); if (!w) return null;
    const today = riyadhDay(now), first = `${riyadhMonth(now)}-01`;
    const res = [];
    for (const a of conns(wsId).filter((x) => x.status === "connected")) {
      const acct = accountOf(a);
      if (!acct || !adsPlatformEnabled(cfg, a.provider)) continue;
      const ch = channelOfPlatform(a.provider);
      const hasApi = store.listOps(COLL.rows, wsId).some((r) => r.source === "api" && r.channel === ch);
      // First pull reaches back to the start of last month; later pulls refresh the last 7 days (late conversions).
      const since = hasApi ? [addDays(today, -7), first].sort()[0] : addDays(first, -1).slice(0, 7) + "-01";
      try {
        const t = await freshTokens(wsId, a);
        const rows = (await fetchInsights(cfg, a.provider, t, acct, { since, until: today }, fetchImpl)).map((r) => ({ ...r, currency: acct.currency || "SAR", account_id: acct.id }));
        const r = saveRows(store, wsId, rows, { source: "api", account_id: acct.id });
        store.updateOps(COLL.accounts, wsId, a.id, { last_pull_at: new Date().toISOString(), last_error: "", status: "connected" });
        res.push({ channel: ch, ...r });
      } catch (e) {
        store.updateOps(COLL.accounts, wsId, a.id, { last_error: String(e?.message || e).slice(0, 300) });
        res.push({ channel: ch, error: String(e?.message || e).slice(0, 300) });
      }
    }
    if (res.length) addLog(wsId, { kind: "pull", by: "ai", text: res.map((r) => (r.error ? `${r.channel}: ${r.error}` : `${r.channel}: ${r.added} new, ${r.updated} updated rows`)).join(" · ") });
    const after = await afterData(wsId, { now });
    return { pulled: res, after };
  }
  // Every 6 hours, Live workspaces only.
  async function pullAll(now = new Date()) {
    const out = [];
    for (const w of store.listWorkspaces()) if (adsSettings(w).mode === "live" && conns(w.id).some((a) => a.status === "connected")) out.push({ ws: w.id, ...(await pull(w.id, { now })) });
    return out;
  }
  const timers = [];
  function start({ every = 6 * 3600e3 } = {}) {
    stop();
    timers.push(setInterval(() => pullAll().catch((e) => log.error?.("[ads] pull:", e?.message)), every));
    timers.forEach((t) => t.unref?.());
  }
  function stop() { while (timers.length) clearInterval(timers.pop()); }

  return { cfg, fetchImpl, conns, connFor, accountOf, saveConnection, freshTokens, applyAction, afterData, pull, pullAll, addLog, rowsOf, start, stop, level, outcome, studio, crm, provider };
}

// ---- before the login wall: the inbound lead hook (landing page or signup form posts here with its UTMs)
export function mountAdsPublic(app, { store, crm, ads }) {
  app.post("/hooks/ads/lead/:secret", (req, res) => {
    const want = ads.cfg.lead_secret, got = String(req.params.secret || "");
    if (!want || got.length !== want.length || !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want))) return res.status(403).json({ detail: "Forbidden" });
    const b = req.body || {};
    const wsId = store.getWorkspace(String(b.workspace || ""))?.id || store.listWorkspaces()[0]?.id;
    if (!wsId || !crm) return res.status(404).json({ detail: "No workspace" });
    const email = normEmail(b.email), phone = normPhone(b.phone), domain = normDomain(b.domain || b.store_url || "");
    if (!email && !phone && !domain) return res.status(422).json({ detail: "Send at least an email, phone or store link." });
    const landing_url = /^https?:\/\//i.test(String(b.url || b.landing_url || "")) ? String(b.url || b.landing_url).slice(0, 1000) : "";
    const utm = cleanUtm(landing_url ? { url: landing_url } : b) || cleanUtm(b);
    const signup = b.signup === true || b.signup === "1" || b.event === "signup";
    // Partners & referrals: a referral code from the form's `ref` field (or the dpa_ref cookie set by /r/<code>).
    const ref = cleanCode(b.ref) || cleanCode(/(?:^|;\s*)dpa_ref=([^;]+)/.exec(req.headers.cookie || "")?.[1]);
    let c = crm.find(wsId, { domain, email, phone });
    if (c) {
      const f = { tags: [...new Set([...(c.tags || []), "inbound", "ads"])] };
      if (!c.utm && utm) Object.assign(f, { utm, landing_url }); // first touch wins
      if (!c.ref_code && ref) f.ref_code = ref;
      if (signup && ["new", "contacted", "engaged", "qualified", "not_now"].includes(c.stage)) f.stage = "onboarding";
      c = crm.update(wsId, c.id, f);
    } else {
      c = crm.add(wsId, { store_name: String(b.store_name || b.name || email || domain || "+" + phone).slice(0, 200), email, phone, domain, platform: "Other", category: "Other", source: "inbound",
        stage: signup ? "onboarding" : "engaged", tags: ["inbound", "ads"], ...(utm ? { utm, landing_url } : {}), ...(ref ? { ref_code: ref } : {}), owner_name: String(b.owner_name || "").slice(0, 120) });
    }
    res.status(201).json({ ok: true, id: c.id, utm: c.utm || null, ref: c.ref_code || null });
  });
}

// ---- signed-in routes
export function mountAds(app, { store, ads, crm = null }) {
  const cfg = ads.cfg;
  const P = "/api/workspaces/:ws/ads";
  const W = (req, res) => { const w = store.getWorkspace(req.params.ws); if (!w) res.status(404).json({ detail: "Workspace not found" }); return w; };
  const by = (req) => req.user?.name || "you";
  const canApprove = (req) => req.user?.id === "owner" || APPROVER_ROLES.includes(req.user?.role_id);
  const deny = (res, what) => res.status(403).json({ detail: `Only approvers (Owner, Admin, Team lead) can ${what}.` });
  const setAds = (w, fields) => { w.ads = { ...(w.ads || {}), ...fields }; store.save(); };
  const studioMeta = (wsId) => { const a = ads.studio?.accountFor?.(wsId, "meta"); const t = a ? ads.studio.targetOf(a) : null; return { a, page_id: t?.page_id || "", ig_id: t?.ig_id || "" }; };
  const mediaUrl = (m) => mediaView(m, cfg.public_url).url;
  const agentLevels = () => Object.fromEntries(Object.entries(AGENT).map(([k, id]) => [k, ads.level(id)]));
  const connView = (a) => {
    const { token_enc, ...rest } = a;
    const p = AD_PLATFORMS[a.provider];
    return { ...rest, provider_name: p.name, account: ads.accountOf(a), missing_scopes: a.provider === "meta" && a.scopes?.length ? p.scopes.filter((s) => !a.scopes.includes(s)) : [],
      expired: !!(a.expires_at && Date.parse(a.expires_at) < Date.now() && a.provider === "meta") };
  };
  const reviewed = (p) => ({ meta: process.env.META_ADS_REVIEWED === "1", snap: process.env.SNAP_ADS_APPROVED === "1", tiktok: process.env.TIKTOK_ADS_APPROVED === "1", google: process.env.GOOGLE_ADS_BASIC_ACCESS === "1" })[p];
  const seedRules = (w) => {
    if (w.ads?.rules_seeded) return;
    for (const r of DEFAULT_RULES) store.addOps(COLL.rules, w.id, { ...r }, false);
    setAds(w, { rules_seeded: true });
  };

  // ---- overview
  app.get(P, (req, res) => {
    const w = W(req, res); if (!w) return;
    const s = adsSettings(w), now = new Date(), rows = ads.rowsOf(w), month = riyadhMonth(now), today = riyadhDay(now);
    const mRows = rows.filter((r) => r.date.startsWith(month));
    const rep = creativeReport({ rows, items: store.listOps("creative_items", w.id), now, result: s.result });
    const att = attribution({ contacts: crm ? crm.contacts(w.id) : [], deals: store.listDeals(w.id), rows, month, result: s.result });
    res.json({
      settings: s, mode: s.mode, can_approve: canApprove(req), result_types: RESULT_TYPES, channels: CHANNELS, agents: agentLevels(),
      pacing: budgetPacing(rows, s, now), fx_missing: missingFx(store.listOps(COLL.rows, w.id), s),
      month, channels_month: CHANNEL_IDS.map((c) => ({ channel: c, ...metricsOf(mRows.filter((r) => r.channel === c), s.result) })), total_month: metricsOf(mRows, s.result),
      trend: dailySeries(rows, addDays(today, -29), today, s.result), top: rep.top, bottom: rep.bottom, attribution: { channels: att.channels, total: att.total },
      connections: ads.conns(w.id).map(connView), has_data: rows.length > 0,
      waiting: { plans: store.listOps(COLL.plans, w.id).filter((p) => p.status === "draft").length, actions: store.listOps(COLL.actions, w.id).filter((a) => a.status === "open").length },
    });
  });
  app.put(`${P}/settings`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const b = req.body || {}, cur = adsSettings(w);
    if ((b.mode !== undefined || b.budgets !== undefined || b.fx !== undefined || b.tolerance_pct !== undefined) && !canApprove(req)) return deny(res, "switch Test/Live or change budgets and rates");
    const o = cleanAdsSettings(b, cur);
    setAds(w, o);
    if (o.mode && o.mode !== cur.mode) ads.addLog(w.id, { kind: "settings", by: by(req), text: `${by(req)} switched Paid Ads to ${o.mode === "live" ? "Live" : "Test"} mode.` });
    if (o.budgets) ads.addLog(w.id, { kind: "settings", by: by(req), text: `${by(req)} set monthly budgets: ${Object.entries(o.budgets).filter(([, v]) => v).map(([k, v]) => `${k} SAR ${v}`).join(", ") || "none"}.` });
    store.save();
    res.json(adsSettings(w));
  });

  // ---- performance by campaign / ad set / ad
  app.get(`${P}/campaigns`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const s = adsSettings(w), days = Math.max(1, Math.min(90, Number(req.query.days) || 30)), level = ["campaign", "adset", "ad"].includes(req.query.level) ? req.query.level : "campaign";
    const from = addDays(riyadhDay(), -(days - 1));
    const rows = ads.rowsOf(w).filter((r) => r.date >= from);
    res.json({ level, days, result: s.result, rows: aggregate(rows, level, s.result).slice(0, 300), plans: store.listOps(COLL.plans, w.id).sort((a, b) => b.created_at.localeCompare(a.created_at)), mode: s.mode, can_approve: canApprove(req),
      connected: Object.fromEntries(AD_PLATFORM_IDS.map((p) => [channelOfPlatform(p), !!ads.connFor(w.id, p)])), agents: agentLevels() });
  });

  // ---- accounts: connections, OAuth, CSV import
  app.get(`${P}/accounts`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const notice = w.ads?.oauth_notice || null;
    if (notice) setAds(w, { oauth_notice: null });
    const sm = studioMeta(w.id);
    res.json({
      platforms: AD_PLATFORM_IDS.filter((p) => adsPlatformEnabled(cfg, p)).map((p) => ({ id: p, ...AD_PLATFORMS[p], channel: channelOfPlatform(p), configured: adsConfigured(cfg, p), redirect_uri: adsRedirectUri(cfg, p),
        review_done: reviewed(p), connection: (() => { const a = ads.conns(w.id).find((x) => x.provider === p); return a ? connView(a) : null; })() })),
      google_flag: cfg.google.enabled, studio_meta: !!sm.a, notice, mode: adsSettings(w).mode, can_approve: canApprove(req), lead_hook: { set: !!cfg.lead_secret, url: `${cfg.public_url}/hooks/ads/lead/<ADS_LEAD_SECRET>` },
      batches: store.listOps(COLL.batches, w.id).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 50), log: store.listOps(COLL.log, w.id).slice(-60).reverse(), channels: CHANNEL_IDS, result: adsSettings(w).result,
    });
  });
  app.put(`${P}/accounts/:id`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const a = store.getOps(COLL.accounts, w.id, req.params.id);
    if (!a) return res.status(404).json({ detail: "Not found" });
    if (!a.accounts.some((x) => x.id === String(req.body?.selected))) return res.status(422).json({ detail: "Pick one of the ad accounts this login can see." });
    res.json(connView(store.updateOps(COLL.accounts, w.id, a.id, { selected: String(req.body.selected) })));
  });
  app.post(`${P}/accounts/:id/refresh`, async (req, res) => {
    const w = W(req, res); if (!w) return;
    const a = store.getOps(COLL.accounts, w.id, req.params.id);
    if (!a) return res.status(404).json({ detail: "Not found" });
    try {
      const accounts = await listAdAccounts(cfg, a.provider, await ads.freshTokens(w.id, a), ads.fetchImpl);
      res.json(connView(store.updateOps(COLL.accounts, w.id, a.id, { accounts, selected: accounts.some((x) => x.id === a.selected) ? a.selected : accounts[0]?.id || "", last_error: "" })));
    } catch (e) { res.status(502).json({ detail: String(e?.message || e).slice(0, 300) }); }
  });
  app.delete(`${P}/accounts/:id`, async (req, res) => {
    const w = W(req, res); if (!w) return;
    const a = store.getOps(COLL.accounts, w.id, req.params.id);
    if (!a) return res.status(404).json({ detail: "Not found" });
    const t = unseal(a.token_enc, cfg.key);
    if (t) await revokeAdsTokens(cfg, a.provider, t, ads.fetchImpl).catch(() => {});
    store.deleteOps(COLL.accounts, w.id, a.id);
    ads.addLog(w.id, { kind: "account", by: by(req), text: `${AD_PLATFORMS[a.provider].short} ads disconnected by ${by(req)}.` });
    store.save();
    res.status(204).end();
  });
  // Meta: use Creative Studio's Meta login when it already carries the ads permissions (one Meta app, one login).
  app.post(`${P}/accounts/meta/reuse`, async (req, res) => {
    const w = W(req, res); if (!w) return;
    const sm = studioMeta(w.id);
    if (!sm.a) return res.status(422).json({ detail: "Creative Studio has no Meta login yet. Use Connect Meta Ads instead." });
    const t = ads.studio.tokensOf(sm.a);
    if (!t?.user) return res.status(422).json({ detail: "Creative Studio's Meta login can't be read: reconnect it there, or use Connect Meta Ads." });
    try {
      const r = await metaFromUserToken(cfg, t.user, sm.a.expires_at || null, ads.fetchImpl);
      if (!r.scopes.includes("ads_read")) return res.status(422).json({ detail: "Creative Studio's Meta login doesn't include ads permissions yet. Use Connect Meta Ads: the same Meta app adds ads_read, ads_management and business_management." });
      const a = ads.saveConnection(w.id, "meta", r, by(req), "studio");
      ads.addLog(w.id, { kind: "account", by: by(req), text: `Meta ads connected from Creative Studio's login by ${by(req)} (${r.accounts.length} ad accounts).` });
      store.save();
      res.json(connView(a));
    } catch (e) { res.status(502).json({ detail: String(e?.message || e).slice(0, 300) }); }
  });

  // OAuth (navigations): start and callback. People with Edit on Paid Ads.
  const mayConnect = (req) => req.user?.id === "owner" || req.perms?.ads === "edit";
  app.get("/oauth/ads/:p/start", (req, res) => {
    const p = req.params.p, w = store.getWorkspace(String(req.query.ws || ""));
    if (!AD_PLATFORMS[p] || !adsPlatformEnabled(cfg, p) || !w) return res.status(404).send(page("Not found", "<h2>Unknown platform or workspace</h2>"));
    if (!mayConnect(req)) return res.status(403).send(page("Not allowed", "<h2>You need Edit access to Paid Ads to connect ad accounts.</h2>"));
    if (!adsConfigured(cfg, p)) return res.status(422).send(page("Not set up", `<h2>${escHtml(AD_PLATFORMS[p].name)} isn't set up</h2><p>Add ${AD_PLATFORMS[p].env.map(escHtml).join(", ")} in hPanel, then try again.</p><p><a href="/#/${w.id}/ads/accounts">Back</a></p>`));
    const { state, nonce } = makeState(cfg.key, { ws: w.id, provider: "ads_" + p, uid: req.user.id });
    res.setHeader("Set-Cookie", `mwiz_ads_oauth=${nonce}; Path=/oauth/ads; HttpOnly; Secure; SameSite=Lax; Max-Age=900`);
    res.redirect(adsAuthUrl(cfg, p, state));
  });
  app.get("/oauth/ads/:p/callback", async (req, res) => {
    const p = req.params.p;
    if (!AD_PLATFORMS[p]) return res.status(404).send(page("Not found", "<h2>Unknown platform</h2>"));
    const nonce = /(?:^|;\s*)mwiz_ads_oauth=([^;]+)/.exec(req.headers.cookie || "")?.[1] || "";
    const st = checkState(cfg.key, String(req.query.state || ""), { uid: req.user.id, nonce, provider: "ads_" + p });
    res.setHeader("Set-Cookie", "mwiz_ads_oauth=; Path=/oauth/ads; HttpOnly; Secure; SameSite=Lax; Max-Age=0");
    if (!st) return res.status(403).send(page("Link expired", "<h2>This sign-in link isn't valid</h2><p>It expired, or was started by someone else or in another browser. Start again from Paid Ads → Accounts.</p><p><a href=\"/\">Back to the dashboard</a></p>"));
    const w = store.getWorkspace(st.ws);
    if (!w || !mayConnect(req)) return res.status(403).send(page("Not allowed", "<h2>Not allowed</h2>"));
    const notice = (ok, text) => setAds(w, { oauth_notice: { provider: p, ok, text, at: new Date().toISOString() } });
    if (req.query.error) notice(false, `${AD_PLATFORMS[p].short}: ${String(req.query.error_description || req.query.error).slice(0, 200)}`);
    else {
      try {
        const r = await adsExchange(cfg, p, req.query, ads.fetchImpl);
        ads.saveConnection(w.id, p, r, req.user.name);
        ads.addLog(w.id, { kind: "account", by: req.user.name, text: `${AD_PLATFORMS[p].short} ads connected (${r.accounts.length} ad account${r.accounts.length === 1 ? "" : "s"}) by ${req.user.name}.` });
        store.save();
        notice(true, `${AD_PLATFORMS[p].short} connected: ${r.accounts.length} ad account${r.accounts.length === 1 ? "" : "s"}. Pick the one DPA AD uses.`);
      } catch (e) { notice(false, `${AD_PLATFORMS[p].short} didn't connect: ${String(e?.message || e).slice(0, 200)}`); }
    }
    res.redirect(`/#/${w.id}/ads/accounts`);
  });

  app.post(`${P}/pull`, async (req, res) => {
    const w = W(req, res); if (!w) return;
    if (!ads.conns(w.id).some((a) => a.status === "connected")) return res.status(422).json({ detail: "Connect an ad account first, or import a CSV." });
    res.json(await ads.pull(w.id)); // read-only; in Test mode guardrails only log what they would do
  });

  // CSV import fallback
  app.post(`${P}/import/parse`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const s = adsSettings(w), b = req.body || {};
    const r = parseAdsInsightsCsv(String(b.text || "").slice(0, 3e6), { channel: CHANNEL_IDS.includes(b.channel) ? b.channel : "", currency: String(b.currency || ""), result: s.result });
    if (r.error) return res.status(422).json({ detail: r.error });
    const dates = r.rows.map((x) => x.date).sort();
    res.json({ ...r, rows: r.rows.slice(0, 5000), preview: r.rows.slice(0, 8), from: dates[0], to: dates.at(-1), fx: fxRate(s, r.currency), totals: { spend: Math.round(r.rows.reduce((a, x) => a + x.spend, 0) * 100) / 100, rows: r.rows.length } });
  });
  app.post(`${P}/import`, async (req, res) => {
    const w = W(req, res); if (!w) return;
    const s = adsSettings(w), b = req.body || {};
    const r = parseAdsInsightsCsv(String(b.text || "").slice(0, 3e6), { channel: CHANNEL_IDS.includes(b.channel) ? b.channel : "", currency: String(b.currency || ""), result: s.result });
    if (r.error) return res.status(422).json({ detail: r.error });
    const dates = r.rows.map((x) => x.date).sort();
    const batch = store.addOps(COLL.batches, w.id, { channel: r.channel, currency: r.currency, rows: r.rows.length, from: dates[0], to: dates.at(-1), by: by(req), spend: Math.round(r.rows.reduce((a, x) => a + x.spend, 0) * 100) / 100 }, false);
    const saved = saveRows(store, w.id, r.rows, { source: "csv", batch_id: batch.id });
    ads.addLog(w.id, { kind: "import", by: by(req), text: `${by(req)} imported ${r.rows.length} ${r.channel} rows (${dates[0]} → ${dates.at(-1)}).` });
    const after = await ads.afterData(w.id);
    res.status(201).json({ batch, ...saved, after, fx_missing: fxRate(s, r.currency) == null ? [r.currency] : [] });
  });
  app.delete(`${P}/import/:id`, async (req, res) => {
    const w = W(req, res); if (!w) return;
    const bt = store.getOps(COLL.batches, w.id, req.params.id);
    if (!bt) return res.status(404).json({ detail: "Not found" });
    store.db[COLL.rows] = store.db[COLL.rows].filter((r) => !(r.workspace_id === w.id && r.batch_id === bt.id));
    store.deleteOps(COLL.batches, w.id, bt.id);
    await ads.afterData(w.id);
    res.status(204).end();
  });

  // ---- budgets & guardrail rules
  app.get(`${P}/rules`, (req, res) => {
    const w = W(req, res); if (!w) return;
    seedRules(w);
    const s = adsSettings(w);
    res.json({ rules: store.listOps(COLL.rules, w.id), kinds: RULE_KINDS, channels: CHANNEL_IDS, settings: s, pacing: budgetPacing(ads.rowsOf(w), s, new Date()), pacer_level: ads.level(AGENT.pacer), can_approve: canApprove(req),
      currencies: [...new Set(ads.conns(w.id).flatMap((a) => a.accounts.map((x) => x.currency)).concat(store.listOps(COLL.rows, w.id).map((r) => r.currency)).filter((c) => c && c !== "SAR"))],
      actions: store.listOps(COLL.actions, w.id).slice(-100).reverse() });
  });
  app.post(`${P}/rules`, (req, res) => {
    const w = W(req, res); if (!w) return;
    if (!canApprove(req)) return deny(res, "change guardrail rules");
    const { o, err } = cleanRule({ kind: "pause_cpa", channel: "all", enabled: false, window_days: 7, max_cpa_sar: null, min_spend_sar: null, cap_sar: null, ...req.body });
    if (err.length) return res.status(422).json({ detail: err.join(" ") });
    res.status(201).json(store.addOps(COLL.rules, w.id, o));
  });
  app.put(`${P}/rules/:id`, (req, res) => {
    const w = W(req, res); if (!w) return;
    if (!canApprove(req)) return deny(res, "change guardrail rules");
    const r = store.getOps(COLL.rules, w.id, req.params.id);
    if (!r) return res.status(404).json({ detail: "Not found" });
    const { o, err } = cleanRule(req.body || {}, r);
    if (err.length) return res.status(422).json({ detail: err.join(" ") });
    res.json(store.updateOps(COLL.rules, w.id, r.id, o));
  });
  app.delete(`${P}/rules/:id`, (req, res) => {
    const w = W(req, res); if (!w) return;
    if (!canApprove(req)) return deny(res, "change guardrail rules");
    store.deleteOps(COLL.rules, w.id, req.params.id) ? res.status(204).end() : res.status(404).json({ detail: "Not found" });
  });
  app.post(`${P}/rules/evaluate`, async (req, res) => { const w = W(req, res); if (!w) return; res.json(await ads.afterData(w.id)); });
  app.post(`${P}/actions/:id/apply`, async (req, res) => {
    const w = W(req, res); if (!w) return;
    if (!canApprove(req)) return deny(res, "pause ad sets or change budgets");
    const a = store.getOps(COLL.actions, w.id, req.params.id);
    if (!a || a.status !== "open") return res.status(404).json({ detail: "Not found or already handled" });
    if (adsSettings(w).mode !== "live") return res.status(422).json({ detail: "Test mode changes nothing on the platforms. Switch to Live first." });
    if (!a.api) return res.status(422).json({ detail: "This ad set came from a CSV import: pause or cap it in the platform's Ads Manager, then mark it done." });
    const r = await ads.applyAction(w.id, a, by(req));
    if (r.status === "done") ads.outcome(AGENT.pacer, w.id, "accepted", `${a.kind} ${a.adset_name} (applied by ${by(req)})`);
    store.save();
    r.status === "done" ? res.json(r) : res.status(502).json({ detail: r.error, action: r });
  });
  app.post(`${P}/actions/:id/resolve`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const a = store.getOps(COLL.actions, w.id, req.params.id);
    if (!a || a.status !== "open") return res.status(404).json({ detail: "Not found or already handled" });
    const done = req.body?.done === true; // "done by hand in Ads Manager" vs dismissed
    if (done && !canApprove(req)) return deny(res, "pause ad sets or change budgets");
    const r = store.updateOps(COLL.actions, w.id, a.id, { status: done ? "done" : "dismissed", by: by(req), done_at: new Date().toISOString() });
    ads.outcome(AGENT.pacer, w.id, done ? "accepted" : "rejected", `${a.kind} ${a.adset_name}: ${done ? "done by hand" : "dismissed"} by ${by(req)}`);
    res.json(r);
  });

  // ---- campaign planner (AI Media buyer)
  const planInputs = (w, b) => {
    const s = adsSettings(w), today = riyadhDay();
    const channels = [...new Set((Array.isArray(b.channels) ? b.channels : []).filter((c) => CHANNEL_IDS.includes(c)))];
    const start_date = /^\d{4}-\d{2}-\d{2}$/.test(b.start_date || "") ? b.start_date : today;
    const end_date = /^\d{4}-\d{2}-\d{2}$/.test(b.end_date || "") && b.end_date >= start_date ? b.end_date : `${start_date.slice(0, 7)}-${String(new Date(Date.UTC(+start_date.slice(0, 4), +start_date.slice(5, 7), 0)).getUTCDate()).padStart(2, "0")}`;
    return { goal: String(b.goal || "").trim().slice(0, 1000), budget_sar: Math.round(Number(b.budget_sar) * 100) / 100, channels, start_date, end_date, result: s.result, landing_url: s.landing_url };
  };
  app.get(`${P}/plans`, (req, res) => { const w = W(req, res); if (!w) return; res.json(store.listOps(COLL.plans, w.id).sort((a, b) => b.created_at.localeCompare(a.created_at))); });
  app.post(`${P}/plans`, async (req, res) => {
    const w = W(req, res); if (!w) return;
    const inp = planInputs(w, req.body || {});
    if (!inp.goal) return res.status(422).json({ detail: "Describe the goal, e.g. \"20 trials from Riyadh fashion stores this month\"." });
    if (!(inp.budget_sar > 0)) return res.status(422).json({ detail: "Type the budget in SAR." });
    if (!inp.channels.length) return res.status(422).json({ detail: "Pick at least one channel." });
    if (ads.level(AGENT.buyer) === 0) return res.status(422).json({ detail: "The AI Media buyer is switched off in AI Workforce." });
    const ctx = plannerContext(store, w, { ...inp, mediaUrl, crm });
    let raw = null, note = "";
    try {
      const text = await withAgent(AGENT.buyer, w.id, () => ads.provider.generate({ prompt: planPrompt(w, { ...inp, ...ctx }), onText: () => {} }));
      raw = parsePlanJson(text);
      if (!raw) note = "The AI didn't return a usable plan: this is a starter structure to fill in.";
    } catch (e) {
      if (e instanceof LLMError && /switched off|budget/i.test(e.message)) return res.status(422).json({ detail: e.message });
      note = "The AI couldn't be reached: this is a starter structure to fill in.";
    }
    const plan = cleanPlan(raw || skeletonPlan({ ...inp, ...ctx }), { ...inp, creatives: ctx.creatives });
    const rec = store.addOps(COLL.plans, w.id, { ...plan, status: "draft", inputs: inp, note, by_ai: !!raw, ai_shape: planShape(plan), created_by: by(req), history: [{ at: new Date().toISOString(), by: "ai", text: raw ? "Drafted by the AI Media buyer." : "Starter structure." }] });
    res.status(201).json(rec);
  });
  app.put(`${P}/plans/:id`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const p = store.getOps(COLL.plans, w.id, req.params.id);
    if (!p) return res.status(404).json({ detail: "Not found" });
    if (p.status !== "draft") return res.status(422).json({ detail: "Only draft plans can be edited. Draft a new plan for changes." });
    const b = req.body || {};
    const inp = { ...p.inputs };
    if (b.budget_sar !== undefined && Number(b.budget_sar) !== p.inputs.budget_sar) { if (!canApprove(req)) return deny(res, "change budgets"); inp.budget_sar = Math.round(Number(b.budget_sar) * 100) / 100; if (!(inp.budget_sar > 0)) return res.status(422).json({ detail: "Budget must be above 0." }); }
    const creatives = plannerContext(store, w, { ...inp, mediaUrl, crm }).creatives;
    const plan = cleanPlan({ name: b.name ?? p.name, summary: b.summary ?? p.summary, campaigns: (b.campaigns || p.campaigns).map((c) => ({ ...c, ads: (c.ads || []).map((a) => ({ ...a, name: String(a.name || "").replace(/\s*\[cs:\d+\]/g, "") })) })) }, { ...inp, creatives });
    res.json(store.updateOps(COLL.plans, w.id, p.id, { ...plan, inputs: inp, history: [...(p.history || []), { at: new Date().toISOString(), by: by(req), text: "Edited." }] }));
  });
  app.post(`${P}/plans/:id/approve`, (req, res) => {
    const w = W(req, res); if (!w) return;
    if (!canApprove(req)) return deny(res, "approve campaign plans");
    const p = store.getOps(COLL.plans, w.id, req.params.id);
    if (!p || p.status !== "draft") return res.status(404).json({ detail: "Not found or not a draft" });
    if (JSON.stringify(p.campaigns).includes("[ADD]")) return res.status(422).json({ detail: "Fill in every [ADD] (Arabic text and headlines) before approving." });
    const edited = planEdited(p);
    if (p.by_ai) ads.outcome(AGENT.buyer, w.id, edited ? "edited" : "accepted", `${p.name}: approved ${edited ? "after edits" : "unchanged"} by ${by(req)}`);
    res.json(store.updateOps(COLL.plans, w.id, p.id, { status: "approved", approved_by: by(req), approved_at: new Date().toISOString(), history: [...(p.history || []), { at: new Date().toISOString(), by: by(req), text: `Approved${edited ? " (edited)" : ""}.` }] }));
  });
  app.post(`${P}/plans/:id/reject`, (req, res) => {
    const w = W(req, res); if (!w) return;
    if (!canApprove(req)) return deny(res, "reject campaign plans");
    const p = store.getOps(COLL.plans, w.id, req.params.id);
    if (!p || p.status !== "draft") return res.status(404).json({ detail: "Not found or not a draft" });
    if (p.by_ai) ads.outcome(AGENT.buyer, w.id, "rejected", `${p.name}: rejected by ${by(req)}${req.body?.reason ? `: ${String(req.body.reason).slice(0, 200)}` : ""}`);
    res.json(store.updateOps(COLL.plans, w.id, p.id, { status: "rejected", history: [...(p.history || []), { at: new Date().toISOString(), by: by(req), text: `Rejected${req.body?.reason ? `: ${String(req.body.reason).slice(0, 200)}` : ""}.` }] }));
  });
  // Create on the platforms, always PAUSED. Test mode stores the exact payloads it would send.
  app.post(`${P}/plans/:id/create`, async (req, res) => {
    const w = W(req, res); if (!w) return;
    if (!canApprove(req)) return deny(res, "create campaigns");
    const p = store.getOps(COLL.plans, w.id, req.params.id);
    if (!p || !["approved", "created"].includes(p.status)) return res.status(422).json({ detail: "Approve the plan first." });
    const s = adsSettings(w), sm = studioMeta(w.id);
    const creatives = plannerContext(store, w, { ...p.inputs, mediaUrl, crm }).creatives;
    const images = Object.fromEntries(creatives.filter((c) => c.image_url).map((c) => [c.id, c.image_url]));
    const campaigns = [];
    for (const c of p.campaigns) {
      if (c.platform?.campaign_id) { campaigns.push(c); continue; } // already created
      const plat = channelOf(c.channel)?.platform, conn = plat && ads.connFor(w.id, plat), acct = conn && ads.accountOf(conn);
      if (c.channel === "Google") { campaigns.push({ ...c, platform: { mode: s.mode, error: "Google campaigns are built in Google Ads (reporting only here)." } }); continue; }
      const fx = acct ? fxRate(s, acct.currency) : 1;
      const ctx = { account: acct || { id: "act_TEST" }, fx: fx || 1, result: s.result, link: s.landing_url, images, page_id: s.meta_page_id || sm.page_id, ig_user_id: sm.ig_id, pixel_id: s[`${plat}_pixel_id`] || "", interests: {} };
      if (s.mode !== "live") { campaigns.push({ ...c, platform: { mode: "test", at: new Date().toISOString(), payloads: buildCreatePayloads(plat, c, ctx), note: "Test mode: nothing was sent. These are the exact requests Live mode would make (all PAUSED)." } }); continue; }
      if (!conn || !acct) { campaigns.push({ ...c, platform: { mode: "live", error: `Connect ${c.channel} and pick the ad account first.` } }); continue; }
      if (!fx) { campaigns.push({ ...c, platform: { mode: "live", error: `Type the ${acct.currency} → SAR rate in Budgets first.` } }); continue; }
      try {
        const t = await ads.freshTokens(w.id, conn);
        if (plat === "meta") {
          const names = c.ad_sets.flatMap((x) => x.audience.interests || []), jobs = c.ad_sets.flatMap((x) => x.audience.job_titles || []);
          ctx.interests = { ...(await metaTargetingIds(cfg, t, names, ads.fetchImpl, "adinterest")), ...(await metaTargetingIds(cfg, t, jobs, ads.fetchImpl, "adworkposition")) };
        }
        const payloads = buildCreatePayloads(plat, c, ctx);
        const r = await createPausedCampaign(cfg, plat, t, acct, payloads, ads.fetchImpl);
        campaigns.push({ ...c, platform: { mode: "live", status: "PAUSED", account_id: acct.id, ...r, at: new Date().toISOString(), by: by(req) } });
        ads.addLog(w.id, { kind: "create", channel: c.channel, by: by(req), text: `Created "${c.name}" on ${c.channel}, PAUSED (campaign ${r.campaign_id}, ${r.adset_ids.length} ad sets, ${r.ad_ids.length} ads).` });
      } catch (e) { campaigns.push({ ...c, platform: { mode: "live", error: String(e?.message || e).slice(0, 300) } }); }
    }
    const created = campaigns.some((c) => c.platform?.campaign_id);
    const r = store.updateOps(COLL.plans, w.id, p.id, { campaigns, status: created ? "created" : p.status, history: [...(p.history || []), { at: new Date().toISOString(), by: by(req), text: s.mode === "live" ? (created ? "Created on the platforms, PAUSED." : "Create attempted: see the errors.") : "Test run: payloads saved, nothing sent." }] });
    res.json(r);
  });
  // Activate: an approver, Live mode, explicit confirmation. Never called automatically.
  app.post(`${P}/plans/:id/activate`, async (req, res) => {
    const w = W(req, res); if (!w) return;
    if (!canApprove(req)) return deny(res, "activate campaigns");
    if (req.body?.confirm !== true) return res.status(422).json({ detail: "Confirm activation." });
    const p = store.getOps(COLL.plans, w.id, req.params.id);
    if (!p || !["created", "active"].includes(p.status)) return res.status(422).json({ detail: "Create the campaign (paused) first." });
    if (adsSettings(w).mode !== "live") return res.status(422).json({ detail: "Test mode: switch to Live to activate." });
    const only = req.body?.channel ? String(req.body.channel) : null;
    const campaigns = [];
    for (const c of p.campaigns) {
      if (!c.platform?.campaign_id || (only && c.channel !== only) || c.platform.status === "ACTIVE") { campaigns.push(c); continue; }
      const plat = channelOf(c.channel).platform, conn = ads.connFor(w.id, plat);
      const acct = conn && (conn.accounts.find((x) => x.id === c.platform.account_id) || ads.accountOf(conn));
      try {
        if (!conn) throw new Error(`${c.channel} isn't connected.`);
        const t = await ads.freshTokens(w.id, conn);
        for (const id of c.platform.ad_ids || []) await setAdsStatus(cfg, plat, t, acct, { level: "ad", id }, true, ads.fetchImpl);
        for (const id of c.platform.adset_ids || []) await setAdsStatus(cfg, plat, t, acct, { level: "adset", id, campaign_id: c.platform.campaign_id }, true, ads.fetchImpl);
        await setAdsStatus(cfg, plat, t, acct, { level: "campaign", id: c.platform.campaign_id }, true, ads.fetchImpl);
        campaigns.push({ ...c, platform: { ...c.platform, status: "ACTIVE", activated_by: by(req), activated_at: new Date().toISOString(), error: "" } });
        ads.addLog(w.id, { kind: "activate", channel: c.channel, by: by(req), text: `${by(req)} activated "${c.name}" on ${c.channel}.` });
      } catch (e) { campaigns.push({ ...c, platform: { ...c.platform, error: String(e?.message || e).slice(0, 300) } }); }
    }
    const active = campaigns.some((c) => c.platform?.status === "ACTIVE");
    res.json(store.updateOps(COLL.plans, w.id, p.id, { campaigns, status: active ? "active" : p.status, history: [...(p.history || []), { at: new Date().toISOString(), by: by(req), text: active ? "Activated by a person." : "Activation failed: see the errors." }] }));
  });
  app.delete(`${P}/plans/:id`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const p = store.getOps(COLL.plans, w.id, req.params.id);
    if (!p) return res.status(404).json({ detail: "Not found" });
    if (["created", "active"].includes(p.status)) return res.status(422).json({ detail: "This plan exists on the platforms: keep it for the record." });
    store.deleteOps(COLL.plans, w.id, p.id); res.status(204).end();
  });

  // ---- creative rotation (AI Creative rotator)
  const creativesView = (w) => {
    const s = adsSettings(w), done = new Set(w.ads?.ideas_done || []);
    const rep = creativeReport({ rows: ads.rowsOf(w), items: store.listOps("creative_items", w.id), now: new Date(), result: s.result });
    const lvl = ads.level(AGENT.rotator);
    const suggestions = lvl > 0 ? [...(w.ads?.ai_ideas || []), ...creativeSuggestions(rep)].filter((x) => !done.has(x.key)) : [];
    return { ...rep, suggestions, rotator_level: lvl, result: s.result };
  };
  app.get(`${P}/creatives`, (req, res) => { const w = W(req, res); if (!w) return; res.json(creativesView(w)); });
  app.post(`${P}/creatives/suggest`, async (req, res) => {
    const w = W(req, res); if (!w) return;
    if (ads.level(AGENT.rotator) === 0) return res.status(422).json({ detail: "The AI Creative rotator is switched off in AI Workforce." });
    const rep = creativeReport({ rows: ads.rowsOf(w), items: store.listOps("creative_items", w.id), now: new Date(), result: adsSettings(w).result });
    try {
      const text = await withAgent(AGENT.rotator, w.id, () => ads.provider.generate({ prompt: rotatorPrompt(w, rep), onText: () => {} }));
      const ideas = parseIdeas(text);
      if (!ideas.length) return res.status(422).json({ detail: "The AI didn't return ideas. Try again." });
      setAds(w, { ai_ideas: [...ideas, ...(w.ads?.ai_ideas || [])].slice(0, 20) });
      res.json(creativesView(w));
    } catch (e) { res.status(e instanceof LLMError ? 422 : 502).json({ detail: e?.message || "AI failed" }); }
  });
  app.post(`${P}/creatives/ideas`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const b = req.body || {}, title = String(b.title || "").trim().slice(0, 160);
    if (!title) return res.status(422).json({ detail: "Give the idea a title." });
    const brief = [String(b.brief || "").slice(0, 2500), b.why ? `Why (Paid Ads): ${String(b.why).slice(0, 300)}` : ""].filter(Boolean).join("\n\n");
    const i = store.addOps("creative_items", w.id, { title, brief, pillar: "product", status: "idea", channels: [], variants: {}, comments: [], history: [], published: {}, created_by: by(req), source: "ads_rotator", date: null, time: "" });
    if (b.key) setAds(w, { ideas_done: [...new Set([...(w.ads?.ideas_done || []), String(b.key)])].slice(-300) });
    ads.outcome(AGENT.rotator, w.id, "accepted", `Idea kept: ${title}`);
    res.status(201).json(i);
  });
  app.post(`${P}/creatives/dismiss`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const key = String(req.body?.key || "");
    if (!key) return res.status(422).json({ detail: "Which suggestion?" });
    setAds(w, { ideas_done: [...new Set([...(w.ads?.ideas_done || []), key])].slice(-300) });
    ads.outcome(AGENT.rotator, w.id, "rejected", `Suggestion dismissed: ${key}`);
    res.json({ ok: true });
  });

  // ---- UTM builder and saved links
  app.post(`${P}/utm`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const b = req.body || {}, ch = channelOf(b.channel);
    const r = buildUtmUrl(b.url || adsSettings(w).landing_url, { source: b.source || ch?.utm_source, medium: b.medium || ch?.utm_medium, campaign: b.campaign, content: b.content, term: b.term });
    if (r.error) return res.status(422).json({ detail: r.error });
    if (b.save) store.addOps(COLL.links, w.id, { url: r.url, utm: r.utm, channel: ch?.id || "", label: String(b.label || "").slice(0, 120), by: by(req) });
    res.json(r);
  });
  app.get(`${P}/links`, (req, res) => { const w = W(req, res); if (!w) return; res.json(store.listOps(COLL.links, w.id).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 200)); });
  app.delete(`${P}/links/:id`, (req, res) => { const w = W(req, res); if (!w) return; store.deleteOps(COLL.links, w.id, req.params.id) ? res.status(204).end() : res.status(404).json({ detail: "Not found" }); });

  // ---- funnel attribution
  app.get(`${P}/attribution`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const month = req.query.month === "all" ? null : /^\d{4}-\d{2}$/.test(req.query.month || "") ? req.query.month : riyadhMonth();
    res.json(attribution({ contacts: crm ? crm.contacts(w.id) : [], deals: store.listDeals(w.id), rows: ads.rowsOf(w), month, result: adsSettings(w).result }));
  });
  app.put(`${P}/attribution/contacts/:id`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const c = crm?.get(w.id, req.params.id);
    if (!c) return res.status(404).json({ detail: "Store not found" });
    const utm = req.body?.clear ? null : cleanUtm(req.body || {});
    if (!utm && !req.body?.clear) return res.status(422).json({ detail: "Paste the landing link with its utm_ parameters, or type utm_source and utm_campaign." });
    res.json(crm.update(w.id, c.id, { utm, ...(req.body?.url ? { landing_url: String(req.body.url).slice(0, 1000) } : {}) }));
  });
  app.put(`${P}/attribution/deals/:id`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const d = store.getDeal(w.id, req.params.id);
    if (!d) return res.status(404).json({ detail: "Deal not found" });
    const utm = req.body?.clear ? null : cleanUtm(req.body || {});
    if (!utm && !req.body?.clear) return res.status(422).json({ detail: "Paste the landing link with its utm_ parameters, or type utm_source and utm_campaign." });
    d.utm = utm; store.save();
    res.json(d);
  });

  // ---- Finance: push now (it also runs after every pull and import)
  app.post(`${P}/finance/sync`, (req, res) => { const w = W(req, res); if (!w) return; res.json(syncFinance(store, w.id, ads.rowsOf(w))); });
}
