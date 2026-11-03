// HTTP routes for Creative Studio phases 2-3: media library, connected accounts (OAuth), publishing,
// results, and comments/DMs into AI Support. Module "creative" in Teams & roles (support replies: "support").
import fs from "node:fs";
import { channelInfo } from "./creative.js";
import { creativeSettings } from "./creativeroutes.js";
import { MAX_UPLOAD, MEDIA_COLL, MEDIA_TYPES, cleanMediaMeta, deleteMedia, mediaPath, mediaView, saveUpload } from "./media.js";
import { ACCOUNTS, LOG, accountView, canAutoPublish, dueAt, isDue, postChannels, publishSettings, resultsPrompt, resultsSummary } from "./publisher.js";
import { CHANNEL_PROVIDER, MANUAL_CHANNELS, PROVIDERS, authUrl, checkMetaSignature, checkState, exchangeCode, makeState, parseMetaWebhook, providerConfigured, redirectUri, revokeTokens, scopesFor } from "./social.js";

const ITEMS = "creative_items";
const page = (title, body) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><link rel="stylesheet" href="/app.css"></head><body style="padding:32px;max-width:560px;margin:auto;font-family:system-ui">${body}</body></html>`;
const escHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// Before the login wall: media files (platforms fetch them) and the Meta webhook.
export function mountStudioPublic(app, { store, studio }) {
  const cfg = studio.cfg;
  app.get("/media/:file", (req, res) => {
    const p = mediaPath(store, String(req.params.file));
    if (!p || !fs.existsSync(p)) return res.status(404).send("Not found");
    const ext = p.split(".").pop();
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.setHeader("Access-Control-Allow-Origin", "*"); // canvas templates read these images
    res.sendFile(p, { headers: { "Content-Type": MEDIA_TYPES[ext].mime } }); // sendFile handles Range for video
  });

  // Meta webhook (Messenger + Instagram messaging, comments). Subscribe in the Meta app dashboard.
  app.get("/hooks/meta", (req, res) => {
    if (cfg.meta.verify && req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === cfg.meta.verify) return res.send(String(req.query["hub.challenge"] || ""));
    res.status(403).end();
  });
  app.post("/hooks/meta", async (req, res) => {
    if (!checkMetaSignature(cfg.meta.secret, req.rawBody, req.headers["x-hub-signature-256"])) return res.status(401).end();
    res.sendStatus(200); // answer Meta fast, then process
    for (const ev of parseMetaWebhook(req.body)) await studio.handleWebhookEvent(ev).catch((e) => console.error("[studio] webhook:", e?.message));
  });
}

export function mountStudio(app, { store, provider, studio }) {
  const cfg = studio.cfg;
  const P = "/api/workspaces/:ws/creative";
  const W = (req, res) => { const w = store.getWorkspace(req.params.ws); if (!w) res.status(404).json({ detail: "Workspace not found" }); return w; };
  const by = (req) => req.user?.name || "you";
  const canApprove = (req, w) => req.user?.id === "owner" || creativeSettings(w).brand.approver_roles.includes(req.user?.role_id);
  const mv = (m) => mediaView(m, cfg.public_url);

  // ---- media library
  app.get(`${P}/media`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const list = store.listOps(MEDIA_COLL, w.id).sort((a, b) => b.created_at.localeCompare(a.created_at));
    const used = {};
    for (const i of store.listOps(ITEMS, w.id)) for (const [ch, v] of Object.entries(i.variants || {})) for (const id of [...(v.media || []), v.cover_id].filter(Boolean)) (used[id] ||= []).push({ item_id: i.id, title: i.title, channel: ch });
    res.json({ media: list.map((m) => ({ ...mv(m), used_in: used[m.id] || [] })), limits: Object.fromEntries(Object.entries(MEDIA_TYPES).map(([k, t]) => [k, { kind: t.kind, max_mb: t.max / 1048576 }])) });
  });
  app.post(`${P}/media`, async (req, res) => {
    const w = W(req, res); if (!w) return;
    const q = req.query || {};
    const isAudio = /^audio\//.test(String(req.headers["content-type"] || "")) || /\.(mp3|m4a)$/i.test(String(q.filename || ""));
    if (isAudio && q.rights !== "1") { req.resume(); return res.status(422).json({ detail: "Tick \"I have the rights\" for voice and music: only files you own or licensed for social ads." }); }
    if (Number(req.headers["content-length"] || 0) > MAX_UPLOAD) { req.resume(); return res.status(413).json({ detail: "Too big." }); }
    try {
      const m = await saveUpload(store, w.id, req, { filename: String(q.filename || ""), tags: q.tags, ai_generated: q.ai, licence: q.licence, rights: q.rights === "1", width: q.width, height: q.height, duration: q.duration, source: q.source, item_id: q.item_id, by: by(req), ...(q.name ? { name: q.name } : {}) });
      res.status(201).json(mv(m));
    } catch (e) { if (!res.headersSent) res.status(e.status || 500).json({ detail: e.message || "Upload failed" }); }
  });
  app.put(`${P}/media/:id`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const m = store.getOps(MEDIA_COLL, w.id, req.params.id);
    if (!m) return res.status(404).json({ detail: "Not found" });
    res.json(mv(store.updateOps(MEDIA_COLL, w.id, m.id, cleanMediaMeta(req.body || {}))));
  });
  app.delete(`${P}/media/:id`, (req, res) => { const w = W(req, res); if (!w) return; deleteMedia(store, w.id, req.params.id) ? res.status(204).end() : res.status(404).json({ detail: "Not found" }); });

  // ---- connected accounts
  const providerInfo = (w) => Object.entries(PROVIDERS).map(([id, p]) => ({ id, ...p, scopes: scopesFor(cfg, id), configured: providerConfigured(cfg, id), redirect_uri: redirectUri(cfg, id),
    channels: Object.entries(CHANNEL_PROVIDER).filter(([, v]) => v === id).map(([c]) => c),
    account: (() => { const a = studio.accounts(w.id).find((x) => x.provider === id); return a ? accountView(a) : null; })() }));
  app.get(`${P}/accounts`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const notice = w.creative?.oauth_notice || null;
    if (notice) { w.creative.oauth_notice = null; store.save(); }
    res.json({ providers: providerInfo(w), manual: MANUAL_CHANNELS.map((c) => ({ id: c, name: channelInfo(c).name })), settings: publishSettings(w), can_auto_publish: canAutoPublish(w), can_approve: canApprove(req, w),
      webhook: { url: `${cfg.public_url}/hooks/meta`, verify_set: !!cfg.meta.verify, secret_set: !!cfg.meta.secret }, notice,
      log: store.listOps(LOG, w.id).slice(-60).reverse() });
  });
  app.put(`${P}/accounts/:id`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const a = store.getOps(ACCOUNTS, w.id, req.params.id);
    if (!a) return res.status(404).json({ detail: "Not found" });
    if (!a.targets.some((t) => t.id === String(req.body?.selected))) return res.status(422).json({ detail: "Pick one of the connected pages or profiles." });
    res.json(accountView(store.updateOps(ACCOUNTS, w.id, a.id, { selected: String(req.body.selected) })));
  });
  app.delete(`${P}/accounts/:id`, async (req, res) => {
    const w = W(req, res); if (!w) return;
    const a = store.getOps(ACCOUNTS, w.id, req.params.id);
    if (!a) return res.status(404).json({ detail: "Not found" });
    const t = studio.tokensOf(a);
    if (t) await revokeTokens(cfg, a.provider, t, studio.fetchImpl).catch(() => {});
    store.deleteOps(ACCOUNTS, w.id, a.id);
    studio.addLog(w.id, { channel: "", mode: publishSettings(w).mode, status: "account", by: by(req), text: `${PROVIDERS[a.provider].short} disconnected by ${by(req)}.` });
    store.save();
    res.status(204).end();
  });
  app.put(`${P}/publish/settings`, (req, res) => {
    const w = W(req, res); if (!w) return;
    if (!canApprove(req, w)) return res.status(403).json({ detail: "Only approvers can change publishing settings." });
    const cur = publishSettings(w), next = { ...cur };
    if (req.body?.mode !== undefined) next.mode = req.body.mode === "live" ? "live" : "test";
    if (req.body?.auto_publish !== undefined) next.auto_publish = req.body.auto_publish === true;
    w.creative = { ...(w.creative || {}), publish: next };
    if (next.mode !== cur.mode || next.auto_publish !== cur.auto_publish) studio.addLog(w.id, { channel: "", mode: next.mode, status: "settings", by: by(req), text: `${by(req)} set publishing to ${next.mode === "live" ? "Live" : "Test"}, auto-publish ${next.auto_publish ? "on" : "off"}.` });
    store.save();
    res.json({ settings: next, can_auto_publish: canAutoPublish(w) });
  });

  // OAuth: start (a navigation, so the cookie and redirect work) and callback. Signed-in people with Edit on Creative Studio only.
  const mayConnect = (req) => req.user?.id === "owner" || req.perms?.creative === "edit";
  app.get("/oauth/:provider/start", (req, res) => {
    const p = req.params.provider, w = store.getWorkspace(String(req.query.ws || ""));
    if (!PROVIDERS[p] || !w) return res.status(404).send(page("Not found", "<h2>Unknown platform or workspace</h2>"));
    if (!mayConnect(req)) return res.status(403).send(page("Not allowed", "<h2>You need Edit access to Creative Studio to connect accounts.</h2>"));
    if (!providerConfigured(cfg, p)) return res.status(422).send(page("Not set up", `<h2>${escHtml(PROVIDERS[p].name)} isn't set up</h2><p>Add ${PROVIDERS[p].env.map(escHtml).join(", ")} in hPanel, then try again.</p><p><a href="/#/${w.id}/studio/accounts">Back</a></p>`));
    const { state, nonce } = makeState(cfg.key, { ws: w.id, provider: p, uid: req.user.id });
    res.setHeader("Set-Cookie", `mwiz_oauth=${nonce}; Path=/oauth; HttpOnly; Secure; SameSite=Lax; Max-Age=900`);
    res.redirect(authUrl(cfg, p, state));
  });
  app.get("/oauth/:provider/callback", async (req, res) => {
    const p = req.params.provider;
    if (!PROVIDERS[p]) return res.status(404).send(page("Not found", "<h2>Unknown platform</h2>"));
    const nonce = /(?:^|;\s*)mwiz_oauth=([^;]+)/.exec(req.headers.cookie || "")?.[1] || "";
    const st = checkState(cfg.key, String(req.query.state || ""), { uid: req.user.id, nonce, provider: p });
    res.setHeader("Set-Cookie", "mwiz_oauth=; Path=/oauth; HttpOnly; Secure; SameSite=Lax; Max-Age=0");
    if (!st) return res.status(403).send(page("Link expired", "<h2>This sign-in link isn't valid</h2><p>It expired, was started by someone else or in another browser. Start again from Creative Studio → Accounts.</p><p><a href=\"/\">Back to the dashboard</a></p>"));
    const w = store.getWorkspace(st.ws);
    if (!w || !mayConnect(req)) return res.status(403).send(page("Not allowed", "<h2>Not allowed</h2>"));
    const back = () => res.redirect(`/#/${w.id}/studio/accounts`);
    const notice = (ok, text) => { w.creative = { ...(w.creative || {}), oauth_notice: { provider: p, ok, text, at: new Date().toISOString() } }; store.save(); };
    if (req.query.error) { notice(false, `${PROVIDERS[p].short}: ${String(req.query.error_description || req.query.error).slice(0, 200)}`); return back(); }
    try {
      const r = await exchangeCode(cfg, p, String(req.query.code || ""), studio.fetchImpl);
      const a = studio.saveAccount(w.id, p, r, req.user.name);
      studio.addLog(w.id, { channel: "", mode: publishSettings(w).mode, status: "account", by: req.user.name, text: `${PROVIDERS[p].short} connected (${a.name}) by ${req.user.name}.` });
      store.save();
      notice(true, `${PROVIDERS[p].short} connected: ${a.name}.`);
    } catch (e) { notice(false, `${PROVIDERS[p].short} didn't connect: ${String(e?.message || e).slice(0, 200)}`); }
    back();
  });

  // ---- publishing for one item
  const itemPublishing = (w, i) => {
    const s = publishSettings(w);
    return { mode: s.mode, auto_publish: s.auto_publish, due_at: Number.isFinite(dueAt(i)) ? new Date(dueAt(i)).toISOString() : null, due: isDue(i),
      channels: Object.fromEntries(postChannels(i).map((ch) => {
        const p = CHANNEL_PROVIDER[ch], a = p ? studio.accountFor(w.id, p) : null, t = a ? studio.targetOf(a) : null;
        return [ch, { direct: !!a, provider: p || null, provider_name: p ? PROVIDERS[p].short : null, account: t ? (t.ig_username && ch !== "fb_post" ? "@" + t.ig_username : t.page_name || t.name || a.name) : null,
          published: i.published?.[ch] || null, state: i.publish_state?.[ch] || null, results: i.results?.[ch] || null }];
      })),
      log: store.listOps(LOG, w.id).filter((l) => l.item_id === i.id).slice(-20).reverse() };
  };
  app.get(`${P}/items/:id/publishing`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const i = store.getOps(ITEMS, w.id, req.params.id);
    i ? res.json(itemPublishing(w, i)) : res.status(404).json({ detail: "Not found" });
  });
  app.post(`${P}/items/:id/publish`, async (req, res) => {
    const w = W(req, res); if (!w) return;
    const i = store.getOps(ITEMS, w.id, req.params.id);
    if (!i) return res.status(404).json({ detail: "Not found" });
    if (!canApprove(req, w)) return res.status(403).json({ detail: "Only approvers can publish." });
    if (!["approved", "scheduled"].includes(i.status)) return res.status(422).json({ detail: "Only approved or scheduled content can be published." });
    const channels = Array.isArray(req.body?.channels) ? req.body.channels.filter((c) => postChannels(i).includes(c)) : null;
    const r = await studio.publishItem(w.id, i.id, { by: by(req), channels });
    res.json({ result: r, item: store.getOps(ITEMS, w.id, i.id), publishing: itemPublishing(w, store.getOps(ITEMS, w.id, i.id)) });
  });
  app.post(`${P}/items/:id/retry`, async (req, res) => {
    const w = W(req, res); if (!w) return;
    const i = store.getOps(ITEMS, w.id, req.params.id), ch = String(req.body?.channel || "");
    if (!i || !i.channels.includes(ch)) return res.status(404).json({ detail: "Not found" });
    if (!canApprove(req, w)) return res.status(403).json({ detail: "Only approvers can publish." });
    studio.retry(w.id, i.id, ch);
    const r = ["approved", "scheduled"].includes(i.status) ? await studio.publishItem(w.id, i.id, { by: by(req), channels: [ch] }) : null;
    res.json({ result: r, publishing: itemPublishing(w, store.getOps(ITEMS, w.id, i.id)) });
  });

  // ---- results
  app.get(`${P}/results`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const items = store.listOps(ITEMS, w.id);
    res.json({ ...resultsSummary(items, creativeSettings(w).pillars), mode: publishSettings(w).mode, summary: w.creative?.results_summary || null,
      published_without_results: items.filter((i) => Object.keys(i.published || {}).some((c) => !i.results?.[c])).length,
      manual: items.flatMap((i) => Object.entries(i.published || {}).filter(([, p]) => p.via !== "api").map(([ch, p]) => ({ item_id: i.id, title: i.title, channel: ch, at: p.at, url: p.url }))).slice(0, 50) });
  });
  app.post(`${P}/results/fetch`, async (req, res) => {
    const w = W(req, res); if (!w) return;
    if (publishSettings(w).mode !== "live") return res.status(422).json({ detail: "Test mode calls no platform API. Switch to Live in Accounts to pull results." });
    res.json(await studio.fetchResults(new Date(), w.id));
  });
  app.post(`${P}/results/summary`, async (req, res) => {
    const w = W(req, res); if (!w) return;
    const sum = resultsSummary(store.listOps(ITEMS, w.id), creativeSettings(w).pillars);
    if (!sum.posts.length) return res.status(422).json({ detail: "No results yet: publish posts by API and pull their numbers first." });
    try {
      const text = await provider.generate({ prompt: resultsPrompt(w, sum), onText: () => {} });
      w.creative = { ...(w.creative || {}), results_summary: { text: String(text).slice(0, 8000), at: new Date().toISOString(), posts: sum.posts.length, by: provider.name } };
      store.save();
      res.json(w.creative.results_summary);
    } catch (e) { res.status(502).json({ detail: e?.message || "AI failed" }); }
  });
  app.post(`${P}/comments/poll`, async (req, res) => {
    const w = W(req, res); if (!w) return;
    if (publishSettings(w).mode !== "live") return res.status(422).json({ detail: "Test mode calls no platform API." });
    res.json(await studio.pollComments(new Date(), w.id));
  });

  // ---- AI Support: replies on Instagram/Facebook comments and DMs go back through the API.
  // Registered before the support routes in app.js; other tickets fall through to them.
  app.post("/api/workspaces/:ws/support/tickets/:id/messages", async (req, res, next) => {
    const w = store.getWorkspace(req.params.ws), t = w && store.getTicket(w.id, req.params.id);
    if (!t?.social || !["you", "ai"].includes(req.body?.from)) return next();
    const text = String(req.body?.text || "").trim().slice(0, 2000);
    if (!text) return res.status(422).json({ detail: "from and text are required" });
    const r = await studio.sendSupportReply(w.id, t, text);
    if (r.status === "failed") return res.status(502).json({ detail: r.error });
    store.addTicketMessage(w.id, t.id, { from: req.body.from, text, sent: r.status === "sent" });
    const m = t.messages.at(-1);
    Object.assign(m, { delivery: r.status, provider_id: r.provider_id || "", note: r.error || "" });
    store.updateTicket(w.id, t.id, { ai_draft: null, ...(req.body.from === "you" ? { human_touched: true } : {}) });
    res.status(201).json({ ok: true, delivery: r.status, note: r.error || "" });
  });
}

