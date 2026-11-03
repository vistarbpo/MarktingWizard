/* Changelog ("What's new"): customer-facing entries in Arabic and English, published on the public site /changelog
   (no login) with RSS and JSON Feed. Entries move draft → in review → published → archived; a different person than
   the author reviews and publishes (the Owner may self-publish unless switched off); [ADD] blocks publishing.
   The AI Release notes writer (drafts only) drafts from a shipped release and its roadmap items and translates AR↔EN.
   Requesters of the linked roadmap items get one draft email each; a person sends it through the Store CRM.
   Access module: Product. Uses app.js globals (S, $, api, esc, md, toast, ROUTES, levelFor, go). Names start with "cl". */

const CL = { tab: "entries", meta: null, list: null, cur: null, open: null, editing: false, filter: { q: "", status: "", type: "", tag: "" }, req: null };
const CL_TABS = [["entries", "Entries"], ["settings", "Settings"]];
const CL_TONE = { draft: "", in_review: "warn", published: "good", archived: "" };
const CL_KIND = { new: "accent", improved: "warn", fixed: "good", announcement: "" };
const CL_MOVE = { in_review: "Send for review", published: "Publish", draft: "Back to draft", archived: "Archive" };
const clP = () => `/api/workspaces/${S.ws.id}/changelog`;
const clEdit = () => levelFor("changelog") === "edit";
const clPost = (p, b) => api(`${clP()}${p}`, { method: "POST", body: JSON.stringify(b || {}) });
const clPut = (p, b) => api(`${clP()}${p}`, { method: "PUT", body: JSON.stringify(b || {}) });
const clOpts = (list, cur, empty) => `${empty !== undefined ? `<option value="">${esc(empty)}</option>` : ""}${list.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(cur ?? "") ? "selected" : ""}>${esc(l)}</option>`).join("")}`;
const clBadge = (t, tone = "") => `<span class="badge ${tone}">${esc(t)}</span>`;
const clType = (id) => CL.meta?.types.find((x) => x.id === id)?.en || id;
const clTag = (id) => CL.meta?.tags.find((x) => x.id === id)?.en || id;
const clStatus = (id) => CL.meta?.statuses.find((x) => x.id === id)?.name || id;
const clTitle = (e) => e.title_en || e.title_ar || "(untitled)";
const clTile = (l, v, sub, tone = "") => `<div class="card s-kpi ${tone}"><span class="eyebrow">${esc(l)}</span><b class="num">${esc(v)}</b><span class="subtle">${esc(sub)}</span></div>`;
const clLangs = (e) => `${e.langs.ar ? clBadge("AR", "accent") : ""}${e.langs.en ? clBadge("EN", "accent") : ""}`;

ROUTES.changelog = { title: "Changelog", crumb: "Product", render: renderChangelog };

async function renderChangelog(view) {
  if (CL_TABS.some(([k]) => k === S.param)) { CL.tab = S.param; CL.open = null; }
  else if (S.param && /^\d+$/.test(S.param)) { CL.tab = "entries"; CL.open = S.param; }
  $("#pageActions").innerHTML = "";
  view.innerHTML = `<div class="s-tabs cl-tabs" role="tablist" aria-label="Changelog views">${CL_TABS.map(([k, l]) => `<button role="tab" data-cltab="${k}" aria-selected="${CL.tab === k}">${l}</button>`).join("")}</div>
    <div id="clBody" style="margin-top:16px"><p class="muted">Loading…</p></div>`;
  try { CL.meta = await api(`${clP()}/meta`); } catch (e) { $("#clBody").innerHTML = `<div class="card empty"><p>${esc(e.message)}</p></div>`; return; }
  await clShow();
}
async function clShow() {
  if (S.route !== "changelog") return;
  document.querySelectorAll("[data-cltab]").forEach((b) => b.setAttribute("aria-selected", b.dataset.cltab === CL.tab));
  const box = $("#clBody"); if (!box) return;
  try {
    if (CL.tab === "settings") { CL.meta = await api(`${clP()}/meta`); box.innerHTML = clSettings(); return; }
    if (CL.open) {
      const e = await api(`${clP()}/entries/${CL.open}`).catch(() => null);
      if (e) { CL.cur = e; CL.req = (e.item_ids || []).length ? await api(`${clP()}/entries/${e.id}/requesters`).catch(() => null) : null; box.innerHTML = clDetail(e); clPickRel(); return; }
      CL.open = null;
    }
    const q = new URLSearchParams(Object.entries(CL.filter).filter(([, v]) => v)).toString();
    CL.list = await api(`${clP()}/entries${q ? "?" + q : ""}`); box.innerHTML = clList();
  } catch (e) { box.innerHTML = `<div class="card empty"><p>${esc(e.message)}</p></div>`; }
}
const clSiteNote = () => { const s = CL.meta.site; return `<p class="cl-banner s-small" role="note"><span>Public page: <a href="/changelog" target="_blank" rel="noopener">${esc(s.url)}</a> · <a href="/changelog/rss.xml" target="_blank" rel="noopener">RSS</a> · <a href="/changelog/feed.json" target="_blank" rel="noopener">JSON Feed</a></span><span>${s.is_this ? "Shows this workspace's published entries." : "Shows another workspace (chosen in Help center → Settings)."} Drafts never appear there.</span></p>`; };

/* ------------------------------------------------ list: tiles, releases waiting, new entry, filters, rows */
function clList() {
  const d = CL.list, t = d.totals, m = CL.meta, f = CL.filter, edit = clEdit();
  const waiting = d.releases.filter((r) => !r.entry_id);
  const tiles = [clTile("Published", t.published, `${t.all} entries in all`), clTile("In review", t.in_review, "waiting for a reviewer", t.in_review ? "warn" : ""),
    clTile("Drafts", t.drafts, "not on the site"), clTile("Releases waiting", waiting.length, "shipped, no entry yet", waiting.length ? "warn" : "")];
  const rels = waiting.length ? `<section class="card card-pad"><h3 class="s-small" style="margin:0 0 8px">Shipped releases without an entry</h3><ul class="cl-ul">${waiting.slice(0, 8).map((r) => `<li class="cl-li"><span><b>${esc(r.version)}</b> <span class="subtle s-small">shipped ${esc(r.date || "–")} · ${r.items} item${r.items === 1 ? "" : "s"}</span></span>
      ${edit ? `<button class="btn btn-sm btn-primary" data-clact="from-release" data-id="${esc(r.id)}">Draft changelog entry</button>` : ""}</li>`).join("")}</ul>
      <p class="subtle s-small" style="margin:8px 0 0">The AI Release notes writer${m.agent_level === 0 ? " is switched off in AI Workforce: you get the factual draft" : " drafts from the release and its roadmap items only"}, with [ADD] for anything missing. A different person reviews and publishes.</p></section>` : "";
  const add = edit ? `<details class="card card-pad cl-new" ${t.all || waiting.length ? "" : "open"}><summary><b>New entry</b></summary>${clForm(null)}</details>` : "";
  const filters = `<form id="clFilter" class="cl-filters" role="search">
    <input class="input input-sm" id="clq" type="search" placeholder="Search (Arabic or English)" value="${esc(f.q)}" aria-label="Search">
    <select class="input input-sm" id="clfs" aria-label="Status">${clOpts(m.statuses.map((x) => [x.id, x.name]), f.status, "All statuses")}</select>
    <select class="input input-sm" id="clft" aria-label="Type">${clOpts(m.types.map((x) => [x.id, x.en]), f.type, "All types")}</select>
    <select class="input input-sm" id="clfg" aria-label="Tag">${clOpts(m.tags.map((x) => [x.id, x.en]), f.tag, "All tags")}</select>
    <button class="btn btn-sm" type="submit">Filter</button></form>`;
  const rows = d.entries.map((e) => `<button class="card cl-row" data-clact="open" data-id="${esc(e.id)}">
      <span class="cl-row-main"><b dir="auto" class="cl-wrap">${esc(clTitle(e))}</b>${e.title_ar && e.title_en ? `<span dir="rtl" lang="ar" class="subtle s-small cl-wrap">${esc(e.title_ar)}</span>` : ""}
        <span class="subtle s-small"><span class="num">${esc(e.date || "")}</span> · /changelog/${esc(e.slug)}${e.tags.length ? ` · ${esc(e.tags.map(clTag).join(", "))}` : ""}</span></span>
      <span class="cl-row-side">${clBadge(clType(e.type), CL_KIND[e.type])}${clBadge(clStatus(e.status), CL_TONE[e.status])}${clLangs(e)}${e.has_add ? clBadge("[ADD] left", "warn") : ""}${e.by_ai ? clBadge("AI draft", "accent") : ""}${e.sample ? clBadge("sample", "warn") : ""}
        <span class="subtle s-small">By ${esc(e.author_name || "–")}${e.reviewer_name ? ` · reviewed by ${esc(e.reviewer_name)}` : ""}</span></span></button>`).join("");
  return `${clSiteNote()}<section class="s-kpis">${tiles.join("")}</section>
    <div class="stack" style="gap:16px;margin-top:16px">${rels}${add}${filters}
    ${rows ? `<div class="stack" style="gap:8px">${rows}</div>` : `<div class="card empty"><p>${t.all ? "Nothing matches these filters." : "No changelog entries yet. Ship a release in Product → Releases and draft its entry here, or write one by hand."}</p></div>`}</div>`;
}
function clForm(e) {
  const m = CL.meta, tags = new Set(e?.tags || []);
  const img = e?.image || "", media = m.media.some((x) => x.url === img) || !img ? m.media : [{ url: img, name: img }, ...m.media];
  return `<form id="clForm" class="cl-form" data-id="${esc(e?.id || "")}" style="margin-top:12px">
    <div class="field"><label for="clf-type">Type</label><select class="input" id="clf-type">${clOpts(m.types.map((x) => [x.id, `${x.en} · ${x.ar}`]), e?.type || "new")}</select></div>
    <div class="field"><label for="clf-date">Date</label><input class="input" id="clf-date" type="date" value="${esc(e?.date || m.today)}"></div>
    <fieldset class="field cl-wide cl-tags"><legend class="s-small">Tags</legend>${m.tags.map((x) => `<label class="chip"><input type="checkbox" data-cltag="${esc(x.id)}" ${tags.has(x.id) ? "checked" : ""}> ${esc(x.en)}</label>`).join("")}</fieldset>
    <div class="field" lang="ar"><label for="clf-tar">العنوان (عربي)</label><input class="input" id="clf-tar" maxlength="200" dir="rtl" value="${esc(e?.title_ar || "")}"></div>
    <div class="field"><label for="clf-ten">Title (English)</label><input class="input" id="clf-ten" maxlength="200" dir="ltr" value="${esc(e?.title_en || "")}"></div>
    <div class="field" lang="ar"><label for="clf-bar">النص (عربي)</label><textarea class="input cl-body" id="clf-bar" rows="8" dir="rtl">${esc(e?.body_ar || "")}</textarea></div>
    <div class="field"><label for="clf-ben">Body (English)</label><textarea class="input cl-body" id="clf-ben" rows="8" dir="ltr">${esc(e?.body_en || "")}</textarea></div>
    <p class="hint cl-wide" style="margin:0">Markdown: ## heading, - list, **bold**, *italic*, [link](https://…). No HTML: it shows as text. Lead with what the merchant can do now; no numbers or names you can't back up.</p>
    <div class="field"><label for="clf-rel">Release</label><select class="input" id="clf-rel">${clOpts(m.all_releases.map((r) => [r.id, `${r.version} (${r.status === "released" ? `shipped ${r.date || ""}` : "draft"})`]), e?.release_id || "", "No release")}</select></div>
    <div class="field"><label for="clf-img">Image (Creative Studio media)</label><select class="input" id="clf-img">${clOpts(media.map((x) => [x.url, x.name]), img, media.length ? "No image" : "No images in Creative Studio yet")}</select></div>
    <div class="field cl-wide"><label for="clf-items">Roadmap items</label><select class="input cl-multi" id="clf-items" multiple size="4">${clOpts(m.items.map((i) => [i.id, `${i.title} (${i.status})`]), "")}</select><span class="hint">Ctrl/⌘-click to pick. Their requesters can be told when it's published.</span></div>
    <div class="field cl-wide"><label for="clf-slug">Link (slug)</label><input class="input" id="clf-slug" maxlength="80" dir="ltr" value="${esc(e?.slug || "")}" placeholder="made from the English title"><span class="hint">/changelog/&lt;slug&gt;: lowercase letters, digits and hyphens.</span></div>
    <div class="row gap-8 cl-wide"><button class="btn btn-primary" type="submit">${e ? "Save" : "Add draft"}</button>${e ? `<button class="btn" type="button" data-clact="cancel-edit">Cancel</button>` : ""}</div></form>`;
}
// Multi-select values can't be set in markup without one string per option: select the entry's items after render.
function clPickRel() { const s = $("#clf-items"); if (s && CL.cur) [...s.options].forEach((o) => { o.selected = (CL.cur.item_ids || []).includes(o.value); }); }

/* ------------------------------------------------ one entry */
function clDetail(e) {
  const edit = clEdit(), locked = e.status === "published";
  const moves = edit ? e.next.map((s) => `<button class="btn btn-sm ${s === "published" ? "btn-primary" : ""}" data-clact="move" data-to="${s}" ${s === "published" && (e.publish_block || e.has_add) ? `disabled title="${esc(e.publish_block || "Fill in every [ADD] first")}"` : ""}>${esc(CL_MOVE[s] || s)}</button>`).join("") : "";
  const head = CL.editing && edit && !locked ? `<section class="card card-pad">${clForm(e)}</section>` : `<section class="card card-pad cl-head">
    <button class="cl-link s-small" data-clact="back">← All entries</button>
    <h2 style="margin:6px 0 0" dir="auto">${esc(clTitle(e))}</h2>${e.title_ar && e.title_en ? `<p dir="rtl" lang="ar" style="margin:2px 0 0" class="subtle">${esc(e.title_ar)}</p>` : ""}
    <div class="cl-meta s-small">${clBadge(clType(e.type), CL_KIND[e.type])}${clBadge(clStatus(e.status), CL_TONE[e.status])}${clLangs(e)}${e.has_add ? clBadge("[ADD] left: can't publish", "warn") : ""}${e.by_ai ? clBadge("AI draft", "accent") : ""}${e.sample ? clBadge("sample", "warn") : ""}
      <span class="num">${esc(e.date || "")}</span>${(e.tags || []).map((x) => `<span class="subtle">#${esc(clTag(x))}</span>`).join("")}${e.live_url ? `<a href="/changelog/${esc(e.slug)}" target="_blank" rel="noopener">View on the site ↗</a>` : `<span class="subtle">/changelog/${esc(e.slug)}</span>`}</div>
    <div class="cl-meta s-small subtle"><span>Author: ${esc(e.author_name || "–")}</span>${e.reviewer_name ? `<span>Reviewer: ${esc(e.reviewer_name)}</span>` : ""}${e.release ? `<span>Release: <b>${esc(e.release.version)}</b>${e.release.missing ? "" : ` (${esc(e.release.status === "released" ? `shipped ${e.release.date || ""}` : "draft")})`}</span>` : ""}
      ${e.items.length ? `<span>Roadmap: ${e.items.map((i) => esc(i.title)).join(", ")}</span>` : ""}</div>
    ${e.image ? `<img class="cl-img" src="${esc(e.image)}" alt="">` : ""}
    ${e.ai_note ? `<p class="cl-note s-small">${esc(e.ai_note)}</p>` : ""}${e.status === "in_review" && e.publish_block ? `<p class="cl-note s-small">${esc(e.publish_block)}</p>` : ""}${locked ? `<p class="subtle s-small" style="margin:8px 0 0">Published text is locked. Move it back to draft to change it (it leaves the site until it's reviewed again).</p>` : ""}
    ${edit ? `<div class="row gap-8 cl-acts">${!locked ? `<button class="btn btn-sm" data-clact="edit">Edit</button>` : ""}${e.status === "draft" && (e.release || e.items.length) ? `<button class="btn btn-sm" data-clact="ai-notes">Rewrite with AI from the release</button>` : ""}${moves}${e.status !== "published" ? `<button class="btn btn-sm btn-ghost btn-danger" data-clact="delete">Delete</button>` : ""}</div>` : ""}</section>`;
  const lang = (l, name) => `<section class="card card-pad cl-lang" ${l === "ar" ? 'lang="ar"' : ""}><div class="row between gap-8" style="flex-wrap:wrap"><h3 class="s-small" style="margin:0">${name}</h3>
      ${edit && !locked && e.langs[l === "ar" ? "en" : "ar"] ? `<button class="btn btn-sm" data-clact="translate" data-to="${l}">${e.langs[l] ? "Re-translate" : "Translate"} with AI</button>` : ""}</div>
    ${e[`body_${l}`] ? `<div class="cl-preview doc" dir="${l === "ar" ? "rtl" : "ltr"}"><h4 class="cl-ptitle">${esc(e[`title_${l}`] || "")}</h4>${md(e[`body_${l}`])}</div>` : `<p class="subtle s-small">Not written yet.</p>`}</section>`;
  const tr = e.translation ? `<section class="card card-pad"><h3 class="s-small" style="margin:0">Translation draft → ${e.translation.lang === "ar" ? "Arabic" : "English"} ${e.translation.by_ai ? clBadge("AI", "accent") : clBadge("template", "warn")}</h3>
      ${e.translation.note ? `<p class="cl-note s-small">${esc(e.translation.note)}</p>` : ""}
      <form id="clTrForm" class="stack" style="gap:8px;margin-top:10px"><input class="input" id="clt-title" dir="${e.translation.lang === "ar" ? "rtl" : "ltr"}" value="${esc(e.translation.title)}" aria-label="Translated title">
        <textarea class="input cl-body" id="clt-body" rows="6" dir="${e.translation.lang === "ar" ? "rtl" : "ltr"}" aria-label="Translated body">${esc(e.translation.body)}</textarea>
        <div class="row gap-8"><button class="btn btn-primary btn-sm" type="submit">Use this ${e.translation.lang === "ar" ? "Arabic" : "English"} version</button><button class="btn btn-sm btn-ghost" type="button" data-clact="tr-discard">Discard</button></div></form></section>` : "";
  const log = (e.log || []).length ? `<details class="card card-pad"><summary class="s-small"><b>Change log</b> (${e.log.length})</summary><ul class="cl-ul">${e.log.slice().reverse().map((x) => `<li class="cl-li s-small"><span dir="auto">${esc(x.text)}</span><span class="subtle">${esc(x.by)} · ${esc(String(x.at).slice(0, 16).replace("T", " "))}</span></li>`).join("")}</ul></details>` : "";
  return `<div class="stack" style="gap:16px">${head}${tr}<div class="cl-langs">${lang("ar", "العربية")}${lang("en", "English")}</div>${clRequesters(e)}${log}</div>`;
}
function clRequesters(e) {
  const r = CL.req;
  if (!e.items.length) return "";
  const list = r?.requesters || [], edit = clEdit(), ready = list.filter((x) => x.ready).length;
  const rows = list.map((x) => `<li class="cl-li s-small"><span class="cl-wrap"><b dir="auto">${esc(x.store_name)}</b>${x.stage ? ` <span class="subtle">${esc(x.stage.replace(/_/g, " "))}</span>` : ""}<br><span class="subtle" dir="auto">“${esc(x.feedback[0]?.text || "")}”${x.feedback.length > 1 ? ` +${x.feedback.length - 1} more` : ""}</span></span>
      <span>${x.ready ? clBadge("ready", "good") : clBadge(x.reason, x.notice_id ? "" : "warn")}</span></li>`).join("");
  const notices = e.notices.map((n) => `<li class="cl-notice card card-pad"><div class="row between gap-8" style="flex-wrap:wrap"><b dir="auto">${esc(n.store_name)}</b>${clBadge(n.status === "test" ? "test: logged in the CRM, not sent" : n.status, n.status === "sent" ? "good" : n.status === "draft" ? "accent" : n.status === "test" ? "" : "warn")}</div>
      ${n.status === "draft" && edit ? `<form class="stack cl-nform" data-nid="${esc(n.id)}" style="gap:6px;margin-top:8px"><input class="input input-sm" name="subject" dir="auto" value="${esc(n.subject)}" aria-label="Subject"><textarea class="input cl-body" name="body" rows="6" dir="auto" aria-label="Message">${esc(n.body)}</textarea>
        <div class="row gap-8" style="flex-wrap:wrap"><button class="btn btn-sm" type="submit">Save</button>${CL.meta.crm_send ? `<button class="btn btn-sm btn-primary" type="button" data-clact="send" data-id="${esc(n.id)}">Send through the Store CRM</button>` : `<span class="subtle s-small">Sending needs Store CRM edit: copy it instead.</span>`}<button class="btn btn-sm btn-ghost btn-danger" type="button" data-clact="nt-del" data-id="${esc(n.id)}">Delete</button></div></form>`
        : `<p class="subtle s-small" style="margin:6px 0 0">${esc(n.error || "")}${n.sent_by ? ` · ${esc(n.sent_by)}` : ""}</p>`}</li>`).join("");
  return `<section class="card card-pad"><div class="row between gap-8" style="flex-wrap:wrap;align-items:flex-start"><div><h3 class="s-small" style="margin:0">Who asked for this</h3>
      <p class="subtle s-small" style="margin:4px 0 0">Stores whose feedback is linked to these roadmap items. Each gets one draft email (Arabic, then English) to check; a person sends it through the Store CRM, with every outreach rule (${r?.mode === "live" ? "Live mode" : "Test mode: logged, not sent"}, opt-outs, 09:00–21:00 Riyadh, not Friday, sample stores never). Nothing is sent by itself.</p></div>
      ${edit && ready ? `<button class="btn btn-sm btn-primary" data-clact="notify" ${e.live ? "" : 'disabled title="Publish the entry first: the email links to it"'}>Draft ${ready} email${ready === 1 ? "" : "s"}</button>` : ""}</div>
    ${rows ? `<ul class="cl-ul">${rows}</ul>` : `<p class="subtle s-small">No feedback is linked to these roadmap items yet (Product → Feedback).</p>`}
    ${notices ? `<ul class="stack cl-notices" style="gap:8px;margin-top:12px">${notices}</ul>` : ""}</section>`;
}

/* ------------------------------------------------ settings */
function clSettings() {
  const m = CL.meta, s = m.settings, edit = clEdit();
  return `<form id="clSetForm" class="card card-pad stack cl-set" style="gap:14px">
    <label class="chip"><input type="checkbox" id="cls-own" ${s.owner_self_publish ? "checked" : ""} ${edit ? "" : "disabled"}> The Owner may publish their own entries (everyone else needs a different reviewer)</label>
    <div class="field"><span class="eyebrow">Public page</span><p class="s-small" style="margin:4px 0 0"><a href="/changelog" target="_blank" rel="noopener">${esc(m.site.url)}</a> shows ${m.site.is_this ? "<b>this workspace</b>" : "another workspace"}: the same one as the public help center (Help center → Settings). Feeds: <a href="/changelog/rss.xml" target="_blank" rel="noopener">RSS</a> and <a href="/changelog/feed.json" target="_blank" rel="noopener">JSON Feed</a>.</p></div>
    <p class="subtle s-small" style="margin:0">Command Center: a shipped release with no entry after ${m.ship_days} days, and an entry in review for ${m.review_days}+ days.</p>
    ${edit ? `<div><button class="btn btn-primary" type="submit">Save</button></div>` : ""}</form>`;
}

/* ------------------------------------------------ actions */
function clReadForm() {
  const v = (s) => $(s)?.value ?? "";
  const b = { type: v("#clf-type"), date: v("#clf-date"), title_ar: v("#clf-tar"), title_en: v("#clf-ten"), body_ar: v("#clf-bar"), body_en: v("#clf-ben"), release_id: v("#clf-rel") || null, image: v("#clf-img"),
    tags: [...document.querySelectorAll("[data-cltag]:checked")].map((x) => x.dataset.cltag), item_ids: [...($("#clf-items")?.selectedOptions || [])].map((o) => o.value) };
  if (v("#clf-slug").trim()) b.slug = v("#clf-slug").trim();
  return b;
}
async function clFromRelease(id, el) {
  if (el) { el.disabled = true; el.textContent = "Drafting…"; }
  try {
    const r = await api(`${clP()}/from-release/${id}`, { method: "POST", body: "{}" });
    toast(r.by_ai ? "AI draft ready: review it" : r.note || "Draft ready");
    go("changelog", r.entry.id);
  } catch (err) { if (el) { el.disabled = false; el.textContent = "Draft changelog entry"; } throw err; }
}
async function clAct(a, el) {
  const id = el.dataset.id;
  if (a === "open") { CL.editing = false; go("changelog", id); return; }
  if (a === "back") { CL.open = null; CL.editing = false; go("changelog", "entries"); return; }
  if (a === "from-release") return clFromRelease(id, el);
  if (a === "edit") { CL.editing = true; $("#clBody").innerHTML = clDetail(CL.cur); clPickRel(); return; }
  if (a === "cancel-edit") { CL.editing = false; return clShow(); }
  const e = CL.cur;
  if (a === "move") { const to = el.dataset.to; if (to === "archived" && !confirm("Archive this entry? It leaves the public changelog.")) return; await clPost(`/entries/${e.id}/status`, { status: to }); toast(to === "published" ? "Published on the changelog" : `Moved to ${clStatus(to)}`); return clShow(); }
  if (a === "delete") { if (!confirm("Delete this entry? This can't be undone.")) return; await api(`${clP()}/entries/${e.id}`, { method: "DELETE" }); toast("Deleted"); CL.open = null; go("changelog", "entries"); return; }
  if (a === "ai-notes") { el.disabled = true; el.textContent = "Writing…"; const r = await clPost(`/entries/${e.id}/ai/notes`).finally(() => { el.disabled = false; }); toast(r.by_ai ? "AI notes ready: review them" : r.note || "Draft ready"); return clShow(); }
  if (a === "translate") { el.disabled = true; el.textContent = "Translating…"; try { await clPost(`/entries/${e.id}/ai/translate`, { to: el.dataset.to }); } finally { el.disabled = false; } return clShow(); }
  if (a === "tr-discard") { await clPost(`/entries/${e.id}/translation`, { action: "discard" }); return clShow(); }
  if (a === "notify") { const r = await clPost(`/entries/${e.id}/notify`); toast(`${r.created} draft email${r.created === 1 ? "" : "s"} ready to check${r.skipped.length ? ` · ${r.skipped.length} skipped` : ""}`); return clShow(); }
  if (a === "send") { if (!confirm("Send this email through the Store CRM? In Test mode it is only logged.")) return; const r = await clPost(`/notices/${id}/send`).catch((err) => { toast(err.message, true); return null; }); if (r) toast(r.message.status === "sent" ? "Sent" : "Logged in the Store CRM (Test mode: not sent)"); return clShow(); }
  if (a === "nt-del") { await api(`${clP()}/notices/${id}`, { method: "DELETE" }); toast("Draft deleted"); return clShow(); }
}
document.addEventListener("click", async (e) => {
  // Product → Releases: "Draft changelog entry" on a shipped release.
  const rel = e.target.closest("[data-clrel]");
  if (rel && S.route === "product") { e.preventDefault(); try { await clFromRelease(rel.dataset.clrel, rel); } catch (err) { toast(err.message, true); } return; }
  if (S.route !== "changelog") return;
  const t = e.target.closest("[data-cltab]");
  if (t) { CL.tab = t.dataset.cltab; CL.open = null; CL.editing = false; go("changelog", CL.tab); return; }
  const b = e.target.closest("[data-clact]");
  if (b) { e.preventDefault(); try { await clAct(b.dataset.clact, b); } catch (err) { toast(err.message, true); } }
});
document.addEventListener("submit", async (e) => {
  if (S.route !== "changelog") return;
  const f = e.target;
  if (!f.matches("#clForm, #clFilter, #clTrForm, #clSetForm, .cl-nform")) return;
  e.preventDefault();
  const v = (s) => $(s)?.value ?? "";
  try {
    if (f.id === "clFilter") { CL.filter = { q: v("#clq").trim(), status: v("#clfs"), type: v("#clft"), tag: v("#clfg") }; return clShow(); }
    if (f.id === "clForm") {
      const body = clReadForm();
      if (f.dataset.id) { await clPut(`/entries/${f.dataset.id}`, body); CL.editing = false; toast("Saved"); await clShow(); }
      else { const x = await clPost("/entries", body); toast("Draft added"); go("changelog", x.id); }
    }
    if (f.id === "clTrForm") { await clPost(`/entries/${CL.cur.id}/translation`, { action: "apply", title: v("#clt-title"), body: v("#clt-body") }); toast("Translation added"); await clShow(); }
    if (f.id === "clSetForm") { await clPut("/settings", { owner_self_publish: !!$("#cls-own")?.checked }); toast("Settings saved"); await clShow(); }
    if (f.matches(".cl-nform")) { await clPut(`/notices/${f.dataset.nid}`, { subject: f.elements.subject.value, body: f.elements.body.value }); toast("Saved"); await clShow(); }
  } catch (err) { toast(err.message, true); }
});

if (S.route === "changelog" && S.ws) render();
