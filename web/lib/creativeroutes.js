// HTTP routes for Creative Studio (module "creative" in Teams & roles).
import { withImages } from "./products.js";
import { CHANNELS, CHANNEL_IDS, DEFAULT_BRAND, DEFAULT_PILLARS, PREVIEW_STORE, STARTER_EMAIL, STORE_PRODUCTS_DEFAULTS, STATUSES, STATUS_IDS, checkItem, cleanBrand, cleanItem, cleanVariant, ideasPrompt, packText, parseJsonObject, planPrompt, renderEmail, seasonsBetween, writePrompt } from "./creative.js";
import { MEDIA_COLL, mediaChecks, mediaView } from "./media.js";

const C = "creative_items";
const today = () => new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10); // Riyadh date

export function creativeSettings(w) {
  const c = w.creative || {};
  return { brand: cleanBrand(c.brand || {}, DEFAULT_BRAND), pillars: c.pillars?.length ? c.pillars : DEFAULT_PILLARS };
}
export function approvedEmails(store, wsId) {
  return store.listOps(C, wsId).filter((i) => i.channels?.includes("email") && ["approved", "scheduled", "published"].includes(i.status));
}
// Used by Store CRM to send a designed email for a campaign step.
export function emailDesign(store, wsId, id) {
  const i = store.getOps(C, wsId, id);
  return i?.variants?.email && ["approved", "scheduled", "published"].includes(i.status) ? i.variants.email : null;
}

const vhash = (v) => JSON.stringify(v || {});

export function mountCreative(app, { store, provider, workforce = null, crm = null }) {
  const level = (id) => (workforce ? workforce.level(id) : 1);
  const outcome = (id, ws, o, note) => workforce?.event(id, ws, o, note);
  const P = "/api/workspaces/:ws/creative";
  const W = (req, res) => { const w = store.getWorkspace(req.params.ws); if (!w) res.status(404).json({ detail: "Workspace not found" }); return w; };
  const by = (req) => req.user?.name || "you";
  const users = () => store.db.users.filter((u) => u.active).map((u) => ({ id: u.id, name: u.name }));
  const canApprove = (req, w) => req.user?.id === "owner" || creativeSettings(w).brand.approver_roles.includes(req.user?.role_id);
  const checksFor = (w, i) => [...checkItem(i, creativeSettings(w).brand), ...mediaChecks(i, (id) => store.getOps(MEDIA_COLL, w.id, id))];
  const view = (w, i) => ({ ...i, checks: checksFor(w, i) });
  const snapshot = (i) => ({ at: new Date().toISOString(), title: i.title, brief: i.brief, variants: i.variants });

  app.get(`${P}/meta`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const from = today(), to = new Date(Date.now() + 400 * 864e5).toISOString().slice(0, 10);
    res.json({ channels: CHANNELS, statuses: STATUSES, ...creativeSettings(w), seasons: seasonsBetween(new Date(Date.now() - 40 * 864e5).toISOString().slice(0, 10), to), today: from,
      users: users(), can_approve: canApprove(req, w), ai: provider.name !== "demo", block_defaults: { store_products: STORE_PRODUCTS_DEFAULTS } });
  });

  app.get(`${P}/items`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const items = store.listOps(C, w.id).map((i) => view(w, i));
    const due = items.filter((i) => ["approved", "scheduled"].includes(i.status) && i.date && i.date <= today() && (i.channels || []).some((c) => !i.published?.[c]));
    res.json({ items, counts: Object.fromEntries(STATUS_IDS.map((s) => [s, items.filter((i) => i.status === s).length])), post_today: due.map((i) => i.id) });
  });

  app.post(`${P}/items`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const o = cleanItem({ title: "Untitled", channels: [], ...req.body });
    if (!o.title) return res.status(422).json({ detail: "Give it a title." });
    if (req.body?.starter_email) { o.channels = [...new Set([...(o.channels || []), "email"])]; o.variants = { ...(o.variants || {}), email: cleanVariant("email", STARTER_EMAIL) }; }
    const i = store.addOps(C, w.id, { status: "idea", comments: [], history: [], published: {}, created_by: by(req), ...o });
    res.status(201).json(view(w, i));
  });

  app.get(`${P}/items/:id`, (req, res) => { const w = W(req, res); if (!w) return; const i = store.getOps(C, w.id, req.params.id); i ? res.json(view(w, i)) : res.status(404).json({ detail: "Not found" }); });

  app.put(`${P}/items/:id`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const i = store.getOps(C, w.id, req.params.id);
    if (!i) return res.status(404).json({ detail: "Not found" });
    if (["approved", "scheduled", "published"].includes(i.status) && (req.body?.variants || req.body?.brief || req.body?.channels)) {
      // Editing approved content sends it back for review, so nothing unapproved goes out.
      i.status = "review";
      i.comments.push({ at: new Date().toISOString(), by: "system", text: `Edited by ${by(req)} after approval: back to review.` });
    }
    const o = cleanItem(req.body || {}, i);
    if (o.variants && JSON.stringify(o.variants) !== JSON.stringify(i.variants)) i.history = [snapshot(i), ...(i.history || [])].slice(0, 10);
    res.json(view(w, store.updateOps(C, w.id, i.id, o)));
  });

  app.delete(`${P}/items/:id`, (req, res) => { const w = W(req, res); if (!w) return; store.deleteOps(C, w.id, req.params.id) ? res.status(204).end() : res.status(404).json({ detail: "Not found" }); });

  // Status moves. Approving needs an approver role; approving needs no blocking checks.
  app.post(`${P}/items/:id/status`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const i = store.getOps(C, w.id, req.params.id), to = String(req.body?.status || "");
    if (!i) return res.status(404).json({ detail: "Not found" });
    if (!STATUS_IDS.includes(to)) return res.status(422).json({ detail: "Unknown status" });
    if (["approved", "scheduled"].includes(to)) {
      if (!canApprove(req, w)) return res.status(403).json({ detail: "Only approvers can approve content (set approver roles in the brand kit)." });
      const bad = checksFor(w, i).filter((c) => c.level === "bad");
      if (bad.length) return res.status(422).json({ detail: "Fix these first: " + bad.map((b) => b.text).join(" ") });
      if (to === "scheduled" && !i.date) return res.status(422).json({ detail: "Set a date before scheduling." });
    }
    i.comments.push({ at: new Date().toISOString(), by: by(req), text: `Status: ${i.status} → ${to}${req.body?.note ? " — " + String(req.body.note).slice(0, 500) : ""}`, system: true });
    const extra = to === "approved" || to === "scheduled" ? { approved_by: by(req), approved_at: new Date().toISOString() } : {};
    // Track record for the AI Copywriter: approved as written, approved after edits, or sent back.
    if (i.ai_hash && i.status === "review" && to === "approved") { outcome("creative_copywriter", w.id, vhash(i.variants) === i.ai_hash ? "accepted" : "edited", i.title); extra.ai_hash = null; }
    if (i.ai_hash && i.status === "review" && to === "draft") { outcome("creative_copywriter", w.id, "rejected", i.title); extra.ai_hash = null; }
    res.json(view(w, store.updateOps(C, w.id, i.id, { status: to, comments: i.comments, ...extra })));
  });

  app.post(`${P}/items/:id/comments`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const i = store.getOps(C, w.id, req.params.id), text = String(req.body?.text || "").trim().slice(0, 2000);
    if (!i || !text) return res.status(422).json({ detail: "Write a comment." });
    i.comments.push({ at: new Date().toISOString(), by: by(req), text });
    res.status(201).json(view(w, store.updateOps(C, w.id, i.id, { comments: i.comments })));
  });

  // "Download and post": a person posts by hand, then logs it here.
  app.post(`${P}/items/:id/posted`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const i = store.getOps(C, w.id, req.params.id), ch = String(req.body?.channel || "");
    if (!i || !i.channels.includes(ch)) return res.status(404).json({ detail: "Not found" });
    if (!["approved", "scheduled", "published"].includes(i.status)) return res.status(422).json({ detail: "Only approved content can be posted." });
    const url = String(req.body?.url || "").trim();
    i.published = { ...(i.published || {}), [ch]: { at: new Date().toISOString(), by: by(req), url: /^https:\/\//.test(url) ? url.slice(0, 500) : "" } };
    const all = i.channels.filter((c) => c !== "email").every((c) => i.published[c]);
    res.json(view(w, store.updateOps(C, w.id, i.id, { published: i.published, status: all ? "published" : i.status })));
  });

  app.get(`${P}/items/:id/pack/:channel`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const i = store.getOps(C, w.id, req.params.id);
    if (!i || !i.channels.includes(req.params.channel)) return res.status(404).json({ detail: "Not found" });
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="dpa-${i.id}-${req.params.channel}.txt"`);
    const urls = (i.variants[req.params.channel]?.media || []).map((id) => store.getOps(MEDIA_COLL, w.id, id)).filter(Boolean).map((m) => mediaView(m).url);
    res.send(packText(i, req.params.channel, urls));
  });

  // Email preview, rendered with a sample store (example.com product photos) and the real footer,
  // or as a real Store CRM store that has product samples (?contact_id=), to see the personalized version.
  app.get(`${P}/items/:id/email`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const i = store.getOps(C, w.id, req.params.id);
    if (!i?.variants?.email) return res.status(404).send("No email on this item");
    const company = w.brief.company_name || "DPA AD";
    const contact = (req.query.contact_id && crm?.get(w.id, req.query.contact_id)) || PREVIEW_STORE;
    const { html } = renderEmail(i.variants.email, creativeSettings(w).brand, { vars: { company, contact, extra: { sender_name: company, company } },
      footer: { company, address: process.env.COMPANY_ADDRESS || "Riyadh, Saudi Arabia", unsubscribe: "https://wizard.dpa.ad/u/preview" } });
    res.setHeader("Content-Security-Policy", "default-src 'none'; img-src https: data:; style-src 'unsafe-inline'");
    res.type("html").send(html);
  });
  // Stores to preview "your products as ads" with: Store CRM stores that have product photos.
  app.get(`${P}/preview-stores`, (req, res) => {
    const w = W(req, res); if (!w) return;
    res.json((crm ? crm.contacts(w.id) : []).filter((c) => withImages(c).length).slice(0, 50).map((c) => ({ id: c.id, store_name: c.store_name, products: withImages(c).length })));
  });
  app.get(`${P}/emails`, (req, res) => { const w = W(req, res); if (w) res.json(approvedEmails(store, w.id).map((i) => ({ id: i.id, title: i.title, subject: i.variants.email.subject, status: i.status }))); });

  // Brand kit and pillars.
  app.get(`${P}/brand`, (req, res) => { const w = W(req, res); if (w) res.json(creativeSettings(w)); });
  app.put(`${P}/brand`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const cur = creativeSettings(w);
    const pillars = Array.isArray(req.body?.pillars) ? req.body.pillars.slice(0, 8).map((p, n) => ({ id: String(p.id || `p${n}`).replace(/[^a-z0-9_]/gi, "").slice(0, 20) || `p${n}`, name: String(p.name || "").slice(0, 40), hint: String(p.hint || "").slice(0, 200) })).filter((p) => p.name) : cur.pillars;
    w.creative = { ...(w.creative || {}), brand: cleanBrand(req.body?.brand || {}, cur.brand), pillars };
    store.save();
    res.json(creativeSettings(w));
  });

  // ---- AI
  const runJson = async (prompt) => {
    const raw = await provider.generate({ prompt, onText: () => {} });
    return parseJsonObject(raw);
  };
  const noAi = (res) => res.status(502).json({ detail: provider.name === "demo" ? "AI needs ANTHROPIC_API_KEY on the server. You can still add and write content by hand." : "The AI answer couldn't be read. Try again." });
  const knowledgeText = (wsId, n = 12) => store.listNotes(wsId).slice(0, n).map((x) => `[${x.category}] ${x.title}: ${x.content.slice(0, 500)}`).join("\n");

  app.post(`${P}/plan`, async (req, res) => {
    const w = W(req, res); if (!w) return;
    const month = /^\d{4}-\d{2}$/.test(String(req.body?.month || "")) ? req.body.month : today().slice(0, 7);
    const count = Math.max(4, Math.min(30, Number(req.body?.count) || 12));
    const { brand, pillars } = creativeSettings(w);
    const end = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5), 0)).toISOString().slice(0, 10);
    const seasons = seasonsBetween(`${month}-01`, new Date(Date.parse(end) + 60 * 864e5).toISOString().slice(0, 10)).filter((s) => !s.minor);
    try {
      const j = await runJson(planPrompt(w, brand, { month, pillars, seasons, count, knowledge: knowledgeText(w.id) }));
      const items = (j?.items || []).slice(0, count).map((x) => cleanItem({ ...x, date: String(x.date || "").startsWith(month) ? x.date : null })).filter((x) => x.title);
      if (!items.length) return noAi(res);
      const added = items.map((x) => store.addOps(C, w.id, { status: "idea", comments: [], history: [], published: {}, created_by: "AI strategist", ...x }, false));
      store.save();
      res.status(201).json({ added: added.length, items: added.map((i) => view(w, i)) });
    } catch (e) { res.status(502).json({ detail: e?.message || "AI failed" }); }
  });

  app.post(`${P}/ideas`, async (req, res) => {
    const w = W(req, res); if (!w) return;
    const { brand, pillars } = creativeSettings(w);
    const tickets = store.listTickets(w.id).slice(0, 15).map((t) => `support question: ${(t.messages[0]?.text || "").slice(0, 200)}`);
    const roas = store.listOps("roas_rows", w.id).length ? "ROAS results exist on the ROAS results page (use only the case-study notes for numbers)." : "";
    const sources = [knowledgeText(w.id, 20), ...tickets, roas].filter(Boolean).join("\n");
    if (!sources.trim()) return res.status(422).json({ detail: "Add Knowledge notes, results or support questions first: ideas come from real material." });
    try {
      const j = await runJson(ideasPrompt(w, brand, { pillars, sources }));
      const items = (j?.items || []).slice(0, 10).map((x) => cleanItem(x)).filter((x) => x.title);
      if (!items.length) return noAi(res);
      const added = items.map((x) => store.addOps(C, w.id, { status: "idea", comments: [], history: [], published: {}, created_by: "AI strategist", ...x }, false));
      store.save();
      res.status(201).json({ added: added.length });
    } catch (e) { res.status(502).json({ detail: e?.message || "AI failed" }); }
  });

  app.post(`${P}/items/:id/write`, async (req, res) => {
    const w = W(req, res); if (!w) return;
    const i = store.getOps(C, w.id, req.params.id);
    if (!i) return res.status(404).json({ detail: "Not found" });
    const channels = (req.body?.channels || i.channels).filter((c) => i.channels.includes(c) && CHANNEL_IDS.includes(c));
    if (!channels.length) return res.status(422).json({ detail: "Pick the channels first." });
    try {
      const j = await runJson(writePrompt(w, creativeSettings(w).brand, i, channels));
      if (!j || !channels.some((c) => j[c])) return noAi(res);
      const variants = { ...i.variants };
      for (const c of channels) if (j[c]) variants[c] = cleanVariant(c, j[c]);
      i.history = [snapshot(i), ...(i.history || [])].slice(0, 10);
      let status = ["idea"].includes(i.status) ? "draft" : ["approved", "scheduled", "published"].includes(i.status) ? "review" : i.status;
      const fields = { variants, history: i.history, status, written_by_ai_at: new Date().toISOString(), ai_hash: vhash(variants) };
      // Autonomy: at level 2+ the copywriter's clean pieces are approved automatically (number claims and
      // spot-checks still go to a person); at level 1 everything waits for review.
      const lv = level("creative_copywriter");
      if (lv >= 2) {
        const checks = checkItem({ ...i, ...fields }, creativeSettings(w).brand);
        const claim = checks.some((c) => /claim/.test(c.text)), bad = checks.some((c) => c.level === "bad");
        const spot = lv === 2 && (store.listOps(C, w.id).filter((x) => x.auto_approved).length % 5 === 4);
        if (!bad && !claim && !spot) {
          Object.assign(fields, { status: "approved", approved_by: "AI Copywriter (auto)", approved_at: new Date().toISOString(), auto_approved: true, ai_hash: null });
          outcome("creative_copywriter", w.id, "auto", i.title);
          i.comments.push({ at: new Date().toISOString(), by: "system", text: `Approved automatically by the AI Copywriter (level ${lv}): every check passed.`, system: true });
          fields.comments = i.comments;
        } else {
          fields.status = "review";
          i.comments.push({ at: new Date().toISOString(), by: "system", text: bad ? "Sent to review: some checks failed." : claim ? "Sent to review: it has a number claim to confirm." : "Sent to review: random spot-check.", system: true });
          fields.comments = i.comments;
        }
      }
      res.json(view(w, store.updateOps(C, w.id, i.id, fields)));
    } catch (e) { res.status(502).json({ detail: e?.message || "AI failed" }); }
  });
}
