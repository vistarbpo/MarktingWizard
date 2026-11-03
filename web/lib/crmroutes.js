// HTTP routes for the Store CRM. Public: unsubscribe page and channel webhooks. Private: everything else
// (module "crm" in Teams & roles).
import crypto from "node:crypto";
import express from "express";
import { BOARD, CAMPAIGN_TYPES, INTENT_TAGS, OUTBOUND_BENCH, CHANNELS, STEP_CHANNELS, INTENTS, ONBOARDING_STEPS, SALLA_CATEGORIES, STAGES, STAGE_IDS, STARTER_CAMPAIGNS, cleanFilter, matchCategory, normDomain, normEmail, normPhone, parseSequence, parseStores, renderTemplate, riyadhDay, scoreContact, sequencePrompt } from "./crm.js";
import { DEFAULT_SETTINGS } from "./outreach.js";
import { zTest } from "./roas.js";
import { creativeSettings, emailDesign } from "./creativeroutes.js";
import { renderEmail } from "./creative.js";
import { PLATFORMS, PLATFORM_LIST, detectPlatform } from "./platforms.js";

const page = (title, body) => `<!doctype html><html lang="ar" dir="auto"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{font-family:system-ui,Tahoma,sans-serif;background:#f6f6f4;color:#111;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px}.c{background:#fff;border:1px solid #e5e5e5;border-radius:14px;padding:32px;max-width:440px;text-align:center}button{background:#1f5eff;color:#fff;border:0;border-radius:8px;padding:10px 20px;font-size:15px;cursor:pointer}p{color:#555;line-height:1.6}</style></head><body><div class="c">${body}</div></body></html>`;

export function mountCrmPublic(app, { crm, outreach }) {
  const cfg = outreach.cfg;
  // Unsubscribe (one click from the email footer and the List-Unsubscribe header).
  app.get("/u/:token", (req, res) => {
    const c = crm.findByToken(req.params.token);
    if (!c) return res.status(404).send(page("Not found", "<h2>Link not found</h2>"));
    res.send(page("Unsubscribe", c.email_opt_out
      ? `<h2>تم إلغاء الاشتراك</h2><p>You're unsubscribed. ${c.store_name} won't get more emails from us.</p>`
      : `<h2>إيقاف الرسائل؟</h2><p>Stop emails to <b>${c.store_name.replace(/</g, "&lt;")}</b>?</p><form method="post"><button>نعم، أوقف الرسائل · Unsubscribe</button></form>`));
  });
  app.post("/u/:token", (req, res) => {
    const c = crm.findByToken(req.params.token);
    if (!c) return res.status(404).send(page("Not found", "<h2>Link not found</h2>"));
    if (!c.email_opt_out) {
      crm.update(c.workspace_id, c.id, { email_opt_out: true });
      crm.stopEnrollments(c.id, "stopped");
      crm.addNote(c.workspace_id, c.id, "Unsubscribed from email (link)", "store");
      if (!["onboarding", "active"].includes(c.stage)) outreach.setStage(c, "do_not_contact", "store");
    }
    res.send(page("Unsubscribed", `<h2>تم إلغاء الاشتراك</h2><p>You're unsubscribed. Sorry for the noise.</p>`));
  });

  // WhatsApp Cloud API webhook: verification, incoming messages and delivery statuses.
  app.get("/hooks/whatsapp", (req, res) => {
    if (cfg.whatsapp.verify && req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === cfg.whatsapp.verify) return res.send(String(req.query["hub.challenge"] || ""));
    res.status(403).end();
  });
  app.post("/hooks/whatsapp", async (req, res) => {
    if (cfg.whatsapp.app_secret) {
      const sig = String(req.headers["x-hub-signature-256"] || "");
      const want = "sha256=" + crypto.createHmac("sha256", cfg.whatsapp.app_secret).update(req.rawBody || "").digest("hex");
      if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return res.status(401).end();
    } else if (!cfg.whatsapp.verify) return res.status(403).end();
    res.sendStatus(200); // answer Meta fast, then process
    for (const entry of req.body?.entry || []) for (const ch of entry.changes || []) {
      const v = ch.value || {};
      const names = Object.fromEntries((v.contacts || []).map((x) => [x.wa_id, x.profile?.name || ""]));
      for (const m of v.messages || []) {
        const body = m.text?.body || m.button?.text || m.interactive?.button_reply?.title || (m.type ? `[${m.type}]` : "");
        await outreach.inbound({ channel: "whatsapp", from: m.from, body, provider_id: m.id, name: names[m.from] }).catch(() => {});
      }
      for (const s of v.statuses || []) {
        const msg = crm.db.messages.find((x) => x.provider_id === s.id);
        if (msg) { msg.delivery = s.status; if (s.status === "failed") { msg.status = "failed"; msg.error = s.errors?.[0]?.title || "WhatsApp delivery failed"; } crm.save(); }
      }
    }
  });

  // Generic inbound email hook (Cloudflare Email Workers, Resend, Postmark…): POST {from, subject, text}.
  app.post("/hooks/email/:secret", async (req, res) => {
    if (!cfg.inbound_secret || req.params.secret.length !== cfg.inbound_secret.length || !crypto.timingSafeEqual(Buffer.from(req.params.secret), Buffer.from(cfg.inbound_secret))) return res.status(403).end();
    const b = req.body || {};
    const from = typeof b.from === "string" ? (/<([^>]+)>/.exec(b.from)?.[1] || b.from) : b.from?.email || b.from?.address || "";
    const m = await outreach.inbound({ channel: "email", from, subject: String(b.subject || ""), body: String(b.text || b.body || b.plain || ""), provider_id: String(b.message_id || b.messageId || "") });
    res.json({ ok: !!m });
  });
}

export function mountCrm(app, { store, crm, outreach, provider }) {
  const P = "/api/workspaces/:ws/crm";
  const W = (req, res) => { const w = store.getWorkspace(req.params.ws); if (!w) res.status(404).json({ detail: "Workspace not found" }); return w; };
  const users = () => store.db.users.filter((u) => u.active).map((u) => ({ id: u.id, name: u.name }));
  const userName = (id) => store.db.users.find((u) => u.id === id)?.name || "";
  const by = (req) => req.user?.name || "you";
  const counts = (list, key) => { const m = {}; for (const x of list) { const k = typeof key === "function" ? key(x) : x[key]; m[k || "—"] = (m[k || "—"] || 0) + 1; } return m; };

  app.get(`${P}/meta`, (req, res) => {
    if (!W(req, res)) return;
    const cfg = outreach.cfg;
    res.json({ platforms: PLATFORM_LIST.map(({ id, region, connect }) => ({ id, region, connect })), intent_tags: INTENT_TAGS, stages: STAGES, board: BOARD, types: CAMPAIGN_TYPES, channels: CHANNELS, categories: SALLA_CATEGORIES, onboarding: ONBOARDING_STEPS, intents: INTENTS, users: users(),
      settings: outreach.settings(req.params.ws),
      connections: { email: cfg.email.ready, email_from: cfg.email.from, imap: cfg.email.imap.ready, whatsapp: cfg.whatsapp.ready, whatsapp_webhook: !!cfg.whatsapp.verify, public_url: cfg.public_url } });
  });

  app.get(`${P}/overview`, (req, res) => {
    if (!W(req, res)) return;
    const ws = req.params.ws, all = crm.contacts(ws), now = Date.now();
    const msgs = crm.db.messages.filter((m) => m.workspace_id === ws);
    const week = msgs.filter((m) => now - Date.parse(m.at) < 7 * 864e5);
    const outW = week.filter((m) => m.direction === "out" && ["sent", "test"].includes(m.status)), inW = week.filter((m) => m.direction === "in");
    const days = [...Array(14)].map((_, i) => riyadhDay(new Date(now - (13 - i) * 864e5)));
    const daily = days.map((d) => ({ day: d, email: 0, whatsapp: 0, replies: 0 }));
    const dIdx = Object.fromEntries(days.map((d, i) => [d, i]));
    for (const m of msgs) { const i = dIdx[riyadhDay(new Date(m.at))]; if (i == null) continue; if (m.direction === "in") daily[i].replies++; else if (["sent", "test"].includes(m.status)) daily[i][m.channel]++; }
    const cats = Object.entries(counts(all, "category")).sort((a, b) => b[1] - a[1]).map(([category, n]) => {
      const cs = all.filter((c) => c.category === category);
      return { category, stores: n, contacted: cs.filter((c) => c.last_contacted_at).length, replied: cs.filter((c) => c.last_reply_at).length, customers: cs.filter((c) => ["onboarding", "active"].includes(c.stage)).length };
    });
    const plats = Object.entries(counts(all, "platform")).sort((a, b) => b[1] - a[1]).map(([platform, n]) => {
      const cs = all.filter((c) => (c.platform || "—") === platform);
      return { platform, stores: n, contacted: cs.filter((c) => c.last_contacted_at).length, replied: cs.filter((c) => c.last_reply_at).length, customers: cs.filter((c) => ["onboarding", "active"].includes(c.stage)).length };
    });
    res.json({
      platforms: plats,
      total: all.length, by_stage: counts(all, "stage"), categories: cats,
      reachable: { email: all.filter((c) => c.email && !c.email_opt_out && !c.bounced && c.stage !== "do_not_contact").length, whatsapp: all.filter((c) => c.phone && c.wa_opt_in && !c.wa_opt_out).length, phone: all.filter((c) => c.phone).length },
      week: { sent: outW.length, replies: inW.length, reply_rate: outW.length ? Math.round((new Set(inW.map((m) => m.contact_id)).size / new Set(outW.map((m) => m.contact_id)).size) * 1000) / 10 : null, unsubscribed: all.filter((c) => c.email_opt_out).length, bounced: all.filter((c) => c.bounced).length },
      calls: msgs.filter((m) => m.channel === "call" && m.status === "todo").length,
      inbox: { open: msgs.filter((m) => m.direction === "in" && !m.handled).length, needs_person: msgs.filter((m) => m.direction === "in" && !m.handled && m.needs_person).length },
      campaigns: { running: crm.campaigns(ws).filter((c) => c.status === "running").length, total: crm.campaigns(ws).length },
      daily, mode: outreach.settings(ws).mode,
      // For the work-backwards planner: what actually happened so far, next to the benchmarks.
      rates: (() => {
        const contacted = all.filter((c) => c.last_contacted_at).length, replied = all.filter((c) => c.last_contacted_at && c.last_reply_at).length;
        const meetings = all.filter((c) => c.deal_id || ["qualified", "onboarding", "active", "churned"].includes(c.stage)).length;
        const customers = all.filter((c) => ["onboarding", "active", "churned"].includes(c.stage)).length;
        const outCamps = crm.campaigns(ws).filter((c) => c.type === "outreach");
        const T = outreach.settings(ws).targets;
        return { contacted, replied, meetings, customers, bench: { reply: T.reply_pct / 100, meeting: T.meeting_pct / 100, close: T.close_pct / 100 }, steps: outCamps.length ? Math.round(outCamps.reduce((a, c) => a + c.steps.length, 0) / outCamps.length) : 4 };
      })(),
      settings: outreach.settings(ws),
      owners: Object.entries(counts(all.filter((c) => c.owner_id), "owner_id")).map(([id, n]) => ({ id, name: userName(id) || "Unknown", stores: n })),
    });
  });

  // ---- contacts
  const filterOf = (req) => { try { return JSON.parse(req.query.f || req.body?.filter && JSON.stringify(req.body.filter) || "{}"); } catch { return {}; } };
  const SORTS = { score: (a, b) => b.score - a.score, products: (a, b) => (b.products || 0) - (a.products || 0), recent: (a, b) => (b.last_reply_at || b.updated_at).localeCompare(a.last_reply_at || a.updated_at), name: (a, b) => a.store_name.localeCompare(b.store_name) };
  app.get(`${P}/contacts`, (req, res) => {
    if (!W(req, res)) return;
    const all = crm.contacts(req.params.ws), rows = crm.query(req.params.ws, filterOf(req));
    rows.sort(SORTS[req.query.sort] || SORTS.score);
    const pageN = Math.max(0, Number(req.query.page) || 0), size = Math.min(200, Number(req.query.size) || 50);
    res.json({
      total: rows.length, all: all.length, page: pageN, size,
      rows: rows.slice(pageN * size, pageN * size + size).map(({ unsub_token, ...c }) => ({ ...c, owner_name: userName(c.owner_id) })),
      facets: { category: counts(all, "category"), city: counts(all, "city"), stage: counts(all, "stage"), platform: counts(all, "platform"), tags: counts(all.flatMap((c) => c.tags || []), (t) => t) },
    });
  });
  const cleanContact = (b, partial) => {
    const o = {};
    const s = (k, max = 160) => { if (b[k] !== undefined) o[k] = String(b[k] ?? "").trim().slice(0, max); };
    ["store_name", "owner_name", "city", "instagram"].forEach((k) => s(k));
    if (b.platform !== undefined) o.platform = PLATFORMS.includes(b.platform) ? b.platform : detectPlatform(b.platform, b.domain) || "Other";
    if (b.domain !== undefined) o.domain = normDomain(b.domain);
    if (b.email !== undefined) o.email = normEmail(b.email);
    if (b.phone !== undefined) o.phone = normPhone(b.phone);
    if (b.category !== undefined) o.category = SALLA_CATEGORIES.includes(b.category) ? b.category : matchCategory(b.category);
    if (b.products !== undefined) o.products = Math.max(0, Math.round(Number(b.products) || 0));
    if (b.tags !== undefined) o.tags = [...new Set((Array.isArray(b.tags) ? b.tags : String(b.tags).split(",")).map((t) => String(t).trim().toLowerCase().slice(0, 30)).filter(Boolean))].slice(0, 20);
    if (b.owner_id !== undefined) o.owner_id = b.owner_id && store.db.users.some((u) => u.id === String(b.owner_id)) ? String(b.owner_id) : null;
    for (const k of ["wa_opt_in", "email_opt_out", "wa_opt_out"]) if (b[k] !== undefined) o[k] = !!b[k];
    if (b.onboarding && typeof b.onboarding === "object") o.onboarding = Object.fromEntries(ONBOARDING_STEPS.map((x) => [x.id, !!b.onboarding[x.id]]));
    if (!partial && !o.store_name) return { err: "Store name is required." };
    return { o };
  };
  app.post(`${P}/contacts`, (req, res) => {
    if (!W(req, res)) return;
    const { o, err } = cleanContact(req.body || {}, false);
    if (err) return res.status(422).json({ detail: err });
    if (crm.find(req.params.ws, o)) return res.status(422).json({ detail: "This store is already in the CRM (same link, email or phone)." });
    res.status(201).json(crm.add(req.params.ws, { category: "Other", source: "manual", ...o, platform: o.platform || detectPlatform("", o.domain) || "Other" }));
  });
  app.get(`${P}/contacts/:id`, (req, res) => {
    if (!W(req, res)) return;
    const c = crm.get(req.params.ws, req.params.id);
    if (!c) return res.status(404).json({ detail: "Store not found" });
    const camps = Object.fromEntries(crm.campaigns(req.params.ws).map((x) => [x.id, x.name]));
    res.json({ contact: { ...c, owner_name: userName(c.owner_id) }, messages: crm.messagesFor(c.id), notes: crm.notesFor(c.id),
      enrollments: crm.db.enrollments.filter((e) => e.contact_id === c.id).map((e) => ({ ...e, campaign: camps[e.campaign_id] || "" })),
      deal: c.deal_id ? store.getDeal(req.params.ws, c.deal_id) : null });
  });
  app.put(`${P}/contacts/:id`, (req, res) => {
    if (!W(req, res)) return;
    const c = crm.get(req.params.ws, req.params.id);
    if (!c) return res.status(404).json({ detail: "Store not found" });
    const { o } = cleanContact(req.body || {}, true);
    crm.update(req.params.ws, c.id, o);
    if (req.body?.stage && STAGE_IDS.includes(req.body.stage)) outreach.setStage(c, req.body.stage, by(req));
    if (o.onboarding && Object.values(o.onboarding).every(Boolean) && c.stage === "onboarding") outreach.setStage(c, "active", by(req));
    res.json(c);
  });
  app.delete(`${P}/contacts/:id`, (req, res) => { if (!W(req, res)) return; crm.remove(req.params.ws, [req.params.id]) ? res.status(204).end() : res.status(404).json({ detail: "Store not found" }); });
  app.post(`${P}/contacts/:id/notes`, (req, res) => {
    if (!W(req, res)) return;
    const c = crm.get(req.params.ws, req.params.id), text = String(req.body?.text || "").trim().slice(0, 4000);
    if (!c || !text) return res.status(422).json({ detail: "Write a note." });
    res.status(201).json(crm.addNote(req.params.ws, c.id, text, by(req)));
  });
  app.post(`${P}/contacts/:id/send`, async (req, res) => {
    if (!W(req, res)) return;
    const c = crm.get(req.params.ws, req.params.id), b = req.body || {};
    if (!c) return res.status(404).json({ detail: "Store not found" });
    if (!CHANNELS.includes(b.channel) || !String(b.body || "").trim()) return res.status(422).json({ detail: "Pick a channel and write the message." });
    const m = await outreach.sendOne(req.params.ws, c, { channel: b.channel, subject: String(b.subject || "").slice(0, 200), body: String(b.body).slice(0, 4000), wa_template: String(b.wa_template || ""), by: by(req) });
    if (b.reply_to) { const inb = crm.message(req.params.ws, b.reply_to); if (inb && m.status !== "skipped" && m.status !== "failed") { inb.handled = true; inb.reply_id = m.id; crm.save(); } }
    res.status(m.status === "skipped" || m.status === "failed" ? 422 : 201).json(m.status === "skipped" || m.status === "failed" ? { detail: m.error, message: m } : m);
  });
  // Log a reply that came another way (phone call, Instagram DM…), so triage and the pipeline still run.
  app.post(`${P}/contacts/:id/log-reply`, async (req, res) => {
    if (!W(req, res)) return;
    const c = crm.get(req.params.ws, req.params.id), body = String(req.body?.body || "").trim();
    if (!c || !body) return res.status(422).json({ detail: "Paste what they said." });
    const channel = CHANNELS.includes(req.body.channel) ? req.body.channel : c.email ? "email" : "whatsapp";
    const from = channel === "email" ? c.email : c.phone;
    if (!from) return res.status(422).json({ detail: `This store has no ${channel === "email" ? "email" : "phone"} to log against.` });
    res.status(201).json(await outreach.inbound({ channel, from, body, subject: "" }));
  });

  // Bulk actions on selected ids or on everything matching a filter.
  app.post(`${P}/bulk`, (req, res) => {
    if (!W(req, res)) return;
    const b = req.body || {}, ws = req.params.ws;
    const list = Array.isArray(b.ids) && b.ids.length ? b.ids.map((id) => crm.get(ws, id)).filter(Boolean) : crm.query(ws, b.filter || {});
    let n = 0;
    if (b.action === "stage") { if (!STAGE_IDS.includes(b.value)) return res.status(422).json({ detail: "Unknown stage" }); list.forEach((c) => outreach.setStage(c, b.value, by(req))); n = list.length; }
    else if (b.action === "owner") {
      const ids = (Array.isArray(b.value) ? b.value : [b.value]).filter((id) => !id || store.db.users.some((u) => u.id === id));
      list.forEach((c, i) => crm.update(ws, c.id, { owner_id: ids.length ? ids[i % ids.length] || null : null })); n = list.length; // round-robin when several
    } else if (b.action === "tag" || b.action === "untag") {
      const t = String(b.value || "").trim().toLowerCase().slice(0, 30);
      if (!t) return res.status(422).json({ detail: "Write the tag." });
      for (const c of list) { const has = c.tags.includes(t); if (b.action === "tag" && !has) { c.tags.push(t); n++; } if (b.action === "untag" && has) { c.tags = c.tags.filter((x) => x !== t); n++; } }
      crm.save();
    } else if (b.action === "icp") {
      // Focus list: the best-fit stores get the full cadence, including phone calls by a person.
      const nTop = Math.max(1, Math.min(5000, Number(b.value) || outreach.settings(ws).targets.focus_list));
      for (const c of [...list].sort((x, y) => y.score - x.score).filter((c) => c.stage !== "do_not_contact").slice(0, nTop)) if (!c.tags.includes("icp")) { c.tags.push("icp"); n++; }
      crm.save();
    } else if (b.action === "enroll") {
      const camp = crm.campaign(ws, b.value);
      if (!camp || camp.type === "onboarding") return res.status(422).json({ detail: "Pick an outreach, nurture or newsletter campaign." });
      const start = new Date().toISOString();
      n = crm.enroll(camp, list.filter((c) => c.stage !== "do_not_contact"), start);
      crm.updateCampaign(ws, camp.id, { enrolled: (camp.enrolled || 0) + n });
    } else if (b.action === "delete") n = crm.remove(ws, list.map((c) => c.id));
    else return res.status(422).json({ detail: "Unknown action" });
    res.json({ affected: n });
  });

  // ---- import / export
  const big = express.text({ type: ["text/*", "application/csv"], limit: "40mb" });
  app.post(`${P}/import/preview`, big, (req, res) => {
    if (!W(req, res)) return;
    const r = parseStores(req.body, { platform: PLATFORMS.includes(req.query.platform) ? req.query.platform : "Other" });
    if (r.error) return res.status(422).json({ detail: r.error });
    const dupes = r.rows.filter((x) => crm.find(req.params.ws, x)).length;
    res.json({ total: r.total, columns: r.columns, no_contact: r.no_contact, duplicates: dupes, with_email: r.rows.filter((x) => x.email).length, with_phone: r.rows.filter((x) => x.phone).length,
      categories: counts(r.rows, "category"), platforms: counts(r.rows, "platform"), sample: r.rows.slice(0, 8) });
  });
  app.post(`${P}/import`, big, (req, res) => {
    if (!W(req, res)) return;
    const r = parseStores(req.body, { platform: PLATFORMS.includes(req.query.platform) ? req.query.platform : "Other", source: String(req.query.source || "import").slice(0, 60) });
    if (r.error) return res.status(422).json({ detail: r.error });
    const tags = String(req.query.tags || "").split(",").map((t) => t.trim().toLowerCase()).filter(Boolean).slice(0, 5);
    const owner_ids = String(req.query.owners || "").split(",").filter((id) => store.db.users.some((u) => u.id === id));
    const out = crm.upsertMany(req.params.ws, r.rows, { tags, owner_ids });
    crm.db.imports.push({ id: crm.id(), workspace_id: req.params.ws, at: crm.now(), by: by(req), ...out, total: r.total }); crm.save();
    res.status(201).json(out);
  });
  app.get(`${P}/export`, (req, res) => {
    if (!W(req, res)) return;
    const cols = ["store_name", "domain", "email", "phone", "category", "city", "products", "stage", "score", "owner", "tags", "email_opt_out", "wa_opt_in", "last_contacted_at", "last_reply_at"];
    const q = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const lines = crm.query(req.params.ws, filterOf(req)).map((c) => cols.map((k) => q(k === "owner" ? userName(c.owner_id) : k === "tags" ? (c.tags || []).join("|") : c[k])).join(","));
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="stores-${riyadhDay()}.csv"`);
    res.send("﻿" + [cols.join(","), ...lines].join("\n"));
  });

  // ---- campaigns
  const campStats = (camp) => {
    const en = crm.enrollments(camp.id), ms = crm.db.messages.filter((m) => m.campaign_id === camp.id);
    const contacted = new Set(ms.filter((m) => ["sent", "test"].includes(m.status)).map((m) => m.contact_id));
    const replied = en.filter((e) => e.status === "replied").length;
    const left = en.filter((e) => e.status === "active").reduce((a, e) => a + Math.max(0, camp.steps.length - e.step), 0);
    const st = outreach.settings(camp.workspace_id), perDay = Math.max(1, Math.min(camp.daily_limit, st.email_daily_cap + st.wa_daily_cap));
    return { contacted: contacted.size, left, per_day: perDay, eta_days: left ? Math.ceil(left / perDay) + Math.max(0, ...camp.steps.map((s) => s.delay_days || 0)) : 0, enrolled: en.length, active: en.filter((e) => e.status === "active").length, done: en.filter((e) => e.status === "done").length, replied,
      sent: ms.filter((m) => m.status === "sent").length, test: ms.filter((m) => m.status === "test").length, skipped: ms.filter((m) => m.status === "skipped").length, failed: ms.filter((m) => m.status === "failed").length,
      reply_rate: contacted.size ? Math.round((replied / contacted.size) * 1000) / 10 : null,
      by_step: camp.steps.map((_, i) => ms.filter((m) => m.step === i && ["sent", "test"].includes(m.status)).length) };
  };
  // ---- A/B tests: change one thing at a time (cadence, persona, channel, message…), never several.
  const EXP_VARS = { subject: "Subject line", message: "Message text", channel: "Channel (email vs WhatsApp)", timing: "Timing (days between steps, send hours)", segment: "Who gets it (segment)", steps: "Number of steps" };
  const diffVars = (a, b) => {
    const out = [];
    const st = (c, f) => JSON.stringify(c.steps.map(f));
    if (JSON.stringify(cleanFilter(a.filter)) !== JSON.stringify(cleanFilter(b.filter))) out.push("segment");
    if (a.steps.length !== b.steps.length) out.push("steps");
    if (st(a, (s) => s.channel) !== st(b, (s) => s.channel)) out.push("channel");
    if (st(a, (s) => s.delay_days) !== st(b, (s) => s.delay_days) || JSON.stringify(a.window) !== JSON.stringify(b.window)) out.push("timing");
    if (st(a, (s) => s.subject) !== st(b, (s) => s.subject)) out.push("subject");
    if (st(a, (s) => s.body) !== st(b, (s) => s.body)) out.push("message");
    return out;
  };
  const partnerOf = (c) => c.experiment && crm.campaigns(c.workspace_id).find((x) => x.id !== c.id && x.experiment?.id === c.experiment.id);
  const experimentView = (c, stats) => {
    const p = partnerOf(c); if (!p) return null;
    const changes = diffVars(c, p);
    const A = c.experiment.part === "A" ? [c, stats(c)] : [p, stats(p)], B = c.experiment.part === "A" ? [p, stats(p)] : [c, stats(c)];
    const test = zTest(B[1].replied, B[1].contacted, A[1].replied, A[1].contacted);
    const enough = A[1].contacted >= 100 && B[1].contacted >= 100;
    const verdict = !enough ? "not enough data yet (100+ stores contacted in each)" : test && test.p < 0.05 ? (B[1].replied / B[1].contacted > A[1].replied / A[1].contacted ? "B wins" : "A wins") : "no clear difference yet";
    return { ...c.experiment, label: EXP_VARS[c.experiment.variable] || c.experiment.variable, changes, changes_labels: changes.map((v) => EXP_VARS[v]), partner_id: p.id, partner_name: p.name,
      a: { name: A[0].name, contacted: A[1].contacted, replied: A[1].replied }, b: { name: B[0].name, contacted: B[1].contacted, replied: B[1].replied }, p: test?.p ?? null, verdict };
  };

  const cleanCampaign = (b) => {
    const o = {};
    if (b.name !== undefined) o.name = String(b.name).trim().slice(0, 120) || "Untitled campaign";
    if (b.type !== undefined) o.type = CAMPAIGN_TYPES.some((t) => t.id === b.type) ? b.type : "outreach";
    if (b.filter !== undefined) o.filter = cleanFilter(b.filter);
    if (b.steps !== undefined) o.steps = (b.steps || []).slice(0, 12).map((s) => ({ channel: STEP_CHANNELS.includes(s.channel) ? s.channel : "email", delay_days: Math.max(0, Math.min(90, Number(s.delay_days) || 0)), subject: String(s.subject || "").slice(0, 200), body: String(s.body || "").slice(0, 4000), wa_template: String(s.wa_template || "").trim().slice(0, 100), design_id: s.channel === "email" && s.design_id ? String(s.design_id).slice(0, 20) : "" }));
    if (b.daily_limit !== undefined) o.daily_limit = Math.max(1, Math.min(5000, Math.round(Number(b.daily_limit) || 150)));
    if (b.start_at !== undefined) o.start_at = b.start_at ? new Date(b.start_at).toISOString() : null;
    if (b.window !== undefined) o.window = { from: Math.max(0, Math.min(23, Number(b.window.from) || 9)), to: Math.max(1, Math.min(24, Number(b.window.to) || 21)), skip_friday: b.window.skip_friday !== false };
    if (b.stop_on_reply !== undefined) o.stop_on_reply = !!b.stop_on_reply;
    if (o.type === "onboarding") o.trigger = "stage:onboarding";
    return o;
  };
  app.get(`${P}/campaigns`, (req, res) => {
    if (!W(req, res)) return;
    res.json(crm.campaigns(req.params.ws).map((c) => {
      let audience = c.type === "onboarding" ? null : crm.query(req.params.ws, c.filter).length;
      if (audience && c.experiment) audience = Math.round(audience / 2);
      return { ...c, stats: campStats(c), audience, experiment: c.experiment ? experimentView(c, campStats) || { ...c.experiment, orphan: true } : null };
    }));
  });
  app.post(`${P}/campaigns/:id/variant`, (req, res) => {
    if (!W(req, res)) return;
    const a = crm.campaign(req.params.ws, req.params.id), variable = String(req.body?.variable || "");
    if (!a) return res.status(404).json({ detail: "Campaign not found" });
    if (!EXP_VARS[variable]) return res.status(422).json({ detail: "Pick the one thing to test." });
    if (a.status !== "draft" || a.type === "onboarding") return res.status(422).json({ detail: "A/B tests start from a draft outreach, nurture or newsletter campaign." });
    if (a.experiment) return res.status(422).json({ detail: "This campaign is already in an A/B test." });
    const id = "x" + crm.id();
    crm.updateCampaign(req.params.ws, a.id, { experiment: { id, variable, part: "A" } });
    const b = crm.addCampaign(req.params.ws, { ...cleanCampaign({ ...a, name: `${a.name} · B (${EXP_VARS[variable].split(" (")[0].toLowerCase()})` }), experiment: { id, variable, part: "B" }, created_by: by(req) });
    res.status(201).json(b);
  });
  app.post(`${P}/campaigns`, (req, res) => {
    if (!W(req, res)) return;
    const o = cleanCampaign({ name: "New campaign", type: "outreach", filter: {}, steps: [{ channel: "email", delay_days: 0, subject: "", body: "" }], ...req.body });
    res.status(201).json(crm.addCampaign(req.params.ws, { ...o, created_by: by(req) }));
  });
  app.post(`${P}/campaigns/starter`, (req, res) => {
    if (!W(req, res)) return;
    const have = new Set(crm.campaigns(req.params.ws).map((c) => c.name));
    const add = STARTER_CAMPAIGNS.filter((c) => !have.has(c.name));
    add.forEach((c) => crm.addCampaign(req.params.ws, { ...cleanCampaign(c), created_by: "starter" }));
    res.status(201).json({ added: add.length });
  });
  app.put(`${P}/campaigns/:id`, (req, res) => {
    if (!W(req, res)) return;
    const c = crm.campaign(req.params.ws, req.params.id);
    if (!c) return res.status(404).json({ detail: "Campaign not found" });
    const o = cleanCampaign(req.body || {});
    if (c.status === "running" && (o.type && o.type !== c.type)) return res.status(422).json({ detail: "Pause the campaign before changing its type." });
    res.json(crm.updateCampaign(req.params.ws, c.id, o));
  });
  app.delete(`${P}/campaigns/:id`, (req, res) => { if (!W(req, res)) return; crm.deleteCampaign(req.params.ws, req.params.id) ? res.status(204).end() : res.status(404).json({ detail: "Campaign not found" }); });
  app.post(`${P}/campaigns/:id/:action(launch|pause|resume)`, (req, res) => {
    if (!W(req, res)) return;
    const c = crm.campaign(req.params.ws, req.params.id);
    if (!c) return res.status(404).json({ detail: "Campaign not found" });
    if (req.params.action === "pause") return res.json(crm.updateCampaign(req.params.ws, c.id, { status: "paused" }));
    if (req.params.action === "resume") return res.json(crm.updateCampaign(req.params.ws, c.id, { status: "running" }));
    if (!c.steps.length || c.steps.some((s) => !s.body.trim() && !s.design_id)) return res.status(422).json({ detail: "Every step needs a message." });
    if (c.steps.some((s) => s.channel === "email" && !s.subject.trim() && !s.design_id)) return res.status(422).json({ detail: "Every email step needs a subject." });
    // A/B test: both versions launch together and split the stores in half, so nobody gets both.
    const partner = c.experiment ? partnerOf(c) : null;
    const group = partner && partner.status === "draft" ? [c, partner] : [c];
    for (const x of group) {
      if (!x.steps.length || x.steps.some((s) => !s.body.trim() && !s.design_id)) return res.status(422).json({ detail: `${x.name}: every step needs a message.` });
      if (x.steps.some((s) => s.channel === "email" && !s.subject.trim() && !s.design_id)) return res.status(422).json({ detail: `${x.name}: every email step needs a subject.` });
    }
    let enrolled = 0, starts_at = null;
    for (const x of group) {
      let audience = x.type === "onboarding" ? [] : crm.query(req.params.ws, x.filter).filter((s) => s.stage !== "do_not_contact");
      if (x.experiment) audience = audience.filter((s) => (Number(s.id) % 2 === 0) === (x.experiment.part === "A"));
      if (x.type !== "onboarding" && !audience.length) return res.status(422).json({ detail: "No stores match this segment." });
      const r = outreach.launch(x, audience); enrolled += r.enrolled; starts_at = r.starts_at;
    }
    res.json({ enrolled, starts_at, ab: group.length > 1, campaign: crm.campaign(req.params.ws, c.id) });
  });
  app.get(`${P}/campaigns/:id/preview`, (req, res) => {
    if (!W(req, res)) return;
    const c = crm.campaign(req.params.ws, req.params.id);
    if (!c) return res.status(404).json({ detail: "Campaign not found" });
    const sample = (req.query.contact_id && crm.get(req.params.ws, req.query.contact_id)) || (c.type === "onboarding" ? crm.contacts(req.params.ws)[0] : crm.query(req.params.ws, c.filter)[0]) || { store_name: "متجر نموذج", owner_name: "", category: "Fashion & abayas", city: "Riyadh", products: 250 };
    const s = outreach.settings(req.params.ws), company = store.getWorkspace(req.params.ws).brief.company_name;
    const ex = { sender_name: s.sender_name || company, company };
    res.json({ store: sample.store_name, steps: c.steps.map((st) => {
      const d = st.design_id ? emailDesign(store, req.params.ws, st.design_id) : null;
      if (st.design_id && !d) return { ...st, subject: "⚠ Design not approved in Creative Studio", body: "This step will be skipped until the design is approved." };
      if (d) { const r = renderEmail(d, creativeSettings(store.getWorkspace(req.params.ws)).brand, { vars: { company, contact: sample, extra: ex } }); return { ...st, subject: st.subject ? renderTemplate(st.subject, sample, ex) : r.subject, body: `[Designed email]\n${r.text}` }; }
      return { ...st, subject: renderTemplate(st.subject, sample, ex), body: renderTemplate(st.body, sample, ex) };
    }) });
  });
  app.post(`${P}/campaigns/:id/ai-write`, async (req, res) => {
    const w = W(req, res); if (!w) return;
    const c = crm.campaign(req.params.ws, req.params.id);
    if (!c) return res.status(404).json({ detail: "Campaign not found" });
    const b = req.body || {};
    const channels = (b.channels || ["email"]).filter((x) => CHANNELS.includes(x));
    const steps = Math.max(1, Math.min(8, Number(b.steps) || (c.type === "newsletter" ? 1 : 4)));
    try {
      const raw = await provider.generate({ prompt: sequencePrompt(w, { type: c.type, category: b.category || c.filter?.category?.[0] || "", goal: String(b.goal || "").slice(0, 300), channels: channels.length ? channels : ["email"], steps, language: b.language }), onText: () => {} });
      const parsed = parseSequence(raw, channels.length ? channels : ["email"]);
      if (!parsed) return res.status(502).json({ detail: provider.name === "demo" ? "AI writing needs ANTHROPIC_API_KEY on the server. Load the starter campaigns to get ready-made Arabic sequences." : "The AI answer couldn't be read. Try again." });
      res.json(crm.updateCampaign(req.params.ws, c.id, { steps: parsed }));
    } catch (e) { res.status(502).json({ detail: e?.message || "AI failed" }); }
  });

  // ---- calls: phone-call steps waiting for a person
  app.get(`${P}/calls`, (req, res) => {
    if (!W(req, res)) return;
    const mine = req.query.mine === "1" ? req.user?.id : null;
    const rows = crm.db.messages.filter((m) => m.workspace_id === req.params.ws && m.channel === "call" && m.status === "todo")
      .map((m) => { const c = crm.get(req.params.ws, m.contact_id); return c && { ...m, store: { id: c.id, store_name: c.store_name, phone: c.phone, category: c.category, city: c.city, products: c.products, stage: c.stage, owner_id: c.owner_id, owner_name: userName(c.owner_id), last_reply_at: c.last_reply_at } }; })
      .filter((m) => m && (!mine || m.store.owner_id === mine));
    res.json(rows);
  });
  app.post(`${P}/calls/:id`, (req, res) => {
    if (!W(req, res)) return;
    const m = crm.message(req.params.ws, req.params.id), outcome = String(req.body?.outcome || "");
    if (!m || m.channel !== "call") return res.status(404).json({ detail: "Call not found" });
    const OUT = { meeting: "Booked a meeting", reached: "Talked, no meeting yet", no_answer: "No answer", not_interested: "Not interested", wrong_number: "Wrong number" };
    if (!OUT[outcome]) return res.status(422).json({ detail: "Pick the outcome." });
    const c = crm.get(req.params.ws, m.contact_id);
    Object.assign(m, { status: "done", outcome, by: by(req), done_at: crm.now() });
    crm.addNote(req.params.ws, c.id, `Call: ${OUT[outcome]}${req.body?.note ? " — " + String(req.body.note).slice(0, 1000) : ""}`, by(req));
    crm.update(req.params.ws, c.id, { last_contacted_at: crm.now(), ...(outcome === "wrong_number" ? { phone: "" } : {}) });
    if (outcome === "meeting") {
      if (["new", "contacted", "engaged", "not_now"].includes(c.stage)) outreach.setStage(c, "qualified", by(req));
      if (!c.deal_id) { const d = store.addDeal(req.params.ws, { name: c.store_name, category: c.category, city: "Other", platform: ["Salla", "Zid", "Shopify", "WooCommerce"].includes(c.platform) ? c.platform : "Other", skus: c.products || 0, contact_phone: c.phone ? "+" + c.phone : "", contact_email: c.email || "", notes: "Meeting booked by phone from the Store CRM.", stage: "demo" }); crm.update(req.params.ws, c.id, { deal_id: d.id }); }
      crm.stopEnrollments(c.id, "replied", { types: ["outreach", "nurture"] });
    } else if (outcome === "not_interested") outreach.setStage(c, "not_now", by(req));
    else if (outcome === "reached" && ["new", "contacted"].includes(c.stage)) outreach.setStage(c, "engaged", by(req));
    crm.save();
    res.json(m);
  });

  // ---- inbox: replies and new messages from stores
  app.get(`${P}/inbox`, (req, res) => {
    if (!W(req, res)) return;
    const all = req.query.status === "all";
    const rows = crm.db.messages.filter((m) => m.workspace_id === req.params.ws && m.direction === "in" && (all || !m.handled)).slice(-300).reverse();
    res.json(rows.map((m) => { const c = crm.get(req.params.ws, m.contact_id); return { ...m, store: c ? { id: c.id, store_name: c.store_name, category: c.category, stage: c.stage, email: c.email, phone: c.phone, owner_name: userName(c.owner_id), deal_id: c.deal_id } : null }; }));
  });
  app.post(`${P}/inbox/:id/done`, (req, res) => {
    if (!W(req, res)) return;
    const m = crm.message(req.params.ws, req.params.id);
    if (!m) return res.status(404).json({ detail: "Message not found" });
    m.handled = true; crm.save(); res.json(m);
  });
  app.post(`${P}/inbox/:id/retriage`, async (req, res) => {
    if (!W(req, res)) return;
    const m = crm.message(req.params.ws, req.params.id), c = m && crm.get(req.params.ws, m.contact_id);
    if (!c) return res.status(404).json({ detail: "Message not found" });
    res.json(await outreach.triage(req.params.ws, c, m));
  });

  // ---- settings and the manual "send due messages now" button
  app.put(`${P}/settings`, (req, res) => {
    if (!W(req, res)) return;
    const b = req.body || {}, cur = outreach.settings(req.params.ws), o = { ...cur };
    if (b.mode !== undefined) o.mode = b.mode === "live" ? "live" : "test";
    for (const k of ["email_daily_cap", "wa_daily_cap", "per_tick"]) if (b[k] !== undefined) o[k] = Math.max(0, Math.min(10000, Math.round(Number(b[k]) || 0)));
    for (const k of ["auto_reply", "auto_deal"]) if (b[k] !== undefined) o[k] = !!b[k];
    if (b.targets && typeof b.targets === "object") {
      const t = { ...cur.targets }, lim = { reply_pct: [0.1, 50], meeting_pct: [1, 100], close_pct: [1, 100], focus_list: [10, 5000] };
      for (const [k, [lo, hi]] of Object.entries(lim)) if (b.targets[k] !== undefined) { const v = Number(b.targets[k]); if (!(v >= lo && v <= hi)) return res.status(422).json({ detail: `${k.replace("_pct", "")} target must be between ${lo} and ${hi}` }); t[k] = v; }
      o.targets = t;
    }
    if (b.sender_name !== undefined) o.sender_name = String(b.sender_name).trim().slice(0, 60);
    crm.db.settings[req.params.ws] = Object.fromEntries(Object.entries(o).filter(([k]) => k in DEFAULT_SETTINGS)); crm.save();
    res.json(outreach.settings(req.params.ws));
  });
  app.post(`${P}/run`, async (req, res) => { if (!W(req, res)) return; res.json(await outreach.tick()); });

  // ---- sample stores (example.com emails, fake numbers; never sent for real)
  app.post(`${P}/sample`, (req, res) => {
    if (!W(req, res)) return;
    res.status(201).json(crm.upsertMany(req.params.ws, sampleStores(), { tags: ["sample"] }));
  });
  app.delete(`${P}/sample`, (req, res) => {
    if (!W(req, res)) return;
    res.json({ removed: crm.remove(req.params.ws, crm.contacts(req.params.ws).filter((c) => c.sample).map((c) => c.id)) });
  });
}

// 240 made-up Salla stores for trying the CRM. Emails use example.com (reserved, undeliverable);
// sendOne refuses to send to sample stores for real.
export function sampleStores() {
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const words = { "Fashion & abayas": ["Abaya", "Lamsa", "Noor", "Dana"], "Perfumes & oud": ["Oud", "Bakhoor", "Misk", "Anfas"], "Beauty & cosmetics": ["Glow", "Rose", "Jamal", "Lulu"],
    "Electronics & accessories": ["Tech", "Smart", "Gadget", "Volt"], "Home & furniture": ["Bayt", "Dar", "Nest", "Majlis"], "Coffee & dates": ["Qahwa", "Tamr", "Hail Dates", "Bunn"],
    "Kids & toys": ["Atfal", "Toy", "Baby", "Farah"], "Gifts & flowers": ["Ward", "Hadiya", "Bloom", "Tuhfa"], "Jewelry & watches": ["Dhahab", "Lulu", "Saa", "Fidda"], "Health & supplements": ["Sehha", "Vita", "Nabd", "Fit"] };
  const cities = ["Riyadh", "Riyadh", "Riyadh", "Jeddah", "Jeddah", "Dammam", "Khobar", "Makkah", "Madinah", "Abha", "Taif", "Buraidah"];
  const out = [];
  for (let i = 1; i <= 240; i++) {
    const cat = pick(Object.keys(words)), name = `${pick(words[cat])} ${pick(["Store", "Shop", "House", "KSA", "Boutique", "Market"])} ${i}`;
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    out.push({ store_name: `Sample · ${name}`, domain: `${slug}.example.com`, email: rnd() < 0.85 ? `owner@${slug}.example.com` : "", phone: rnd() < 0.7 ? `9665000${String(10000 + i).slice(1)}` : "",
      category: cat, city: pick(cities), products: Math.round(Math.pow(rnd(), 2) * 2500) + 5, owner_name: "", instagram: rnd() < 0.6 ? `@${slug}` : "", platform: rnd() < 0.8 ? "Salla" : "Zid",
      rating: Math.round((3.6 + rnd() * 1.4) * 10) / 10, wa_opt_in: rnd() < 0.25, source: "sample", sample: true });
  }
  return out;
}
