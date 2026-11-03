// HTTP routes for the Investor room (access module "investors").
// Before the login wall (mountInvestorsPublic): the share link /i/<token> (the room), /i/<token>/item/<id> (one item,
// with the watermark "Shared with <investor> · <date>") and /i/<token>/f/<id> (the file: inline for PDF, images and
// text, ?dl=1 to download when the link allows it). No scripts (publicsite.js shell and CSP), noindex, no-store,
// no referrer; rate-limited; unknown links 404 and revoked or expired links 410 with the same neutral page.
// A passcode is checked against its scrypt hash and remembered by an HttpOnly cookie scoped to the link's path.
// Every room view, item view, file open and download is logged (investor, item, time, hashed IP + day, browser family).
// Behind the login wall (mountInvestors): /api/workspaces/:ws/investors/... investors, rounds, metrics pack and frozen
// snapshots, data room, share links, engagement, monthly updates. Roles without the module get 404 (app.js).
import crypto from "node:crypto";
import fs from "node:fs";
import { levelOk } from "./access.js";
import { workforceSummary } from "./agentroutes.js";
import { renderMarkdown } from "./helpcenter.js";
import { COLL as LEGAL, canSeeRestricted, currentVersion, legalPath, saveLegalUpload } from "./legal.js";
import { publicBase } from "./media.js";
import { canSee as canSeeMeeting } from "./meetings.js";
import { h, newNonce, publicPage, PUBLIC_HEADERS } from "./publicsite.js";
import { AGENT_ID, CLOSED, aiParts, COLL, CONFIRM, FOLDERS, FOLDER_IDS, INSTRUMENTS, ITEM_KINDS, KINDS, NO_DATA, PACK, PACK_IDS, ROUND_STATUS, STAGES, TERM_FIELDS, VIEWER_INLINE,
  cleanInvestor, cleanLink, cleanRound, cleanUrl, daysBetween, engagement, ensureInvestors, folderName, hasAdd, includesSample, isMonth, itemTarget, linkItems, linkState, liveMetrics, logView,
  monthName, newToken, passCookie, passcodeOk, people, personName, removeItemFile, roundView, stageName, stripRefs, todayOf } from "./investors.js";

const str = (v, max = 200) => String(v ?? "").trim().slice(0, max);
const safeName = (s) => String(s || "file").replace(/[^\w.\-]+/g, "_").slice(0, 80) || "file";
const fmtSize = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round((n || 0) / 1024))} KB`);
const T = {
  en: { section: "Investor room", room: "Data room", gone: "This link isn't available", goneText: "The link may have expired or been switched off. Ask the person who shared it for a new one.", for: "Prepared for", until: "Link valid until",
    shared: "Shared with", back: "← Data room", none: "Nothing is shared in this folder.", empty: "Nothing is shared on this link yet.", open: "Open the file", download: "Download", noDownload: "Viewing only: downloads are switched off for this link.",
    noView: "This file type can't be shown in the browser and downloads are switched off for this link. Ask for a copy.", openLink: "Open the link", sample: "SAMPLE: built from sample data. These are not real numbers.", metric: "Metric", value: "Value", source: "Source", asOf: "As of",
    frozen: "Frozen snapshot: these numbers were saved on", pass: "This data room is protected", passText: "Enter the passcode you were given.", passLabel: "Passcode", passBtn: "Open", passBad: "That passcode isn't right.",
    many: "Too many requests. Please try again in a few minutes.", logged: "Views of this room are recorded for the company (date, item, browser type; no tracking cookies). Please don't forward this link.", unavailable: "No longer available" },
  ar: { section: "غرفة المستثمرين", room: "غرفة البيانات", gone: "هذا الرابط غير متاح", goneText: "ممكن انتهت صلاحية الرابط أو تم إيقافه. اطلب رابط جديد من الشخص اللي أرسله لك.", for: "مُعدّة لـ", until: "الرابط صالح حتى",
    shared: "مشارك مع", back: "غرفة البيانات →", none: "ما فيه شيء مشارك في هذا المجلد.", empty: "ما فيه شيء مشارك في هذا الرابط حالياً.", open: "افتح الملف", download: "تحميل", noDownload: "للعرض فقط: التحميل موقوف لهذا الرابط.",
    noView: "ما نقدر نعرض هذا النوع من الملفات في المتصفح، والتحميل موقوف لهذا الرابط. اطلب نسخة.", openLink: "افتح الرابط", sample: "عيّنة: مبنية على بيانات تجريبية. هذه ليست أرقام حقيقية.", metric: "المؤشر", value: "القيمة", source: "المصدر", asOf: "بتاريخ",
    frozen: "لقطة مجمّدة: هذه الأرقام محفوظة بتاريخ", pass: "غرفة البيانات محمية", passText: "اكتب رمز الدخول اللي وصلك.", passLabel: "رمز الدخول", passBtn: "افتح", passBad: "رمز الدخول غير صحيح.",
    many: "طلبات كثيرة. حاول بعد دقائق.", logged: "يتم تسجيل مشاهدات هذه الغرفة للشركة (التاريخ، الملف، نوع المتصفح؛ بدون كوكيز تتبع). الرجاء عدم إعادة إرسال الرابط.", unavailable: "غير متاح الآن" },
};
const CSS = `.wm{margin:0;padding:8px 12px;border-radius:10px;background:var(--soft);font-size:14px;font-weight:600;overflow-wrap:anywhere}.wmk{position:relative;border-radius:14px}
.ivt{width:100%;border-collapse:collapse;font-size:14px}.ivt th,.ivt td{text-align:start;padding:8px 6px;border-top:1px solid var(--border);vertical-align:top;overflow-wrap:anywhere}.ivt th{color:var(--muted);font-weight:600}
.tw{overflow-x:auto}.warn{background:#fff4d6;color:#5c4400;border-radius:10px;padding:10px 12px;font-weight:600}.preview img{display:block;max-width:100%;height:auto;border-radius:10px}.preview pre{white-space:pre-wrap;overflow-wrap:anywhere;background:var(--soft);padding:12px;border-radius:10px;max-height:70vh;overflow:auto;direction:ltr;text-align:left}
form.pc{display:grid;gap:8px;max-width:340px}form.pc input{font:inherit;padding:10px 12px;border:1px solid var(--border);border-radius:10px;background:var(--bg);color:var(--text)}.err{color:#b42318;font-weight:600;margin:0}
ul.items li{display:flex;justify-content:space-between;gap:8px 12px;flex-wrap:wrap;border-top:1px solid var(--border);padding:8px 0}ul.items li:first-child{border-top:0}.kindl{color:var(--muted);font-size:13px}`;

export function mountInvestorsPublic(app, { store, investors, env = process.env }) {
  ensureInvestors(store);
  const hits = new Map();
  const limited = (key, max, windowMs) => {
    const t = Date.now(), list = (hits.get(key) || []).filter((x) => t - x < windowMs);
    list.push(t); hits.set(key, list);
    if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((x) => t - x < windowMs)) hits.delete(k);
    return list.length > max;
  };
  const secure = !/^http:\/\//i.test(env.PUBLIC_URL || "https://");
  const now = () => investors.now();
  const lang = (req) => (req.query.lang === "ar" ? "ar" : "en");
  // The watermark drawn behind the viewer: the investor's name and the day, repeated diagonally (an SVG data URI in the nonce'd style block).
  const wmCss = (text) => { const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="200"><text x="20" y="120" transform="rotate(-24 180 100)" font-family="system-ui,sans-serif" font-size="15" fill="#888" fill-opacity=".16">${h(text)}</text></svg>`;
    return `.wmk{background-image:url("data:image/svg+xml,${encodeURIComponent(svg).replace(/'/g, "%27").replace(/\(/g, "%28").replace(/\)/g, "%29")}");background-repeat:repeat}`; };
  const send = (res, { w, l, title = "", body, status = 200, wm = "", tok = "" }) => {
    const nonce = newNonce(), t = T[l];
    const base = tok ? `/i/${tok}` : "/i";
    const html = publicPage({ w, lang: l, nonce, title, section: t.section, homeHref: tok ? (l === "ar" ? `${base}?lang=ar` : base) : "#", switchHref: tok ? (l === "ar" ? base : `${base}?lang=ar`) : "?lang=ar", body, noindex: true, css: CSS + (wm ? wmCss(wm) : "") });
    res.status(status).set({ "Content-Type": "text/html; charset=utf-8", ...PUBLIC_HEADERS, "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow, noarchive", "Cache-Control": "no-store",
      "Content-Security-Policy": `default-src 'none'; style-src 'nonce-${nonce}'; img-src 'self' data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'` }).send(html);
  };
  const gone = (res, l, status = 404) => send(res, { w: null, l, title: T[l].gone, status, body: `<div class="card"><h1>${h(T[l].gone)}</h1><p>${h(T[l].goneText)}</p></div>` });
  const findLink = (tok) => {
    const t = String(tok || "");
    if (t.length < 20 || t.length > 64) return null;
    return store.db[COLL.links].find((x) => x.token.length === t.length && crypto.timingSafeEqual(Buffer.from(x.token), Buffer.from(t))) || null;
  };
  const cookieOk = (req, l) => { const m = /(?:^|;\s*)ivp=([^;]+)/.exec(req.headers.cookie || ""); const want = passCookie(store, l); return !!m && m[1].length === want.length && crypto.timingSafeEqual(Buffer.from(m[1]), Buffer.from(want)); };
  // Every /i/ request: rate limit, link lookup, state, passcode. Returns { l, w, inv, t, lg } or null when a page was sent.
  const gate = (req, res, { form = false } = {}) => {
    const lg = lang(req);
    if (limited("i:" + req.ip, 120, 10 * 60e3)) { send(res, { w: null, l: lg, status: 429, body: `<div class="card"><p>${h(T[lg].many)}</p></div>` }); return null; }
    const l = findLink(req.params.token);
    const w = l ? store.getWorkspace(l.workspace_id) : null, inv = l && w ? store.getOps(COLL.investors, w.id, l.investor_id) : null;
    if (!l || !w || !inv) { gone(res, lg, 404); return null; }
    if (linkState(l, todayOf(now())) !== "active") { gone(res, lg, 410); return null; }
    if (l.passcode && !form && !cookieOk(req, l)) {
      if (req.params.item) { res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" }).redirect(303, `/i/${l.token}${lg === "ar" ? "?lang=ar" : ""}`); return null; }
      passPage(res, { w, l, lg }); return null;
    }
    return { l, w, inv, t: T[lg], lg };
  };
  const passPage = (res, { w, l, lg, bad = false }) => send(res, { w, l: lg, tok: l.token, title: T[lg].pass, status: bad ? 401 : 200,
    body: `<div class="card"><h1>${h(T[lg].pass)}</h1><p>${h(T[lg].passText)}</p><form class="pc" method="post" action="/i/${h(l.token)}${lg === "ar" ? "?lang=ar" : ""}">${bad ? `<p class="err" role="alert">${h(T[lg].passBad)}</p>` : ""}<label for="pc">${h(T[lg].passLabel)}</label><input id="pc" name="passcode" type="password" autocomplete="off" required maxlength="64"><button type="submit">${h(T[lg].passBtn)}</button></form></div>` });
  const stamp = (g) => `${g.t.shared} ${g.inv.name} · ${todayOf(now())}`;
  const q = (g) => (g.lg === "ar" ? "?lang=ar" : "");
  const log = (g, req, item, action) => logView(store, g.l, { item, action, ip: req.ip, ua: req.headers["user-agent"], now: now() });

  app.post("/i/:token", (req, res) => {
    const g = gate(req, res, { form: true }); if (!g) return;
    if (!g.l.passcode) return res.redirect(303, `/i/${g.l.token}${q(g)}`);
    if (limited(`pc:${req.ip}:${g.l.id}`, 10, 15 * 60e3)) return send(res, { w: g.w, l: g.lg, status: 429, body: `<div class="card"><p>${h(g.t.many)}</p></div>` });
    if (!passcodeOk(g.l, req.body?.passcode)) return passPage(res, { w: g.w, l: g.l, lg: g.lg, bad: true });
    res.set({ "Set-Cookie": `ivp=${passCookie(store, g.l)}; Path=/i/${g.l.token}; Max-Age=43200; HttpOnly; SameSite=Strict${secure ? "; Secure" : ""}`, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
    res.redirect(303, `/i/${g.l.token}${q(g)}`);
  });
  app.get("/i/:token", (req, res) => {
    const g = gate(req, res); if (!g) return;
    const items = linkItems(store, g.w.id, g.l);
    log(g, req, null, "view");
    const folders = FOLDERS.filter((f) => items.some((it) => it.folder === f.id)).map((f) => `<section class="card"><h2 class="t">${h(f.name)}</h2><ul class="list items">${items.filter((it) => it.folder === f.id).map((it) => {
      const ok = itemTarget(store, g.w, it).ok;
      return `<li>${ok ? `<a href="/i/${h(g.l.token)}/item/${h(it.id)}${q(g)}" dir="auto">${h(it.title)}</a>` : `<span dir="auto">${h(it.title)}</span>`}<span class="kindl">${h(ok ? ITEM_KINDS.find((k) => k.id === it.kind)?.name || it.kind : g.t.unavailable)}${it.file?.size ? ` · ${h(fmtSize(it.file.size))}` : ""}</span></li>`;
    }).join("")}</ul></section>`).join("");
    send(res, { w: g.w, l: g.lg, tok: g.l.token, title: g.t.room, wm: stamp(g), body: `<p class="wm" role="note" dir="auto">${h(stamp(g))}</p>
      <div class="hero"><h1>${h(g.t.room)}</h1><p class="muted m0" dir="auto">${h(g.t.for)} ${h(g.inv.name)} · ${h(g.t.until)} ${h(g.l.expires_on)}</p></div>
      ${folders || `<div class="card"><p>${h(g.t.empty)}</p></div>`}<p class="muted">${h(g.t.logged)}</p>` });
  });
  const itemOf = (req, res, g) => {
    const it = linkItems(store, g.w.id, g.l).find((x) => x.id === String(req.params.item));
    const tg = it ? itemTarget(store, g.w, it) : null;
    if (!it || !tg.ok) { gone(res, g.lg, 404); return null; }
    return { it, tg };
  };
  app.get("/i/:token/item/:item", (req, res) => {
    const g = gate(req, res); if (!g) return;
    const x = itemOf(req, res, g); if (!x) return;
    const { it, tg } = x, t = g.t, tok = h(g.l.token);
    log(g, req, it, "view");
    let inner = "";
    if (it.kind === "snapshot") {
      const s = tg.snapshot;
      inner = `${s.sample || s.includes_sample ? `<p class="warn" role="note">${h(t.sample)}</p>` : ""}<p class="muted">${h(t.frozen)} ${h(s.as_of)}.</p>
        <div class="tw"><table class="ivt"><thead><tr><th>${h(t.metric)}</th><th>${h(t.value)}</th><th>${h(t.source)}</th><th>${h(t.asOf)}</th></tr></thead><tbody>${s.metrics.map((m) => `<tr><td>${h(m.name)}</td><td><b>${h(m.display)}</b>${m.note && m.display === NO_DATA ? "" : m.note ? `<br><span class="muted">${h(m.note)}</span>` : ""}</td><td class="muted">${h(m.source || "–")}</td><td class="muted">${h(m.as_of)}</td></tr>`).join("")}</tbody></table></div>`;
    } else if (it.kind === "update") {
      inner = `<div class="body" dir="auto">${renderMarkdown(stripRefs(tg.update.text).replace(/^# .*\n/, ""))}</div>`;
    } else if (it.kind === "link") {
      inner = `<p dir="ltr" class="muted">${h(it.url)}</p><p><a class="btn" href="${h(it.url)}" rel="noopener noreferrer" target="_blank">${h(t.openLink)} ↗</a></p>`;
    } else {
      const f = tg.file, src = `/i/${tok}/f/${h(it.id)}${q(g)}`, dl = g.l.download ? `<a class="btn ghost" href="/i/${tok}/f/${h(it.id)}?dl=1${g.lg === "ar" ? "&amp;lang=ar" : ""}">${h(t.download)}</a>` : "";
      let view = "";
      if (f.ext === "png" || f.ext === "jpg") view = `<img src="${src}" alt="${h(it.title)}">`;
      else if (f.ext === "txt") { const p = legalPath(store, f.file); view = `<pre dir="auto">${h(fs.readFileSync(p, "utf8").slice(0, 200_000))}</pre>`; }
      else if (f.ext === "pdf") view = `<p><a class="btn" href="${src}" target="_blank" rel="noopener">${h(t.open)} (PDF)</a></p>`;
      else if (!g.l.download) view = `<p>${h(t.noView)}</p>`;
      inner = `<div class="preview">${view}</div><div class="row mt12">${dl}${!g.l.download && VIEWER_INLINE.includes(f.ext) ? `<span class="muted">${h(t.noDownload)}</span>` : ""}</div>`;
    }
    send(res, { w: g.w, l: g.lg, tok: g.l.token, title: it.title, wm: stamp(g), body: `<p class="crumb"><a href="/i/${tok}${q(g)}">${h(t.back)}</a> · ${h(folderName(it.folder))}</p>
      <p class="wm" role="note" dir="auto">${h(stamp(g))}</p><article class="card wmk"><h1 dir="auto">${h(it.title)}</h1>${it.note ? `<p class="muted" dir="auto">${h(it.note)}</p>` : ""}${inner}</article><p class="muted">${h(t.logged)}</p>` });
  });
  // The file itself. Inline only for PDF, images and text; ?dl=1 downloads when the link allows it. Files are never modified.
  app.get("/i/:token/f/:item", (req, res) => {
    const g = gate(req, res); if (!g) return;
    const x = itemOf(req, res, g); if (!x) return;
    const f = x.tg.file; if (!f) return gone(res, g.lg, 404);
    const dl = req.query.dl === "1";
    if (dl && !g.l.download) return send(res, { w: g.w, l: g.lg, tok: g.l.token, status: 403, body: `<div class="card"><p>${h(g.t.noDownload)}</p></div>` });
    if (!dl && !VIEWER_INLINE.includes(f.ext)) return send(res, { w: g.w, l: g.lg, tok: g.l.token, status: 403, body: `<div class="card"><p>${h(g.t.noView)}</p></div>` });
    const p = legalPath(store, f.file);
    if (!p || !fs.existsSync(p)) return gone(res, g.lg, 404);
    log(g, req, x.it, dl ? "download" : "open");
    res.set({ "Content-Type": f.mime, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow, noarchive",
      "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'", "Content-Disposition": `${dl ? "attachment" : "inline"}; filename="${safeName(f.name || x.it.title)}"` });
    fs.createReadStream(p).pipe(res);
  });
}

export function mountInvestors(app, { store, investors, workforce = null, env = process.env }) {
  ensureInvestors(store);
  const P = "/api/workspaces/:ws/investors";
  const W = (req, res) => { const w = store.getWorkspace(req.params.ws); if (!w) res.status(404).json({ detail: "Workspace not found" }); return w; };
  const by = (req) => req.user?.name || "you";
  const now = () => investors.now();
  const iso = () => new Date(now()).toISOString();
  const today = () => todayOf(now());
  const can = (req, mod, lvl = "view") => levelOk(req.perms?.[mod], lvl);
  const audit = (res, text) => { res.locals.audit = String(text).slice(0, 200); }; // the activity log line for this change (app.js)
  const outcome = (w, o, note) => workforce?.event(AGENT_ID, w.id, o, note);
  const agentsActive = () => { try { return workforce ? workforceSummary(store, workforce).totals.active : null; } catch { return null; } };
  const linkUrl = (l) => `${publicBase(env)}/i/${l.token}`;
  const one = (coll, req, res, w, name, id = req.params.id) => { const x = store.getOps(coll, w.id, id); if (!x) res.status(404).json({ detail: `${name} not found` }); return x; };
  const pushLog = (x, req, text) => { (x.log ||= []).push({ at: iso(), by: by(req), text: String(text).slice(0, 300) }); };
  const views = (w) => store.listOps(COLL.views, w.id);
  const invView = (w, i) => {
    const v = views(w).filter((x) => x.investor_id === i.id), r = i.round_id ? store.getOps(COLL.rounds, w.id, i.round_id) : null;
    return { ...i, stage_name: stageName(i.stage), owner_name: personName(store, i.owner_id), round_name: r?.name || null, overdue: !CLOSED.includes(i.stage) && !!i.next_step_date && i.next_step_date < today(),
      views: v.length, last_view_at: v.reduce((a, x) => (x.at > a ? x.at : a), "") || null, links_active: store.listOps(COLL.links, w.id).filter((l) => l.investor_id === i.id && linkState(l, today()) === "active").length, notes_count: (i.notes || []).length };
  };
  const itemView = (w, it) => { const tg = itemTarget(store, w, it); return { ...it, available: tg.ok, reason: tg.ok ? "" : tg.reason, ext: tg.file?.ext || null, size: tg.file?.size || null }; };
  const linkView = (w, l) => { const { passcode, ...rest } = l; const inv = store.getOps(COLL.investors, w.id, l.investor_id); const v = views(w).filter((x) => x.link_id === l.id);
    return { ...rest, has_passcode: !!passcode, url: linkUrl(l), state: linkState(l, today()), investor_name: inv?.name || "(deleted)", items_shared: linkItems(store, w.id, l).length, views: v.length, days_left: daysBetween(today(), l.expires_on) }; };

  app.get(`${P}/meta`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const docs = can(req, "legal") ? store.listOps(LEGAL.docs, w.id).filter((d) => d.confidentiality !== "restricted" || canSeeRestricted(req.user)).map((d) => ({ id: d.id, title: d.title, type: d.type, status: d.status, restricted: d.confidentiality === "restricted", has_file: !!currentVersion(d) })) : [];
    const meetings = (store.db.meetings_meetings || []).filter((m) => m.workspace_id === w.id && canSeeMeeting(req.user, m)).sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 200).map((m) => ({ id: m.id, title: m.title, date: m.date, type: m.type }));
    res.json({ stages: STAGES, kinds: KINDS, folders: FOLDERS, item_kinds: ITEM_KINDS, instruments: INSTRUMENTS, round_statuses: ROUND_STATUS, term_fields: TERM_FIELDS, pack: PACK, people: people(store), today: today(),
      legal_documents: docs, meetings, agent_level: investors.level(), me: { edit: can(req, "investors", "edit"), restricted: canSeeRestricted(req.user), legal: can(req, "legal") }, base: publicBase(env), no_data: NO_DATA, confirm: CONFIRM });
  });

  // ---- investors
  app.get(`${P}/investors`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const q = str(req.query.q, 80).toLowerCase();
    let list = store.listOps(COLL.investors, w.id);
    if (req.query.stage) list = list.filter((i) => i.stage === String(req.query.stage));
    if (q) list = list.filter((i) => `${i.name} ${i.firm || ""} ${i.thesis || ""} ${i.contact?.name || ""}`.toLowerCase().includes(q));
    const rows = list.map((i) => invView(w, i)).sort((a, b) => STAGES.findIndex((s) => s.id === a.stage) - STAGES.findIndex((s) => s.id === b.stage) || a.name.localeCompare(b.name));
    const all = store.listOps(COLL.investors, w.id);
    res.json({ investors: rows, by_stage: Object.fromEntries(STAGES.map((s) => [s.id, all.filter((i) => i.stage === s.id).length])), total: all.length, overdue: all.filter((i) => !CLOSED.includes(i.stage) && i.next_step_date && i.next_step_date < today()).length, today: today() });
  });
  app.post(`${P}/investors`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const { o, err } = cleanInvestor(req.body || {}, { store, wsId: w.id });
    if (err.length) return res.status(422).json({ detail: err.join("; ") });
    const i = store.addOps(COLL.investors, w.id, { firm: "", website: "", contact: { name: "", email: "", phone: "" }, check_min_usd: null, check_max_usd: null, committed_usd: null, thesis: "", intro_path: "", next_step: "", next_step_date: null, owner_id: req.user.id,
      round_id: null, meeting_ids: [], document_ids: [], pass_reason: "", notes: [], log: [], created_by: by(req), ...o }, false);
    pushLog(i, req, `Investor added (${stageName(i.stage)})`);
    store.save(); audit(res, `added investor "${i.name.slice(0, 60)}"`);
    res.status(201).json(invView(w, i));
  });
  app.get(`${P}/investors/:id`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const i = one(COLL.investors, req, res, w, "Investor"); if (!i) return;
    const meetings = (i.meeting_ids || []).map((id) => (store.db.meetings_meetings || []).find((m) => m.id === id && m.workspace_id === w.id)).filter((m) => m && canSeeMeeting(req.user, m)).map((m) => ({ id: m.id, title: m.title, date: m.date, type: m.type }));
    const docs = (i.document_ids || []).map((id) => store.getOps(COLL.items, w.id, id)).filter(Boolean).map((it) => itemView(w, it));
    const items = new Map(store.listOps(COLL.items, w.id).map((x) => [x.id, x.title]));
    res.json({ ...invView(w, i), meetings, documents: docs, links: store.listOps(COLL.links, w.id).filter((l) => l.investor_id === i.id).map((l) => linkView(w, l)),
      engagement: engagement(store, w.id, { investorId: i.id }).map((r) => ({ ...r, item_title: r.item_id ? items.get(r.item_id) || "(removed item)" : "Data room (index)" })) });
  });
  app.put(`${P}/investors/:id`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const i = one(COLL.investors, req, res, w, "Investor"); if (!i) return;
    const { o, err } = cleanInvestor(req.body || {}, { store, wsId: w.id, partial: true });
    if (err.length) return res.status(422).json({ detail: err.join("; ") });
    const next = { ...i, ...o };
    if (next.check_min_usd != null && next.check_max_usd != null && next.check_min_usd > next.check_max_usd) return res.status(422).json({ detail: "check_min_usd is more than check_max_usd" });
    const changes = Object.keys(o).filter((k) => JSON.stringify(o[k]) !== JSON.stringify(i[k]));
    Object.assign(i, o, { updated_at: iso() });
    if (changes.length) pushLog(i, req, changes.map((k) => (k === "stage" ? `stage → ${stageName(o.stage)}` : k === "committed_usd" ? `committed amount → ${o.committed_usd == null ? "cleared" : `USD ${o.committed_usd.toLocaleString("en-US")}`}` : `${k.replace(/_/g, " ")} edited`)).join(", "));
    store.save(); audit(res, `changed investor "${i.name.slice(0, 60)}"${o.stage && changes.includes("stage") ? ` (stage → ${stageName(o.stage)})` : ""}`);
    res.json(invView(w, i));
  });
  app.delete(`${P}/investors/:id`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const i = one(COLL.investors, req, res, w, "Investor"); if (!i) return;
    const links = new Set(store.listOps(COLL.links, w.id).filter((l) => l.investor_id === i.id).map((l) => l.id));
    store.db[COLL.links] = store.db[COLL.links].filter((l) => !links.has(l.id));
    store.db[COLL.views] = store.db[COLL.views].filter((v) => !(v.workspace_id === w.id && v.investor_id === i.id));
    store.deleteOps(COLL.investors, w.id, i.id); audit(res, `deleted investor "${i.name.slice(0, 60)}" and ${links.size} share link${links.size === 1 ? "" : "s"}`);
    res.status(204).end();
  });
  app.post(`${P}/investors/:id/notes`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const i = one(COLL.investors, req, res, w, "Investor"); if (!i) return;
    const text = str(req.body?.text, 4000);
    if (!text) return res.status(422).json({ detail: "text is required" });
    const n = { id: store.newId(), at: iso(), by: by(req), text };
    i.notes = [...(i.notes || []), n];
    store.save(); audit(res, `added a note to investor "${i.name.slice(0, 60)}"`);
    res.status(201).json(n);
  });

  // ---- rounds: committed = sum of committed investors' typed amounts; valuation / cap fields stay [CONFIRM] until a person confirms them
  app.get(`${P}/rounds`, (req, res) => { const w = W(req, res); if (w) res.json({ rounds: store.listOps(COLL.rounds, w.id).map((r) => roundView(store, r)) }); });
  app.post(`${P}/rounds`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const { o, err } = cleanRound(req.body || {});
    if (err.length) return res.status(422).json({ detail: err.join("; ") });
    const r = store.addOps(COLL.rounds, w.id, { target_usd: null, valuation_cap_usd: null, pre_money_usd: null, discount_pct: null, notes: "", close_date: null, terms_confirmed: false, created_by: by(req), ...o });
    audit(res, `added round "${r.name.slice(0, 60)}"`);
    res.status(201).json(roundView(store, r));
  });
  app.put(`${P}/rounds/:id`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const r = one(COLL.rounds, req, res, w, "Round"); if (!r) return;
    const { o, err } = cleanRound(req.body || {}, { partial: true });
    if (err.length) return res.status(422).json({ detail: err.join("; ") });
    if (TERM_FIELDS.some((k) => k in o && o[k] !== r[k])) Object.assign(o, { terms_confirmed: false, terms_confirmed_by: null, terms_confirmed_at: null }); // changed terms need confirming again
    Object.assign(r, o, { updated_at: iso() }); store.save(); audit(res, `changed round "${r.name.slice(0, 60)}"`);
    res.json(roundView(store, r));
  });
  app.post(`${P}/rounds/:id/confirm-terms`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const r = one(COLL.rounds, req, res, w, "Round"); if (!r) return;
    if (!TERM_FIELDS.some((k) => r[k] != null)) return res.status(422).json({ detail: "Type the valuation cap, pre-money or discount first." });
    Object.assign(r, { terms_confirmed: true, terms_confirmed_by: by(req), terms_confirmed_at: iso() }); store.save(); audit(res, `confirmed the terms of round "${r.name.slice(0, 60)}"`);
    res.json(roundView(store, r));
  });
  app.delete(`${P}/rounds/:id`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const r = one(COLL.rounds, req, res, w, "Round"); if (!r) return;
    for (const i of store.listOps(COLL.investors, w.id)) if (i.round_id === r.id) i.round_id = null;
    store.deleteOps(COLL.rounds, w.id, r.id); audit(res, `deleted round "${r.name.slice(0, 60)}"`);
    res.status(204).end();
  });

  // ---- metrics pack and frozen snapshots
  app.get(`${P}/metrics`, (req, res) => {
    const w = W(req, res); if (!w) return;
    res.json({ metrics: liveMetrics({ store, crm: app.locals.crm, w, agentsActive: agentsActive(), now: now() }), includes_sample: includesSample(store, w.id), today: today() });
  });
  app.get(`${P}/snapshots`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const used = new Set(store.listOps(COLL.items, w.id).filter((it) => it.kind === "snapshot").map((it) => it.ref_id));
    res.json({ snapshots: store.listOps(COLL.snapshots, w.id).sort((a, b) => b.frozen_at.localeCompare(a.frozen_at)).map((s) => ({ ...s, in_room: used.has(s.id) })) });
  });
  app.get(`${P}/snapshots/:id`, (req, res) => { const w = W(req, res); if (!w) return; const s = one(COLL.snapshots, req, res, w, "Snapshot"); if (s) res.json(s); });
  app.post(`${P}/snapshots`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const b = req.body || {};
    const ids = Array.isArray(b.metric_ids) ? [...new Set(b.metric_ids.map(String))] : PACK_IDS;
    const bad = ids.filter((x) => !PACK_IDS.includes(x));
    if (bad.length) return res.status(422).json({ detail: `unknown metrics: ${bad.join(", ")}` });
    if (!ids.length) return res.status(422).json({ detail: "Pick at least one metric for the pack." });
    const live = liveMetrics({ store, crm: app.locals.crm, w, agentsActive: agentsActive(), now: now() });
    const sample = includesSample(store, w.id);
    const label = str(b.label, 120) || `Metrics pack · ${today()}`;
    const s = store.addOps(COLL.snapshots, w.id, { label: sample && !/sample/i.test(label) ? `${label} (includes sample data)` : label, metric_ids: ids, metrics: JSON.parse(JSON.stringify(live.filter((m) => ids.includes(m.id)))), as_of: today(), frozen_at: iso(), frozen_by: by(req), includes_sample: sample });
    audit(res, `froze metrics snapshot "${s.label.slice(0, 60)}" (${ids.length} metrics)`);
    res.status(201).json(s);
  });
  app.put(`${P}/snapshots/:id`, (req, res) => { const w = W(req, res); if (!w) return; const s = one(COLL.snapshots, req, res, w, "Snapshot"); if (s) res.status(409).json({ detail: "A frozen snapshot can't be changed: freeze a new one instead." }); });
  app.delete(`${P}/snapshots/:id`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const s = one(COLL.snapshots, req, res, w, "Snapshot"); if (!s) return;
    if (store.listOps(COLL.items, w.id).some((it) => it.kind === "snapshot" && it.ref_id === s.id) || store.listOps(COLL.updates, w.id).some((u) => u.snapshot_id === s.id)) return res.status(409).json({ detail: "This snapshot is in the data room or an investor update: remove it from there first." });
    store.deleteOps(COLL.snapshots, w.id, s.id); audit(res, `deleted metrics snapshot "${s.label.slice(0, 60)}"`);
    res.status(204).end();
  });

  // ---- data room
  app.get(`${P}/room`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const items = store.listOps(COLL.items, w.id).map((it) => itemView(w, it)).sort((a, b) => FOLDER_IDS.indexOf(a.folder) - FOLDER_IDS.indexOf(b.folder) || a.title.localeCompare(b.title));
    res.json({ folders: FOLDERS.map((f) => ({ ...f, items: items.filter((it) => it.folder === f.id) })), total: items.length });
  });
  app.post(`${P}/room/items`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const b = req.body || {}, folder = String(b.folder || ""), kind = String(b.kind || "");
    if (!FOLDER_IDS.includes(folder)) return res.status(422).json({ detail: `folder must be one of ${FOLDER_IDS.join(", ")}` });
    const f = { folder, kind, title: str(b.title, 160), note: str(b.note, 500), ref_id: null, url: "", restricted: false, added_by: by(req), added_at: iso() };
    if (kind === "legal_doc") {
      if (!can(req, "legal")) return res.status(403).json({ detail: "Adding a Legal document needs View on Legal & documents." });
      const d = store.getOps(LEGAL.docs, w.id, b.ref_id);
      if (!d || (d.confidentiality === "restricted" && !canSeeRestricted(req.user))) return res.status(404).json({ detail: "Document not found" });
      if (d.confidentiality === "restricted") {
        if (b.share_restricted !== true) return res.status(422).json({ detail: "This document is restricted. Tick \"share restricted\" to put it in the data room on purpose." });
        f.restricted = true;
      }
      if (!currentVersion(d)) return res.status(422).json({ detail: "The document has no file yet: upload one in Legal & documents first." });
      Object.assign(f, { ref_id: d.id, title: f.title || d.title });
    } else if (kind === "snapshot") {
      const s = store.getOps(COLL.snapshots, w.id, b.ref_id); if (!s) return res.status(404).json({ detail: "Snapshot not found" });
      Object.assign(f, { ref_id: s.id, title: f.title || s.label, ...(s.sample ? { sample: true } : {}) });
    } else if (kind === "update") {
      const u = store.getOps(COLL.updates, w.id, b.ref_id); if (!u) return res.status(404).json({ detail: "Update not found" });
      if (u.status !== "approved") return res.status(422).json({ detail: "Only an approved investor update can go in the data room." });
      Object.assign(f, { ref_id: u.id, title: f.title || `Investor update · ${monthName(u.month)}` });
    } else if (kind === "link") {
      f.url = cleanUrl(b.url); if (!f.url) return res.status(422).json({ detail: "url must be an https:// link" });
      if (!f.title) return res.status(422).json({ detail: "title is required" });
    } else return res.status(422).json({ detail: "kind must be legal_doc, snapshot, update or link (upload files with the file button)" });
    const it = store.addOps(COLL.items, w.id, f);
    audit(res, `added "${it.title.slice(0, 60)}" to the data room (${folderName(folder)}${it.restricted ? ", restricted document shared on purpose" : ""})`);
    res.status(201).json(itemView(w, it));
  });
  app.post(`${P}/room/files`, async (req, res) => {
    const w = W(req, res); if (!w) { req.resume(); return; }
    const q = req.query || {}, folder = String(q.folder || "");
    if (!FOLDER_IDS.includes(folder)) { req.resume(); return res.status(422).json({ detail: `folder must be one of ${FOLDER_IDS.join(", ")}` }); }
    try {
      const file = await saveLegalUpload(store, req, String(q.filename || ""));
      const it = store.addOps(COLL.items, w.id, { folder, kind: "file", title: str(q.title, 160) || str(q.filename, 160) || "File", note: str(q.note, 500), ref_id: null, url: "", restricted: false, file: { ...file, name: str(q.filename, 120) || file.file }, added_by: by(req), added_at: iso() });
      audit(res, `uploaded "${it.title.slice(0, 60)}" to the data room (${folderName(folder)})`);
      res.status(201).json(itemView(w, it));
    } catch (e) { if (!res.headersSent) res.status(e.status || 500).json({ detail: e.message || "Upload failed" }); }
  });
  app.put(`${P}/room/items/:id`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const it = one(COLL.items, req, res, w, "Item"); if (!it) return;
    const b = req.body || {}, o = {};
    if (b.folder !== undefined) { if (!FOLDER_IDS.includes(String(b.folder))) return res.status(422).json({ detail: `folder must be one of ${FOLDER_IDS.join(", ")}` }); o.folder = String(b.folder); }
    if (b.title !== undefined) { o.title = str(b.title, 160); if (!o.title) return res.status(422).json({ detail: "title cannot be empty" }); }
    if (b.note !== undefined) o.note = str(b.note, 500);
    if (b.url !== undefined && it.kind === "link") { o.url = cleanUrl(b.url); if (!o.url) return res.status(422).json({ detail: "url must be an https:// link" }); }
    Object.assign(it, o, { updated_at: iso() }); store.save(); audit(res, `changed data room item "${it.title.slice(0, 60)}"`);
    res.json(itemView(w, it));
  });
  app.delete(`${P}/room/items/:id`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const it = one(COLL.items, req, res, w, "Item"); if (!it) return;
    removeItemFile(store, it);
    for (const l of store.listOps(COLL.links, w.id)) l.item_ids = (l.item_ids || []).filter((x) => x !== it.id);
    for (const i of store.listOps(COLL.investors, w.id)) i.document_ids = (i.document_ids || []).filter((x) => x !== it.id);
    store.deleteOps(COLL.items, w.id, it.id); audit(res, `removed "${it.title.slice(0, 60)}" from the data room`);
    res.status(204).end();
  });

  // ---- share links
  app.get(`${P}/links`, (req, res) => { const w = W(req, res); if (w) res.json({ links: store.listOps(COLL.links, w.id).map((l) => linkView(w, l)).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))), today: today() }); });
  app.post(`${P}/links`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const { o, err } = cleanLink(req.body || {}, { store, wsId: w.id, today: today() });
    if (err.length) return res.status(422).json({ detail: err.join("; ") });
    const inv = store.getOps(COLL.investors, w.id, o.investor_id);
    const l = store.addOps(COLL.links, w.id, { label: "", passcode: null, ...o, token: newToken(), revoked_at: null, revoked_by: null, created_by: by(req), created_at: iso(), last_view_at: null, ...(inv.sample ? { sample: true } : {}) });
    audit(res, `created a data room share link for "${inv.name.slice(0, 60)}" (expires ${l.expires_on}${l.passcode ? ", passcode" : ""}, ${l.download ? "downloads allowed" : "view only"})`);
    res.status(201).json(linkView(w, l));
  });
  app.put(`${P}/links/:id`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const l = one(COLL.links, req, res, w, "Link"); if (!l) return;
    if (l.revoked_at) return res.status(409).json({ detail: "This link is revoked: create a new one." });
    const b = req.body || {};
    const { o, err } = cleanLink(b, { store, wsId: w.id, today: today(), partial: true });
    if (err.length) return res.status(422).json({ detail: err.join("; ") });
    if (b.remove_passcode === true) o.passcode = null;
    const next = { ...l, ...o };
    if (!next.folders.length && !next.item_ids.length) return res.status(422).json({ detail: "pick at least one folder or item to share" });
    Object.assign(l, o, { updated_at: iso() }); store.save();
    audit(res, `changed the share link for "${store.getOps(COLL.investors, w.id, l.investor_id)?.name?.slice(0, 60) || "investor"}" (expires ${l.expires_on}, ${l.download ? "downloads allowed" : "view only"})`);
    res.json(linkView(w, l));
  });
  app.post(`${P}/links/:id/revoke`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const l = one(COLL.links, req, res, w, "Link"); if (!l) return;
    if (!l.revoked_at) Object.assign(l, { revoked_at: iso(), revoked_by: by(req) });
    store.save(); audit(res, `revoked the share link for "${store.getOps(COLL.investors, w.id, l.investor_id)?.name?.slice(0, 60) || "investor"}"`);
    res.json(linkView(w, l));
  });

  // ---- engagement: per investor and item
  app.get(`${P}/engagement`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const inv = new Map(store.listOps(COLL.investors, w.id).map((i) => [i.id, i.name])), items = new Map(store.listOps(COLL.items, w.id).map((x) => [x.id, x.title]));
    const rows = engagement(store, w.id).map((r) => ({ ...r, investor_name: inv.get(r.investor_id) || "(deleted)", item_title: r.item_id ? items.get(r.item_id) || "(removed item)" : "Data room (index)" }));
    const per = [...inv].map(([id, name]) => { const mine = rows.filter((r) => r.investor_id === id); return { investor_id: id, investor_name: name, views: mine.reduce((a, r) => a + r.views, 0), opens: mine.reduce((a, r) => a + r.opens, 0), downloads: mine.reduce((a, r) => a + r.downloads, 0),
      items_viewed: mine.filter((r) => r.item_id).length, first_at: mine.reduce((a, r) => (!a || r.first_at < a ? r.first_at : a), null), last_at: mine.reduce((a, r) => (!a || r.last_at > a ? r.last_at : a), null) }; }).filter((x) => x.views + x.opens + x.downloads > 0).sort((a, b) => b.last_at.localeCompare(a.last_at));
    const recent = views(w).slice(-50).reverse().map((v) => ({ at: v.at, action: v.action, ua: v.ua, investor_name: inv.get(v.investor_id) || "(deleted)", item_title: v.item_id ? items.get(v.item_id) || "(removed item)" : "Data room (index)" }));
    res.json({ investors: per, items: rows, recent, today: today() });
  });

  // ---- monthly investor updates (AI Investor relations agent, drafts only; a person approves)
  const updView = (w, u) => ({ ...u, has_add: hasAdd(u.text), clean_text: stripRefs(u.text), snapshot_label: store.getOps(COLL.snapshots, w.id, u.snapshot_id)?.label || "(deleted snapshot)", in_room: store.listOps(COLL.items, w.id).some((it) => it.kind === "update" && it.ref_id === u.id) });
  app.get(`${P}/updates`, (req, res) => { const w = W(req, res); if (w) res.json({ updates: store.listOps(COLL.updates, w.id).sort((a, b) => b.month.localeCompare(a.month) || String(b.generated_at).localeCompare(String(a.generated_at))).map((u) => updView(w, u)), agent_level: investors.level() }); });
  app.get(`${P}/updates/:id`, (req, res) => { const w = W(req, res); if (!w) return; const u = one(COLL.updates, req, res, w, "Update"); if (u) res.json(updView(w, u)); });
  app.post(`${P}/updates`, async (req, res) => {
    const w = W(req, res); if (!w) return;
    const b = req.body || {}, month = String(b.month || "");
    if (!isMonth(month)) return res.status(422).json({ detail: "month must be YYYY-MM" });
    const s = store.getOps(COLL.snapshots, w.id, b.snapshot_id);
    if (!s) return res.status(422).json({ detail: "Pick a frozen metrics snapshot (Metrics pack → Freeze) for the update." });
    const d = await investors.draftUpdate(w, { month, snapshot: s });
    const u = store.addOps(COLL.updates, w.id, { month, snapshot_id: s.id, status: "draft", text: d.text, original: d.text, by_ai: d.by_ai, note: d.note, sources: d.sources, generated_at: iso(), generated_by: by(req), approved_by: null, approved_at: null, ...(s.sample ? { sample: true } : {}) });
    audit(res, `drafted the investor update for ${month}${d.by_ai ? " (AI)" : " (factual draft)"}`);
    res.status(201).json(updView(w, u));
  });
  app.put(`${P}/updates/:id`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const u = one(COLL.updates, req, res, w, "Update"); if (!u) return;
    if (u.status !== "draft") return res.status(409).json({ detail: "An approved update is locked." });
    const text = String(req.body?.text ?? "").replace(/\r\n?/g, "\n").slice(0, 40000);
    if (!text.trim()) return res.status(422).json({ detail: "text cannot be empty" });
    Object.assign(u, { text, updated_at: iso(), edited_by: by(req) }); store.save();
    res.json(updView(w, u));
  });
  app.post(`${P}/updates/:id/approve`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const u = one(COLL.updates, req, res, w, "Update"); if (!u) return;
    if (u.status !== "draft") return res.status(409).json({ detail: "Already approved." });
    if (hasAdd(u.text)) return res.status(422).json({ detail: "Fill in every [ADD] first (the lowlights are always written by the founder)." });
    Object.assign(u, { status: "approved", approved_by: by(req), approved_at: iso() }); store.save();
    if (u.by_ai) outcome(w, aiParts(u.text) === aiParts(u.original) ? "accepted" : "edited", `Investor update ${u.month}`);
    audit(res, `approved the investor update for ${u.month}`);
    res.json(updView(w, u));
  });
  app.post(`${P}/updates/:id/share`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const u = one(COLL.updates, req, res, w, "Update"); if (!u) return;
    if (u.status !== "approved") return res.status(422).json({ detail: "Approve the update first." });
    const folder = FOLDER_IDS.includes(String(req.body?.folder)) ? String(req.body.folder) : "company";
    const cur = store.listOps(COLL.items, w.id).find((it) => it.kind === "update" && it.ref_id === u.id);
    if (cur) return res.json(itemView(w, cur));
    const it = store.addOps(COLL.items, w.id, { folder, kind: "update", title: `Investor update · ${monthName(u.month)}`, note: "", ref_id: u.id, url: "", restricted: false, added_by: by(req), added_at: iso(), ...(u.sample ? { sample: true } : {}) });
    audit(res, `added the investor update for ${u.month} to the data room (${folderName(folder)})`);
    res.status(201).json(itemView(w, it));
  });
  app.get(`${P}/updates/:id/download`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const u = one(COLL.updates, req, res, w, "Update"); if (!u) return;
    if (u.status !== "approved") return res.status(422).json({ detail: "Approve the update first." });
    res.set({ "Content-Type": "text/markdown; charset=utf-8", "Content-Disposition": `attachment; filename="investor-update-${u.month}.md"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" }).send(stripRefs(u.text));
  });
  app.delete(`${P}/updates/:id`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const u = one(COLL.updates, req, res, w, "Update"); if (!u) return;
    if (store.listOps(COLL.items, w.id).some((it) => it.kind === "update" && it.ref_id === u.id)) return res.status(409).json({ detail: "This update is in the data room: remove it from there first." });
    if (u.status === "draft" && u.by_ai) outcome(w, "rejected", `Investor update ${u.month} discarded`);
    store.deleteOps(COLL.updates, w.id, u.id); audit(res, `deleted the investor update for ${u.month}`);
    res.status(204).end();
  });
}
