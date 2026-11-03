/* Creative Studio: calendar with Saudi seasons, board by status, idea bank, email designer,
   brand kit, AI copy in Arabic and English, approvals and "download and post" (phase 1).
   Phases 2-3 add tabs and drawer sections from studio-media.js (Assets, templates, reels) and
   studio-publish.js (Accounts, publishing, Results) through CS_TABS and CS_DRAWER_HOOKS.
   Uses app.js globals (S, $, api, esc, toast, fmtDate, ROUTES, levelFor). */

const CS = { meta: null, items: [], counts: {}, due: [], tab: "calendar", month: null, openId: null, chTab: null, draft: null };
const CS_STATUS_TONE = { idea: "", draft: "", review: "warn", approved: "good", scheduled: "accent", published: "good", archived: "" };
const csP = () => `/api/workspaces/${S.ws.id}/creative`;
const csEdit = () => levelFor("studio") === "edit";
const csCh = (id) => CS.meta.channels.find((c) => c.id === id);
const csShort = { ig_post: "IG", ig_carousel: "IG▦", ig_reel: "Reel", ig_story: "Story", tiktok: "TikTok", snapchat: "Snap", yt_short: "Short", yt_video: "YT", fb_post: "FB", linkedin: "in", x: "X", email: "Email", whatsapp: "WA" };

ROUTES.studio = { title: "Creative Studio", crumb: "Creative Studio", render: renderStudio };
// Tabs in order; later scripts add theirs (key, label, render function returning HTML, optional after-render).
const CS_TABS = [{ key: "calendar", label: "Calendar", view: () => csCalendar() }, { key: "board", label: "Board", view: () => csBoard() }, { key: "ideas", label: "Ideas", view: () => csIdeas() }, { key: "emails", label: "Emails", view: () => csEmails() }];
const CS_TABS_END = [{ key: "brand", label: "Brand kit", view: () => csBrand() }];
const csTabs = () => [...CS_TABS, ...CS_TABS_END];
const CS_DRAWER_HOOKS = []; // functions(item, channel) run after the drawer renders

async function csLoad() {
  if (!CS.meta) CS.meta = await api(`${csP()}/meta`);
  const d = await api(`${csP()}/items`);
  CS.items = d.items; CS.counts = d.counts; CS.due = d.post_today;
  if (!CS.month) CS.month = CS.meta.today.slice(0, 7);
}

async function renderStudio(view) {
  view.innerHTML = `<p class="muted">Loading…</p>`;
  CS.meta = null; await csLoad();
  if (S.param && csTabs().some((t) => t.key === S.param)) CS.tab = S.param;
  $("#pageActions").innerHTML = `<div class="s-tabs" role="tablist" aria-label="Creative Studio views">
    ${csTabs().map((t) => `<button role="tab" data-cstab="${t.key}" aria-selected="${CS.tab === t.key}">${t.label}</button>`).join("")}</div>
    ${csEdit() ? `<button class="btn" data-csact="plan">Plan month with AI</button><button class="btn btn-primary" data-csact="new">New content</button>` : ""}`;
  view.innerHTML = `<div id="csBody"></div>`;
  csRerender();
}

function csRerender() {
  if (S.route !== "studio") return;
  document.querySelectorAll("[data-cstab][role=tab]").forEach((b) => b.setAttribute("aria-selected", b.dataset.cstab === CS.tab));
  const due = CS.items.filter((i) => CS.due.includes(i.id));
  const banner = due.length ? `<div class="card c-banner" style="margin-bottom:16px"><b>Post today (${due.length}):</b> ${due.map((i) => `<button class="linklike" data-csopen="${i.id}">${esc(i.title)}</button>`).join(", ")}. Open each, download the pack, post it, then tap "Mark posted".</div>` : "";
  const review = CS.counts.review ? `<div class="card c-banner" style="margin-bottom:16px;border-color:var(--accent)"><b>${CS.counts.review} waiting for approval.</b> ${CS.meta.can_approve ? "You can approve them on the Board." : "An approver needs to review them."} <button class="btn btn-sm btn-ghost" data-cstab="board">Board</button></div>` : "";
  const tab = csTabs().find((t) => t.key === CS.tab) || csTabs()[0];
  $("#csBody").innerHTML = banner + review + tab.view();
  tab.after?.();
}

/* ------------------------------------------------ Calendar (weeks start Sunday, Saudi-style) */
function csChip(i) {
  return `<button class="cs-chip st-${i.status}" data-csopen="${i.id}" title="${esc(i.title)} · ${esc(i.status)}"><span dir="auto">${esc(i.title)}</span><small>${(i.channels || []).slice(0, 3).map((c) => csShort[c]).join(" · ")}${i.channels?.length > 3 ? " +" + (i.channels.length - 3) : ""}</small></button>`;
}
function csCalendar() {
  const [y, m] = CS.month.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1)), days = new Date(Date.UTC(y, m, 0)).getUTCDate(), pad = first.getUTCDay();
  const ymd = (d) => `${CS.month}-${String(d).padStart(2, "0")}`;
  const byDay = {}, seasons = {};
  for (const i of CS.items) if (i.date?.startsWith(CS.month) && i.status !== "archived") (byDay[i.date] ||= []).push(i);
  for (const s of CS.meta.seasons) { if (s.date.startsWith(CS.month)) (seasons[s.date] ||= []).push({ ...s, kind: "day" }); if (!s.minor && s.prepare_from.startsWith(CS.month) && s.prepare_from !== s.date) (seasons[s.prepare_from] ||= []).push({ ...s, kind: "prep" }); }
  const label = first.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
  const cells = [];
  for (let k = 0; k < pad; k++) cells.push(`<div class="cs-day off"></div>`);
  for (let d = 1; d <= days; d++) {
    const date = ymd(d), isToday = date === CS.meta.today, fri = (pad + d - 1) % 7 === 5;
    cells.push(`<div class="cs-day ${isToday ? "today" : ""} ${fri ? "fri" : ""}" data-csday="${date}"><div class="cs-dnum">${d}</div>
      ${(seasons[date] || []).map((s) => `<div class="cs-season ${s.kind} ${s.minor ? "minor" : ""}" title="${esc(s.name)}${s.approx ? " (approx, moon sighting)" : ""}">${s.kind === "prep" ? "Prepare: " : ""}${esc(s.name.split(" (")[0])}${s.approx ? "*" : ""}</div>`).join("")}
      ${(byDay[date] || []).map(csChip).join("")}</div>`);
  }
  const unscheduled = CS.items.filter((i) => !i.date && !["archived", "published"].includes(i.status));
  const upcoming = CS.meta.seasons.filter((s) => !s.minor && s.date >= CS.meta.today).slice(0, 4);
  return `<div class="cs-cal-wrap"><div class="card"><div class="card-head"><div class="row gap-8"><button class="btn btn-sm" data-csmonth="-1" aria-label="Previous month">‹</button><h2 style="min-width:150px;text-align:center">${label}</h2><button class="btn btn-sm" data-csmonth="1" aria-label="Next month">›</button></div>
      <span class="subtle s-small">* Hijri dates are approximate (moon sighting). Click a day to add content.</span></div>
    <div class="cs-week">${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => `<div>${d}</div>`).join("")}</div>
    <div class="cs-grid">${cells.join("")}</div></div>
    <aside class="stack"><div class="card card-pad"><span class="eyebrow">Coming up</span>${upcoming.map((s) => `<div class="cs-up"><b>${esc(s.name)}</b><span class="subtle s-small">${fmtDay(s.date)}${s.approx ? " (approx)" : ""} · start preparing ${fmtDay(s.prepare_from)}</span></div>`).join("") || `<p class="muted s-small">No big season soon.</p>`}</div>
      <div class="card card-pad"><span class="eyebrow">Not scheduled · ${unscheduled.length}</span><div class="stack" style="margin-top:8px">${unscheduled.slice(0, 12).map(csChip).join("") || `<p class="muted s-small">Everything has a date.</p>`}</div></div></aside></div>`;
}
const fmtDay = (d) => new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/* ------------------------------------------------ Board by status */
function csCard(i) {
  const bad = i.checks.filter((c) => c.level === "bad").length;
  return `<button class="s-card" data-csopen="${i.id}" style="cursor:pointer"><b dir="auto" style="font-size:13px">${esc(i.title)}</b>
    <span class="subtle" style="font-size:12px">${i.date ? fmtDay(i.date) : "no date"} · ${(i.channels || []).map((c) => csShort[c]).join(" · ") || "no channels"}</span>
    <span class="row gap-8">${i.pillar ? `<span class="badge">${esc(CS.meta.pillars.find((p) => p.id === i.pillar)?.name || i.pillar)}</span>` : ""}${bad ? `<span class="badge bad">${bad} to fix</span>` : ""}${i.created_by?.startsWith("AI") ? `<span class="s-owner">AI</span>` : ""}</span></button>`;
}
function csBoard() {
  const cols = CS.meta.statuses.filter((s) => s.id !== "archived");
  return `<div class="s-board">${cols.map((s) => { const list = CS.items.filter((i) => i.status === s.id).sort((a, b) => (a.date || "9").localeCompare(b.date || "9"));
    return `<section class="s-col"><div class="s-col-head"><h3>${esc(s.name)}</h3><span class="subtle num">${list.length}</span></div>${list.map(csCard).join("")}</section>`; }).join("")}</div>`;
}

/* ------------------------------------------------ Ideas */
function csIdeas() {
  const ideas = CS.items.filter((i) => i.status === "idea");
  return `<div class="row gap-8" style="justify-content:space-between;margin-bottom:14px;flex-wrap:wrap"><p class="muted" style="font-size:13px;max-width:700px">Ideas come from your Knowledge notes, real results, support questions and store replies. Keep the good ones: give them a date and channels, then let AI write every version.</p>
    ${csEdit() ? `<button class="btn" data-csact="ideas">Find ideas with AI</button>` : ""}</div>
    <div class="cs-pillars">${CS.meta.pillars.map((p) => `<div class="card card-pad"><b>${esc(p.name)}</b><p class="subtle s-small">${esc(p.hint)}</p><span class="num">${ideas.filter((i) => i.pillar === p.id).length}</span></div>`).join("")}</div>
    ${ideas.length ? `<div class="grid-2" style="margin-top:16px">${ideas.map((i) => `<div class="card card-pad stack"><div class="row between"><b dir="auto">${esc(i.title)}</b>${i.created_by?.startsWith("AI") ? `<span class="s-owner">AI</span>` : ""}</div><p class="muted s-small" dir="auto">${esc(i.brief || "")}</p>
      <div class="row gap-8"><button class="btn btn-sm" data-csopen="${i.id}">Open</button>${csEdit() ? `<button class="btn btn-sm btn-ghost" data-csact="archive" data-id="${i.id}">Drop</button>` : ""}</div></div>`).join("")}</div>`
      : `<div class="card empty" style="margin-top:16px"><h2>No ideas yet</h2><p>Click "Find ideas with AI", "Plan month with AI", or add one with "New content".</p></div>`}`;
}

/* ------------------------------------------------ Emails */
function csEmails() {
  const list = CS.items.filter((i) => i.channels?.includes("email"));
  return `<div class="row gap-8" style="justify-content:space-between;margin-bottom:14px;flex-wrap:wrap"><p class="muted" style="font-size:13px;max-width:720px">Designed emails for newsletters and outreach. Once approved, pick one in a Store CRM campaign step and every store gets it with its own name, the unsubscribe footer and the plain-text version.</p>
    ${csEdit() ? `<button class="btn btn-primary" data-csact="new-email">New email design</button>` : ""}</div>
    ${list.length ? `<div class="cs-emails">${list.map((i) => `<div class="card cs-email-card"><iframe src="${csP()}/items/${i.id}/email" title="${esc(i.title)} preview" loading="lazy" sandbox></iframe>
      <div class="card-body" style="padding:12px 16px"><div class="row between"><b dir="auto">${esc(i.title)}</b><span class="badge ${CS_STATUS_TONE[i.status]}">${esc(i.status)}</span></div><p class="subtle s-small" dir="auto">${esc(i.variants?.email?.subject || "no subject")}</p>
      <button class="btn btn-sm" data-csopen="${i.id}" data-csch="email">Edit</button></div></div>`).join("")}</div>`
      : `<div class="card empty"><h2>No email designs yet</h2><p>Start from the Arabic outreach design: hero, before/after ads, one button.</p></div>`}`;
}

/* ------------------------------------------------ Brand kit */
function csBrand() {
  const { brand: b, pillars } = CS.meta, edit = csEdit();
  const roles = ["owner", "admin", "manager", "creative", "member"];
  return `<div class="grid-2"><div class="card"><div class="card-head"><h2>Brand kit</h2></div><div class="card-body stack" style="padding:16px 20px">
    <div class="row gap-8" style="flex-wrap:wrap">${Object.entries(b.colors).map(([k, v]) => `<label class="field" style="width:120px"><span class="s-small">${k}</span><input type="color" class="input" data-bcolor="${k}" value="${v}" ${edit ? "" : "disabled"}></label>`).join("")}</div>
    <div class="grid-2"><div class="field"><label for="bkAr">Arabic font</label><input class="input" id="bkAr" value="${esc(b.font_ar)}"></div><div class="field"><label for="bkEn">English font</label><input class="input" id="bkEn" value="${esc(b.font_en)}"></div></div>
    <div class="field"><label for="bkLogo">Logo URL (https, PNG)</label><input class="input" id="bkLogo" value="${esc(b.logo_url)}" placeholder="https://dpa.ad/logo.png"></div>
    <div class="field"><label for="bkTone">Tone of voice</label><textarea class="input" id="bkTone" rows="3">${esc(b.tone)}</textarea></div>
    <div class="grid-2"><div class="field"><label for="bkDo">Do (one per line)</label><textarea class="input" id="bkDo" rows="4">${esc(b.do.join("\n"))}</textarea></div><div class="field"><label for="bkDont">Don't (one per line)</label><textarea class="input" id="bkDont" rows="4">${esc(b.dont.join("\n"))}</textarea></div></div>
    <div class="field"><label for="bkTags">Core hashtags</label><input class="input" id="bkTags" value="${esc(b.hashtags.join(" "))}" dir="auto"></div>
    <div class="field"><label>Who can approve content</label><div class="row gap-8" style="flex-wrap:wrap">${roles.map((r) => `<label class="chip"><input type="checkbox" name="bkAppr" value="${r}" ${b.approver_roles.includes(r) ? "checked" : ""}> ${r}</label>`).join("")}</div><span class="hint">The team-password Owner can always approve.</span></div>
  </div></div>
  <div class="card"><div class="card-head"><h2>Content pillars</h2></div><div class="card-body stack" style="padding:16px 20px" id="bkPillars">
    ${pillars.map((p) => `<div class="grid-2" data-pillar="${esc(p.id)}"><input class="input" data-pf="name" value="${esc(p.name)}"><input class="input" data-pf="hint" value="${esc(p.hint)}"></div>`).join("")}
    <p class="subtle s-small">Every piece of content belongs to one pillar, so the mix stays balanced: teach, prove, show, seasons, founder.</p></div></div></div>
  ${edit ? `<div class="row" style="justify-content:flex-end;margin-top:14px"><button class="btn btn-primary" data-csact="save-brand">Save brand kit</button></div>` : ""}`;
}

/* ------------------------------------------------ Editor drawer */
function csDrawerEl() {
  let el = $("#csDrawer");
  if (!el) { document.body.insertAdjacentHTML("beforeend", `<div class="s-scrim" id="csScrim" hidden></div><aside class="s-drawer cs-drawer" id="csDrawer" hidden aria-label="Content"></aside>`); el = $("#csDrawer"); }
  return el;
}
function csClose() { const d = $("#csDrawer"); if (d) { d.hidden = true; $("#csScrim").hidden = true; } CS.openId = null; CS.draft = null; }

async function csOpen(id, ch) {
  const i = await api(`${csP()}/items/${id}`);
  CS.openId = id; CS.draft = structuredClone(i);
  CS.chTab = ch || (i.channels.includes(CS.chTab) ? CS.chTab : i.channels[0] || null);
  if ((i.variants?.email?.blocks || []).some((b) => b.type === "store_products")) await csPreviewStores();
  csDrawer();
}
function csDrawer() {
  const i = CS.draft, edit = csEdit(), el = csDrawerEl(), M = CS.meta;
  const st = i.status, approve = M.can_approve;
  const actions = [];
  if (edit) {
    if (["idea", "draft"].includes(st)) actions.push(["review", "Send for review", "btn-primary"]);
    if (st === "review" && approve) actions.push(["approved", "Approve", "btn-primary"], ["draft", "Request changes", ""]);
    if (st === "approved" && approve) actions.push(["scheduled", "Schedule", "btn-primary"]);
    if (["review", "approved", "scheduled"].includes(st)) actions.push(["draft", "Back to draft", "btn-ghost"]);
    if (st !== "archived") actions.push(["archived", "Archive", "btn-ghost"]);
  }
  const ch = CS.chTab, c = ch && csCh(ch), v = (ch && i.variants[ch]) || {};
  const posted = ch && i.published?.[ch];
  el.innerHTML = `<div class="row gap-12"><div style="flex:1;min-width:0"><input class="input cs-title" id="ceTitle" value="${esc(i.title)}" dir="auto" ${edit ? "" : "disabled"}>
      <span class="subtle s-small">${esc(i.created_by || "")} · ${fmtDate(i.created_at)}${i.approved_by ? ` · approved by ${esc(i.approved_by)}` : ""}</span></div>
    <span class="badge ${CS_STATUS_TONE[st]}">${esc(M.statuses.find((s) => s.id === st)?.name || st)}</span><button class="btn btn-sm" data-csact="close">Close</button></div>
  <div class="grid-2">
    <div class="field"><label for="ceDate">Date (Riyadh)</label><div class="row gap-8"><input class="input" type="date" id="ceDate" value="${i.date || ""}"><input class="input" type="time" id="ceTime" value="${i.time || ""}" style="width:120px"></div></div>
    <div class="field"><label for="cePillar">Pillar</label><select class="input" id="cePillar"><option value="">—</option>${M.pillars.map((p) => `<option value="${esc(p.id)}" ${p.id === i.pillar ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></div>
    <div class="field"><label for="ceAssignee">Assigned to</label><select class="input" id="ceAssignee"><option value="">Nobody</option>${M.users.map((u) => `<option value="${u.id}" ${u.id === i.assignee_id ? "selected" : ""}>${esc(u.name)}</option>`).join("")}</select></div>
    <div class="field"><label for="ceSeason">Season</label><input class="input" id="ceSeason" value="${esc(i.season || "")}" placeholder="e.g. Ramadan"></div>
  </div>
  <div class="field"><label for="ceBrief">Brief: angle, hook, what to show, the one ask</label><textarea class="input" id="ceBrief" rows="3" dir="auto">${esc(i.brief || "")}</textarea></div>
  <div class="field"><label>Channels</label><div class="cs-chans">${M.channels.map((x) => `<label class="chip ${i.channels.includes(x.id) ? "active" : ""}"><input type="checkbox" data-cechan="${x.id}" ${i.channels.includes(x.id) ? "checked" : ""} ${edit ? "" : "disabled"}> ${esc(x.name)}</label>`).join("")}</div></div>
  ${i.checks.length ? `<div class="cs-checks">${i.checks.map((k) => `<div class="cs-check ${k.level}">${k.level === "bad" ? "✕" : "!"} ${esc(k.text)}</div>`).join("")}</div>` : `<div class="cs-checks"><div class="cs-check ok">✓ All checks pass</div></div>`}
  ${edit ? `<div class="row gap-8" style="flex-wrap:wrap"><button class="btn btn-sm" data-csact="save">Save</button><button class="btn btn-sm" data-csact="write" ${i.channels.length ? "" : "disabled"}>${M.ai ? "Write all versions with AI" : "Write with AI (needs API key)"}</button>
    ${actions.map(([s, l, cls]) => `<button class="btn btn-sm ${cls}" data-csstatus="${s}">${l}</button>`).join("")}</div>` : ""}
  ${i.channels.length ? `<div class="s-tabs cs-vtabs" role="tablist">${i.channels.map((x) => `<button role="tab" data-cevtab="${x}" aria-selected="${x === ch}">${esc(csCh(x).name)}${i.published?.[x] ? " ✓" : ""}</button>`).join("")}</div>
  <div class="card" style="padding:14px 16px"><p class="subtle s-small">${esc(c.ratio)}${c.caption_max ? ` · caption up to ${c.caption_max}` : ""}${c.hashtags_max ? ` · ${c.hashtags_max} hashtags max` : ""}${c.tip ? ` · ${esc(c.tip)}` : ""}</p>
    ${c.kind === "email" ? csEmailEditor(v, edit) : csSocialEditor(c, v, edit)}
    ${c.kind !== "email" ? `<div id="csMediaBox"></div>` : ""}
    ${c.kind !== "email" ? `<div class="row gap-8" style="flex-wrap:wrap;margin-top:10px"><button class="btn btn-sm" data-csact="copy">Copy caption</button><a class="btn btn-sm" href="${csP()}/items/${i.id}/pack/${ch}">Download pack</a>
      ${["approved", "scheduled", "published"].includes(st) && edit ? (posted ? `<span class="badge good">Posted ${fmtDate(posted.at)} by ${esc(posted.by)}</span>${posted.url ? ` <a href="${esc(posted.url)}" target="_blank" rel="noopener" class="s-small">open</a>` : ""}` : `<button class="btn btn-sm btn-primary" data-csact="posted">Mark posted</button>`) : `<span class="subtle s-small">Posting opens after approval.</span>`}</div>` : ""}
  </div>` : `<p class="muted s-small">Pick channels above to write each version.</p>`}
  <div id="csPubBox"></div>
  <div><span class="eyebrow">Comments and history</span><div class="c-timeline">${[...i.comments].reverse().map((m) => `<div class="c-tl ${m.system ? "note" : ""}"><span class="subtle">${fmtDate(m.at)} · ${esc(m.by)}</span><div dir="auto">${esc(m.text)}</div></div>`).join("") || `<p class="muted s-small">No comments yet.</p>`}</div>
    ${edit ? `<div class="row gap-8" style="margin-top:8px"><input class="input input-sm" id="ceComment" placeholder="Comment for the team" dir="auto"><button class="btn btn-sm" data-csact="comment">Add</button></div>` : ""}
    ${i.history?.length ? `<p class="subtle s-small" style="margin-top:6px">${i.history.length} earlier version${i.history.length === 1 ? "" : "s"} kept.</p>` : ""}</div>
  ${edit ? `<button class="btn btn-ghost btn-sm" data-csact="delete" style="color:var(--bad);align-self:flex-start">Delete</button>` : ""}`;
  el.hidden = false; $("#csScrim").hidden = false;
  for (const h of CS_DRAWER_HOOKS) { try { h(i, ch); } catch (e) { console.error(e); } }
}
function csSocialEditor(c, v, edit) {
  const dis = edit ? "" : "disabled";
  return `<div class="stack">
    <div class="field"><label for="veAr">Arabic caption</label><textarea class="input" id="veAr" rows="5" dir="rtl" ${dis}>${esc(v.caption_ar || "")}</textarea></div>
    <div class="field"><label for="veEn">English caption</label><textarea class="input" id="veEn" rows="4" ${dis}>${esc(v.caption_en || "")}</textarea></div>
    ${c.hashtags_max ? `<div class="field"><label for="veTags">Hashtags</label><input class="input" id="veTags" value="${esc((v.hashtags || []).join(" "))}" dir="auto" ${dis}></div>` : ""}
    ${c.kind === "video" ? `<div class="field"><label for="veScript">Script (scenes, on-screen text, voiceover)</label><textarea class="input" id="veScript" rows="6" dir="auto" ${dis}>${esc(v.script || "")}</textarea></div>` : ""}
    ${c.kind === "carousel" ? `<div class="field"><label for="veSlides">Slides (one per line)</label><textarea class="input" id="veSlides" rows="6" dir="auto" ${dis}>${esc((v.slides || []).join("\n"))}</textarea></div>` : ""}
    ${c.kind === "whatsapp" ? `<div class="grid-2"><div class="field"><label for="veTpl">Approved template name</label><input class="input" id="veTpl" value="${esc(v.template_name || "")}" ${dis}></div><div class="field"><label for="veBtn">Button text</label><input class="input" id="veBtn" value="${esc(v.button || "")}" dir="auto" ${dis}></div></div>` : ""}
    ${c.kind !== "text" ? `<div class="field"><label for="veAsset">Image or video link (Drive, Canva, Dropbox… https)</label><input class="input" id="veAsset" value="${esc(v.asset_url || "")}" ${dis}></div>` : ""}
    <div class="field"><label for="veNotes">Notes for whoever posts</label><input class="input" id="veNotes" value="${esc(v.notes || "")}" dir="auto" ${dis}></div></div>`;
}
const CS_BLOCKS = { header: "Header (logo)", hero: "Hero (title + text + image)", text: "Text", button: "Button", image: "Image", compare: "Before / after ads", products: "Products (up to 3)", store_products: "Store's own products as ads (personalized)", quote: "Quote (real person)", divider: "Divider" };
function csEmailEditor(v, edit) {
  const dis = edit ? "" : "disabled";
  const blocks = v.blocks || [];
  const f = (bi, key, label, val, opts = {}) => `<label class="field"><span class="s-small">${label}</span>${opts.area ? `<textarea class="input" rows="${opts.area}" data-eb="${bi}:${key}" dir="auto" ${dis}>${esc(val || "")}</textarea>` : `<input class="input input-sm" data-eb="${bi}:${key}" value="${esc(val ?? "")}" dir="${opts.ltr ? "ltr" : "auto"}" ${opts.num ? `type="number" min="1" max="3"` : ""} ${dis}>`}</label>`;
  return `<div class="cs-email-ed"><div class="stack">
    <div class="field"><label for="veSubj">Subject</label><input class="input" id="veSubj" value="${esc(v.subject || "")}" dir="auto" ${dis}></div>
    <div class="field"><label for="vePre">Preview text (shown after the subject in the inbox)</label><input class="input" id="vePre" value="${esc(v.preheader || "")}" dir="auto" ${dis}></div>
    ${blocks.map((b, bi) => `<div class="cs-block"><div class="row gap-8"><b class="s-small">${bi + 1}. ${CS_BLOCKS[b.type]}</b>${edit ? `<span style="margin-left:auto"></span><button class="btn btn-sm btn-ghost" data-ebmove="${bi}:-1" aria-label="Move up">↑</button><button class="btn btn-sm btn-ghost" data-ebmove="${bi}:1" aria-label="Move down">↓</button><button class="btn btn-sm btn-ghost" data-ebdel="${bi}" aria-label="Remove block">✕</button>` : ""}</div>
      ${b.type === "header" ? f(bi, "preheader", "Preheader", b.preheader) : ""}
      ${b.type === "hero" ? f(bi, "title", "Title", b.title) + f(bi, "text", "Text", b.text, { area: 3 }) + f(bi, "image_url", "Image URL (https)", b.image_url, { ltr: true }) + f(bi, "image_alt", "Image description", b.image_alt) : ""}
      ${b.type === "text" ? f(bi, "text", "Text", b.text, { area: 4 }) : ""}
      ${b.type === "button" ? f(bi, "label", "Button text", b.label) + f(bi, "url", "Link (https)", b.url, { ltr: true }) : ""}
      ${b.type === "image" ? f(bi, "image_url", "Image URL (https)", b.image_url, { ltr: true }) + f(bi, "image_alt", "Image description", b.image_alt) + f(bi, "link", "Link (optional)", b.link, { ltr: true }) : ""}
      ${b.type === "compare" ? f(bi, "before_url", "Plain packshot image (https)", b.before_url, { ltr: true }) + f(bi, "after_url", "Designed ad image (https)", b.after_url, { ltr: true }) + f(bi, "caption", "Caption", b.caption) : ""}
      ${b.type === "products" ? [0, 1, 2].map((k) => `<div class="grid-2">${["title", "price", "image_url", "url"].map((key) => `<label class="field"><span class="s-small">Product ${k + 1} ${key.replace("_url", "").replace("url", "link")}</span><input class="input input-sm" data-ebp="${bi}:${k}:${key}" value="${esc(b.items?.[k]?.[key] || "")}" ${dis}></label>`).join("")}</div>`).join("") : ""}
      ${b.type === "store_products" ? `<p class="subtle s-small">Each store sees up to this many of its own products (Store CRM → product samples) as designed ad cards. Stores without samples get the fallback text.</p>` + f(bi, "title", "Block title", b.title) + f(bi, "count", "Up to how many products (1–3)", b.count ?? 3, { num: true }) + f(bi, "headline", "Headline on each card", b.headline) + f(bi, "cta_label", "Button on each card (optional)", b.cta_label) + f(bi, "cta_url", "Button link (https)", b.cta_url, { ltr: true }) + f(bi, "fallback_text", "Fallback text (stores without product samples)", b.fallback_text, { area: 3 }) : ""}
      ${b.type === "quote" ? f(bi, "text", "Quote (their exact words)", b.text, { area: 2 }) + f(bi, "author", "Name and store (with permission)", b.author) : ""}</div>`).join("")}
    ${edit ? `<div class="row gap-8"><select class="input input-sm" id="ebType" style="width:auto">${Object.entries(CS_BLOCKS).map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</select><button class="btn btn-sm" data-csact="add-block">Add block</button></div>` : ""}
    <p class="subtle s-small">Placeholders: {{store_name}} {{owner_name}} {{category_ar}} {{sender_name}}. The unsubscribe footer is added automatically. Save to refresh the preview.</p>
  </div><div class="cs-email-prev">${blocks.some((b) => b.type === "store_products") ? `<label class="field" style="margin-bottom:6px"><span class="s-small">Preview as</span><select class="input input-sm" id="csPrevStore"><option value="">Sample store (example.com photos)</option>${(CS.previewStores || []).map((x) => `<option value="${esc(x.id)}" ${String(x.id) === String(CS.previewStore || "") ? "selected" : ""}>${esc(x.store_name)} · ${x.products} product${x.products > 1 ? "s" : ""}</option>`).join("")}</select></label>` : ""}<iframe id="cePreview" src="${csP()}/items/${CS.draft.id}/email?ts=${Date.now()}${CS.previewStore ? `&contact_id=${encodeURIComponent(CS.previewStore)}` : ""}" title="Email preview" sandbox></iframe>
    <div class="row gap-8" style="justify-content:center;margin-top:6px"><button class="btn btn-sm btn-ghost" data-csact="prev-phone">Phone</button><button class="btn btn-sm btn-ghost" data-csact="prev-desk">Desktop</button></div></div></div>`;
}

// Read the open editor back into CS.draft.
function csCollect() {
  const i = CS.draft; if (!i) return;
  const val = (id) => (document.getElementById(id) ? document.getElementById(id).value : undefined);
  i.title = val("ceTitle") ?? i.title; i.date = val("ceDate") || null; i.time = val("ceTime") || ""; i.pillar = val("cePillar") ?? i.pillar;
  i.assignee_id = val("ceAssignee") || null; i.season = val("ceSeason") ?? i.season; i.brief = val("ceBrief") ?? i.brief;
  const ch = CS.chTab; if (!ch || !i.variants[ch]) return;
  const v = i.variants[ch];
  if (csCh(ch).kind === "email") {
    if (val("veSubj") !== undefined) { v.subject = val("veSubj"); v.preheader = val("vePre"); }
    document.querySelectorAll("[data-eb]").forEach((el) => { const [bi, key] = el.dataset.eb.split(":"); v.blocks[bi][key] = el.value; });
    document.querySelectorAll("[data-ebp]").forEach((el) => { const [bi, k, key] = el.dataset.ebp.split(":"); const b = v.blocks[bi]; b.items ||= []; b.items[k] ||= {}; b.items[k][key] = el.value; });
    for (const b of v.blocks) if (b.type === "products") b.items = (b.items || []).filter((p) => p && (p.title || p.image_url));
  } else {
    if (val("veAr") !== undefined) v.caption_ar = val("veAr");
    if (val("veEn") !== undefined) v.caption_en = val("veEn");
    if (val("veTags") !== undefined) v.hashtags = val("veTags").split(/\s+/).filter(Boolean);
    if (val("veScript") !== undefined) v.script = val("veScript");
    if (val("veSlides") !== undefined) v.slides = val("veSlides").split("\n").filter((x) => x.trim());
    if (val("veTpl") !== undefined) { v.template_name = val("veTpl"); v.button = val("veBtn"); }
    if (val("veAsset") !== undefined) v.asset_url = val("veAsset");
    if (val("veNotes") !== undefined) v.notes = val("veNotes");
  }
}
async function csSave(quiet) {
  csCollect();
  const i = CS.draft;
  const saved = await api(`${csP()}/items/${i.id}`, { method: "PUT", body: JSON.stringify({ title: i.title, date: i.date, time: i.time, pillar: i.pillar, assignee_id: i.assignee_id, season: i.season, brief: i.brief, channels: i.channels, variants: i.variants }) });
  CS.draft = structuredClone(saved);
  await csLoad(); csRerender(); csDrawer();
  if (!quiet) toast(saved.status === "review" && i.status !== "review" ? "Saved: edited after approval, so it's back in review" : "Saved");
}

/* ------------------------------------------------ Events */
document.addEventListener("click", async (e) => {
  if (S.route !== "studio" && !e.target.closest("#csDrawer")) return;
  const t = e.target;
  if (t.closest("#csScrim")) return csClose();
  const tab = t.closest("[data-cstab]");
  if (tab) { CS.tab = tab.dataset.cstab; csClose(); return csRerender(); }
  const mo = t.closest("[data-csmonth]");
  if (mo) { const [y, m] = CS.month.split("-").map(Number); const d = new Date(Date.UTC(y, m - 1 + Number(mo.dataset.csmonth), 1)); CS.month = d.toISOString().slice(0, 7); return csRerender(); }
  const op = t.closest("[data-csopen]");
  if (op) return csOpen(op.dataset.csopen, op.dataset.csch);
  const vt = t.closest("[data-cevtab]");
  if (vt) { csCollect(); CS.chTab = vt.dataset.cevtab; return csDrawer(); }
  const day = t.closest("[data-csday]");
  const b = t.closest("[data-csact], [data-csstatus], [data-ebmove], [data-ebdel]");
  if (!b && day && csEdit()) { const i = await api(`${csP()}/items`, { method: "POST", body: JSON.stringify({ title: "New content", date: day.dataset.csday }) }); await csLoad(); csRerender(); return csOpen(i.id); }
  if (!b) return;
  try {
    if (b.dataset.csstatus) {
      await csSave(true);
      await api(`${csP()}/items/${CS.draft.id}/status`, { method: "POST", body: JSON.stringify({ status: b.dataset.csstatus }) });
      toast({ review: "Sent for review", approved: "Approved", scheduled: "Scheduled", draft: "Back to draft", archived: "Archived" }[b.dataset.csstatus] || "Done");
      await csLoad(); csRerender(); return csOpen(CS.draft.id);
    }
    if (b.dataset.ebmove) { csCollect(); const [bi, d] = b.dataset.ebmove.split(":").map(Number); const bl = CS.draft.variants.email.blocks, j = bi + d; if (j >= 0 && j < bl.length) [bl[bi], bl[j]] = [bl[j], bl[bi]]; return csDrawer(); }
    if (b.dataset.ebdel) { csCollect(); CS.draft.variants.email.blocks.splice(Number(b.dataset.ebdel), 1); return csDrawer(); }
    const act = b.dataset.csact, id = b.dataset.id;
    switch (act) {
      case "close": return csClose();
      case "new": { const i = await api(`${csP()}/items`, { method: "POST", body: JSON.stringify({ title: "New content" }) }); await csLoad(); csRerender(); return csOpen(i.id); }
      case "new-email": { const i = await api(`${csP()}/items`, { method: "POST", body: JSON.stringify({ title: "Outreach email · your products as ads", starter_email: true, pillar: "product" }) }); await csLoad(); csRerender(); return csOpen(i.id, "email"); }
      case "plan": {
        const month = prompt("Plan which month? (YYYY-MM)", CS.month); if (!month) return;
        b.disabled = true; b.textContent = "Planning…";
        try { const r = await api(`${csP()}/plan`, { method: "POST", body: JSON.stringify({ month, count: 12 }) }); toast(`${r.added} ideas added to ${month}. Keep the good ones.`); CS.month = month; CS.tab = "calendar"; await csLoad(); csRerender(); }
        finally { b.disabled = false; b.textContent = "Plan month with AI"; }
        return;
      }
      case "ideas": { b.disabled = true; b.textContent = "Thinking…"; try { const r = await api(`${csP()}/ideas`, { method: "POST" }); toast(`${r.added} ideas added`); await csLoad(); csRerender(); } finally { b.disabled = false; b.textContent = "Find ideas with AI"; } return; }
      case "archive": await api(`${csP()}/items/${id}/status`, { method: "POST", body: JSON.stringify({ status: "archived" }) }); await csLoad(); return csRerender();
      case "save": return csSave();
      case "write": {
        await csSave(true); b.disabled = true; b.textContent = "Writing…";
        try { const r = await api(`${csP()}/items/${CS.draft.id}/write`, { method: "POST", body: JSON.stringify({}) }); CS.draft = structuredClone(r); toast("Every version written. Check and edit before review."); await csLoad(); csRerender(); csDrawer(); }
        finally { b.disabled = false; }
        return;
      }
      case "copy": { csCollect(); const v = CS.draft.variants[CS.chTab]; const text = [v.caption_ar, v.caption_en].filter(Boolean).join("\n\n") + (v.hashtags?.length ? "\n\n" + v.hashtags.join(" ") : ""); await navigator.clipboard.writeText(text).then(() => toast("Caption copied"), () => toast("Couldn't copy: select the text instead", true)); return; }
      case "posted": { const url = prompt("Link to the live post (optional)", "") ?? null; if (url === null) return; const r = await api(`${csP()}/items/${CS.draft.id}/posted`, { method: "POST", body: JSON.stringify({ channel: CS.chTab, url }) }); CS.draft = structuredClone(r); toast("Logged as posted"); await csLoad(); csRerender(); return csDrawer(); }
      case "comment": { const text = $("#ceComment").value.trim(); if (!text) return; const r = await api(`${csP()}/items/${CS.draft.id}/comments`, { method: "POST", body: JSON.stringify({ text }) }); csCollect(); CS.draft.comments = r.comments; return csDrawer(); }
      case "add-block": { csCollect(); const type = $("#ebType").value; CS.draft.variants.email.blocks.push({ type, ...(CS.meta.block_defaults?.[type] || {}) }); if (type === "store_products") await csPreviewStores(); return csDrawer(); }
      case "prev-phone": $("#cePreview").style.width = "375px"; return;
      case "prev-desk": $("#cePreview").style.width = "100%"; return;
      case "delete": if (!confirm("Delete this content?")) return; await api(`${csP()}/items/${CS.draft.id}`, { method: "DELETE" }); csClose(); await csLoad(); return csRerender();
      case "save-brand": {
        const colors = Object.fromEntries([...document.querySelectorAll("[data-bcolor]")].map((x) => [x.dataset.bcolor, x.value]));
        const pillars = [...document.querySelectorAll("[data-pillar]")].map((r) => ({ id: r.dataset.pillar, name: r.querySelector('[data-pf="name"]').value, hint: r.querySelector('[data-pf="hint"]').value }));
        const brand = { colors, font_ar: $("#bkAr").value, font_en: $("#bkEn").value, logo_url: $("#bkLogo").value, tone: $("#bkTone").value, do: $("#bkDo").value, dont: $("#bkDont").value, hashtags: $("#bkTags").value.split(/\s+/), approver_roles: [...document.querySelectorAll('input[name="bkAppr"]:checked')].map((x) => x.value) };
        const r = await api(`${csP()}/brand`, { method: "PUT", body: JSON.stringify({ brand, pillars }) });
        Object.assign(CS.meta, r); toast("Brand kit saved"); return csRerender();
      }
    }
  } catch (err) { toast(err.message, true); }
});
// Store CRM stores with product photos, for previewing the personalized email.
async function csPreviewStores() { if (CS.previewStores) return; try { CS.previewStores = await api(`${csP()}/preview-stores`); } catch { CS.previewStores = []; } }
document.addEventListener("change", (e) => {
  if (e.target.id === "csPrevStore") { CS.previewStore = e.target.value || null; $("#cePreview").src = `${csP()}/items/${CS.draft.id}/email?ts=${Date.now()}${CS.previewStore ? `&contact_id=${encodeURIComponent(CS.previewStore)}` : ""}`; return; }
  const c = e.target.closest?.("[data-cechan]");
  if (!c || !CS.draft) return;
  csCollect();
  const id = c.dataset.cechan, i = CS.draft;
  i.channels = c.checked ? [...new Set([...i.channels, id])] : i.channels.filter((x) => x !== id);
  if (c.checked && !i.variants[id]) i.variants[id] = id === "email" ? { subject: "", preheader: "", blocks: [] } : {};
  if (!i.channels.includes(CS.chTab)) CS.chTab = i.channels[0] || null;
  if (c.checked) CS.chTab = id;
  csDrawer();
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && CS.openId && !$("#dialog").open) csClose(); });

if (S.route === "studio" && S.ws) render();
