// Sending and receiving for the Store CRM.
//   Email out: SMTP (Hostinger mailbox works: smtp.hostinger.com:465). Email in: IMAP polling of the same mailbox.
//   WhatsApp: Meta WhatsApp Cloud API. First contact must use an approved template and only goes to
//   numbers that opted in (WhatsApp Business policy); free text only inside 24h of their last message.
// Without credentials, or in Test mode, nothing leaves the server: messages are logged as "test".
import { CITIES, PLATFORMS } from "./sales.js";
import { CHANNELS, guessIntent, inWindow, nextWindowStart, parseTriage, renderTemplate, replyTriagePrompt, riyadhDay, normEmail, normPhone } from "./crm.js";

export function channelConfig(env = process.env) {
  return {
    email: {
      ready: !!(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS),
      host: env.SMTP_HOST || "", port: Number(env.SMTP_PORT || 465), user: env.SMTP_USER || "", pass: env.SMTP_PASS || "",
      from: env.MAIL_FROM || env.SMTP_USER || "", reply_to: env.MAIL_REPLY_TO || "",
      imap: { ready: !!((env.IMAP_HOST || env.SMTP_HOST) && (env.IMAP_USER || env.SMTP_USER) && (env.IMAP_PASS || env.SMTP_PASS)) && env.IMAP_HOST !== "off",
        host: env.IMAP_HOST || (env.SMTP_HOST || "").replace(/^smtp\./, "imap."), port: Number(env.IMAP_PORT || 993), user: env.IMAP_USER || env.SMTP_USER || "", pass: env.IMAP_PASS || env.SMTP_PASS || "" },
    },
    whatsapp: { ready: !!(env.WA_TOKEN && env.WA_PHONE_ID), token: env.WA_TOKEN || "", phone_id: env.WA_PHONE_ID || "", verify: env.WA_VERIFY_TOKEN || "", app_secret: env.WA_APP_SECRET || "", lang: env.WA_TEMPLATE_LANG || "ar" },
    public_url: (env.PUBLIC_URL || "https://wizard.dpa.ad").replace(/\/$/, ""),
    address: env.COMPANY_ADDRESS || "Riyadh, Saudi Arabia",
    inbound_secret: env.INBOUND_SECRET || "",
  };
}

const escHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

export function emailParts(cfg, c, subject, body, company) {
  const link = `${cfg.public_url}/u/${c.unsub_token}`;
  const foot = `\n\n—\n${company} · ${cfg.address}\nلإيقاف هذه الرسائل / Unsubscribe: ${link}`;
  const rtl = /[؀-ۿ]/.test(body);
  const html = `<div dir="${rtl ? "rtl" : "ltr"}" style="font-family:Tahoma,Arial,sans-serif;font-size:15px;line-height:1.7;color:#111">${escHtml(body).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>').replace(/\n/g, "<br>")}
<p style="margin-top:28px;font-size:12px;color:#777">${escHtml(company)} · ${escHtml(cfg.address)}<br><a href="${link}" style="color:#777">لإيقاف هذه الرسائل · Unsubscribe</a></p></div>`;
  return { subject, text: body + foot, html, headers: { "List-Unsubscribe": `<${link}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } };
}

// Real senders. Tests pass their own.
export function makeSenders(cfg) {
  let mailer = null;
  return {
    async email({ to, subject, text, html, headers }) {
      if (!mailer) {
        const nodemailer = (await import("nodemailer")).default;
        mailer = nodemailer.createTransport({ host: cfg.email.host, port: cfg.email.port, secure: cfg.email.port === 465, auth: { user: cfg.email.user, pass: cfg.email.pass }, pool: true, maxConnections: 2, rateDelta: 1000, rateLimit: 2 });
      }
      const r = await mailer.sendMail({ from: cfg.email.from, to, subject, text, html, headers, replyTo: cfg.email.reply_to || undefined });
      return { provider_id: r.messageId };
    },
    async whatsapp({ to, text, template, params }) {
      const body = template
        ? { messaging_product: "whatsapp", to, type: "template", template: { name: template, language: { code: cfg.whatsapp.lang }, components: params?.length ? [{ type: "body", parameters: params.map((p) => ({ type: "text", text: String(p || "-") })) }] : [] } }
        : { messaging_product: "whatsapp", to, type: "text", text: { body: text } };
      const res = await fetch(`https://graph.facebook.com/v21.0/${cfg.whatsapp.phone_id}/messages`, { method: "POST", headers: { Authorization: `Bearer ${cfg.whatsapp.token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error?.message || `WhatsApp error ${res.status}`);
      return { provider_id: j?.messages?.[0]?.id || "" };
    },
  };
}

export const DEFAULT_SETTINGS = { mode: "test", email_daily_cap: 200, wa_daily_cap: 250, per_tick: 25, auto_reply: false, sender_name: "", auto_deal: true };

export function createOutreach({ store, crm, provider, cfg = channelConfig(), senders = makeSenders(cfg), log = console }) {
  const settings = (wsId) => ({ ...DEFAULT_SETTINGS, ...(crm.db.settings[wsId] || {}) });
  const ws = (wsId) => store.getWorkspace(wsId);
  const lastIn = (contactId, channel) => { const ms = crm.messagesFor(contactId).filter((m) => m.direction === "in" && m.channel === channel); return ms.length ? Date.parse(ms[ms.length - 1].at) : 0; };
  const sentToday = (wsId, channel, day) => crm.db.messages.filter((m) => m.workspace_id === wsId && m.direction === "out" && m.channel === channel && ["sent", "test"].includes(m.status) && riyadhDay(new Date(m.at)) === day).length;

  // Sends one message to one store, or records why it couldn't. Never throws.
  async function sendOne(wsId, c, { channel, subject = "", body, wa_template = "", wa_params = null, campaign_id = null, step = null, by = "ai" }) {
    const s = settings(wsId), w = ws(wsId), company = w?.brief?.company_name || "DPA AD";
    const vars = { sender_name: s.sender_name || company, company };
    const text = renderTemplate(body, c, vars), subj = renderTemplate(subject, c, vars);
    const base = { workspace_id: wsId, contact_id: c.id, campaign_id, step, channel, direction: "out", subject: subj, body: text, by };
    const skip = (reason) => crm.addMessage({ ...base, status: "skipped", error: reason });
    if (c.stage === "do_not_contact") return skip("Store is on do-not-contact");
    if (channel === "email") {
      if (!c.email) return skip("No email");
      if (c.email_opt_out) return skip("Unsubscribed from email");
      if (c.bounced) return skip("Email bounced before");
    } else {
      if (!c.phone) return skip("No WhatsApp number");
      if (c.wa_opt_out) return skip("Asked to stop WhatsApp");
      const inSession = Date.now() - lastIn(c.id, "whatsapp") < 24 * 3600e3;
      if (!inSession && !c.wa_opt_in) return skip("No WhatsApp opt-in: WhatsApp only allows business-first messages to people who agreed");
      if (!inSession && !wa_template) return skip("Outside the 24h window: needs an approved WhatsApp template");
      base.wa_template = inSession ? "" : wa_template;
    }
    const live = s.mode === "live" && cfg[channel].ready && !c.sample;
    if (!live) { touch(c, campaign_id); return crm.addMessage({ ...base, status: "test", error: c.sample ? "Sample store: never sent for real" : cfg[channel].ready ? "Test mode: not sent" : `${channel === "email" ? "Email" : "WhatsApp"} isn't connected yet: not sent` }); }
    try {
      const r = channel === "email"
        ? await senders.email({ to: c.email, ...emailParts(cfg, c, subj, text, company) })
        : await senders.whatsapp({ to: c.phone, text, template: base.wa_template, params: (wa_params || ["owner_name", "store_name"]).map((k) => (k === "sender_name" ? vars.sender_name : c[k] || c.store_name)) });
      touch(c, campaign_id);
      return crm.addMessage({ ...base, status: "sent", provider_id: r?.provider_id || "" });
    } catch (e) {
      const msg = String(e?.message || e).slice(0, 300);
      if (channel === "email" && /^5\d\d|user unknown|does not exist|no such user|mailbox unavailable/i.test(msg)) crm.update(wsId, c.id, { bounced: true });
      return crm.addMessage({ ...base, status: "failed", error: msg });
    }
  }
  function touch(c, campaign_id) {
    const f = { last_contacted_at: new Date().toISOString() };
    if (campaign_id && c.stage === "new") f.stage = "contacted";
    crm.update(c.workspace_id, c.id, f);
  }

  // One pass of the scheduler: sends what is due, inside Saudi hours and daily caps.
  async function tick(now = new Date()) {
    const out = { sent: 0, skipped: 0, waiting: 0 };
    const day = riyadhDay(now);
    const running = crm.db.campaigns.filter((c) => c.status === "running");
    const budget = {};
    for (const camp of running) {
      if (!inWindow(now, camp.window)) continue;
      const s = settings(camp.workspace_id);
      const key = (ch) => `${camp.workspace_id}|${ch}`;
      for (const ch of CHANNELS) if (budget[key(ch)] == null) budget[key(ch)] = Math.max(0, (ch === "email" ? s.email_daily_cap : s.wa_daily_cap) - sentToday(camp.workspace_id, ch, day));
      let campLeft = Math.max(0, camp.daily_limit - crm.db.messages.filter((m) => m.campaign_id === camp.id && m.direction === "out" && ["sent", "test"].includes(m.status) && riyadhDay(new Date(m.at)) === day).length);
      let tickLeft = s.per_tick;
      const due = crm.db.enrollments.filter((e) => e.campaign_id === camp.id && e.status === "active" && Date.parse(e.next_at) <= now.getTime());
      for (const e of due) {
        if (campLeft <= 0 || tickLeft <= 0) { out.waiting++; continue; }
        const c = crm.get(camp.workspace_id, e.contact_id);
        if (!c) { e.status = "stopped"; continue; }
        if (camp.stop_on_reply && c.last_reply_at && Date.parse(c.last_reply_at) > Date.parse(e.created_at)) { e.status = "replied"; continue; }
        if (c.stage === "do_not_contact") { e.status = "stopped"; continue; }
        const st = camp.steps[e.step];
        if (!st) { e.status = "done"; continue; }
        if (budget[key(st.channel)] <= 0) { out.waiting++; continue; }
        const m = await sendOne(camp.workspace_id, c, { ...st, campaign_id: camp.id, step: e.step });
        if (m.status === "skipped") out.skipped++; else { out.sent++; campLeft--; tickLeft--; budget[key(st.channel)]--; }
        e.step++;
        if (e.step >= camp.steps.length) { e.status = "done"; e.next_at = null; }
        else e.next_at = new Date(now.getTime() + (camp.steps[e.step].delay_days || 0) * 864e5).toISOString();
      }
      if (camp.type !== "onboarding" && !crm.db.enrollments.some((e) => e.campaign_id === camp.id && e.status === "active")) { camp.status = "done"; camp.finished_at = now.toISOString(); }
    }
    crm.save();
    return out;
  }

  // Launch: enroll every store in the segment and start at start_at (or the next Saudi send window).
  function launch(camp, contacts) {
    const start = nextWindowStart(camp.start_at ? new Date(camp.start_at) : new Date(), camp.window).toISOString();
    const n = camp.type === "onboarding" ? 0 : crm.enroll(camp, contacts, start);
    crm.updateCampaign(camp.workspace_id, camp.id, { status: "running", launched_at: new Date().toISOString(), enrolled: (camp.enrolled || 0) + n });
    return { enrolled: n, starts_at: start };
  }

  // Lifecycle hook: moving a store to Onboarding starts the running onboarding flows.
  function onStage(c, from, to) {
    if (from === to) return;
    if (to === "onboarding") {
      for (const camp of crm.campaigns(c.workspace_id).filter((x) => x.status === "running" && x.type === "onboarding")) {
        crm.enroll(camp, [c], new Date().toISOString());
        camp.enrolled = (camp.enrolled || 0) + 1;
      }
      crm.stopEnrollments(c.id, "stopped", { types: ["outreach", "nurture"] });
    }
    if (["do_not_contact", "churned"].includes(to)) crm.stopEnrollments(c.id, "stopped");
  }
  function setStage(c, stage, by = "ai") {
    const from = c.stage;
    if (from === stage) return c;
    crm.update(c.workspace_id, c.id, { stage, stage_changed_at: new Date().toISOString() });
    crm.addNote(c.workspace_id, c.id, `Stage: ${from} → ${stage}`, by);
    onStage(c, from, stage);
    return c;
  }

  // A store wrote to us (reply or first contact). Store it, stop sequences, triage with AI.
  async function inbound({ channel, from, subject = "", body, provider_id = "", name = "" }) {
    const email = channel === "email" ? normEmail(from) : "", phone = channel === "whatsapp" ? normPhone(from) : "";
    if (!email && !phone) return null;
    if (provider_id && crm.db.messages.some((m) => m.provider_id === provider_id && m.direction === "in")) return null; // duplicate delivery
    let c = email ? crm.findByEmail(email) : crm.findByPhone(phone);
    if (!c) {
      const wsId = store.listWorkspaces()[0]?.id;
      if (!wsId) return null;
      c = crm.add(wsId, { store_name: name || email || "+" + phone, email, phone, platform: "Unknown", category: "Other", source: "inbound", stage: "engaged", tags: ["inbound"] });
    }
    const wsId = c.workspace_id;
    const msg = crm.addMessage({ workspace_id: wsId, contact_id: c.id, channel, direction: "in", subject, body: String(body).slice(0, 8000), status: "received", provider_id, handled: false });
    const f = { last_reply_at: msg.at };
    if (channel === "whatsapp") f.wa_opt_in = true;
    crm.update(wsId, c.id, f);
    crm.stopEnrollments(c.id, "replied", { types: ["outreach", "nurture", "newsletter"] });
    if (["new", "contacted", "not_now"].includes(c.stage)) setStage(c, "engaged");
    await triage(wsId, c, msg);
    return msg;
  }

  async function triage(wsId, c, msg) {
    const w = ws(wsId), s = settings(wsId);
    let t;
    try {
      const history = crm.messagesFor(c.id).filter((m) => m.id !== msg.id && m.status !== "skipped").slice(-8);
      t = parseTriage(await provider.generate({ prompt: replyTriagePrompt(w, c, history, msg), onText: () => {} }));
    } catch (e) {
      t = { intent: guessIntent(msg.body), needs_person: true, summary: "AI could not read this: " + (e?.message || "error"), reply: "", checked: false };
    }
    if (!t.checked) { t.intent = guessIntent(msg.body); t.reply = ""; } // AI answer unreadable: fall back to rules on the store's own words
    // Unsubscribe is honoured even if the AI missed it.
    if (guessIntent(msg.body) === "unsubscribe") t.intent = "unsubscribe";
    Object.assign(msg, { intent: t.intent, summary: t.summary, ai_reply: t.reply, needs_person: t.needs_person || !t.checked });
    if (t.intent === "unsubscribe") {
      crm.update(wsId, c.id, msg.channel === "email" ? { email_opt_out: true } : { wa_opt_out: true, wa_opt_in: false });
      setStage(c, "do_not_contact"); msg.handled = true; msg.ai_reply = "";
    } else if (t.intent === "not_interested" || t.intent === "not_now") setStage(c, "not_now");
    else if (t.intent === "out_of_office") msg.handled = true;
    else if (t.intent === "interested") {
      if (["new", "contacted", "engaged", "not_now"].includes(c.stage)) setStage(c, "qualified");
      if (s.auto_deal && !c.deal_id && store.addDeal) {
        const d = store.addDeal(wsId, { name: c.store_name, category: c.category, city: Object.hasOwn(CITIES, c.city) ? c.city : "Other", platform: PLATFORMS.includes(c.platform) ? c.platform : "Other", skus: c.products || 0, contact_name: c.owner_name || "", contact_email: c.email || "", contact_phone: c.phone ? "+" + c.phone : "", notes: `From Store CRM: replied on ${msg.channel}. ${t.summary}`, stage: "contacted", crm_contact_id: c.id });
        crm.update(wsId, c.id, { deal_id: d.id });
      }
    }
    // Auto-reply only when switched on, the AI is confident and no person is needed.
    if (s.auto_reply && t.checked && !msg.needs_person && msg.ai_reply && ["interested", "question"].includes(t.intent)) {
      const r = await sendOne(wsId, crm.get(wsId, c.id), { channel: msg.channel, subject: msg.subject ? "Re: " + msg.subject.replace(/^re:\s*/i, "") : "", body: msg.ai_reply, by: "ai" });
      if (r.status !== "skipped" && r.status !== "failed") { msg.handled = true; msg.reply_id = r.id; }
    }
    crm.save();
    return msg;
  }

  // Email replies and bounces from the mailbox (IMAP). Runs every few minutes when configured.
  let lastUid = 0;
  async function pollMailbox() {
    if (!cfg.email.imap.ready) return { skipped: true };
    const { ImapFlow } = await import("imapflow");
    const { simpleParser } = await import("mailparser");
    const client = new ImapFlow({ host: cfg.email.imap.host, port: cfg.email.imap.port, secure: true, auth: { user: cfg.email.imap.user, pass: cfg.email.imap.pass }, logger: false });
    let n = 0;
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    try {
      const since = new Date(Date.now() - 3 * 864e5);
      for await (const m of client.fetch({ seen: false, since }, { uid: true, source: true })) {
        if (m.uid <= lastUid) continue;
        lastUid = Math.max(lastUid, m.uid);
        const p = await simpleParser(m.source);
        const fromAddr = p.from?.value?.[0]?.address || "";
        const text = cleanReply(p.text || "");
        if (/mailer-daemon|postmaster/i.test(fromAddr) || /delivery status notification|undeliver|returned mail/i.test(p.subject || "")) {
          const bad = /([^\s<>"]+@[^\s<>"]+\.[a-z]{2,})/i.exec(p.text || "")?.[1];
          const c = bad && crm.findByEmail(bad.toLowerCase());
          if (c) crm.update(c.workspace_id, c.id, { bounced: true });
        } else if (fromAddr && text) { await inbound({ channel: "email", from: fromAddr, subject: p.subject || "", body: text, provider_id: p.messageId || "", name: p.from?.value?.[0]?.name || "" }); n++; }
        await client.messageFlagsAdd({ uid: m.uid }, ["\\Seen"], { uid: true });
      }
    } finally { lock.release(); await client.logout().catch(() => {}); }
    return { received: n };
  }

  let timers = [];
  function start({ every = 60e3, mailEvery = 180e3 } = {}) {
    const safe = (fn, name) => async () => { try { await fn(); } catch (e) { log.error(`[crm] ${name}:`, e?.message || e); } };
    timers.push(setInterval(safe(() => tick(), "tick"), every), setInterval(safe(pollMailbox, "mailbox"), mailEvery));
    timers.forEach((t) => t.unref?.());
  }
  function stop() { timers.forEach(clearInterval); timers = []; }

  return { tick, launch, sendOne, inbound, triage, setStage, onStage, pollMailbox, settings, start, stop, cfg };
}

// Drops quoted history and signatures from an email reply.
export function cleanReply(text) {
  const lines = String(text).replace(/\r/g, "").split("\n");
  const out = [];
  for (const l of lines) {
    if (/^\s*>/.test(l)) continue;
    if (/^On .+wrote:\s*$/i.test(l) || /^في .+كتب.*:?\s*$/.test(l) || /^-{2,}\s*Original Message/i.test(l) || /^From:\s/i.test(l) || /^—\s*$/.test(l)) break;
    out.push(l);
  }
  return out.join("\n").trim().slice(0, 8000);
}
