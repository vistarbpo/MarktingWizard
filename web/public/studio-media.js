/* Creative Studio phase 2-3 UI: the Assets tab (media library), attaching files to a channel,
   the image template designer and the reel builder. Rendering is in studio-render.js (csr*).
   Uses globals from app.js (S, $, api, esc, toast, fmtDate) and studio.js (CS, csP, csEdit, csCh, csSave, csCollect, csDrawer). */

const CM = { media: null, filter: "all", q: "", tpl: {}, reel: null, loading: null };
const CM_ACCEPT = "image/png,image/jpeg,image/webp,video/mp4,audio/mp4,audio/mpeg,.m4a,.mp3";
const cmSize = (b) => (b >= 1048576 ? (b / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(b / 1024)) + " KB");
const cmById = (id) => (CM.media || []).find((m) => m.id === id);
const cmKindsFor = (ch) => { const k = csCh(ch)?.kind; return k === "video" ? ["video"] : k === "story" ? ["image", "video"] : ch === "fb_post" ? ["image", "video"] : ["image"]; };

async function cmLoad(force) {
  if (CM.media && !force) return CM.media;
  if (!CM.loading) CM.loading = api(`${csP()}/media`).then((d) => { CM.media = d.media; CM.limits = d.limits; return d.media; }).finally(() => { CM.loading = null; });
  return CM.loading;
}

// Reads width/height/duration in the browser before upload (the server can't decode media).
async function cmProbe(file) {
  const url = URL.createObjectURL(file);
  try {
    if (file.type.startsWith("image/")) { const im = new Image(); im.src = url; await im.decode(); return { width: im.naturalWidth, height: im.naturalHeight }; }
    if (file.type.startsWith("video/") || file.type.startsWith("audio/") || /\.(mp3|m4a|mp4)$/i.test(file.name)) {
      const el = document.createElement(file.type.startsWith("audio/") || /\.(mp3|m4a)$/i.test(file.name) ? "audio" : "video");
      el.preload = "metadata"; el.muted = true; el.src = url;
      await new Promise((r) => { el.onloadedmetadata = r; el.onerror = r; setTimeout(r, 8000); });
      return { duration: Number.isFinite(el.duration) ? el.duration : "", width: el.videoWidth || "", height: el.videoHeight || "" };
    }
  } catch {} finally { URL.revokeObjectURL(url); }
  return {};
}
async function cmUpload(file, q = {}) {
  const probe = await cmProbe(file);
  const params = new URLSearchParams(Object.entries({ filename: file.name || "file", ...probe, ...q }).filter(([, v]) => v !== "" && v !== undefined && v !== null));
  const res = await fetch(`${csP()}/media?${params}`, { method: "POST", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file });
  if (res.status === 401) { location.href = "/login"; throw new Error("Please log in again."); }
  if (!res.ok) { let m = res.statusText; try { m = (await res.json()).detail; } catch {} throw new Error(`${file.name}: ${m}`); }
  const m = await res.json();
  if (CM.media) CM.media.unshift({ ...m, used_in: [] });
  return m;
}
function cmThumb(m, cls = "") {
  if (!m) return `<div class="cm-thumb ${cls} missing">deleted</div>`;
  if (m.kind === "image") return `<img class="cm-thumb ${cls}" src="${esc(m.path)}" alt="${esc(m.name)}" loading="lazy">`;
  if (m.kind === "video") return `<video class="cm-thumb ${cls}" src="${esc(m.path)}#t=0.5" preload="metadata" muted playsinline aria-label="${esc(m.name)}"></video>`;
  return `<div class="cm-thumb ${cls} audio" aria-label="${esc(m.name)}">♪</div>`;
}

/* ------------------------------------------------ Assets tab */
function cmAssets() { return `<div id="cmAssets"><p class="muted">Loading the library…</p></div>`; }
async function cmAssetsAfter() {
  try { await cmLoad(true); } catch (e) { $("#cmAssets").innerHTML = `<p class="muted">${esc(e.message)}</p>`; return; }
  cmAssetsRender();
}
function cmAssetsRender() {
  const box = $("#cmAssets"); if (!box) return;
  const q = CM.q.trim().toLowerCase(), edit = csEdit();
  const list = CM.media.filter((m) => (CM.filter === "all" || m.kind === CM.filter) && (!q || m.name.toLowerCase().includes(q) || m.tags.some((t) => t.includes(q))));
  const counts = { all: CM.media.length, image: 0, video: 0, audio: 0 };
  for (const m of CM.media) counts[m.kind]++;
  box.innerHTML = `<div class="row gap-8" style="justify-content:space-between;margin-bottom:14px;flex-wrap:wrap"><p class="muted" style="font-size:13px;max-width:720px">Every image, video, voice and music file for DPA AD's content. Files get a public link (platforms fetch them from it when we publish), so upload only what may be public. Templates and the reel builder save their output here too.</p></div>
    ${edit ? `<form class="card card-pad stack" id="cmUpForm" style="margin-bottom:16px"><div class="cm-upgrid">
      <div class="field"><label for="cmFiles">Files (PNG, JPG, WebP up to 10 MB · MP4 up to 150 MB · M4A, MP3 up to 30 MB)</label><input class="input" type="file" id="cmFiles" multiple accept="${CM_ACCEPT}"></div>
      <div class="field"><label for="cmTags">Tags</label><input class="input" id="cmTags" placeholder="abaya, ramadan, packshot" dir="auto"></div>
      <div class="field"><label for="cmLic">Licence or source (music and stock)</label><input class="input" id="cmLic" placeholder="e.g. Artlist licence #, own photo, recorded by Noura" dir="auto"></div></div>
      <div class="row gap-12" style="flex-wrap:wrap"><label class="chip"><input type="checkbox" id="cmAi"> AI-generated</label><label class="chip"><input type="checkbox" id="cmRights"> I have the rights to use these in DPA AD's ads (required for voice and music)</label>
      <span style="flex:1"></span><button class="btn btn-primary" type="submit" id="cmUpBtn">Upload</button></div></form>` : ""}
    <div class="row gap-8" style="flex-wrap:wrap;margin-bottom:12px"><div class="s-tabs" role="tablist" aria-label="File type">${[["all", "All"], ["image", "Images"], ["video", "Video"], ["audio", "Audio"]].map(([k, l]) => `<button role="tab" data-cmfilter="${k}" aria-selected="${CM.filter === k}">${l} <span class="subtle">${counts[k]}</span></button>`).join("")}</div>
      <input class="input input-sm" id="cmQ" placeholder="Search name or tag" value="${esc(CM.q)}" style="width:220px;max-width:100%" dir="auto"></div>
    ${list.length ? `<div class="cm-grid">${list.map((m) => `<div class="card cm-card">${cmThumb(m)}
      <div class="cm-body"><b class="cm-name" dir="auto" title="${esc(m.name)}">${esc(m.name)}</b>
        <span class="subtle s-small">${esc(m.kind)} · ${cmSize(m.size)}${m.width ? ` · ${m.width}×${m.height}` : ""}${m.duration ? ` · ${Math.round(m.duration)} s` : ""}</span>
        <span class="row gap-8" style="flex-wrap:wrap">${m.ai_generated ? `<span class="badge warn">AI-generated</span>` : ""}${m.source !== "upload" ? `<span class="badge accent">${esc(m.source)}</span>` : ""}${m.kind === "audio" ? `<span class="badge ${m.rights_confirmed ? "good" : "bad"}">${m.rights_confirmed ? "rights confirmed" : "rights not confirmed"}</span>` : ""}${m.tags.map((t) => `<span class="badge" dir="auto">${esc(t)}</span>`).join("")}</span>
        ${m.licence ? `<span class="subtle s-small" dir="auto">Licence: ${esc(m.licence)}</span>` : ""}
        ${m.kind === "audio" ? `<audio controls preload="none" src="${esc(m.path)}" style="width:100%"></audio>` : ""}
        ${m.used_in?.length ? `<span class="subtle s-small">Used in: ${m.used_in.slice(0, 3).map((u) => `<button class="linklike" data-csopen="${esc(u.item_id)}" data-csch="${esc(u.channel)}">${esc(u.title)}</button>`).join(", ")}${m.used_in.length > 3 ? " +" + (m.used_in.length - 3) : ""}</span>` : ""}
        <div class="row gap-8" style="flex-wrap:wrap"><button class="btn btn-sm" data-cmcopy="${m.id}">Copy URL</button><a class="btn btn-sm btn-ghost" href="${esc(m.path)}" target="_blank" rel="noopener">Open</a>
          ${edit ? `<button class="btn btn-sm btn-ghost" data-cmedit="${m.id}">Edit</button><button class="btn btn-sm btn-ghost" data-cmdel="${m.id}" style="color:var(--bad)">Delete</button>` : ""}</div></div></div>`).join("")}</div>`
      : `<div class="card empty"><h2>${CM.media.length ? "Nothing matches" : "No files yet"}</h2><p>Upload product photos, screen recordings, voiceovers and licensed music, or design one with a template from any content item.</p></div>`}`;
}
async function cmUploadForm() {
  const files = [...($("#cmFiles").files || [])];
  if (!files.length) return toast("Pick one or more files first", true);
  const audio = files.some((f) => f.type.startsWith("audio/") || /\.(mp3|m4a)$/i.test(f.name));
  if (audio && !$("#cmRights").checked) return toast('Tick "I have the rights" for voice and music', true);
  const btn = $("#cmUpBtn"); btn.disabled = true;
  let ok = 0;
  try {
    for (const [n, f] of files.entries()) {
      btn.textContent = `Uploading ${n + 1}/${files.length}…`;
      try { await cmUpload(f, { tags: $("#cmTags").value, licence: $("#cmLic").value, ai: $("#cmAi").checked ? "1" : "", rights: $("#cmRights").checked ? "1" : "" }); ok++; } catch (e) { toast(e.message, true); }
    }
  } finally { btn.disabled = false; btn.textContent = "Upload"; }
  if (ok) toast(`${ok} file${ok === 1 ? "" : "s"} uploaded`);
  await cmLoad(true); cmAssetsRender();
}
function cmEditDialog(m) {
  const d = cmDlg();
  d.innerHTML = `<form method="dialog" class="stack" style="padding:20px" id="cmEditForm"><h2>Edit file</h2>${cmThumb(m, "big")}
    <div class="field"><label for="ceName">Name</label><input class="input" id="ceName" value="${esc(m.name)}" dir="auto"></div>
    <div class="field"><label for="ceTags">Tags (comma separated)</label><input class="input" id="ceTags" value="${esc(m.tags.join(", "))}" dir="auto"></div>
    <div class="field"><label for="ceLic">Licence or source</label><input class="input" id="ceLic" value="${esc(m.licence || "")}" dir="auto"></div>
    <label class="chip"><input type="checkbox" id="ceAi" ${m.ai_generated ? "checked" : ""}> AI-generated</label>
    <div class="row gap-8" style="justify-content:flex-end"><button class="btn" value="cancel">Cancel</button><button class="btn btn-primary" value="ok" id="ceSave">Save</button></div></form>`;
  d.showModal();
  $("#ceSave").onclick = async (e) => {
    e.preventDefault();
    try { await api(`${csP()}/media/${m.id}`, { method: "PUT", body: JSON.stringify({ name: $("#ceName").value, tags: $("#ceTags").value, licence: $("#ceLic").value, ai_generated: $("#ceAi").checked }) }); d.close(); toast("Saved"); await cmLoad(true); cmAssetsRender(); }
    catch (err) { toast(err.message, true); }
  };
}
function cmDlg() {
  let d = $("#cmDlg");
  if (!d) { document.body.insertAdjacentHTML("beforeend", `<dialog id="cmDlg" class="dialog cm-dialog"></dialog>`); d = $("#cmDlg"); d.addEventListener("close", () => { d.innerHTML = ""; d.classList.remove("wide"); d.onclick = d.oninput = d.onchange = null; }); }
  return d;
}
CS_TABS.push({ key: "assets", label: "Assets", view: cmAssets, after: cmAssetsAfter });

/* ------------------------------------------------ Drawer: files for this channel */
CS_DRAWER_HOOKS.push(async (item, ch) => {
  const box = $("#csMediaBox"); if (!box || !ch) return;
  const c = csCh(ch); if (!c || c.kind === "email") return;
  await cmLoad().catch(() => {});
  if (CS.chTab !== ch || !$("#csMediaBox")) return;
  const v = CS.draft.variants[ch] || {}, edit = csEdit(), ids = v.media || [];
  const canTpl = !!CSR_CHANNEL_SIZE[ch] || c.kind === "carousel", isVideo = CSR_VIDEO_CHANNELS.includes(ch);
  $("#csMediaBox").innerHTML = `<div class="cm-attach"><div class="row gap-8" style="justify-content:space-between;flex-wrap:wrap"><span class="eyebrow">Files for ${esc(c.name)}</span>
    ${edit ? `<div class="row gap-8" style="flex-wrap:wrap"><button class="btn btn-sm" data-cmact="pick">Attach from library</button>${canTpl ? `<button class="btn btn-sm" data-cmact="tpl">Design with a template</button>` : ""}${isVideo ? `<button class="btn btn-sm" data-cmact="reel">Build the reel</button>` : ""}</div>` : ""}</div>
    ${ids.length ? `<div class="cm-strip">${ids.map((id, n) => `<div class="cm-slot">${cmThumb(cmById(id))}<span class="cm-num">${n + 1}</span>${edit ? `<div class="cm-slot-act"><button class="btn btn-sm btn-ghost" data-cmmove="${n}:-1" aria-label="Move earlier">‹</button><button class="btn btn-sm btn-ghost" data-cmmove="${n}:1" aria-label="Move later">›</button><button class="btn btn-sm btn-ghost" data-cmremove="${n}" aria-label="Remove">✕</button></div>` : ""}</div>`).join("")}
      ${v.cover_id ? `<div class="cm-slot">${cmThumb(cmById(v.cover_id))}<span class="cm-num">cover</span>${edit ? `<div class="cm-slot-act"><button class="btn btn-sm btn-ghost" data-cmact="uncover" aria-label="Remove cover">✕</button></div>` : ""}</div>` : ""}</div>`
      : `<p class="subtle s-small">${v.cover_id ? `Cover set. ` : ""}No files attached yet. ${c.kind === "carousel" ? "Attach 2 to 10 images in slide order, or design the slides with a template." : isVideo ? "Build the reel from scenes, or attach an MP4 you made elsewhere." : "Attach an image, or design one with a template."}</p>`}
    ${c.platform === "Instagram" ? `<p class="subtle s-small">Instagram accepts JPEG images and MP4 video only. Templates export JPEG.</p>` : ""}</div>`;
});
function cmSetMedia(ch, ids, cover) {
  csCollect();
  const v = (CS.draft.variants[ch] ||= {});
  v.media = [...new Set(ids)].slice(0, 10);
  if (cover !== undefined) v.cover_id = cover || "";
}
function cmPicker(ch) {
  const d = cmDlg(), kinds = cmKindsFor(ch), multi = ["ig_carousel", "fb_post", "linkedin"].includes(ch);
  const chosen = new Set(CS.draft.variants[ch]?.media || []);
  const draw = () => {
    const list = (CM.media || []).filter((m) => kinds.includes(m.kind));
    d.innerHTML = `<div class="stack" style="padding:20px"><div class="row between"><h2>Attach to ${esc(csCh(ch).name)}</h2><button class="btn btn-sm" data-cmpick="close">Close</button></div>
      <p class="subtle s-small">${multi ? "Pick several; they're posted in the order you pick them." : "Pick one file."} Showing ${kinds.join(" and ")} files.</p>
      <div class="row gap-8"><input type="file" class="input input-sm" id="cmPickUp" accept="${kinds.includes("video") ? "video/mp4," : ""}image/png,image/jpeg,image/webp" style="flex:1"><button class="btn btn-sm" data-cmpick="upload">Upload</button></div>
      <div class="cm-grid small">${list.map((m) => `<button class="cm-pick ${chosen.has(m.id) ? "on" : ""}" data-cmpickid="${m.id}" aria-pressed="${chosen.has(m.id)}">${cmThumb(m)}<span class="s-small" dir="auto">${esc(m.name)}</span>${chosen.has(m.id) ? `<span class="cm-num">${[...chosen].indexOf(m.id) + 1}</span>` : ""}</button>`).join("") || `<p class="muted s-small">No ${kinds.join(" or ")} files yet: upload one above.</p>`}</div>
      <div class="row gap-8" style="justify-content:flex-end"><button class="btn btn-primary" data-cmpick="done">Attach ${chosen.size || ""}</button></div></div>`;
  };
  d.classList.add("wide"); draw(); if (!d.open) d.showModal();
  d.onclick = async (e) => {
    const id = e.target.closest("[data-cmpickid]")?.dataset.cmpickid, act = e.target.closest("[data-cmpick]")?.dataset.cmpick;
    if (id) { if (chosen.has(id)) chosen.delete(id); else { if (!multi) chosen.clear(); chosen.add(id); } return draw(); }
    if (act === "close") return d.close();
    if (act === "upload") { const f = $("#cmPickUp").files[0]; if (!f) return toast("Pick a file first", true); try { const m = await cmUpload(f, { item_id: CS.draft.id }); chosen.add(m.id); if (!multi) { chosen.clear(); chosen.add(m.id); } draw(); } catch (err) { toast(err.message, true); } return; }
    if (act === "done") { d.close(); cmSetMedia(ch, [...chosen]); await csSave(); }
  };
}

/* ------------------------------------------------ Template designer */
function cmTplFields(item) {
  const ch = CS.chTab, v = item.variants[ch] || {};
  const first = (s) => String(s || "").split("\n").find((l) => l.trim())?.trim() || "";
  const img = (v.media || []).map(cmById).filter((m) => m?.kind === "image").map((m) => m.id);
  return CM.tpl[item.id] ||= { template: ch === "ig_carousel" ? "carousel" : ch === "ig_story" ? "story" : ch === "yt_video" ? "yt_thumb" : ch === "whatsapp" ? "wa_header" : ch === "linkedin" ? "square" : "post",
    headline: first(v.caption_ar) || item.title, subline: first(v.caption_en) || "", badge: "", cta: v.button || (csrAr(v.caption_ar) ? "اطلب الآن" : "Shop now"), img1: img[0] || "", img2: img[1] || "" };
}
function cmTemplate() {
  const item = CS.draft, f = cmTplFields(item), imgs = (CM.media || []).filter((m) => m.kind === "image"), d = cmDlg();
  const targets = item.channels.filter((c) => CSR_CHANNEL_SIZE[c]);
  const opt = (sel) => `<option value="">—</option>${imgs.map((m) => `<option value="${m.id}" ${m.id === sel ? "selected" : ""}>${esc(m.name)}</option>`).join("")}`;
  d.classList.add("wide");
  d.innerHTML = `<div class="cm-tpl"><div class="stack" style="min-width:0"><div class="row between"><h2>Design with a template</h2><button class="btn btn-sm" data-cmtpl="close">Close</button></div>
    <div class="cm-tpls" role="radiogroup" aria-label="Template">${CSR_TEMPLATES.map((t) => `<label class="chip ${t.id === f.template ? "active" : ""}" title="${esc(t.hint)}"><input type="radio" name="cmTpl" value="${t.id}" ${t.id === f.template ? "checked" : ""}> ${esc(t.name)}</label>`).join("")}</div>
    <div class="field"><label for="tfHead">Headline</label><textarea class="input" id="tfHead" rows="2" dir="auto">${esc(f.headline)}</textarea></div>
    <div class="field"><label for="tfSub">Subline</label><input class="input" id="tfSub" value="${esc(f.subline)}" dir="auto"></div>
    <div class="grid-2"><div class="field"><label for="tfBadge">Price or badge</label><input class="input" id="tfBadge" value="${esc(f.badge)}" placeholder="٢٩٩ ر.س · خصم ٢٠٪ · جديد" dir="auto"></div>
      <div class="field"><label for="tfCta">Button</label><input class="input" id="tfCta" value="${esc(f.cta)}" dir="auto"></div></div>
    <div class="grid-2"><div class="field"><label for="tfImg1">Product image (before, for before/after)</label><select class="input" id="tfImg1">${opt(f.img1)}</select></div>
      <div class="field"><label for="tfImg2">Second image (designed ad, for before/after)</label><select class="input" id="tfImg2">${opt(f.img2)}</select></div></div>
    <p class="subtle s-small">Real prices and claims only. Carousel slides come from the carousel's slide lines. Brand colours, fonts and logo come from the Brand kit.</p>
    <div class="row gap-8" style="flex-wrap:wrap"><button class="btn" data-cmtpl="download">Download this size</button>
      <button class="btn btn-primary" data-cmtpl="all" ${targets.length ? "" : "disabled"}>Render ${targets.length} size${targets.length === 1 ? "" : "s"} and attach</button></div>
    <p class="subtle s-small" id="tfStatus">${targets.length ? `Makes: ${targets.map((c) => esc(csCh(c).name)).join(", ")}. Replaces their attached images${targets.includes("yt_video") ? " (YouTube video gets the thumbnail as its cover)" : ""}.` : "None of this item's channels take a designed image."}</p></div>
    <div class="cm-prev"><canvas id="tfCanvas" aria-label="Template preview"></canvas></div></div>`;
  if (!d.open) d.showModal();
  const read = () => !$("#tfHead") ? f : Object.assign(f, { template: d.querySelector('input[name="cmTpl"]:checked')?.value || f.template, headline: $("#tfHead").value, subline: $("#tfSub").value, badge: $("#tfBadge").value, cta: $("#tfCta").value, img1: $("#tfImg1").value, img2: $("#tfImg2").value });
  let timer;
  const preview = async () => {
    read();
    const t = CSR_TEMPLATES.find((x) => x.id === f.template);
    d.querySelectorAll(".cm-tpls .chip").forEach((l) => l.classList.toggle("active", l.querySelector("input").checked));
    const slides = CS.draft.variants.ig_carousel?.slides || [];
    const { canvas } = await csrRender({ w: t.w, h: t.h, style: t.style, fields: { ...f, slide: slides[0] || f.headline, slideNo: 1, slideCount: Math.max(1, slides.length) }, brand: CS.meta.brand, imageUrls: [f.img1, f.img2].filter(Boolean).map((id) => cmById(id)?.path) });
    const c = $("#tfCanvas"); if (!c) return;
    c.width = canvas.width; c.height = canvas.height; c.getContext("2d").drawImage(canvas, 0, 0);
  };
  d.oninput = () => { clearTimeout(timer); timer = setTimeout(preview, 250); };
  d.onchange = d.oninput;
  preview();
  d.onclick = async (e) => {
    const act = e.target.closest("[data-cmtpl]")?.dataset.cmtpl; if (!act) return;
    if (act === "close") return d.close();
    read();
    const t = CSR_TEMPLATES.find((x) => x.id === f.template), brand = CS.meta.brand, urls = [f.img1, f.img2].filter(Boolean).map((id) => cmById(id)?.path);
    if (act === "download") {
      const { blob } = await csrRender({ w: t.w, h: t.h, style: t.style, fields: f, brand, imageUrls: urls });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `dpa-${t.id}.jpg`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      return;
    }
    if (act === "all") {
      const btn = e.target.closest("button"); btn.disabled = true;
      const status = $("#tfStatus");
      try {
        csCollect();
        const item = CS.draft, done = [];
        for (const ch of targets) {
          const [w, h] = CSR_CHANNEL_SIZE[ch], style = csrStyleFor(t.style, ch);
          const slides = ch === "ig_carousel" ? (item.variants[ch]?.slides?.length ? item.variants[ch].slides : [f.headline]) : [null];
          const ids = [];
          for (const [n, s] of slides.entries()) {
            status.textContent = `Rendering ${csCh(ch).name}${slides.length > 1 ? ` slide ${n + 1}/${slides.length}` : ""}…`;
            const imgUrls = ch === "ig_carousel" && style === "carousel" ? (urls.length ? [urls[n % urls.length]] : []) : urls;
            const { blob } = await csrRender({ w, h, style, fields: { ...f, slide: s, slideNo: n + 1, slideCount: slides.length }, brand, imageUrls: imgUrls });
            const file = new File([blob], `${item.title.slice(0, 40)}-${ch}${slides.length > 1 ? "-" + (n + 1) : ""}.jpg`, { type: "image/jpeg" });
            ids.push((await cmUpload(file, { source: "template", item_id: item.id, tags: `template,${t.id}` })).id);
          }
          if (ch === "yt_video") item.variants[ch].cover_id = ids[0];
          else item.variants[ch].media = ids;
          done.push(csCh(ch).name);
        }
        d.close();
        await csSave(true);
        toast(`Rendered and attached: ${done.join(", ")}`);
      } catch (err) { toast(err.message, true); status.textContent = err.message; } finally { btn.disabled = false; }
    }
  };
}

/* ------------------------------------------------ Reel builder */
function cmReelState(item, ch) {
  const v = item.variants[ch] || {};
  if (CM.reel?.item === item.id) return CM.reel;
  const imgIds = (CM.media || []).filter((m) => (v.media || []).includes(m.id) && m.kind === "image").map((m) => m.id);
  const saved = v.reel?.scenes?.length ? v.reel : null;
  return (CM.reel = { item: item.id, scenes: saved ? structuredClone(saved.scenes) : csrScenesFromScript(v.script, imgIds), audio_id: saved?.audio_id || "", volume: saved?.volume ?? 0.8, cover_scene: saved?.cover_scene || 0, support: null });
}
async function cmReel() {
  const item = CS.draft, ch = CS.chTab, R = cmReelState(item, ch), d = cmDlg();
  if (!R.scenes.length) R.scenes.push({ media_id: "", text: "", duration: 3, motion: "zoom_in" });
  R.support ||= await csrCodecSupport();
  if (R.aac === undefined) R.aac = await csrAudioSupport();
  const visual = (CM.media || []).filter((m) => m.kind === "image" || m.kind === "video"), audio = (CM.media || []).filter((m) => m.kind === "audio");
  const targets = item.channels.filter((c) => CSR_VIDEO_CHANNELS.includes(c));
  const total = R.scenes.reduce((a, s) => a + Number(s.duration || 0), 0);
  d.classList.add("wide");
  d.innerHTML = `<div class="stack" style="padding:20px"><div class="row between"><h2>Reel builder · 1080×1920, 30 fps</h2><button class="btn btn-sm" data-cmreel="close">Close</button></div>
    ${R.support.ok ? "" : `<div class="notice">${esc(R.support.reason)}</div>`}
    ${R.support.ok && !R.aac ? `<div class="notice">This browser can make the video but can't add audio (AAC). Chrome and Edge on Windows or Mac can; here, make it without audio.</div>` : ""}
    <p class="subtle s-small">Each scene: an image or video, short Arabic on-screen text, a length and a motion. Up to 60 seconds. The MP4 is saved in Assets and attached to ${targets.length ? targets.map((c) => esc(csCh(c).name)).join(", ") : "this item's video channels"}.</p>
    <div class="cm-scenes">${R.scenes.map((s, n) => `<div class="cm-scene"><div class="cm-scene-media">${s.media_id ? cmThumb(cmById(s.media_id)) : `<div class="cm-thumb missing">colour</div>`}</div>
      <div class="stack" style="flex:1;min-width:0"><div class="row gap-8" style="flex-wrap:wrap"><b class="s-small">Scene ${n + 1}</b>
        <select class="input input-sm" data-rs="${n}:media_id" aria-label="Scene ${n + 1} image or video" style="width:auto;max-width:100%"><option value="">Brand colour</option>${visual.map((m) => `<option value="${m.id}" ${m.id === s.media_id ? "selected" : ""}>${esc(m.kind === "video" ? "🎬 " : "")}${esc(m.name)}</option>`).join("")}</select>
        <select class="input input-sm" data-rs="${n}:motion" aria-label="Scene ${n + 1} motion" style="width:auto">${[["zoom_in", "Zoom in"], ["zoom_out", "Zoom out"], ["slide_left", "Slide left"], ["slide_right", "Slide right"], ["none", "Still"]].map(([k, l]) => `<option value="${k}" ${k === s.motion ? "selected" : ""}>${l}</option>`).join("")}</select>
        <label class="row gap-8 s-small"><input class="input input-sm" type="number" min="1" max="15" step="0.5" data-rs="${n}:duration" value="${esc(s.duration)}" style="width:70px" aria-label="Scene ${n + 1} seconds"> s</label>
        <span style="flex:1"></span><button class="btn btn-sm btn-ghost" data-rsmove="${n}:-1" aria-label="Move up">↑</button><button class="btn btn-sm btn-ghost" data-rsmove="${n}:1" aria-label="Move down">↓</button><button class="btn btn-sm btn-ghost" data-rsdel="${n}" aria-label="Remove scene">✕</button></div>
        <textarea class="input" rows="2" data-rs="${n}:text" dir="auto" placeholder="النص على الشاشة">${esc(s.text)}</textarea></div></div>`).join("")}</div>
    <div class="row gap-8" style="flex-wrap:wrap"><button class="btn btn-sm" data-cmreel="add">+ Scene</button><button class="btn btn-sm" data-cmreel="script" ${item.variants[ch]?.script ? "" : "disabled"}>Fill from the script</button>
      <span class="badge ${total > 60 ? "bad" : ""}">${total} s of 60</span></div>
    <div class="grid-2"><div class="field"><label for="rAudio">Voice or music (optional)</label><select class="input" id="rAudio"><option value="">No audio</option>${audio.map((m) => `<option value="${m.id}" ${m.id === R.audio_id ? "selected" : ""}>${esc(m.name)}${m.licence ? " · " + esc(m.licence) : ""}</option>`).join("")}</select>
        <div class="row gap-8" style="margin-top:6px;flex-wrap:wrap"><input type="file" class="input input-sm" id="rAudioUp" accept="audio/mpeg,audio/mp4,.mp3,.m4a" style="flex:1;min-width:0"><label class="chip"><input type="checkbox" id="rRights"> I have the rights</label><button class="btn btn-sm" data-cmreel="upaudio">Upload</button></div></div>
      <div class="field"><label for="rVol">Audio volume</label><input type="range" id="rVol" min="0" max="1" step="0.05" value="${esc(R.volume)}">
        <label for="rCover" style="margin-top:8px">Cover frame from scene</label><select class="input" id="rCover">${R.scenes.map((s, n) => `<option value="${n}" ${n === R.cover_scene ? "selected" : ""}>Scene ${n + 1}</option>`).join("")}</select></div></div>
    <div class="cm-reelprev"><canvas id="rCanvas" width="270" height="480" aria-label="Scene preview"></canvas><div class="stack" style="flex:1;min-width:0">
      <div class="row gap-8" style="flex-wrap:wrap"><button class="btn btn-sm" data-cmreel="preview">Preview scene</button><select class="input input-sm" id="rPrevScene" style="width:auto" aria-label="Scene to preview">${R.scenes.map((s, n) => `<option value="${n}">Scene ${n + 1}</option>`).join("")}</select></div>
      <progress id="rProg" max="1" value="0" hidden style="width:100%"></progress><p class="subtle s-small" id="rStatus">Making the video runs in this browser and takes about as long as the reel (keep the tab open).</p>
      <div class="row gap-8" style="flex-wrap:wrap"><button class="btn btn-primary" data-cmreel="make" ${R.support.ok && total <= 60 && total > 0 ? "" : "disabled"}>Make the MP4 and attach</button></div></div></div></div>`;
  if (!d.open) d.showModal();
  const sync = () => {
    if (!$("#rAudio")) return;
    d.querySelectorAll("[data-rs]").forEach((el) => { const [n, k] = el.dataset.rs.split(":"); R.scenes[n][k] = k === "duration" ? Math.max(1, Math.min(15, Number(el.value) || 3)) : el.value; });
    R.audio_id = $("#rAudio").value; R.volume = Number($("#rVol").value); R.cover_scene = Number($("#rCover").value) || 0;
  };
  const sceneSrc = (s) => { const m = cmById(s.media_id); return m ? { url: m.path, kind: m.kind } : { url: "", kind: "image" }; };
  const previewScene = async () => {
    sync();
    const n = Number($("#rPrevScene")?.value || 0), s = R.scenes[n]; if (!s) return;
    await csrFonts(CS.meta.brand);
    const src = sceneSrc(s), el = src.url ? (src.kind === "video" ? await csrVideoEl(src.url) : await csrImg(src.url)) : null;
    const big = document.createElement("canvas"); big.width = CSR_REEL.W; big.height = CSR_REEL.H;
    csrScene(big.getContext("2d"), CS.meta.brand, s, el, 0.6, await csrImg(CS.meta.brand.logo_url));
    const c = $("#rCanvas"); if (c) c.getContext("2d").drawImage(big, 0, 0, c.width, c.height);
  };
  previewScene();
  d.onchange = (e) => { if (e.target.closest("[data-rs]") && e.target.dataset.rs.endsWith("media_id")) { sync(); cmReel(); } };
  d.onclick = async (e) => {
    const b = e.target.closest("[data-cmreel], [data-rsmove], [data-rsdel]"); if (!b) return;
    sync();
    if (b.dataset.rsmove) { const [n, k] = b.dataset.rsmove.split(":").map(Number), j = n + k; if (j >= 0 && j < R.scenes.length) [R.scenes[n], R.scenes[j]] = [R.scenes[j], R.scenes[n]]; return cmReel(); }
    if (b.dataset.rsdel) { R.scenes.splice(Number(b.dataset.rsdel), 1); return cmReel(); }
    const act = b.dataset.cmreel;
    if (act === "close") return d.close();
    if (act === "add") { if (R.scenes.length < 20) R.scenes.push({ media_id: R.scenes.at(-1)?.media_id || "", text: "", duration: 3, motion: "zoom_in" }); return cmReel(); }
    if (act === "script") { const imgs = R.scenes.map((s) => s.media_id).filter(Boolean); R.scenes = csrScenesFromScript(CS.draft.variants[ch]?.script, imgs); return cmReel(); }
    if (act === "preview") return previewScene();
    if (act === "upaudio") {
      const f = $("#rAudioUp").files[0]; if (!f) return toast("Pick a voice or music file", true);
      if (!$("#rRights").checked) return toast('Tick "I have the rights" first', true);
      try { const m = await cmUpload(f, { rights: "1", item_id: item.id, tags: "reel audio" }); R.audio_id = m.id; toast("Audio uploaded"); return cmReel(); } catch (err) { return toast(err.message, true); }
    }
    if (act === "make") {
      b.disabled = true;
      const prog = $("#rProg"), status = $("#rStatus"); prog.hidden = false;
      try {
        const am = R.audio_id ? cmById(R.audio_id) : null;
        status.textContent = "Encoding…";
        const out = await csrEncodeReel({ scenes: R.scenes.map((s) => ({ ...s, ...sceneSrc(s), duration: Number(s.duration) })), audio: am ? { url: am.path, volume: R.volume } : null, brand: CS.meta.brand, coverScene: R.cover_scene, onProgress: (p) => { prog.value = p; } });
        status.textContent = `Uploading ${cmSize(out.mp4.size)}…`;
        const name = item.title.slice(0, 40);
        const mp4 = await cmUpload(new File([out.mp4], `${name}-reel.mp4`, { type: "video/mp4" }), { source: "reel", item_id: item.id, width: CSR_REEL.W, height: CSR_REEL.H, duration: out.duration, tags: "reel" });
        const cover = await cmUpload(new File([out.cover], `${name}-cover.jpg`, { type: "image/jpeg" }), { source: "cover", item_id: item.id, tags: "reel cover" });
        csCollect();
        for (const c of targets.length ? targets : [ch]) { const v = (CS.draft.variants[c] ||= {}); v.media = [mp4.id]; v.cover_id = cover.id; }
        CS.draft.variants[ch].reel = { scenes: R.scenes, audio_id: R.audio_id, volume: R.volume, cover_scene: R.cover_scene };
        d.close();
        await csSave(true);
        toast(`Reel made (${Math.round(out.duration)} s) and attached`);
      } catch (err) { status.textContent = err.message; toast(err.message, true); b.disabled = false; }
    }
  };
}

/* ------------------------------------------------ Events */
document.addEventListener("click", async (e) => {
  if (S.route !== "studio") return;
  const t = e.target;
  const f = t.closest("[data-cmfilter]"); if (f) { CM.filter = f.dataset.cmfilter; return cmAssetsRender(); }
  const cp = t.closest("[data-cmcopy]"); if (cp) { const m = cmById(cp.dataset.cmcopy); return navigator.clipboard.writeText(m.url).then(() => toast("Public URL copied"), () => prompt("Copy the URL", m.url)); }
  const ed = t.closest("[data-cmedit]"); if (ed) return cmEditDialog(cmById(ed.dataset.cmedit));
  const del = t.closest("[data-cmdel]");
  if (del) {
    const m = cmById(del.dataset.cmdel);
    if (!confirm(`Delete "${m.name}"?${m.used_in?.length ? ` It's attached to ${m.used_in.length} content item(s) and will be removed from them.` : ""} The public link stops working.`)) return;
    try { await api(`${csP()}/media/${m.id}`, { method: "DELETE" }); toast("Deleted"); await cmLoad(true); return cmAssetsRender(); } catch (err) { return toast(err.message, true); }
  }
  const ch = CS.chTab;
  const mv = t.closest("[data-cmmove]");
  if (mv) { const [n, k] = mv.dataset.cmmove.split(":").map(Number), ids = [...(CS.draft.variants[ch].media || [])], j = n + k; if (j < 0 || j >= ids.length) return; [ids[n], ids[j]] = [ids[j], ids[n]]; cmSetMedia(ch, ids); return csSave(true); }
  const rm = t.closest("[data-cmremove]");
  if (rm) { const ids = [...(CS.draft.variants[ch].media || [])]; ids.splice(Number(rm.dataset.cmremove), 1); cmSetMedia(ch, ids); return csSave(); }
  const a = t.closest("[data-cmact]"); if (!a) return;
  try {
    await cmLoad();
    if (a.dataset.cmact === "pick") return cmPicker(ch);
    if (a.dataset.cmact === "tpl") return cmTemplate();
    if (a.dataset.cmact === "reel") { if (CM.reel?.item !== CS.draft.id) CM.reel = null; return cmReel(); }
    if (a.dataset.cmact === "uncover") { cmSetMedia(ch, CS.draft.variants[ch].media || [], ""); return csSave(); }
  } catch (err) { toast(err.message, true); }
});
document.addEventListener("submit", (e) => { if (e.target.id === "cmUpForm") { e.preventDefault(); cmUploadForm(); } });
document.addEventListener("input", (e) => { if (e.target.id === "cmQ") { CM.q = e.target.value; clearTimeout(CM.qt); CM.qt = setTimeout(() => { cmAssetsRender(); const q = $("#cmQ"); if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } }, 200); } });
