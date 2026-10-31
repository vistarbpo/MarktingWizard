/* AI Support module: inbox, help center and website chat. Loaded after app.js;
   uses its globals (S, $, api, esc, md, toast, fmtDate, ROUTES).
   AI answers from the help center; money, legal, data, bugs and upset customers
   go to a person. In the inbox AI drafts and you send; on the website chat (when
   switched on) AI replies live and hands over when a rule says so. */

const SUP = { meta: null, data: null, tab: "inbox", filter: "open", openId: null, draft: null };
const ST_LABEL = { new: "New", ai_answered: "AI answered", needs_human: "Needs you", resolved: "Resolved" };
const ST_TONE = { new: "accent", ai_answered: "", needs_human: "warn", resolved: "good" };
const fromBadge = (f) => `<span class="s-owner ${f === "you" ? "you" : "ai"}" ${f === "customer" ? 'style="background:var(--surface-2);color:var(--text-2)"' : ""}>${f === "customer" ? "CUSTOMER" : f === "you" ? "YOU" : "AI"}</span>`;
const isAr = (t) => /[؀-ۿ]/.test(t || "");

ROUTES.support = { title: "AI Support", crumb: "Support", render: renderSupport };

async function supLoad() {
  if (!SUP.meta) SUP.meta = await api("/api/support/meta");
  SUP.data = await api(`/api/workspaces/${S.ws.id}/support`);
}

async function renderSupport(view) {
  view.innerHTML = `<p class="muted">Loading…</p>`;
  await supLoad();
  $("#pageActions").innerHTML = `
    <div class="s-tabs" role="tablist" aria-label="Support views">
      ${[["inbox", "Inbox"], ["kb", "Help center"], ["chat", "Website chat"]].map(([k, l]) => `<button role="tab" data-sutab="${k}" aria-selected="${SUP.tab === k}">${l}</button>`).join("")}
    </div>
    <button class="btn btn-primary" data-suaction="new-ticket">Add customer message</button>`;
  view.innerHTML = `<section class="s-kpis" id="suKpis"></section><div id="suBody" style="margin-top:20px"></div>`;
  supRerender();
}

function supRerender() {
  if (S.route !== "support") return;
  const s = SUP.data.summary;
  const tile = (label, val, sub, tone = "") => `<div class="card s-kpi ${tone}"><span class="eyebrow">${label}</span><b class="num">${val}</b><span class="subtle">${sub}</span></div>`;
  $("#suKpis").innerHTML = [
    tile("Open conversations", s.open, "not resolved yet"),
    tile("Needs you", s.needs_you.length, "money, legal, bugs, upset customers", s.needs_you.length ? "warn" : ""),
    tile("Resolved by AI", s.ai_resolved_pct == null ? "–" : s.ai_resolved_pct + "%", "of resolved this week, no person needed"),
    tile("New this week", s.new_week, s.top_categories.length ? "top: " + s.top_categories.map(([c, n]) => `${c} ${n}`).slice(0, 2).join(", ") : "conversations"),
    tile("Help articles", s.articles, "what AI answers from", s.articles ? "" : "warn"),
    tile("Website chat", SUP.data.settings.widget_enabled ? "On" : "Off", SUP.data.settings.widget_enabled ? "AI replies live, 24/7" : "switch on in Website chat"),
  ].join("");
  ({ inbox: supInbox, kb: supKb, chat: supChat })[SUP.tab]();
}

/* ------------------------------------------------ Inbox */
function supInbox() {
  const all = SUP.data.tickets;
  const list = all.filter((t) => SUP.filter === "all" ? true : SUP.filter === "open" ? t.status !== "resolved" : t.status === SUP.filter);
  const counts = { open: all.filter((t) => t.status !== "resolved").length, needs_human: all.filter((t) => t.status === "needs_human").length, resolved: all.filter((t) => t.status === "resolved").length, all: all.length };
  $("#suBody").innerHTML = `
    ${SUP.data.summary.articles ? "" : `<div class="notice" style="margin-bottom:16px">The help center is empty, so AI will hand almost every question to you. Open <button class="s-link" data-sutab="kb">Help center</button> and let AI write starter articles first.</div>`}
    <form class="card s-add" id="suNew" hidden>
      <div class="field"><label for="sun-name">Customer name</label><input class="input" id="sun-name"></div>
      <div class="field"><label for="sun-store">Store</label><input class="input" id="sun-store"></div>
      <div class="field"><label for="sun-ch">Channel</label><select class="input" id="sun-ch">${SUP.meta.channels.map((c) => `<option>${c}</option>`).join("")}</select></div>
      <div class="field"><label for="sun-contact">Contact</label><input class="input" id="sun-contact" placeholder="WhatsApp or email"></div>
      <div class="field h-span"><label for="sun-msg">Their message</label><textarea class="input" id="sun-msg" rows="3" required placeholder="Paste what the customer wrote (Arabic or English)"></textarea></div>
      <div class="row gap-8 h-span"><button class="btn btn-primary" type="submit">Add and let AI reply</button><button class="btn" type="button" data-suaction="new-ticket">Cancel</button></div>
    </form>
    <div class="su-inbox">
      <aside class="card su-list">
        <div class="row gap-8 su-filters">${[["open", "Open"], ["needs_human", "Needs you"], ["resolved", "Resolved"], ["all", "All"]].map(([k, l]) => `<button class="chip ${SUP.filter === k ? "active" : ""}" data-sufilter="${k}">${l} <span class="num">${counts[k]}</span></button>`).join("")}</div>
        <ul class="list">${list.map((t) => `<li class="clickable ${t.id === SUP.openId ? "selected" : ""}" data-suopen="${t.id}">
          <div style="min-width:0;flex:1"><div class="row between gap-8"><b class="s-name">${esc(t.customer_name || "Customer")}</b><span class="subtle s-small num" style="white-space:nowrap">${fmtDate(t.updated_at)}</span></div>
            <div class="s-small subtle" style="margin:2px 0 4px">${esc(t.channel)}${t.store ? " · " + esc(t.store) : ""} · ${esc(t.category)}</div>
            <p class="s-small muted su-preview" ${isAr(t.last?.text) ? 'dir="rtl"' : ""}>${esc((t.last?.text || "").slice(0, 120))}</p></div>
          <span class="badge ${ST_TONE[t.status]}">${ST_LABEL[t.status]}</span></li>`).join("") || `<li class="subtle s-small">${all.length ? "Nothing here." : "No conversations yet. Add a customer message, or switch on the website chat."}</li>`}</ul>
      </aside>
      <section class="card su-thread" id="suThread">${SUP.openId ? `<p class="muted" style="padding:24px">Loading…</p>` : `<div class="empty"><h2>Pick a conversation</h2><p>AI drafts a reply from your help center. You check it and send. Anything about money, legal, data, bugs or an upset customer is marked "Needs you".</p></div>`}</section>
    </div>`;
  if (SUP.openId) supOpen(SUP.openId);
}

async function supOpen(id) {
  SUP.openId = id;
  document.querySelectorAll("[data-suopen]").forEach((li) => li.classList.toggle("selected", li.dataset.suopen === id));
  let t; try { t = await api(`/api/workspaces/${S.ws.id}/support/tickets/${id}`); } catch (e) { toast(e.message, true); return; }
  const box = $("#suThread"); if (!box) return;
  box.innerHTML = `
    <div class="su-head"><div style="min-width:0"><h2>${esc(t.customer_name || "Customer")}</h2>
      <span class="subtle s-small">${esc(t.channel)}${t.store ? " · " + esc(t.store) : ""}${t.contact ? " · " + esc(t.contact) : ""}</span></div>
      <div class="row gap-8" style="flex-wrap:wrap"><span class="badge ${ST_TONE[t.status]}">${ST_LABEL[t.status]}</span>
        <select class="input input-sm" id="su-cat" aria-label="Category">${SUP.meta.categories.map((c) => `<option ${c === t.category ? "selected" : ""}>${c}</option>`).join("")}</select></div></div>
    ${t.status === "needs_human" ? `<div class="notice su-esc">Needs you${t.escalation_reason ? ": " + esc(t.escalation_reason) : ""}</div>` : ""}
    <div class="su-msgs">${t.messages.map((m) => `<div class="su-msg ${m.from}"><div class="row gap-8">${fromBadge(m.from)}<span class="subtle s-small num">${fmtDate(m.at)}</span></div><div class="su-bubble" ${isAr(m.text) ? 'dir="rtl"' : ""}>${esc(m.text)}</div></div>`).join("")}</div>
    <div class="su-compose">
      <div id="suDraftInfo" class="s-small subtle"></div>
      <textarea class="input" id="su-reply" rows="4" placeholder="Write a reply, or let AI draft one from the help center"></textarea>
      <div class="row between gap-8" style="flex-wrap:wrap">
        <div class="row gap-8" style="flex-wrap:wrap"><button class="btn" data-suaction="ai-reply">AI: draft reply</button><button class="btn btn-sm btn-ghost" data-suaction="customer-msg">+ Customer replied</button></div>
        <div class="row gap-8" style="flex-wrap:wrap">
          ${t.status !== "needs_human" ? `<button class="btn btn-sm" data-suaction="handover">Hand to a person</button>` : ""}
          ${t.status !== "resolved" ? `<button class="btn btn-sm" data-suaction="resolve">Resolve</button>` : `<button class="btn btn-sm" data-suaction="reopen">Reopen</button>`}
          <button class="btn btn-primary" data-suaction="send">I sent this reply</button></div>
      </div>
      <p class="subtle s-small">Copy the reply into ${esc(t.channel === "Website chat" ? "the chat follow-up (by email or WhatsApp)" : t.channel)}, send it, then click "I sent this reply" to log it.</p>
      <div class="row between"><span></span><button class="btn btn-ghost btn-danger btn-sm" data-suaction="delete">Delete conversation</button></div>
    </div>`;
  const ta = $("#su-reply");
  ta.addEventListener("input", () => (ta.dir = isAr(ta.value) ? "rtl" : "ltr"));
  box.querySelector(".su-msgs").scrollTop = 1e9;
}

/* ------------------------------------------------ Help center */
function supKb() {
  const arts = SUP.data.articles;
  $("#suBody").innerHTML = `
    <div class="row between" style="flex-wrap:wrap;gap:12px;margin-bottom:12px"><div><h2>Help center</h2><p class="subtle s-small">AI Support answers only from these articles and your Brief. If the answer isn't here, it hands the customer to you instead of guessing.</p></div>
      <div class="row gap-8"><button class="btn" data-suaction="kb-ai">AI: write starter articles (EN + AR)</button><button class="btn btn-primary" data-suaction="kb-new">Add article</button></div></div>
    <div id="suKbAi" class="card card-pad" hidden></div>
    <form class="card card-pad stack" id="suKbForm" hidden>
      <input type="hidden" id="kb-id">
      <div class="field"><label for="kb-q">Question</label><input class="input" id="kb-q" required placeholder="How do I connect my Salla store?"></div>
      <div class="field"><label for="kb-a">Answer</label><textarea class="input" id="kb-a" rows="5" required></textarea></div>
      <div class="row gap-12" style="flex-wrap:wrap"><div class="field"><label for="kb-lang">Language</label><select class="input" id="kb-lang"><option value="en">English</option><option value="ar">Arabic</option></select></div>
        <div class="field"><label for="kb-cat">Category</label><select class="input" id="kb-cat">${SUP.meta.categories.map((c) => `<option>${c}</option>`).join("")}</select></div></div>
      <div class="row gap-8"><button class="btn btn-primary" type="submit">Save article</button><button class="btn" type="button" data-suaction="kb-cancel">Cancel</button></div>
    </form>
    ${arts.length ? `<div class="su-kb">${arts.map((a) => `<article class="card card-pad su-art" ${a.language === "ar" ? 'dir="rtl"' : ""}>
      <div class="row between gap-8"><h3>${esc(a.question)}</h3><span class="badge">${a.language === "ar" ? "AR" : "EN"}</span></div>
      <p class="muted s-small su-ans">${esc(a.answer)}</p>
      <div class="row gap-8" dir="ltr"><button class="btn btn-sm" data-sukbedit="${a.id}">Edit</button><button class="btn btn-sm btn-ghost btn-danger" data-sukbdel="${a.id}">Delete</button>${/\[CONFIRM/.test(a.answer) ? `<span class="badge warn">Has [CONFIRM] to fill</span>` : ""}</div></article>`).join("")}</div>`
      : `<div class="card empty"><h2>No articles yet</h2><p>Let AI write 12 starter articles in English and Arabic from your Brief. It marks anything it can't confirm as [CONFIRM: …] for you to fill in.</p><button class="btn btn-primary" data-suaction="kb-ai">AI: write starter articles</button></div>`}`;
}

/* ------------------------------------------------ Website chat */
function supChat() {
  const st = SUP.data.settings, url = st.widget_key ? `${location.origin}/support/${st.widget_key}` : "";
  $("#suBody").innerHTML = `
    <div class="s-grid2">
      <div class="card card-pad stack">
        <div class="row between"><h2>Live AI chat for your website</h2><span class="badge ${st.widget_enabled ? "good" : ""}">${st.widget_enabled ? "On" : "Off"}</span></div>
        <p class="muted">When it's on, merchants can chat with AI Support any time. AI answers from your help center in Arabic or English. When a rule says a person must handle it (refunds, cancellations, legal, data, bugs, upset customers, or anything it can't answer), it asks for their contact and the conversation lands in your inbox under "Needs you".</p>
        <ul class="su-rules">${SUP.meta.escalation_rules.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>
        <p class="subtle s-small">Limits: 20 messages per visitor per 10 minutes, 400 per day in total, 40 per conversation. Each reply uses your Anthropic API key.</p>
        <div class="row gap-8" style="flex-wrap:wrap"><button class="btn ${st.widget_enabled ? "" : "btn-primary"}" data-suaction="toggle-chat">${st.widget_enabled ? "Switch off" : "Switch on"}</button>${st.widget_key ? `<button class="btn btn-ghost btn-sm" data-suaction="rotate">New link (old one stops working)</button>` : ""}</div>
      </div>
      <div class="card card-pad stack">
        <h2>Add it to dpa.ad</h2>
        ${url ? `<div class="field"><label for="su-url">Chat page link</label><div class="row gap-8"><input class="input" id="su-url" readonly value="${esc(url)}" style="flex:1"><button class="btn btn-sm" data-sucopy="su-url">Copy</button></div></div>
        <div class="field"><label for="su-embed">Or embed it (paste into your site's HTML)</label><textarea class="input mono" id="su-embed" rows="3" readonly>&lt;iframe src="${esc(url)}" title="DPA AD support" style="width:100%;max-width:420px;height:600px;border:0;border-radius:12px"&gt;&lt;/iframe&gt;</textarea><button class="btn btn-sm" data-sucopy="su-embed" style="align-self:flex-start">Copy embed code</button></div>
        ${st.widget_enabled ? `<a class="btn" href="${esc(url)}" target="_blank" rel="noopener">Open the chat and test it</a>` : `<p class="subtle s-small">Switch it on to test.</p>`}`
        : `<p class="muted">Switch the chat on to get your link and embed code.</p>`}
        ${SUP.data.summary.articles ? "" : `<div class="notice">Write help articles first, or AI will hand almost every question to you.</div>`}
      </div>
    </div>`;
}

/* ------------------------------------------------ AI calls */
async function supAiReply() {
  const btn = document.querySelector('[data-suaction="ai-reply"]'), info = $("#suDraftInfo");
  btn.disabled = true; btn.textContent = "AI is writing…";
  try {
    const r = await api(`/api/workspaces/${S.ws.id}/support/tickets/${SUP.openId}/ai-reply`, { method: "POST", body: "{}" });
    const ta = $("#su-reply"); ta.value = r.reply; ta.dir = isAr(r.reply) ? "rtl" : "ltr";
    SUP.draft = r.reply;
    info.innerHTML = r.escalate ? `<span style="color:var(--warn);font-weight:500">AI says a person must handle this: ${esc(r.reason || "see rules")}. The draft only tells the customer someone will follow up.</span>` : `AI draft · ${esc(r.category)} · review, edit if needed, send it, then log it.`;
    await supLoad(); supRerenderKeep();
  } catch (e) { toast(e.message, true); }
  finally { btn.disabled = false; btn.textContent = "AI: draft reply"; }
}
// Refresh counts and list without losing the reply being written.
function supRerenderKeep() {
  const ta = $("#su-reply"), v = ta?.value, info = $("#suDraftInfo")?.innerHTML;
  supRerender();
  setTimeout(() => { const t2 = $("#su-reply"); if (t2 && v) { t2.value = v; t2.dir = isAr(v) ? "rtl" : "ltr"; } if ($("#suDraftInfo") && info) $("#suDraftInfo").innerHTML = info; }, 250);
}

async function supKbAi() {
  const box = $("#suKbAi"); box.hidden = false;
  box.innerHTML = `<p class="muted">AI is writing starter articles in English and Arabic from your Brief. This takes a minute or two…</p><div class="doc s-draft-body" id="suKbStream"></div>`;
  document.querySelectorAll('[data-suaction="kb-ai"]').forEach((b) => (b.disabled = true));
  try {
    const res = await fetch(`/api/workspaces/${S.ws.id}/support/articles/ai-starter`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    if (res.status === 401) { location.href = "/login"; return; }
    if (!res.ok) { let m = res.statusText; try { m = (await res.json()).detail; } catch {} throw new Error(m); }
    const reader = res.body.getReader(), dec = new TextDecoder(); let text = "", last = 0;
    for (;;) { const { done, value } = await reader.read(); if (done) break; text += dec.decode(value, { stream: true }); if (Date.now() - last > 200) { last = Date.now(); $("#suKbStream").innerHTML = md(text.split("\n\n[[MWIZ_")[0]); } }
    const err = text.split("[[MWIZ_ERROR]]")[1]; if (err !== undefined) throw new Error(err.trim());
    const n = Number((text.split("[[MWIZ_SAVED]]")[1] || "0").trim());
    await supLoad(); supRerender();
    toast(n ? `Added ${n} articles. Check any marked [CONFIRM].` : "AI didn't return articles in the expected format. Try again.", !n);
  } catch (e) { box.innerHTML = `<div class="notice" style="color:var(--bad)">${esc(e.message)}</div>`; }
  finally { document.querySelectorAll('[data-suaction="kb-ai"]').forEach((b) => (b.disabled = false)); }
}

/* ------------------------------------------------ events */
document.addEventListener("click", async (e) => {
  const t = e.target;
  try {
    const tab = t.closest("[data-sutab]");
    if (tab) { SUP.tab = tab.dataset.sutab; document.querySelectorAll("[data-sutab][role=tab]").forEach((b) => b.setAttribute("aria-selected", b.dataset.sutab === SUP.tab)); supRerender(); return; }
    const f = t.closest("[data-sufilter]"); if (f) { SUP.filter = f.dataset.sufilter; supInbox(); return; }
    const o = t.closest("[data-suopen]"); if (o) { await supOpen(o.dataset.suopen); if (innerWidth < 1024) $("#suThread").scrollIntoView({ behavior: "smooth" }); return; }
    const cp = t.closest("[data-sucopy]"); if (cp) { const el = $("#" + cp.dataset.sucopy); try { await navigator.clipboard.writeText(el.value); toast("Copied"); } catch { el.select(); toast("Selected: press Ctrl+C"); } return; }
    const ke = t.closest("[data-sukbedit]");
    if (ke) { const a = SUP.data.articles.find((x) => x.id === ke.dataset.sukbedit); const fm = $("#suKbForm"); fm.hidden = false; $("#kb-id").value = a.id; $("#kb-q").value = a.question; $("#kb-a").value = a.answer; $("#kb-lang").value = a.language; $("#kb-cat").value = a.category; fm.scrollIntoView({ behavior: "smooth", block: "nearest" }); return; }
    const kd = t.closest("[data-sukbdel]");
    if (kd) { if (kd.dataset.confirm !== "1") { kd.dataset.confirm = "1"; kd.textContent = "Click again"; return; } await api(`/api/workspaces/${S.ws.id}/support/articles/${kd.dataset.sukbdel}`, { method: "DELETE" }); await supLoad(); supRerender(); return toast("Article deleted"); }
    const a = t.closest("[data-suaction]"); if (!a) return;
    const act = a.dataset.suaction, base = `/api/workspaces/${S.ws.id}/support`;
    if (act === "new-ticket") { if (SUP.tab !== "inbox") { SUP.tab = "inbox"; document.querySelectorAll("[data-sutab][role=tab]").forEach((b) => b.setAttribute("aria-selected", b.dataset.sutab === "inbox")); supRerender(); } const fm = $("#suNew"); fm.hidden = !fm.hidden; if (!fm.hidden) $("#sun-name").focus(); return; }
    if (act === "ai-reply") return supAiReply();
    if (act === "send") {
      const text = $("#su-reply").value.trim(); if (!text) return toast("Write or draft a reply first", true);
      const from = SUP.draft && text === SUP.draft.trim() ? "ai" : "you";
      await api(`${base}/tickets/${SUP.openId}/messages`, { method: "POST", body: JSON.stringify({ from, text }) });
      const tk = SUP.data.tickets.find((x) => x.id === SUP.openId);
      if (tk && tk.status === "new") await api(`${base}/tickets/${SUP.openId}`, { method: "PUT", body: JSON.stringify({ status: from === "ai" ? "ai_answered" : "needs_human" }) });
      SUP.draft = null; await supLoad(); supRerender(); return toast(from === "ai" ? "Logged: AI reply sent" : "Logged: your reply sent");
    }
    if (act === "customer-msg") {
      const text = $("#su-reply").value.trim(); if (!text) return toast("Paste the customer's new message in the box first", true);
      await api(`${base}/tickets/${SUP.openId}/messages`, { method: "POST", body: JSON.stringify({ from: "customer", text }) });
      await supLoad(); supRerender(); return toast("Customer message added");
    }
    if (["resolve", "reopen", "handover"].includes(act)) {
      await api(`${base}/tickets/${SUP.openId}`, { method: "PUT", body: JSON.stringify({ status: { resolve: "resolved", reopen: "new", handover: "needs_human" }[act] }) });
      await supLoad(); supRerenderKeep(); return toast({ resolve: "Resolved", reopen: "Reopened", handover: "Handed to a person" }[act]);
    }
    if (act === "delete") { if (a.dataset.confirm !== "1") { a.dataset.confirm = "1"; a.textContent = "Click again to delete"; return; } await api(`${base}/tickets/${SUP.openId}`, { method: "DELETE" }); SUP.openId = null; await supLoad(); supRerender(); return toast("Deleted"); }
    if (act === "kb-ai") return supKbAi();
    if (act === "kb-new") { const fm = $("#suKbForm"); fm.hidden = false; fm.reset(); $("#kb-id").value = ""; $("#kb-q").focus(); return; }
    if (act === "kb-cancel") { $("#suKbForm").hidden = true; return; }
    if (act === "toggle-chat") { await api(`${base}/settings`, { method: "PUT", body: JSON.stringify({ widget_enabled: !SUP.data.settings.widget_enabled }) }); await supLoad(); supRerender(); return toast(SUP.data.settings.widget_enabled ? "Website chat is on" : "Website chat is off"); }
    if (act === "rotate") { if (a.dataset.confirm !== "1") { a.dataset.confirm = "1"; a.textContent = "Click again: the old link stops working"; return; } await api(`${base}/settings`, { method: "PUT", body: JSON.stringify({ rotate_key: true }) }); await supLoad(); supRerender(); return toast("New link created"); }
  } catch (err) { toast(err.message || "Something went wrong", true); }
});

document.addEventListener("change", async (e) => {
  if (e.target.id !== "su-cat") return;
  try { await api(`/api/workspaces/${S.ws.id}/support/tickets/${SUP.openId}`, { method: "PUT", body: JSON.stringify({ category: e.target.value }) }); toast("Category updated"); } catch (err) { toast(err.message, true); }
});

document.addEventListener("submit", async (e) => {
  if (!["suNew", "suKbForm"].includes(e.target.id)) return;
  e.preventDefault();
  try {
    if (e.target.id === "suNew") {
      const t = await api(`/api/workspaces/${S.ws.id}/support/tickets`, { method: "POST", body: JSON.stringify({ customer_name: $("#sun-name").value, store: $("#sun-store").value, channel: $("#sun-ch").value, contact: $("#sun-contact").value, message: $("#sun-msg").value }) });
      SUP.filter = "open"; await supLoad(); supRerender(); await supOpen(t.id); await supAiReply();
    } else {
      const id = $("#kb-id").value, body = JSON.stringify({ question: $("#kb-q").value, answer: $("#kb-a").value, language: $("#kb-lang").value, category: $("#kb-cat").value });
      await api(`/api/workspaces/${S.ws.id}/support/articles${id ? "/" + id : ""}`, { method: id ? "PUT" : "POST", body });
      await supLoad(); supRerender(); toast("Article saved");
    }
  } catch (err) { toast(err.message || "Couldn't save", true); }
});

if (S.route === "support" && S.ws) render();
