/* Ask DPA AD: the assistant panel on every page (button bottom-right, or Ctrl/⌘+K).
   Answers from the dashboard's real data through tools; any change waits for a Confirm in the chat.
   Uses app.js globals (S, $, api, esc, md, toast, ROUTES). */

const AK = { open: false, thread: null, msgs: [], busy: false, pending: null, ready: null };
const AK_LABELS = { get_overview: "the overview", find_stores: "stores", get_store: "a store", outreach_overview: "outreach numbers", list_campaigns: "campaigns", list_deals: "the pipeline", finance_snapshot: "finance", list_content: "content", workforce_status: "AI Workforce", search_knowledge: "Knowledge",
  update_stores: "updated stores", add_store_note: "added a store note", draft_campaign: "drafted a campaign", add_deal: "added a deal", create_content: "added content", add_task: "added a task", add_knowledge_note: "saved a note" };
const AK_SUGGEST = ["What needs me today?", "How is outreach going this week?", "Which categories reply best?", "Tag the 50 best-fit perfume stores in Riyadh as icp", "Add 3 White Friday post ideas to the calendar", "ما وضع الكاش والرنواي؟"];

function akEl() {
  let el = $("#akPanel");
  if (!el) {
    document.body.insertAdjacentHTML("beforeend", `<button class="ak-fab" id="akFab" aria-label="Ask DPA AD (Ctrl+K)" title="Ask DPA AD (Ctrl/⌘+K)"><span>✦</span> Ask DPA AD</button>
      <aside class="ak-panel" id="akPanel" hidden aria-label="Ask DPA AD"><div class="ak-head"><div><b>Ask DPA AD</b><span class="subtle s-small">Answers from your data. Changes need your OK.</span></div>
        <div class="row gap-8"><button class="btn btn-sm btn-ghost" data-ak="new" title="New conversation">New</button><button class="btn btn-sm" data-ak="close" aria-label="Close">✕</button></div></div>
        <div class="ak-body" id="akBody"></div>
        <form class="ak-form" id="akForm"><textarea class="input" id="akInput" rows="2" dir="auto" placeholder="Ask anything, or ask for a change… (Enter to send)"></textarea><button class="btn btn-primary" id="akSend">Send</button></form></aside>`);
    el = $("#akPanel");
    try { const saved = JSON.parse(sessionStorage.getItem("ak") || "null"); if (saved) { AK.thread = saved.thread; AK.msgs = saved.msgs || []; } } catch {}
  }
  return el;
}
function akSave() { try { sessionStorage.setItem("ak", JSON.stringify({ thread: AK.thread, msgs: AK.msgs.slice(-40) })); } catch {} }

function akRender() {
  const body = $("#akBody"); if (!body) return;
  if (AK.ready === false) { body.innerHTML = `<div class="ak-empty"><b>Not switched on yet</b><p class="muted s-small">Ask DPA AD needs ANTHROPIC_API_KEY on the server (hPanel → Node.js → Environment variables).</p></div>`; return; }
  const msgs = AK.msgs.map((m) => m.role === "user"
    ? `<div class="ak-msg me" dir="auto">${esc(m.text)}</div>`
    : m.role === "steps" ? `<div class="ak-steps">${m.steps.map((s) => `<span class="${s.ok ? "" : "bad"}">${s.write ? "✓ " : "Looked at "}${esc(AK_LABELS[s.tool] || s.tool)}</span>`).join("")}</div>`
    : m.role === "error" ? `<div class="ak-msg err">${esc(m.text)}</div>`
    : `<div class="ak-msg ai doc" dir="auto">${md(m.text)}</div>`).join("");
  const pend = AK.pending ? `<div class="ak-confirm"><span class="eyebrow">Confirm this change</span><div dir="auto">${esc(AK.pending.summary)}</div>
    <div class="row gap-8"><button class="btn btn-sm btn-primary" data-ak="yes">Yes, do it</button><button class="btn btn-sm" data-ak="no">No</button></div></div>` : "";
  const empty = !AK.msgs.length ? `<div class="ak-empty"><b>What can I help with?</b><p class="muted s-small">I can look across Sales, the Store CRM, Creative Studio, Finance, Operations and AI Workforce, as far as your role allows.</p>
    <div class="ak-sugg">${AK_SUGGEST.map((q) => `<button class="chip" data-akq="${esc(q)}" dir="auto">${esc(q)}</button>`).join("")}</div></div>` : "";
  body.innerHTML = empty + msgs + pend + (AK.busy ? `<div class="ak-msg ai"><span class="ak-dots"><i></i><i></i><i></i></span></div>` : "");
  body.scrollTop = body.scrollHeight;
  $("#akSend").disabled = AK.busy;
}
function akApply(r) {
  AK.thread = r.thread_id;
  if (r.steps?.length) AK.msgs.push({ role: "steps", steps: r.steps });
  if (r.reply) AK.msgs.push({ role: "ai", text: r.reply });
  AK.pending = r.pending || null;
  if (r.steps?.some((s) => s.write && s.ok) && typeof render === "function" && S.ws) render(); // refresh the page behind
}
async function akSend(text) {
  text = String(text || "").trim(); if (!text || AK.busy) return;
  AK.msgs.push({ role: "user", text }); AK.busy = true; AK.pending = null; akRender();
  try { akApply(await api("/api/assistant", { method: "POST", body: JSON.stringify({ thread_id: AK.thread, message: text, ws: S.ws?.id, page: ROUTES[S.route]?.title || "" }) })); }
  catch (e) { AK.msgs.push({ role: "error", text: e.message }); }
  AK.busy = false; akSave(); akRender();
}
async function akConfirm(approve) {
  if (!AK.pending || AK.busy) return;
  const p = AK.pending; AK.busy = true; AK.pending = null;
  AK.msgs.push({ role: "user", text: approve ? `Yes: ${p.summary}` : "No, don't do that." }); akRender();
  try { akApply(await api("/api/assistant/confirm", { method: "POST", body: JSON.stringify({ thread_id: AK.thread, action_id: p.id, approve }) })); }
  catch (e) { AK.msgs.push({ role: "error", text: e.message }); }
  AK.busy = false; akSave(); akRender();
}
async function akToggle(force) {
  const el = akEl();
  AK.open = force ?? !AK.open;
  el.hidden = !AK.open; $("#akFab").classList.toggle("on", AK.open);
  if (AK.open) {
    if (AK.ready === null) { try { AK.ready = (await api("/api/assistant/status")).ready; } catch { AK.ready = false; } }
    akRender(); setTimeout(() => $("#akInput")?.focus(), 50);
  }
}

document.addEventListener("click", (e) => {
  if (e.target.closest("#akFab")) return akToggle();
  const b = e.target.closest("[data-ak]");
  if (b) {
    const a = b.dataset.ak;
    if (a === "close") return akToggle(false);
    if (a === "new") { AK.thread = null; AK.msgs = []; AK.pending = null; akSave(); return akRender(); }
    if (a === "yes") return akConfirm(true);
    if (a === "no") return akConfirm(false);
  }
  const q = e.target.closest("[data-akq]");
  if (q) return akSend(q.dataset.akq);
});
document.addEventListener("submit", (e) => { if (e.target.id !== "akForm") return; e.preventDefault(); const v = $("#akInput").value; $("#akInput").value = ""; akSend(v); });
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); akToggle(); return; }
  if (e.target.id === "akInput" && e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("#akForm").requestSubmit(); }
  if (e.key === "Escape" && AK.open && !$("#dialog").open) akToggle(false);
});
akEl();
