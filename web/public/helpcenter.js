/* Help center: customer-facing help articles in Arabic and English, published on the public site /help (no login).
   Articles move draft → in review → published → archived; a different person than the author reviews and publishes
   (the Owner may self-publish unless switched off). The AI Help writer (drafts only) drafts from a support article or
   from resolved tickets, translates AR↔EN, and the Gaps tab lists ticket topics with no published article.
   Uses app.js globals (S, $, api, esc, md, toast, ROUTES, levelFor, go). Names start with "hc". */

const HC = { tab: "articles", meta: null, list: null, cur: null, open: null, editing: false, filter: { q: "", status: "", category: "" }, gaps: null };
const HC_TABS = [["articles", "Articles"], ["gaps", "Gaps"], ["settings", "Settings"]];
const HC_TONE = { draft: "", in_review: "warn", published: "good", archived: "" };
const HC_MOVE = { in_review: "Send for review", published: "Publish", draft: "Back to draft", archived: "Archive" };
const hcP = () => `/api/workspaces/${S.ws.id}/helpcenter`;
const hcEdit = () => levelFor("helpcenter") === "edit";
const hcPost = (p, b) => api(`${hcP()}${p}`, { method: "POST", body: JSON.stringify(b || {}) });
const hcPut = (p, b) => api(`${hcP()}${p}`, { method: "PUT", body: JSON.stringify(b || {}) });
const hcOpts = (list, cur, empty) => `${empty !== undefined ? `<option value="">${esc(empty)}</option>` : ""}${list.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(cur ?? "") ? "selected" : ""}>${esc(l)}</option>`).join("")}`;
const hcBadge = (t, tone = "") => `<span class="badge ${tone}">${esc(t)}</span>`;
const hcCat = (id) => HC.meta?.categories.find((c) => c.id === id)?.en || id;
const hcStatus = (id) => HC.meta?.statuses.find((s) => s.id === id)?.name || id;
const hcTile = (l, v, sub, tone = "") => `<div class="card s-kpi ${tone}"><span class="eyebrow">${esc(l)}</span><b class="num">${esc(v)}</b><span class="subtle">${esc(sub)}</span></div>`;
const hcTitle = (a) => a.title_en || a.title_ar || "(untitled)";
const hcLangs = (a) => `${a.langs.ar ? hcBadge("AR", "accent") : ""}${a.langs.en ? hcBadge("EN", "accent") : ""}`;

ROUTES.helpcenter = { title: "Help center", crumb: "Customers", render: renderHelpCenter };

async function renderHelpCenter(view) {
  if (HC_TABS.some(([k]) => k === S.param)) { HC.tab = S.param; HC.open = null; }
  else if (S.param && /^\d+$/.test(S.param)) { HC.tab = "articles"; HC.open = S.param; }
  $("#pageActions").innerHTML = "";
  view.innerHTML = `<div class="s-tabs hc-tabs" role="tablist" aria-label="Help center views">${HC_TABS.map(([k, l]) => `<button role="tab" data-hctab="${k}" aria-selected="${HC.tab === k}">${l}</button>`).join("")}</div>
    <div id="hcBody" style="margin-top:16px"><p class="muted">Loading…</p></div>`;
  try { HC.meta = await api(`${hcP()}/meta`); } catch (e) { $("#hcBody").innerHTML = `<div class="card empty"><p>${esc(e.message)}</p></div>`; return; }
  await hcShow();
}
async function hcShow() {
  if (S.route !== "helpcenter") return;
  document.querySelectorAll("[data-hctab]").forEach((b) => b.setAttribute("aria-selected", b.dataset.hctab === HC.tab));
  const box = $("#hcBody"); if (!box) return;
  try {
    if (HC.tab === "gaps") { HC.gaps = (await api(`${hcP()}/gaps`)).gaps; box.innerHTML = hcGaps(); return; }
    if (HC.tab === "settings") { HC.meta = await api(`${hcP()}/meta`); box.innerHTML = hcSettings(); return; }
    if (HC.open) { const a = await api(`${hcP()}/articles/${HC.open}`).catch(() => null); if (a) { HC.cur = a; box.innerHTML = hcDetail(a); return; } HC.open = null; }
    const q = new URLSearchParams(Object.entries(HC.filter).filter(([, v]) => v)).toString();
    HC.list = await api(`${hcP()}/articles${q ? "?" + q : ""}`); box.innerHTML = hcList();
  } catch (e) { box.innerHTML = `<div class="card empty"><p>${esc(e.message)}</p></div>`; }
}
const hcSiteNote = () => { const s = HC.meta.site; return `<p class="hc-banner s-small" role="note"><span>Public site: <a href="/help" target="_blank" rel="noopener">${esc(s.url)}</a></span><span>${s.is_this ? "shows this workspace's published articles." : "shows another workspace (change it in Settings)."}</span><span>Only published, public articles appear there; drafts never do.</span></p>`; };

/* ------------------------------------------------ list: tiles, new article, AI draft, filters, rows */
function hcList() {
  const d = HC.list, t = d.totals, m = HC.meta, f = HC.filter;
  const tiles = [hcTile("Published", t.published, `${t.all} articles in all`), hcTile("In review", t.in_review, "waiting for a reviewer", t.in_review ? "warn" : ""),
    hcTile("Drafts", t.drafts, "not on the site"), hcTile("To re-review", t.stale, `not reviewed in ${m.stale_days} days`, t.stale ? "warn" : ""), hcTile("Not helpful", t.not_helpful, "3+ “no” votes in 30 days", t.not_helpful ? "bad" : "")];
  const add = hcEdit() ? `<div class="hc-two"><details class="card card-pad hc-new" ${t.all ? "" : "open"}><summary><b>New article</b></summary>${hcForm(null)}</details>
    <details class="card card-pad hc-new"><summary><b>Draft with the AI Help writer</b></summary>
      <form id="hcAiForm" class="stack" style="gap:10px;margin-top:12px"><p class="subtle s-small" style="margin:0">Drafts only from a support article's own words (or from resolved tickets on the Gaps tab), with [ADD] for anything missing. A different person reviews and publishes.${m.agent_level === 0 ? " <b>The AI Help writer is switched off in AI Workforce: you get the plain draft.</b>" : ""}</p>
        <div class="field"><label for="hca-sa">Support article</label><select class="input" id="hca-sa">${hcOpts(m.support_articles.map((a) => [a.id, `${a.question.slice(0, 90)} (${a.language})`]), "", m.support_articles.length ? "Pick a support article" : "No support articles yet (AI Support → Help center)")}</select></div>
        <div class="field"><label for="hca-cat">Category</label><select class="input" id="hca-cat">${hcOpts(m.categories.map((c) => [c.id, c.en]), "", "From the support article")}</select></div>
        <div><button class="btn btn-primary" type="submit" ${m.support_articles.length ? "" : "disabled"}>Draft the article</button></div></form></details></div>` : "";
  const filters = `<form id="hcFilter" class="hc-filters" role="search">
    <input class="input input-sm" id="hcq" type="search" placeholder="Search (Arabic or English)" value="${esc(f.q)}" aria-label="Search">
    <select class="input input-sm" id="hcfs" aria-label="Status">${hcOpts([...m.statuses.map((x) => [x.id, x.name]), ["stale", "To re-review"]], f.status, "All statuses")}</select>
    <select class="input input-sm" id="hcfc" aria-label="Category">${hcOpts(m.categories.map((x) => [x.id, x.en]), f.category, "All categories")}</select>
    <button class="btn btn-sm" type="submit">Filter</button></form>`;
  const rows = d.articles.map((a) => `<button class="card hc-row" data-hcact="open" data-id="${esc(a.id)}">
      <span class="hc-row-main"><b dir="auto" class="hc-title">${esc(hcTitle(a))}</b>${a.title_ar && a.title_en ? `<span dir="rtl" lang="ar" class="subtle s-small hc-title">${esc(a.title_ar)}</span>` : ""}
        <span class="subtle s-small">${esc(hcCat(a.category))} · /help/a/${esc(a.slug)}</span></span>
      <span class="hc-row-side">${hcBadge(hcStatus(a.status), HC_TONE[a.status])}${hcLangs(a)}${a.visibility === "customers" ? hcBadge("customers only", "") : ""}${a.fresh.stale ? hcBadge("re-review", "warn") : ""}${a.votes.no_30 >= 3 ? hcBadge(`${a.votes.no_30} not helpful`, "bad") : ""}${a.by_ai ? hcBadge("AI draft", "accent") : ""}${a.sample ? hcBadge("sample", "warn") : ""}
        <span class="subtle s-small num">${a.status === "published" ? `Reviewed ${esc(a.last_reviewed || "–")} · ${a.votes.yes_30} yes / ${a.votes.no_30} no (30 days)` : `By ${esc(a.author_name || "–")}`}</span></span></button>`).join("");
  return `${hcSiteNote()}<section class="s-kpis">${tiles.join("")}</section>
    <div class="stack" style="gap:16px;margin-top:16px">${add}${filters}
    ${rows ? `<div class="stack" style="gap:8px">${rows}</div>` : `<div class="card empty"><p>${t.all ? "Nothing matches these filters." : "No help articles yet. Start with the questions merchants ask most (Gaps tab), or draft one from a support article."}</p></div>`}</div>`;
}
function hcForm(a) {
  const m = HC.meta;
  return `<form id="hcForm" class="hc-form" data-id="${esc(a?.id || "")}" style="margin-top:12px">
    <div class="field"><label for="hcf-cat">Category</label><select class="input" id="hcf-cat">${hcOpts(m.categories.map((c) => [c.id, c.en]), a?.category || "getting-started")}</select></div>
    <div class="field"><label for="hcf-vis">Visibility</label><select class="input" id="hcf-vis">${hcOpts(m.visibility.map((v) => [v.id, v.name]), a?.visibility || "public")}</select></div>
    <div class="field hc-wide"><label for="hcf-slug">Link (slug)</label><input class="input" id="hcf-slug" maxlength="80" dir="ltr" value="${esc(a?.slug || "")}" placeholder="made from the English title"><span class="hint">/help/a/&lt;slug&gt;: lowercase letters, digits and hyphens.</span></div>
    <div class="field" lang="ar"><label for="hcf-tar">العنوان (عربي)</label><input class="input" id="hcf-tar" maxlength="200" dir="rtl" value="${esc(a?.title_ar || "")}"></div>
    <div class="field"><label for="hcf-ten">Title (English)</label><input class="input" id="hcf-ten" maxlength="200" dir="ltr" value="${esc(a?.title_en || "")}"></div>
    <div class="field" lang="ar"><label for="hcf-bar">النص (عربي)</label><textarea class="input hc-body" id="hcf-bar" rows="10" dir="rtl">${esc(a?.body_ar || "")}</textarea></div>
    <div class="field"><label for="hcf-ben">Body (English)</label><textarea class="input hc-body" id="hcf-ben" rows="10" dir="ltr">${esc(a?.body_en || "")}</textarea></div>
    <p class="hint hc-wide" style="margin:0">Markdown: ## heading, - list, 1. steps, **bold**, *italic*, \`code\`, [link](https://…), ![image](/media/…). No HTML: it shows as text.</p>
    ${a ? `<div class="field hc-wide"><label for="hcf-rel">Related articles</label><select class="input" id="hcf-rel" multiple size="4">${hcOpts((HC.list?.articles || []).filter((x) => x.id !== a.id).map((x) => [x.id, hcTitle(x)]), "")}</select><span class="hint">Ctrl/⌘-click to pick up to 6. Only published ones show on the site.</span></div>` : ""}
    <div class="row gap-8 hc-wide"><button class="btn btn-primary" type="submit">${a ? "Save" : "Add draft"}</button>${a ? `<button class="btn" type="button" data-hcact="cancel-edit">Cancel</button>` : ""}</div></form>`;
}

/* ------------------------------------------------ one article */
function hcDetail(a) {
  const edit = hcEdit(), m = HC.meta, locked = a.status === "published";
  const moves = edit ? a.next.map((s) => `<button class="btn btn-sm ${s === "published" ? "btn-primary" : ""}" data-hcact="move" data-to="${s}" ${s === "published" && a.publish_block ? `disabled title="${esc(a.publish_block)}"` : ""}>${esc(HC_MOVE[s] || s)}</button>`).join("") : "";
  const head = HC.editing && edit && !locked ? `<section class="card card-pad">${hcForm(a)}</section>` : `<section class="card card-pad hc-head">
    <button class="hc-link s-small" data-hcact="back">← All articles</button>
    <h2 style="margin:6px 0 0" dir="auto">${esc(hcTitle(a))}</h2>${a.title_ar && a.title_en ? `<p dir="rtl" lang="ar" style="margin:2px 0 0" class="subtle">${esc(a.title_ar)}</p>` : ""}
    <div class="hc-meta s-small">${hcBadge(hcStatus(a.status), HC_TONE[a.status])}${hcLangs(a)}${a.visibility === "customers" ? hcBadge("customers only: not on the site yet", "") : ""}${a.fresh.stale ? hcBadge(`not reviewed in ${m.stale_days} days`, "warn") : ""}${a.by_ai ? hcBadge("AI draft", "accent") : ""}${a.sample ? hcBadge("sample", "warn") : ""}
      <span class="subtle">${esc(hcCat(a.category))}</span>${a.live_url ? `<a href="${esc(a.live_url.replace(/^https?:\/\/[^/]+/, ""))}" target="_blank" rel="noopener">View on the site ↗</a>` : `<span class="subtle">/help/a/${esc(a.slug)}</span>`}</div>
    <div class="hc-meta s-small subtle"><span>Author: ${esc(a.author_name || "–")}</span>${a.reviewer_name ? `<span>Reviewer: ${esc(a.reviewer_name)}</span>` : ""}${a.last_reviewed ? `<span>Last reviewed <b class="num">${esc(a.last_reviewed)}</b></span>` : ""}
      <span>Helpful: <b class="num">${a.votes.yes_30}</b> yes · <b class="num">${a.votes.no_30}</b> no (30 days; ${a.votes.yes} / ${a.votes.no} in all)</span>${a.support_article ? `<span>From support article: <span dir="auto">${esc(a.support_article.question)}</span></span>` : ""}</div>
    ${a.ai_note ? `<p class="hc-note s-small">${esc(a.ai_note)}</p>` : ""}${a.status === "in_review" && a.publish_block ? `<p class="hc-note s-small">${esc(a.publish_block)}</p>` : ""}${locked ? `<p class="subtle s-small" style="margin:8px 0 0">Published text is locked. Move it back to draft to change it (it leaves the site until it's reviewed again).</p>` : ""}
    ${edit ? `<div class="row gap-8 hc-acts">${!locked ? `<button class="btn btn-sm" data-hcact="edit">Edit</button>` : ""}${moves}${locked ? `<button class="btn btn-sm" data-hcact="reviewed">Still correct (re-reviewed)</button>` : ""}${a.status !== "published" ? `<button class="btn btn-sm btn-ghost btn-danger" data-hcact="delete">Delete</button>` : ""}</div>` : ""}</section>`;
  const lang = (l, name) => `<section class="card card-pad hc-lang" ${l === "ar" ? 'lang="ar"' : ""}><div class="row between gap-8" style="flex-wrap:wrap"><h3 class="s-small" style="margin:0">${name}</h3>
      ${edit && !locked && a.langs[l === "ar" ? "en" : "ar"] ? `<button class="btn btn-sm" data-hcact="translate" data-to="${l}">${a.langs[l] ? "Re-translate" : "Translate"} with AI</button>` : ""}</div>
    ${a[`body_${l}`] ? `<div class="hc-preview doc" dir="${l === "ar" ? "rtl" : "ltr"}"><h4 class="hc-ptitle">${esc(a[`title_${l}`] || "")}</h4>${md(a[`body_${l}`])}</div>` : `<p class="subtle s-small">Not written yet.</p>`}</section>`;
  const tr = a.translation ? `<section class="card card-pad hc-tr"><h3 class="s-small" style="margin:0">Translation draft → ${a.translation.lang === "ar" ? "Arabic" : "English"} ${a.translation.by_ai ? hcBadge("AI", "accent") : hcBadge("template", "warn")}</h3>
      ${a.translation.note ? `<p class="hc-note s-small">${esc(a.translation.note)}</p>` : ""}
      <form id="hcTrForm" class="stack" style="gap:8px;margin-top:10px"><input class="input" id="hct-title" dir="${a.translation.lang === "ar" ? "rtl" : "ltr"}" value="${esc(a.translation.title)}" aria-label="Translated title">
        <textarea class="input hc-body" id="hct-body" rows="8" dir="${a.translation.lang === "ar" ? "rtl" : "ltr"}" aria-label="Translated body">${esc(a.translation.body)}</textarea>
        <div class="row gap-8"><button class="btn btn-primary btn-sm" type="submit">Use this ${a.translation.lang === "ar" ? "Arabic" : "English"} version</button><button class="btn btn-sm btn-ghost" type="button" data-hcact="tr-discard">Discard</button></div></form></section>` : "";
  const log = (a.log || []).length ? `<details class="card card-pad"><summary class="s-small"><b>Change log</b> (${a.log.length})</summary><ul class="hc-ul">${a.log.slice().reverse().map((x) => `<li class="hc-li s-small"><span dir="auto">${esc(x.text)}</span><span class="subtle">${esc(x.by)} · ${esc(String(x.at).slice(0, 16).replace("T", " "))}</span></li>`).join("")}</ul></details>` : "";
  return `<div class="stack" style="gap:16px">${head}${tr}<div class="hc-langs">${lang("ar", "العربية")}${lang("en", "English")}</div>${log}</div>`;
}

/* ------------------------------------------------ gaps */
function hcGaps() {
  const g = HC.gaps || [];
  const rows = g.map((x) => `<li class="card card-pad hc-gap"><div class="row between gap-8" style="flex-wrap:wrap;align-items:flex-start"><div style="min-width:0"><b>${esc(x.name)}</b> <span class="subtle s-small" lang="ar" dir="rtl">${esc(x.name_ar)}</span>
      <div class="subtle s-small"><b class="num">${x.tickets}</b> ticket${x.tickets === 1 ? "" : "s"} in 90 days · ${x.resolved} resolved · no published article${x.tickets >= 5 ? " · " + hcBadge("in the Command Center", "warn") : ""}</div>
      ${x.examples.length ? `<ul class="hc-ex s-small">${x.examples.map((e) => `<li dir="auto">${esc(e)}</li>`).join("")}</ul>` : ""}</div>
      ${hcEdit() ? `<button class="btn btn-sm ${x.resolved ? "btn-primary" : ""}" data-hcact="gap-draft" data-cat="${esc(x.category)}" ${x.resolved ? "" : 'disabled title="Resolve a ticket on this topic first"'}>Draft from ${x.resolved} resolved ticket${x.resolved === 1 ? "" : "s"}</button>` : ""}</div></li>`).join("");
  return `<p class="subtle s-small" style="margin:0 0 12px">Support tickets from the last 90 days, grouped by topic, where no published public article exists yet. Topics with 5+ tickets show in the Command Center. Customer emails and phone numbers are hidden.</p>
    ${rows ? `<ul class="stack hc-gaps" style="gap:8px">${rows}</ul>` : `<div class="card empty"><p>No gaps: every ticket topic of the last 90 days has a published article (or there are no tickets yet).</p></div>`}`;
}

/* ------------------------------------------------ settings */
function hcSettings() {
  const m = HC.meta, s = m.settings, site = m.site, edit = hcEdit();
  return `<form id="hcSetForm" class="card card-pad stack hc-set" style="gap:14px">
    <div class="field"><label for="hcs-mail">Contact email for "Still need help?"</label><input class="input" id="hcs-mail" type="email" maxlength="200" value="${esc(s.contact_email)}" ${edit ? "" : "disabled"} placeholder="support@dpa.ad">
      <span class="hint">Used when the website chat is off. Now: ${m.support_link ? esc(m.support_link.startsWith("mailto:") ? m.support_link : "the website chat (AI Support → Website chat)") : "no link shown"}.</span></div>
    <label class="chip"><input type="checkbox" id="hcs-own" ${s.owner_self_publish ? "checked" : ""} ${edit ? "" : "disabled"}> The Owner may publish their own articles (everyone else needs a different reviewer)</label>
    <div class="field"><span class="eyebrow">Public site</span><p class="s-small" style="margin:4px 0 0"><a href="/help" target="_blank" rel="noopener">${esc(site.url)}</a> shows ${site.is_this ? "<b>this workspace</b>" : "another workspace"}${site.chosen ? "" : " (the first workspace, by default)"}.</p>
      ${site.can_choose && !site.is_this ? `<label class="chip" style="margin-top:8px"><input type="checkbox" id="hcs-site"> Show this workspace on the public site instead</label>` : ""}</div>
    ${edit ? `<div><button class="btn btn-primary" type="submit">Save</button></div>` : ""}</form>`;
}

/* ------------------------------------------------ actions */
function hcReadForm() {
  const v = (s) => $(s)?.value ?? "";
  const b = { category: v("#hcf-cat"), visibility: v("#hcf-vis"), title_ar: v("#hcf-tar"), title_en: v("#hcf-ten"), body_ar: v("#hcf-bar"), body_en: v("#hcf-ben") };
  if (v("#hcf-slug").trim()) b.slug = v("#hcf-slug").trim();
  const rel = $("#hcf-rel"); if (rel) b.related_ids = [...rel.selectedOptions].map((o) => o.value);
  return b;
}
async function hcAct(a, el) {
  const id = el.dataset.id;
  if (a === "open") { HC.editing = false; go("helpcenter", id); return; }
  if (a === "back") { HC.open = null; HC.editing = false; go("helpcenter", "articles"); return; }
  if (a === "edit") { HC.editing = true; HC.list ||= await api(`${hcP()}/articles`); $("#hcBody").innerHTML = hcDetail(HC.cur); const r = $("#hcf-rel"); if (r) [...r.options].forEach((o) => { o.selected = (HC.cur.related_ids || []).includes(o.value); }); return; }
  if (a === "cancel-edit") { HC.editing = false; return hcShow(); }
  const d = HC.cur;
  if (a === "move") { const to = el.dataset.to; if (to === "archived" && !confirm("Archive this article? It leaves the public site.")) return; await hcPost(`/articles/${d.id}/status`, { status: to }); toast(to === "published" ? "Published on the help site" : `Moved to ${hcStatus(to)}`); return hcShow(); }
  if (a === "reviewed") { await hcPost(`/articles/${d.id}/reviewed`); toast("Marked as re-reviewed today"); return hcShow(); }
  if (a === "delete") { if (!confirm("Delete this article? This can't be undone.")) return; await api(`${hcP()}/articles/${d.id}`, { method: "DELETE" }); toast("Deleted"); HC.open = null; go("helpcenter", "articles"); return; }
  if (a === "translate") { el.disabled = true; el.textContent = "Translating…"; try { await hcPost(`/articles/${d.id}/ai/translate`, { to: el.dataset.to }); } finally { el.disabled = false; } return hcShow(); }
  if (a === "tr-discard") { await hcPost(`/articles/${d.id}/translation`, { action: "discard" }); return hcShow(); }
  if (a === "gap-draft") { el.disabled = true; el.textContent = "Drafting…"; const r = await hcPost("/ai/draft", { source: "gap", category: el.dataset.cat }).finally(() => { el.disabled = false; }); toast(r.by_ai ? "AI draft ready: review it" : r.note || "Draft ready"); go("helpcenter", r.article.id); }
}
document.addEventListener("click", async (e) => {
  if (S.route !== "helpcenter") return;
  const t = e.target.closest("[data-hctab]");
  if (t) { HC.tab = t.dataset.hctab; HC.open = null; HC.editing = false; go("helpcenter", HC.tab); return; }
  const b = e.target.closest("[data-hcact]");
  if (b) { e.preventDefault(); try { await hcAct(b.dataset.hcact, b); } catch (err) { toast(err.message, true); } }
});
document.addEventListener("submit", async (e) => {
  if (S.route !== "helpcenter") return;
  const f = e.target;
  if (!f.matches("#hcForm, #hcFilter, #hcAiForm, #hcTrForm, #hcSetForm")) return;
  e.preventDefault();
  const v = (s) => $(s)?.value ?? "";
  try {
    if (f.id === "hcFilter") { HC.filter = { q: v("#hcq").trim(), status: v("#hcfs"), category: v("#hcfc") }; return hcShow(); }
    if (f.id === "hcForm") {
      const body = hcReadForm();
      if (f.dataset.id) { await hcPut(`/articles/${f.dataset.id}`, body); HC.editing = false; toast("Saved"); await hcShow(); }
      else { const a = await hcPost("/articles", body); toast("Draft added"); go("helpcenter", a.id); }
    }
    if (f.id === "hcAiForm") {
      if (!v("#hca-sa")) return toast("Pick a support article first", true);
      const btn = f.querySelector("button[type=submit]"); btn.disabled = true; btn.textContent = "Drafting…";
      const r = await hcPost("/ai/draft", { source: "support_article", support_article_id: v("#hca-sa"), category: v("#hca-cat") || undefined }).finally(() => { btn.disabled = false; btn.textContent = "Draft the article"; });
      toast(r.by_ai ? "AI draft ready: review it" : r.note || "Draft ready"); go("helpcenter", r.article.id);
    }
    if (f.id === "hcTrForm") { await hcPost(`/articles/${HC.cur.id}/translation`, { action: "apply", title: v("#hct-title"), body: v("#hct-body") }); toast("Translation added"); await hcShow(); }
    if (f.id === "hcSetForm") {
      const body = { contact_email: v("#hcs-mail").trim(), owner_self_publish: !!$("#hcs-own")?.checked };
      if ($("#hcs-site")?.checked) body.public_site = true;
      await hcPut("/settings", body); toast("Settings saved"); await hcShow();
    }
  } catch (err) { toast(err.message, true); }
});

if (S.route === "helpcenter" && S.ws) render();
