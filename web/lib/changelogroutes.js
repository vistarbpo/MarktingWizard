// HTTP routes for the Changelog (access module "product").
// Before the login wall (mountChangelogPublic): /changelog (Arabic by default, ?lang=en; filters ?type= and ?tag=),
// /changelog/<slug>, /changelog/rss.xml (RSS 2.0) and /changelog/feed.json (JSON Feed 1.1). The same self-contained
// shell, security headers and workspace as the public Help center (publicsite.js; Help center → Settings chooses the
// workspace). Only published entries exist there; drafts, in review and archived entries answer 404.
// Behind the login wall (mountChangelog): /api/workspaces/:ws/changelog/... entries, lifecycle, drafts from releases,
// AI notes and translation, requesters and notices (sent only through the Store CRM's sendOne()).
import { levelOk } from "./access.js";
import { COLL, CONTENT_KEYS, NEXT, REVIEW_DAYS, SHIP_DAYS, STATUSES, TAGS, TYPES, AGENT_ID, cleanEntry, cleanSettings, contentHash, dateTime, ensureChangelog, hasAdd, hasLang, isLive,
  liveEntries, logPush, noticeText, people, releaseFacts, requestersFor, reviewBlock, settingsOf, tagName, titleOf, todayOf, typeName, uniqueSlug } from "./changelog.js";
import { inWindow } from "./crm.js";
import { excerpt, plainText, renderMarkdown, siteWorkspace, slugFrom } from "./helpcenter.js";
import { publicBase } from "./media.js";
import { brandOf, h, langOf, linkFor, newNonce, publicPage, sendPublic } from "./publicsite.js";

const T = {
  ar: { section: "ما الجديد", lead: "آخر التحديثات والمزايا في المنتج.", all: "الكل", none: "ما فيه تحديثات منشورة بعد.", noneFiltered: "ما فيه تحديثات بهذا الفلتر.", help: "مركز المساعدة", back: "كل التحديثات",
    older: "أقدم ←", newer: "→ أحدث", onlyOther: "هذا التحديث متوفر بالإنجليزي فقط حالياً.", notFound: "الصفحة غير موجودة", notFoundText: "ما لقينا هذه الصفحة. ارجع لصفحة التحديثات.", types: "النوع", tags: "المواضيع", rss: "RSS", feed: "JSON Feed", read: "اقرأ أكثر" },
  en: { section: "What's new", lead: "The latest updates and features in the product.", all: "All", none: "No published updates yet.", noneFiltered: "No updates match this filter.", help: "Help center", back: "All updates",
    older: "Older →", newer: "← Newer", onlyOther: "This update is only available in Arabic for now.", notFound: "Page not found", notFoundText: "We couldn't find this page. Go back to the updates.", types: "Type", tags: "Topics", rss: "RSS", feed: "JSON Feed", read: "Read more" },
};
const PAGE = 20;
const xml = (s) => h(String(s ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, ""));
const fmtDay = (d, lang) => { try { return new Intl.DateTimeFormat(lang === "ar" ? "ar-SA-u-ca-gregory-nu-latn" : "en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`)); } catch { return d; } };
const langFor = (e, lang) => (hasLang(e, lang) ? lang : lang === "ar" ? "en" : "ar");
// Absolute links inside feed content: /media/… and /changelog… become https://<PUBLIC_URL>/….
const absolutize = (html, base) => html.replace(/(href|src)="\/(?!\/)/g, `$1="${base}/`);

export function mountChangelogPublic(app, { store, env = process.env }) {
  ensureChangelog(store);
  const base = () => publicBase(env);
  const ctx = (req) => { const w = siteWorkspace(store), lang = langOf(req); return { w, lang, t: T[lang], q: linkFor(lang), nonce: newNonce() }; };
  const page = (c, { title = "", body, path, desc = "", noindex = false }) => {
    const other = c.lang === "ar" ? "en" : "ar";
    const switchHref = `${path}${other === "en" ? (path.includes("?") ? "&" : "?") + "lang=en" : ""}`;
    const alt = [{ type: "application/rss+xml", title: `${brandOf(c.w).company} · ${c.t.section} (RSS)`, href: c.q("/changelog/rss.xml") }, { type: "application/feed+json", title: `${brandOf(c.w).company} · ${c.t.section} (JSON Feed)`, href: c.q("/changelog/feed.json") }];
    return publicPage({ w: c.w, lang: c.lang, nonce: c.nonce, title, section: c.t.section, homeHref: c.q("/changelog"), switchHref, nav: [{ href: c.q("/help"), text: c.t.help }], body, desc, noindex, alternate: alt });
  };
  const notFound = (res, c) => sendPublic(res, page(c, { title: c.t.notFound, path: "/changelog", noindex: true, body: `<div class="card"><h1>${h(c.t.notFound)}</h1><p>${h(c.t.notFoundText)}</p><a class="btn" href="${h(c.q("/changelog"))}">${h(c.t.back)}</a></div>` }), 404, { nonce: c.nonce });
  const chips = (e, c) => `<div class="chips"><a class="chip kind ${h(e.type)}" href="${h(c.q("/changelog", { type: e.type }))}">${h(typeName(e.type, c.lang))}</a>${(e.tags || []).map((t) => `<a class="chip" href="${h(c.q("/changelog", { tag: t }))}">${h(tagName(t, c.lang))}</a>`).join("")}</div>`;
  const when = (e, c) => `<time class="when" datetime="${h(e.date)}">${h(fmtDay(e.date, c.lang))}</time>`;

  // ---- feeds (RSS 2.0 and JSON Feed 1.1): the newest 30 published entries in the feed's language
  const feedItems = (w, lang) => liveEntries(store, w.id).slice(0, 30).map((e) => {
    const l = langFor(e, lang), url = `${base()}/changelog/${e.slug}${lang === "en" ? "?lang=en" : ""}`;
    const html = absolutize(`${e.image ? `<p><img src="${h(e.image)}" alt=""></p>` : ""}${renderMarkdown(e[`body_${l}`])}`, base());
    return { e, l, url, title: e[`title_${l}`], html, summary: plainText(e[`body_${l}`]).slice(0, 280) };
  });
  const feedHead = (w, lang) => ({ company: brandOf(w).company, title: `${brandOf(w).company} · ${T[lang].section}`, home: `${base()}/changelog${lang === "en" ? "?lang=en" : ""}` });
  app.get("/changelog/rss.xml", (req, res) => {
    const w = siteWorkspace(store); if (!w) return res.status(404).type("text").send("Not found");
    const lang = langOf(req), f = feedHead(w, lang), items = feedItems(w, lang);
    const self = `${base()}/changelog/rss.xml${lang === "en" ? "?lang=en" : ""}`;
    const last = items[0] ? new Date(Math.max(...items.map((x) => Date.parse(x.e.published_at || x.e.updated_at || x.e.created_at) || 0))).toUTCString() : new Date(0).toUTCString();
    const body = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>${xml(f.title)}</title><link>${xml(f.home)}</link><description>${xml(T[lang].lead)}</description><language>${lang}</language><lastBuildDate>${last}</lastBuildDate><atom:link href="${xml(self)}" rel="self" type="application/rss+xml"/>
${items.map((x) => `<item><title>${xml(x.title)}</title><link>${xml(x.url)}</link><guid isPermaLink="true">${xml(x.url)}</guid><pubDate>${dateTime(x.e.date).toUTCString()}</pubDate><category>${xml(typeName(x.e.type, lang))}</category>${(x.e.tags || []).map((t) => `<category>${xml(tagName(t, lang))}</category>`).join("")}<description>${xml(x.html)}</description></item>`).join("\n")}
</channel></rss>
`;
    res.set({ "Content-Type": "application/rss+xml; charset=utf-8", "X-Content-Type-Options": "nosniff", "Cache-Control": "public, max-age=300" }).send(body);
  });
  app.get("/changelog/feed.json", (req, res) => {
    const w = siteWorkspace(store); if (!w) return res.status(404).json({ detail: "Not found" });
    const lang = langOf(req), f = feedHead(w, lang);
    const feed = { version: "https://jsonfeed.org/version/1.1", title: f.title, home_page_url: f.home, feed_url: `${base()}/changelog/feed.json${lang === "en" ? "?lang=en" : ""}`, description: T[lang].lead, language: lang,
      authors: [{ name: f.company }],
      items: feedItems(w, lang).map((x) => ({ id: x.url.replace(/\?lang=en$/, ""), url: x.url, title: x.title, content_html: x.html, summary: x.summary, date_published: dateTime(x.e.date).toISOString(),
        ...(x.e.published_at ? { date_modified: new Date(x.e.published_at).toISOString() } : {}), tags: [typeName(x.e.type, lang), ...(x.e.tags || []).map((t) => tagName(t, lang))], language: x.l,
        ...(x.e.image ? { image: `${base()}${x.e.image}` } : {}) })) };
    res.set({ "Content-Type": "application/feed+json; charset=utf-8", "X-Content-Type-Options": "nosniff", "Cache-Control": "public, max-age=300" }).send(JSON.stringify(feed, null, 1));
  });

  app.get("/changelog", (req, res) => {
    const c = ctx(req); if (!c.w) return notFound(res, c);
    const type = String(req.query.type || ""), tag = String(req.query.tag || "");
    if ((type && !TYPES.some((x) => x.id === type)) || (tag && !TAGS.some((x) => x.id === tag))) return notFound(res, c);
    const pg = Math.max(1, Math.min(500, Number.parseInt(req.query.page, 10) || 1));
    const all = liveEntries(store, c.w.id);
    const list = all.filter((e) => (!type || e.type === type) && (!tag || (e.tags || []).includes(tag)));
    const shown = list.slice((pg - 1) * PAGE, pg * PAGE);
    if (pg > 1 && !shown.length) return notFound(res, c);
    const keep = (extra) => Object.fromEntries(Object.entries({ type, tag, ...extra }).filter(([, v]) => v));
    const usedTags = TAGS.filter((x) => all.some((e) => (e.tags || []).includes(x.id)));
    const filters = all.length ? `<section class="card"><div class="chips" aria-label="${h(c.t.types)}"><a class="chip${type ? "" : " on"}" href="${h(c.q("/changelog", keep({ type: "" })))}">${h(c.t.all)}</a>${TYPES.filter((x) => all.some((e) => e.type === x.id)).map((x) => `<a class="chip${type === x.id ? " on" : ""}" href="${h(c.q("/changelog", keep({ type: x.id })))}">${h(x[c.lang])}</a>`).join("")}</div>
      ${usedTags.length ? `<div class="chips" style="margin-top:8px" aria-label="${h(c.t.tags)}">${usedTags.map((x) => `<a class="chip${tag === x.id ? " on" : ""}" href="${h(c.q("/changelog", keep({ tag: tag === x.id ? "" : x.id })))}">${h(x[c.lang])}</a>`).join("")}</div>` : ""}</section>` : "";
    const cards = shown.map((e) => { const l = langFor(e, c.lang); return `<article class="card entry">${when(e, c)}<h2 dir="${l === "ar" ? "rtl" : "ltr"}" lang="${l}"><a href="${h(c.q(`/changelog/${e.slug}`))}">${h(e[`title_${l}`])}</a></h2>${chips(e, c)}
      ${e.image ? `<img class="hero-img" src="${h(e.image)}" alt="" loading="lazy">` : ""}<p class="muted" dir="${l === "ar" ? "rtl" : "ltr"}" lang="${l}" style="margin:0">${h(excerpt(e[`body_${l}`], 220))}</p><a href="${h(c.q(`/changelog/${e.slug}`))}">${h(c.t.read)}</a></article>`; }).join("");
    const pager = list.length > PAGE ? `<nav class="pager">${pg > 1 ? `<a href="${h(c.q("/changelog", keep({ page: pg - 1 > 1 ? String(pg - 1) : "" })))}">${h(c.t.newer)}</a>` : "<span></span>"}${pg * PAGE < list.length ? `<a href="${h(c.q("/changelog", keep({ page: String(pg + 1) })))}">${h(c.t.older)}</a>` : ""}</nav>` : "";
    const body = `<section><h1 class="t">${h(c.t.section)}</h1><p class="muted" style="margin:0">${h(c.t.lead)} <a href="${h(c.q("/changelog/rss.xml"))}">${h(c.t.rss)}</a> · <a href="${h(c.q("/changelog/feed.json"))}">${h(c.t.feed)}</a></p></section>${filters}
      ${cards || `<p class="muted">${h(all.length ? c.t.noneFiltered : c.t.none)}</p>`}${pager}`;
    const path = `/changelog${Object.keys(keep({ page: pg > 1 ? String(pg) : "" })).length ? `?${new URLSearchParams(keep({ page: pg > 1 ? String(pg) : "" }))}` : ""}`;
    sendPublic(res, page(c, { body, path, noindex: !!(type || tag || pg > 1), desc: c.t.lead }), 200, { nonce: c.nonce });
  });
  app.get("/changelog/:slug", (req, res) => {
    const c = ctx(req); if (!c.w) return notFound(res, c);
    const e = liveEntries(store, c.w.id).find((x) => x.slug === String(req.params.slug || "").toLowerCase());
    if (!e) return notFound(res, c);
    const l = langFor(e, c.lang);
    const body = `<article><div class="crumb"><a href="${h(c.q("/changelog"))}">${h(c.t.section)}</a></div>
      <h1 dir="${l === "ar" ? "rtl" : "ltr"}" lang="${l}">${h(e[`title_${l}`])}</h1><div class="row">${when(e, c)}${chips(e, c)}</div>
      ${l !== c.lang ? `<p class="note">${h(T[l === "ar" ? "en" : "ar"].onlyOther)}</p>` : ""}
      ${e.image ? `<img class="hero-img" src="${h(e.image)}" alt="" style="margin-top:12px">` : ""}
      <div class="body card" style="margin-top:12px" dir="${l === "ar" ? "rtl" : "ltr"}" lang="${l}">${renderMarkdown(e[`body_${l}`])}</div></article>
      <p><a href="${h(c.q("/changelog"))}">${h(c.t.back)}</a> · <a href="${h(c.q("/help"))}">${h(c.t.help)}</a></p>`;
    sendPublic(res, page(c, { title: e[`title_${l}`], body, path: `/changelog/${e.slug}`, desc: plainText(e[`body_${l}`]).slice(0, 160) }), 200, { nonce: c.nonce });
  });
}

export function mountChangelog(app, { store, crm, outreach, changelog, env = process.env }) {
  ensureChangelog(store);
  const P = "/api/workspaces/:ws/changelog";
  const W = (req, res) => { const w = store.getWorkspace(req.params.ws); if (!w) res.status(404).json({ detail: "Workspace not found" }); return w; };
  const by = (req) => `${req.user?.name || "you"}${req.headers["x-mwiz-via"] === "assistant" ? " (via Ask DPA AD)" : ""}`;
  const now = () => changelog.now();
  const outcome = (ws, o, note) => app.locals.workforce?.event(AGENT_ID, ws, o, note);
  const get = (req, res, w) => { const e = store.getOps(COLL.entries, w.id, req.params.id); if (!e) res.status(404).json({ detail: "Entry not found" }); return e; };
  const base = () => publicBase(env);
  const can = (req, mod, lvl) => req.user?.id === "owner" || levelOk(req.perms?.[mod], lvl);
  const releaseOf = (w, id) => (id ? store.getOps("product_releases", w.id, id) : null);
  const view = (req, w, e) => {
    const r = releaseOf(w, e.release_id);
    return { ...e, live: isLive(e), live_url: isLive(e) ? `${base()}/changelog/${e.slug}` : null, langs: { ar: hasLang(e, "ar"), en: hasLang(e, "en") }, has_add: hasAdd(e),
      next: NEXT[e.status] || [], publish_block: reviewBlock(e, req.user, settingsOf(w), "Product"), can_edit: levelOk(req.perms?.product, "edit"),
      release: r ? { id: r.id, version: r.version, status: r.status, date: r.date } : e.release_id ? { id: e.release_id, version: "Release removed", missing: true } : null,
      items: (e.item_ids || []).map((id) => store.getOps("product_items", w.id, id)).filter(Boolean).map((i) => ({ id: i.id, title: i.title, status: i.status, type: i.type })),
      notices: store.listOps(COLL.notices, w.id).filter((n) => n.entry_id === e.id).map((n) => ({ ...n })) };
  };
  const summary = (e) => ({ id: e.id, slug: e.slug, type: e.type, tags: e.tags || [], date: e.date, title_ar: e.title_ar, title_en: e.title_en, status: e.status, author_name: e.author_name, reviewer_name: e.reviewer_name,
    release_id: e.release_id, item_ids: e.item_ids || [], updated_at: e.updated_at || e.created_at, submitted_at: e.submitted_at || null, by_ai: !!e.by_ai, sample: !!e.sample, langs: { ar: hasLang(e, "ar"), en: hasLang(e, "en") }, live: isLive(e), has_add: hasAdd(e) });
  // Shipped releases with no entry yet (any status counts as handled).
  const waiting = (w) => {
    const covered = new Map(store.listOps(COLL.entries, w.id).filter((e) => e.release_id).map((e) => [e.release_id, e]));
    return store.listOps("product_releases", w.id).filter((r) => r.status === "released").sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))
      .map((r) => ({ id: r.id, version: r.version, date: r.date, items: (r.item_ids || []).length, entry_id: covered.get(r.id)?.id || null, entry_status: covered.get(r.id)?.status || null }));
  };
  // An AI draft is judged once: published unchanged = accepted, published after edits = edited, thrown away = rejected.
  const judge = (w, e, kind) => {
    if (!e.by_ai || e.ai_judged) return;
    e.ai_judged = kind === "publish" ? (contentHash(e) === e.ai_hash ? "accepted" : "edited") : "rejected";
    outcome(w.id, e.ai_judged, `Changelog entry "${titleOf(e).slice(0, 60)}" ${kind === "publish" ? "published" : kind === "delete" ? "deleted" : "archived"}`);
  };
  const newEntry = (req, w, f) => {
    const e = store.addOps(COLL.entries, w.id, { title_ar: "", title_en: "", body_ar: "", body_en: "", type: "new", tags: [], item_ids: [], release_id: null, image: "", date: todayOf(now()), ...f, slug: "", status: "draft",
      author_id: req.user.id, author_name: req.user.name, reviewer_id: null, reviewer_name: "", published_at: null, by_ai: !!f.by_ai, log: [] }, false);
    const clean = (t) => slugFrom(String(t || "").replace(/\[ADD[^\]]*\]/gi, "").replace(/^Sample ·/, ""));
    e.slug = f.slug || uniqueSlug(store, w.id, clean(e.title_en) || `update-${e.date}-${e.id}`, e.id);
    if (e.by_ai) e.ai_hash = contentHash(e);
    return e;
  };

  app.get(`${P}/meta`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const site = siteWorkspace(store);
    res.json({ types: TYPES, tags: TAGS, statuses: STATUSES, next: NEXT, people: people(store), settings: settingsOf(w), ship_days: SHIP_DAYS, review_days: REVIEW_DAYS,
      site: { workspace_id: site?.id || null, is_this: site?.id === w.id, url: `${base()}/changelog`, rss: `${base()}/changelog/rss.xml`, json: `${base()}/changelog/feed.json` },
      releases: waiting(w), all_releases: store.listOps("product_releases", w.id).map((r) => ({ id: r.id, version: r.version, status: r.status, date: r.date })),
      items: store.listOps("product_items", w.id).map((i) => ({ id: i.id, title: i.title, status: i.status })),
      media: store.listOps("creative_media", w.id).filter((m) => m.kind === "image" && /\.(png|jpe?g|webp|gif)$/i.test(m.file || "")).slice(-60).reverse().map((m) => ({ id: m.id, url: `/media/${m.file}`, name: m.name })),
      edit: levelOk(req.perms?.product, "edit"), crm_send: can(req, "crm", "edit"), me: { id: req.user?.id, owner: req.user?.id === "owner" || req.user?.role_id === "owner" }, agent_level: changelog.level(), today: todayOf(now()) });
  });
  app.put(`${P}/settings`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const { out } = cleanSettings(req.body || {});
    w.changelog = { ...settingsOf(w), ...out }; store.save();
    res.json({ settings: settingsOf(w) });
  });

  app.get(`${P}/entries`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const st = String(req.query.status || ""), type = String(req.query.type || ""), tag = String(req.query.tag || ""), q = String(req.query.q || "").trim().toLowerCase().slice(0, 200);
    let list = store.listOps(COLL.entries, w.id);
    if (st) list = list.filter((e) => e.status === st);
    if (type) list = list.filter((e) => e.type === type);
    if (tag) list = list.filter((e) => (e.tags || []).includes(tag));
    if (q) list = list.filter((e) => CONTENT_KEYS.map((k) => e[k] || "").join(" ").toLowerCase().includes(q));
    list.sort((a, b) => ({ in_review: 0, draft: 1, published: 2, archived: 3 })[a.status] - ({ in_review: 0, draft: 1, published: 2, archived: 3 })[b.status] || String(b.date).localeCompare(String(a.date)) || Number(b.id) - Number(a.id));
    const all = store.listOps(COLL.entries, w.id), cnt = (s) => all.filter((e) => e.status === s).length;
    res.json({ entries: list.map(summary), totals: { all: all.length, published: cnt("published"), in_review: cnt("in_review"), drafts: cnt("draft"), archived: cnt("archived") }, releases: waiting(w) });
  });
  app.post(`${P}/entries`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const { out, err } = cleanEntry(req.body || {}, { store, wsId: w.id });
    if (err.length) return res.status(422).json({ detail: err.join("; ") });
    const e = newEntry(req, w, out);
    logPush(e, by(req), "Created as a draft", now()); store.save();
    res.status(201).json(view(req, w, e));
  });
  app.get(`${P}/entries/:id`, (req, res) => { const w = W(req, res); if (!w) return; const e = get(req, res, w); if (e) res.json(view(req, w, e)); });
  app.put(`${P}/entries/:id`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const e = get(req, res, w); if (!e) return;
    const { out, err } = cleanEntry(req.body || {}, { store, wsId: w.id, partial: true, selfId: e.id });
    if (err.length) return res.status(422).json({ detail: err.join("; ") });
    const changed = Object.keys(out).filter((k) => JSON.stringify(out[k]) !== JSON.stringify(e[k]));
    if (e.status === "published" && changed.some((k) => [...CONTENT_KEYS, "slug", "type", "date", "image"].includes(k))) return res.status(409).json({ detail: "Published entries are locked. Move it back to Draft to change it (it leaves the public changelog until it's reviewed again)." });
    if (!{ ...e, ...out }.title_ar && !{ ...e, ...out }.title_en) return res.status(422).json({ detail: "Give the entry a title (Arabic or English)" });
    Object.assign(e, out, { updated_at: new Date(now()).toISOString() });
    if (changed.length) logPush(e, by(req), `Edited: ${changed.map((k) => k.replace(/_/g, " ")).join(", ")}`, now());
    store.save();
    res.json(view(req, w, e));
  });
  app.post(`${P}/entries/:id/status`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const e = get(req, res, w); if (!e) return;
    const to = String(req.body?.status || "");
    if (!(NEXT[e.status] || []).includes(to)) return res.status(409).json({ detail: `A ${e.status.replace("_", " ")} entry can move to: ${(NEXT[e.status] || []).join(", ").replace(/_/g, " ") || "nothing"}.` });
    const at = new Date(now()).toISOString();
    const oneLang = hasLang(e, "ar") || hasLang(e, "en");
    if ((to === "in_review" || to === "published") && !oneLang) return res.status(422).json({ detail: "Write a title and a body in at least one language first." });
    if (to === "published") {
      const block = reviewBlock(e, req.user, settingsOf(w), "Product");
      if (block) return res.status(403).json({ detail: block });
      if (hasAdd(e)) return res.status(422).json({ detail: "Fill in every [ADD] before publishing (or delete the language you aren't publishing)." });
      Object.assign(e, { reviewer_id: req.user.id, reviewer_name: req.user.name, published_at: at });
      judge(w, e, "publish");
    }
    if (to === "in_review") Object.assign(e, { submitted_by: req.user.name, submitted_at: at });
    if (to === "archived" && e.status !== "published") judge(w, e, "archive");
    const from = e.status;
    Object.assign(e, { status: to, updated_at: at });
    logPush(e, by(req), `${from.replace("_", " ")} → ${to.replace("_", " ")}${to === "published" ? ` (reviewed by ${req.user.name})` : ""}`, now());
    store.save();
    res.json(view(req, w, e));
  });
  app.delete(`${P}/entries/:id`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const e = get(req, res, w); if (!e) return;
    if (e.status === "published") return res.status(409).json({ detail: "Archive a published entry before deleting it." });
    judge(w, e, "delete");
    store.deleteOps(COLL.entries, w.id, e.id);
    store.db[COLL.notices] = store.db[COLL.notices].filter((n) => !(n.workspace_id === w.id && n.entry_id === e.id));
    store.save();
    res.json({ ok: true });
  });

  // ---- from a shipped release: a draft by the AI Release notes writer (or the factual draft), linked to the release and its items
  app.post(`${P}/from-release/:rid`, async (req, res) => {
    const w = W(req, res); if (!w) return;
    const r = releaseOf(w, req.params.rid);
    if (!r) return res.status(404).json({ detail: "Release not found" });
    if (r.status !== "released") return res.status(409).json({ detail: "Approve and release it in Product → Releases first: entries are drafted from shipped releases." });
    const have = store.listOps(COLL.entries, w.id).find((e) => e.release_id === r.id && e.status !== "archived");
    if (have && !req.body?.force) return res.status(409).json({ detail: `This release already has a changelog entry (${have.status.replace("_", " ")}).`, entry_id: have.id });
    const f = releaseFacts(store, w, r);
    const d = await changelog.draft(w, f);
    const e = newEntry(req, w, { ...d.entry, type: f.type, tags: f.tags, release_id: r.id, item_ids: f.item_ids, date: r.date || todayOf(now()), by_ai: d.by_ai, ai_note: d.note, source: { kind: "release", label: f.label } });
    logPush(e, by(req), `${d.by_ai ? "AI Release notes writer drafted" : "Factual draft made"} from ${f.label}`, now()); store.save();
    res.status(201).json({ entry: view(req, w, e), by_ai: d.by_ai, note: d.note });
  });
  // Redo a draft's text from its linked release and roadmap items.
  app.post(`${P}/entries/:id/ai/notes`, async (req, res) => {
    const w = W(req, res); if (!w) return;
    const e = get(req, res, w); if (!e) return;
    if (e.status !== "draft") return res.status(409).json({ detail: "Only drafts are rewritten. Move it back to Draft first." });
    const r = releaseOf(w, e.release_id);
    if (!r && !(e.item_ids || []).length) return res.status(422).json({ detail: "Link a release or roadmap items first: the notes are written only from them." });
    const f = releaseFacts(store, w, r, (e.item_ids || []).length ? e.item_ids : null);
    const d = await changelog.draft(w, f);
    if (e.by_ai && !e.ai_judged) { e.ai_judged = "rejected"; outcome(w.id, "rejected", `Changelog notes for "${titleOf(e).slice(0, 60)}" rewritten`); }
    Object.assign(e, d.entry, { by_ai: d.by_ai, ai_note: d.note, ai_judged: undefined, updated_at: new Date(now()).toISOString() });
    if (d.by_ai) e.ai_hash = contentHash(e);
    logPush(e, by(req), `${d.by_ai ? "AI Release notes writer rewrote the notes" : "Factual draft made"} from ${f.label}`, now()); store.save();
    res.json({ entry: view(req, w, e), by_ai: d.by_ai, note: d.note });
  });
  app.post(`${P}/entries/:id/ai/translate`, async (req, res) => {
    const w = W(req, res); if (!w) return;
    const e = get(req, res, w); if (!e) return;
    const to = req.body?.to === "en" ? "en" : req.body?.to === "ar" ? "ar" : null;
    if (!to) return res.status(422).json({ detail: "to must be ar or en" });
    const from = to === "ar" ? "en" : "ar";
    if (!hasLang(e, from)) return res.status(422).json({ detail: `Write the ${from === "ar" ? "Arabic" : "English"} version first.` });
    if (e.status === "published") return res.status(409).json({ detail: "Published entries are locked. Move it back to Draft first." });
    const t = await changelog.translate(w, e, to);
    e.translation = { lang: to, title: t.title, body: t.body, by_ai: t.by_ai, note: t.note, at: new Date(now()).toISOString() };
    store.save();
    res.json({ translation: e.translation });
  });
  app.post(`${P}/entries/:id/translation`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const e = get(req, res, w); if (!e) return;
    const tr = e.translation; if (!tr) return res.status(404).json({ detail: "No translation draft" });
    const act = String(req.body?.action || "");
    if (act === "discard") { if (tr.by_ai) outcome(w.id, "rejected", "Changelog translation discarded"); delete e.translation; store.save(); return res.json(view(req, w, e)); }
    if (act !== "apply") return res.status(422).json({ detail: "action must be apply or discard" });
    if (e.status === "published") return res.status(409).json({ detail: "Published entries are locked. Move it back to Draft first." });
    const title = req.body?.title !== undefined ? String(req.body.title).trim().slice(0, 200) : tr.title, body = req.body?.body !== undefined ? String(req.body.body).slice(0, 20000) : tr.body;
    if (tr.by_ai) outcome(w.id, title === tr.title && body === tr.body ? "accepted" : "edited", `Changelog translation to ${tr.lang} used`);
    Object.assign(e, { [`title_${tr.lang}`]: title, [`body_${tr.lang}`]: body, updated_at: new Date(now()).toISOString() });
    delete e.translation;
    logPush(e, by(req), `${tr.lang === "ar" ? "Arabic" : "English"} version from ${tr.by_ai ? "the AI translation" : "the translation draft"}`, now()); store.save();
    res.json(view(req, w, e));
  });

  // ---- feedback loop: requesters of the linked roadmap items, and one draft notice per Store CRM store
  app.get(`${P}/entries/:id/requesters`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const e = get(req, res, w); if (!e) return;
    const list = requestersFor(store, crm, w, e);
    res.json({ requesters: list, ready: list.filter((x) => x.ready).length, live: isLive(e), mode: outreach?.settings(w.id).mode || "test" });
  });
  app.post(`${P}/entries/:id/notify`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const e = get(req, res, w); if (!e) return;
    if (!isLive(e)) return res.status(409).json({ detail: "Publish the entry first: the notice links to its public page." });
    const pick = Array.isArray(req.body?.store_ids) ? new Set(req.body.store_ids.map(String)) : null;
    const list = requestersFor(store, crm, w, e).filter((x) => !pick || (x.store_id && pick.has(String(x.store_id))));
    const url = `${base()}/changelog/${e.slug}`, txt = noticeText(w, e, url), created = [], skipped = [];
    for (const r of list) {
      if (!r.ready) { skipped.push({ store_id: r.store_id, store_name: r.store_name, reason: r.reason }); continue; }
      created.push(store.addOps(COLL.notices, w.id, { entry_id: e.id, store_id: r.store_id, store_name: r.store_name, item_ids: r.item_ids, channel: "email", subject: txt.subject, body: txt.body, status: "draft", created_by: by(req), message_id: null, error: "", ...(e.sample ? { sample: true } : {}) }, false));
    }
    if (created.length) logPush(e, by(req), `${created.length} notice draft${created.length === 1 ? "" : "s"} for requesters`, now());
    store.save();
    res.status(created.length ? 201 : 200).json({ created: created.length, notices: created, skipped });
  });
  const getNotice = (req, res, w) => { const n = store.getOps(COLL.notices, w.id, req.params.nid); if (!n) res.status(404).json({ detail: "Notice not found" }); return n; };
  app.put(`${P}/notices/:nid`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const n = getNotice(req, res, w); if (!n) return;
    if (n.status !== "draft") return res.status(409).json({ detail: `This notice is ${n.status}.` });
    const b = req.body || {};
    if (b.subject !== undefined) n.subject = String(b.subject).trim().slice(0, 200);
    if (b.body !== undefined) n.body = String(b.body).slice(0, 6000);
    n.edited_by = by(req); n.updated_at = new Date(now()).toISOString(); store.save();
    res.json(n);
  });
  app.delete(`${P}/notices/:nid`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const n = getNotice(req, res, w); if (!n) return;
    if (n.status !== "draft") return res.status(409).json({ detail: `This notice is ${n.status}: it stays in the log.` });
    store.deleteOps(COLL.notices, w.id, n.id);
    res.json({ ok: true });
  });
  // A person sends: through the Store CRM's sendOne() (Test mode, do-not-contact, opt-outs, bounces, sample stores,
  // unsubscribe link and header); in Live mode only 09:00–21:00 Riyadh time, not Friday.
  app.post(`${P}/notices/:nid/send`, async (req, res) => {
    const w = W(req, res); if (!w) return;
    const n = getNotice(req, res, w); if (!n) return;
    if (!can(req, "crm", "edit")) return res.status(403).json({ detail: "Sending goes through the Store CRM: your role can't send there. Copy the email instead." });
    if (n.status !== "draft") return res.status(409).json({ detail: `This notice is ${n.status}.` });
    const c = crm?.get(w.id, n.store_id);
    if (!c || !outreach) return res.status(422).json({ detail: "The store isn't in the Store CRM any more." });
    if (!n.body.trim() || !n.subject.trim()) return res.status(422).json({ detail: "The email needs a subject and a message." });
    if (/\[ADD/.test(`${n.subject} ${n.body}`)) return res.status(422).json({ detail: "Fill in every [ADD] before sending." });
    const live = outreach.settings(w.id).mode === "live" && !c.sample;
    if (live && !inWindow(new Date(now()), { from: 9, to: 21, skip_friday: true })) return res.status(422).json({ detail: "Emails go out only 09:00–21:00 Riyadh time, not Friday. Send it then." });
    const msg = await outreach.sendOne(w.id, c, { channel: "email", subject: n.subject, body: n.body, by: by(req) });
    Object.assign(n, { status: msg.status, message_id: msg.id, error: msg.error || "", sent_at: new Date(now()).toISOString(), sent_by: by(req) });
    store.save();
    const bad = msg.status === "skipped" || msg.status === "failed";
    res.status(bad ? 422 : 201).json({ ...(bad ? { detail: msg.error } : {}), notice: n, message: { id: msg.id, status: msg.status, error: msg.error || "" } });
  });
}
