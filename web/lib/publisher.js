// Creative Studio publisher: connected accounts, the publishing scheduler, results and comments.
// Test mode by default (like the Store CRM): it logs "would publish" and calls no platform API
// until a person switches the workspace to Live. Only approved or scheduled content ever publishes.
import crypto from "node:crypto";
import { channelInfo } from "./creative.js";
import { MEDIA_COLL, mediaPath, mediaView } from "./media.js";
import { CHANNEL_PROVIDER, PROVIDERS, PUBLISHERS, captionFor, listComments, metricsFacebook, metricsInstagram, metricsTikTok, metricsYouTube, refreshTokens, replyComment, seal, sendMessage, socialConfig, unseal } from "./social.js";
import { SYSTEM_SUPPORT, parseReply, replyPrompt } from "./support.js";

export const ACCOUNTS = "social_accounts";
export const LOG = "creative_publish_log";
export const MAX_ATTEMPTS = 3;
export const DEFAULT_PUBLISH = { mode: "test", auto_publish: false };
export const SOCIAL_CHANNELS = { instagram: { comment: "Instagram comment", dm: "Instagram DM" }, facebook: { comment: "Facebook comment", dm: "Messenger" } };
const PUBLISHABLE = ["approved", "scheduled"];

export function publishSettings(w) { return { ...DEFAULT_PUBLISH, ...(w?.creative?.publish || {}) }; }
// The one place that decides whether the scheduler may post without a person clicking "Publish now".
// (The founder will tie this to an AI Workforce autonomy level later.)
export function canAutoPublish(w) { return publishSettings(w).auto_publish === true; }
// Date + time are Riyadh (UTC+3, no daylight saving). No time means 10:00.
export function dueAt(item) { return item.date ? Date.parse(`${item.date}T${item.time || "10:00"}:00+03:00`) : NaN; }
export const isDue = (item, now = Date.now()) => item.status === "scheduled" && dueAt(item) <= now;
// Channels that need posting (email goes out through Store CRM campaigns).
export const postChannels = (item) => (item.channels || []).filter((c) => c !== "email");
const versionOf = (item, ch) => crypto.createHash("sha1").update(JSON.stringify([item.variants?.[ch] || {}, item.date, item.time])).digest("hex").slice(0, 12);

export function accountView(a) {
  const { token_enc, ...rest } = a; // tokens never leave the server
  const p = PROVIDERS[a.provider];
  const granted = a.scopes || [];
  return { ...rest, provider_name: p?.name || a.provider, target: (a.targets || []).find((t) => t.id === a.selected) || null,
    missing_scopes: (p?.scopes || []).filter((s) => granted.length && !granted.includes(s)),
    expired: !!(a.expires_at && Date.parse(a.expires_at) < Date.now() && !a.can_refresh) };
}

export function createPublisher({ store, provider, cfg = socialConfig(), fetchImpl = (...a) => fetch(...a), sleep = (ms) => new Promise((r) => setTimeout(r, ms)), pollEvery = 5000, pollMax = 60, log = console } = {}) {
  const api = { cfg, fetchImpl, sleep, pollEvery, pollMax };
  const W = (id) => store.getWorkspace(id);
  const accounts = (wsId) => store.listOps(ACCOUNTS, wsId);
  const accountFor = (wsId, p) => accounts(wsId).find((a) => a.provider === p && a.status === "connected") || null;
  const tokensOf = (a) => unseal(a.token_enc, cfg.key);
  const targetOf = (a) => (a.targets || []).find((t) => t.id === a.selected) || a.targets?.[0] || null;
  const addLog = (wsId, e) => {
    const x = store.addOps(LOG, wsId, { at: new Date().toISOString(), ...e }, false);
    if (store.db[LOG].length > 3000) store.db[LOG].splice(0, store.db[LOG].length - 3000);
    return x;
  };

  function saveAccount(wsId, provider, r, by) {
    const cur = accountFor(wsId, provider) || accounts(wsId).find((a) => a.provider === provider);
    const fields = { provider, status: "connected", name: r.name, targets: r.targets, selected: cur?.targets?.some((t) => t.id === cur.selected) && r.targets.some((t) => t.id === cur.selected) ? cur.selected : r.selected,
      token_enc: seal(r.tokens, cfg.key), expires_at: r.expires_at || null, refresh_expires_at: r.refresh_expires_at || null, can_refresh: !!r.tokens.refresh && provider !== "meta",
      scopes: r.scopes || [], connected_by: by, connected_at: new Date().toISOString(), last_error: "" };
    return cur ? store.updateOps(ACCOUNTS, wsId, cur.id, fields) : store.addOps(ACCOUNTS, wsId, fields);
  }

  // Tokens for an account, refreshed first when they're close to expiring.
  async function freshTokens(wsId, a) {
    let t = tokensOf(a);
    if (!t) { store.updateOps(ACCOUNTS, wsId, a.id, { status: "error", last_error: "Saved login can't be read (TOKEN_KEY or the password changed). Reconnect." }); throw new Error(`${PROVIDERS[a.provider].short}: reconnect the account (saved login can't be read).`); }
    if (a.expires_at && Date.parse(a.expires_at) < Date.now() + 5 * 60e3) {
      const r = await refreshTokens(cfg, a.provider, t, fetchImpl).catch((e) => { throw new Error(`${PROVIDERS[a.provider].short}: token refresh failed (${e.message}). Reconnect.`); });
      if (r) { t = r.tokens; store.updateOps(ACCOUNTS, wsId, a.id, { token_enc: seal(t, cfg.key), expires_at: r.expires_at }); }
      else if (a.provider !== "meta") throw new Error(`${PROVIDERS[a.provider].short}: the login expired. Reconnect the account.`);
    }
    return t;
  }

  function filesFor(wsId, v) {
    const recs = (v.media || []).map((id) => store.getOps(MEDIA_COLL, wsId, id)).filter(Boolean)
      .map((m) => ({ ...mediaView(m, cfg.public_url), local: mediaPath(store, m.file) }));
    // Phase 1 links still work for platforms that fetch by URL, when they point straight at a file.
    if (!recs.length && v.asset_url) {
      const ext = (/\.(jpe?g|png|webp|mp4)(\?|$)/i.exec(v.asset_url) || [])[1]?.toLowerCase();
      if (ext) recs.push({ url: v.asset_url, kind: ext === "mp4" ? "video" : "image", ext: ext === "jpeg" ? "jpg" : ext, mime: ext === "mp4" ? "video/mp4" : `image/${ext === "jpg" ? "jpeg" : ext}`, size: null, local: null, linked: true });
    }
    return recs;
  }

  // Publishes the channels of one item that have a connected account. Never throws.
  async function publishItem(wsId, itemId, { by = "scheduler", channels = null, now = new Date() } = {}) {
    const w = W(wsId), s = publishSettings(w), out = { published: [], test: [], failed: [], skipped: [] };
    for (const ch of channels || postChannels(store.getOps("creative_items", wsId, itemId) || {})) {
      const item = store.getOps("creative_items", wsId, itemId); // re-read: it may have been edited meanwhile
      if (!item || !PUBLISHABLE.includes(item.status)) { out.skipped.push({ channel: ch, reason: "Only approved or scheduled content can publish." }); break; }
      if (!item.channels.includes(ch) || item.published?.[ch]) continue;
      const p = CHANNEL_PROVIDER[ch], acc = p && accountFor(wsId, p);
      if (!acc) { out.skipped.push({ channel: ch, reason: p ? `${PROVIDERS[p].short} isn't connected: download and post` : "No posting API: download and post" }); continue; }
      const state = { ...(item.publish_state?.[ch] || {}) };
      if (state.failed) { out.skipped.push({ channel: ch, reason: `Failed ${MAX_ATTEMPTS} times: retry by hand` }); continue; }
      if (state.next_at && Date.parse(state.next_at) > now.getTime() && by === "scheduler") continue;
      const v = item.variants[ch] || {}, files = filesFor(wsId, v), target = targetOf(acc);
      const label = `${channelInfo(ch).name} → ${PROVIDERS[p].short}${target ? ` (${target.ig_username ? "@" + target.ig_username : target.page_name || target.name || ""})` : ""}`;
      const setState = (st) => store.updateOps("creative_items", wsId, item.id, { publish_state: { ...(item.publish_state || {}), [ch]: st } });
      if (s.mode !== "live") {
        const ver = versionOf(item, ch);
        if (state.test_version === ver && by === "scheduler") continue; // already logged this version
        addLog(wsId, { item_id: item.id, title: item.title, channel: ch, mode: "test", status: "test", by, text: `Test mode: would publish ${label} with ${files.length} file${files.length === 1 ? "" : "s"} and a ${captionFor(ch, v).length}-character caption. Nothing was sent.` });
        setState({ ...state, test_version: ver, test_at: now.toISOString() });
        out.test.push(ch); continue;
      }
      try {
        const tokens = await freshTokens(wsId, acc);
        const cover = v.cover_id ? (() => { const m = store.getOps(MEDIA_COLL, wsId, v.cover_id); return m && { ...mediaView(m, cfg.public_url), local: mediaPath(store, m.file) }; })() : null;
        const r = await PUBLISHERS[p]({ ...api, account: acc, target, tokens, channel: ch, variant: v, files, item, cover });
        const fresh = store.getOps("creative_items", wsId, item.id);
        fresh.published = { ...(fresh.published || {}), [ch]: { at: new Date().toISOString(), by: by === "scheduler" ? "scheduler" : by, via: "api", provider: p, account_id: acc.id, post_id: r.post_id, url: r.url || "", note: r.note || "" } };
        fresh.publish_state = { ...(fresh.publish_state || {}), [ch]: { ...state, attempts: (state.attempts || 0) + 1, last_error: "", failed: false, next_at: null } };
        const all = postChannels(fresh).every((c) => fresh.published[c]);
        store.updateOps("creative_items", wsId, fresh.id, { published: fresh.published, publish_state: fresh.publish_state, ...(all ? { status: "published", published_at: new Date().toISOString() } : {}) });
        addLog(wsId, { item_id: item.id, title: item.title, channel: ch, mode: "live", status: "published", by, post_id: r.post_id, url: r.url || "", text: `Published ${label}.${r.note ? " " + r.note : ""}` });
        out.published.push(ch);
      } catch (e) {
        const attempts = (state.attempts || 0) + 1, failed = attempts >= MAX_ATTEMPTS, msg = String(e?.message || e).slice(0, 300);
        setState({ ...state, attempts, last_error: msg, failed, next_at: failed ? null : new Date(now.getTime() + attempts * 5 * 60e3).toISOString(), last_at: now.toISOString() });
        addLog(wsId, { item_id: item.id, title: item.title, channel: ch, mode: "live", status: failed ? "failed" : "retry", by, attempt: attempts, text: `${label}: ${msg}${failed ? ` Stopped after ${MAX_ATTEMPTS} tries.` : ` Will try again (${attempts}/${MAX_ATTEMPTS}).`}` });
        out.failed.push({ channel: ch, error: msg });
      }
    }
    store.save();
    return out;
  }

  function retry(wsId, itemId, ch) {
    const i = store.getOps("creative_items", wsId, itemId);
    if (!i) return null;
    return store.updateOps("creative_items", wsId, i.id, { publish_state: { ...(i.publish_state || {}), [ch]: { attempts: 0, failed: false, next_at: null, last_error: "" } } });
  }

  // Every minute: scheduled + due items, when the workspace allows posting without a person.
  let busy = false;
  async function tick(now = new Date()) {
    if (busy) return { busy: true };
    busy = true;
    const out = { items: 0, waiting: 0 };
    try {
      for (const w of store.listWorkspaces()) {
        const due = store.listOps("creative_items", w.id).filter((i) => isDue(i, now.getTime()));
        if (!due.length) continue;
        if (!canAutoPublish(w)) { out.waiting += due.length; continue; } // waits for "Publish now"
        for (const i of due) { await publishItem(w.id, i.id, { by: "scheduler", now }); out.items++; }
      }
    } finally { busy = false; }
    return out;
  }

  // ---- results: every 6 hours for posts we published by API
  async function fetchResults(now = new Date(), onlyWs = null) {
    const out = { updated: 0, errors: 0 };
    for (const w of store.listWorkspaces()) {
      if (onlyWs && w.id !== String(onlyWs)) continue;
      if (publishSettings(w).mode !== "live") continue; // Test mode calls no API
      const items = store.listOps("creative_items", w.id).filter((i) => Object.values(i.published || {}).some((p) => p.via === "api" && p.post_id));
      const byProvider = {};
      for (const i of items) for (const [ch, p] of Object.entries(i.published)) if (p.via === "api" && p.post_id) (byProvider[p.provider] ||= []).push({ i, ch, p });
      for (const [prov, list] of Object.entries(byProvider)) {
        const acc = accountFor(w.id, prov);
        if (!acc) continue;
        let tokens;
        try { tokens = await freshTokens(w.id, acc); } catch (e) { out.errors++; continue; }
        const set = (i, ch, metrics, errors = []) => { i.results = { ...(i.results || {}), [ch]: { at: now.toISOString(), metrics, errors: errors.slice(0, 5) } }; out.updated++; };
        try {
          if (prov === "meta") for (const { i, ch, p } of list) {
            const token = tokens.pages?.[targetOf(acc)?.page_id];
            const r = ch === "fb_post" ? await metricsFacebook(api, p.post_id, token) : await metricsInstagram(api, p.post_id, token);
            set(i, ch, r.metrics, r.errors);
          }
          if (prov === "google" || prov === "tiktok") {
            for (let n = 0; n < list.length; n += 20) {
              const part = list.slice(n, n + 20);
              const m = prov === "google" ? await metricsYouTube(api, part.map((x) => x.p.post_id), tokens.access) : await metricsTikTok(api, part.filter((x) => x.p.post_id !== x.p.publish_id).map((x) => x.p.post_id), tokens.access);
              for (const { i, ch, p } of part) if (m[p.post_id]) set(i, ch, m[p.post_id]);
            }
          }
        } catch (e) { out.errors++; log.error?.(`[studio] results ${prov}:`, e.message); }
      }
      store.save();
    }
    return out;
  }

  // ---- comments and DMs into AI Support. AI drafts; a person sends (nothing is posted automatically).
  async function draftFor(w, t) {
    try {
      const r = parseReply(await provider.generate({ system: SYSTEM_SUPPORT, prompt: replyPrompt(w, store.listArticles(w.id), store.getTicket(w.id, t.id)), onText: () => {} }));
      store.updateTicket(w.id, t.id, { category: r.category, language: r.language, ai_draft: r.checked && r.reply ? { text: r.reply, at: new Date().toISOString() } : null,
        ...(r.escalate ? { status: "needs_human", escalation_reason: r.reason } : {}) });
    } catch (e) { store.updateTicket(w.id, t.id, { status: "needs_human", escalation_reason: "AI could not draft: " + (e?.message || "error") }); }
  }
  async function ingestComment(wsId, { platform, comment_id, object_id, from_id, from_name, text, account_id, item_id = null, permalink = "" }) {
    const w = W(wsId);
    if (!w || !text || store.db.support_tickets.some((t) => t.workspace_id === w.id && t.social?.comment_id === comment_id)) return null;
    const t = store.addTicket(w.id, { channel: SOCIAL_CHANNELS[platform].comment, customer_name: from_name ? (platform === "instagram" ? "@" + from_name : from_name) : "", contact: "", store: "",
      social: { kind: "comment", platform, comment_id, object_id, from_id, account_id, item_id, permalink } });
    store.addTicketMessage(w.id, t.id, { from: "customer", text: String(text).slice(0, 4000) });
    await draftFor(w, t);
    return store.getTicket(w.id, t.id);
  }
  async function ingestDm(wsId, { platform, target_id, sender_id, text, mid, at, account_id }) {
    const w = W(wsId);
    if (!w || (mid && store.db.support_tickets.some((t) => t.workspace_id === w.id && t.social?.mids?.includes(mid)))) return null;
    const key = `${platform}:${target_id}:${sender_id}`;
    let t = store.listTickets(w.id).find((x) => x.social?.thread === key);
    if (!t) t = store.addTicket(w.id, { channel: SOCIAL_CHANNELS[platform].dm, customer_name: "", contact: "", store: "", social: { kind: "dm", platform, thread: key, target_id, sender_id, account_id, mids: [], last_in_at: at } });
    store.updateTicket(w.id, t.id, { social: { ...t.social, mids: [...(t.social.mids || []), mid].filter(Boolean).slice(-50), last_in_at: at || new Date().toISOString() }, ...(t.status === "resolved" ? { status: "new" } : {}) });
    store.addTicketMessage(w.id, t.id, { from: "customer", text: String(text).slice(0, 4000) });
    if (store.getTicket(w.id, t.id).status !== "needs_human") await draftFor(w, t);
    return store.getTicket(w.id, t.id);
  }
  // Which workspace/account owns a Page or Instagram id (webhooks only say the id).
  function findByTarget(targetId) {
    for (const a of store.db[ACCOUNTS]) if (a.provider === "meta" && a.status === "connected" && (a.targets || []).some((t) => t.page_id === targetId || t.ig_id === targetId)) return a;
    return null;
  }
  async function handleWebhookEvent(ev) {
    const a = findByTarget(ev.target_id);
    if (!a) return null;
    if (ev.type === "dm") return ingestDm(a.workspace_id, { ...ev, account_id: a.id });
    const item = store.listOps("creative_items", a.workspace_id).find((i) => Object.values(i.published || {}).some((p) => p.post_id === ev.object_id));
    return ingestComment(a.workspace_id, { ...ev, account_id: a.id, item_id: item?.id || null });
  }

  // Every 15 minutes: new comments on posts published in the last 30 days (Live mode only).
  async function pollComments(now = new Date(), onlyWs = null) {
    const out = { new: 0, errors: 0 };
    for (const w of store.listWorkspaces()) {
      if (onlyWs && w.id !== String(onlyWs)) continue;
      if (publishSettings(w).mode !== "live") continue;
      const acc = accountFor(w.id, "meta");
      if (!acc) continue;
      const target = targetOf(acc);
      let tokens; try { tokens = await freshTokens(w.id, acc); } catch { out.errors++; continue; }
      const token = tokens.pages?.[target?.page_id];
      for (const i of store.listOps("creative_items", w.id)) for (const [ch, p] of Object.entries(i.published || {})) {
        if (p.via !== "api" || p.provider !== "meta" || !p.post_id || now.getTime() - Date.parse(p.at) > 30 * 864e5) continue;
        const platform = ch === "fb_post" ? "facebook" : "instagram";
        if (ch === "ig_story") continue;
        try {
          for (const c of await listComments(api, platform, p.post_id, token)) {
            if (c.from_id && (c.from_id === target.page_id || c.from_id === target.ig_id)) continue; // our own replies
            if (platform === "instagram" && target.ig_username && c.from_name === target.ig_username) continue;
            const t = await ingestComment(w.id, { platform, comment_id: c.id, object_id: p.post_id, from_id: c.from_id, from_name: c.from_name, text: c.text, account_id: acc.id, item_id: i.id, permalink: p.url });
            if (t) out.new++;
          }
        } catch (e) { out.errors++; log.error?.(`[studio] comments:`, e.message); }
      }
    }
    return out;
  }

  // A person's reply from AI Support goes back where the customer wrote. Test mode logs it only.
  async function sendSupportReply(wsId, t, text) {
    const w = W(wsId), s = publishSettings(w), so = t.social;
    const acc = store.getOps(ACCOUNTS, wsId, so.account_id);
    if (!acc || acc.status !== "connected") return { status: "failed", error: "The Meta account for this conversation isn't connected any more." };
    if (so.kind === "dm" && Date.now() - Date.parse(so.last_in_at || 0) > 24 * 3600e3) return { status: "failed", error: "More than 24 hours since their last message: Meta only allows replies inside 24 hours. Reply from the Meta Business Suite instead." };
    if (s.mode !== "live") return { status: "test", error: "Test mode: not sent to Meta." };
    try {
      const tokens = await freshTokens(wsId, acc), target = (acc.targets || []).find((x) => x.page_id === so.target_id || x.ig_id === so.target_id) || targetOf(acc);
      const token = tokens.pages?.[target?.page_id];
      const r = so.kind === "comment" ? await replyComment(api, so.platform, so.comment_id, text, token) : await sendMessage(api, target.page_id, so.sender_id, text, token);
      return { status: "sent", provider_id: r?.id || r?.message_id || "" };
    } catch (e) { return { status: "failed", error: String(e?.message || e).slice(0, 300) }; }
  }

  let timers = [];
  function start({ every = 60e3, resultsEvery = 6 * 3600e3, commentsEvery = 15 * 60e3 } = {}) {
    const safe = (fn, name) => async () => { try { await fn(); } catch (e) { log.error?.(`[studio] ${name}:`, e?.message || e); } };
    timers.push(setInterval(safe(() => tick(), "tick"), every), setInterval(safe(() => fetchResults(), "results"), resultsEvery), setInterval(safe(() => pollComments(), "comments"), commentsEvery));
    timers.forEach((t) => t.unref?.());
  }
  function stop() { timers.forEach(clearInterval); timers = []; }

  return { cfg, fetchImpl, accounts, accountFor, saveAccount, tokensOf, targetOf, publishItem, retry, tick, fetchResults, pollComments, ingestComment, ingestDm, handleWebhookEvent, sendSupportReply, addLog, start, stop };
}

// ---- Results tab: totals by channel and pillar, top posts. Real numbers only.
const SUM_KEYS = ["reach", "views", "likes", "comments", "saves", "shares"];
export const engagement = (m = {}) => ["likes", "comments", "saves", "shares"].reduce((a, k) => a + (Number(m[k]) || 0), 0);
export function resultsSummary(items, pillars = []) {
  const posts = [];
  for (const i of items) for (const [ch, r] of Object.entries(i.results || {})) posts.push({ item_id: i.id, title: i.title, pillar: i.pillar || "", channel: ch, url: i.published?.[ch]?.url || "", published_at: i.published?.[ch]?.at || null, at: r.at, metrics: r.metrics || {}, errors: r.errors || [] });
  const total = (list) => Object.fromEntries(SUM_KEYS.map((k) => [k, list.some((p) => p.metrics[k] != null) ? list.reduce((a, p) => a + (Number(p.metrics[k]) || 0), 0) : null]));
  const group = (key) => Object.entries(posts.reduce((a, p) => ((a[p[key] || "none"] ||= []).push(p), a), {})).map(([k, list]) => ({ key: k, posts: list.length, ...total(list), engagement: list.reduce((a, p) => a + engagement(p.metrics), 0) }));
  return {
    posts: posts.sort((a, b) => String(b.published_at).localeCompare(String(a.published_at))),
    by_channel: group("channel").map((g) => ({ ...g, name: channelInfo(g.key)?.name || g.key })),
    by_pillar: group("pillar").map((g) => ({ ...g, name: pillars.find((p) => p.id === g.key)?.name || (g.key === "none" ? "No pillar" : g.key) })),
    top: [...posts].sort((a, b) => engagement(b.metrics) - engagement(a.metrics)).slice(0, 5),
    totals: total(posts),
  };
}
export function resultsPrompt(w, summary) {
  const rows = summary.posts.slice(0, 60).map((p) => `- "${p.title}" | ${p.channel} | pillar ${p.pillar || "none"} | ${SUM_KEYS.map((k) => `${k} ${p.metrics[k] ?? "n/a"}`).join(", ")}`).join("\n");
  return `<company>${w.brief.company_name}: ${w.brief.one_liner}</company>
<results fetched_from="the platforms' APIs">
${rows || "(no results yet)"}
</results>
<task title="What worked">
Write a short "what worked" report for DPA AD's content team in English, with Arabic headings in brackets where useful: 1) what performed best and why it may have worked, 2) what underperformed, 3) by channel and by pillar, 4) three concrete things to make next month.
Use ONLY the numbers in <results>; never invent or estimate numbers, and say "not enough data" when there are fewer than 5 posts. Engagement = likes + comments + saves + shares. Plain markdown, under 300 words.
</task>`;
}
