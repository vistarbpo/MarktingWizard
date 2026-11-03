// HTTP routes for the Help center (module "helpcenter").
// Before the login wall (mountHelpPublic): the public site /help (Arabic by default, ?lang=en), /help/<category>,
// /help/a/<slug>, /help/search?q=, /help/sitemap.xml and the "Was this helpful?" form. Self-contained HTML with no
// scripts at all (CSP script-src 'none'; the only inline style carries a per-response nonce), no tracking, no user
// HTML (bodies go through the safe markdown renderer). Only published, public articles of the site's workspace show.
// Behind the login wall (mountHelp): /api/workspaces/:ws/helpcenter/... articles, lifecycle, gaps, AI drafts, settings.
import crypto from "node:crypto";
import { levelOk } from "./access.js";
import { publicBase } from "./media.js";
import { AGENT_ID, CATEGORIES, COLL, CONTENT_KEYS, NEXT, STALE_DAYS, STATUSES, VISIBILITY, catName, cleanArticle, cleanSettings, contentHash, ensureHelp, freshness,
  excerpt, gapList, hasLang, isLive, logPush, people, plainText, recordVote, renderMarkdown, reviewBlock, searchArticles, settingsOf, siteWorkspace, slugFrom, sourceFacts, todayOf, uniqueSlug, voteCounts } from "./helpcenter.js";

import { h, langOf, linkFor, newNonce, publicPage, sendPublic } from "./publicsite.js";

const T = {
  ar: { help: "مركز المساعدة", search: "ابحث في المقالات", go: "بحث", home: "الرئيسية", article: "مقالة", articles: "مقالات", noArticles: "ما فيه مقالات منشورة بعد.", results: "نتائج البحث عن", none: "ما لقينا شي. جرّب كلمات ثانية.",
    helpful: "هل أفادتك هذه المقالة؟", yes: "نعم", no: "لا", thanks: "شكراً على رأيك!", need: "تحتاج مساعدة أكثر؟", chat: "كلّمنا في المحادثة", mail: "راسلنا بالإيميل", updated: "آخر مراجعة", related: "مقالات ذات صلة",
    whatsNew: "ما الجديد", onlyOther: "هذه المقالة متوفرة بالإنجليزي فقط حالياً.", notFound: "الصفحة غير موجودة", notFoundText: "ما لقينا هذه الصفحة. ارجع لمركز المساعدة أو ابحث.", categories: "الأقسام" },
  en: { help: "Help center", search: "Search articles", go: "Search", home: "Home", article: "article", articles: "articles", noArticles: "No published articles yet.", results: "Results for", none: "Nothing found. Try other words.",
    helpful: "Was this article helpful?", yes: "Yes", no: "No", thanks: "Thanks for your feedback!", need: "Still need help?", chat: "Chat with us", mail: "Email us", updated: "Last reviewed", related: "Related articles",
    whatsNew: "What's new", onlyOther: "This article is only available in Arabic for now.", notFound: "Page not found", notFoundText: "We couldn't find this page. Go back to the help center or search.", categories: "Topics" },
};

export function mountHelpPublic(app, { store, help, env = process.env }) {
  ensureHelp(store);
  const hits = new Map(), voted = new Map();
  const limited = (key, max, windowMs) => {
    const t = Date.now(), list = (hits.get(key) || []).filter((x) => t - x < windowMs);
    list.push(t); hits.set(key, list);
    if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((x) => t - x < windowMs)) hits.delete(k);
    return list.length > max;
  };
  const live = (w) => store.listOps(COLL.articles, w.id).filter(isLive);
  const send = (res, html, status = 200, opts = {}) => sendPublic(res, html, status, opts);
  const ctx = (req) => {
    const w = siteWorkspace(store), lang = langOf(req), t = T[lang];
    return { w, lang, t, q: linkFor(lang), nonce: newNonce() };
  };
  const supportLink = (w, t) => {
    if (w.support?.widget_enabled && w.support.widget_key) return `<a class="btn" href="/support/${encodeURIComponent(w.support.widget_key)}">${h(t.chat)}</a>`;
    const e = settingsOf(w).contact_email;
    return e ? `<a class="btn" href="mailto:${h(e)}">${h(t.mail)}</a>` : "";
  };
  // The shared public shell (publicsite.js), with the search form and a link to the Changelog.
  function page(c, { title, body, path, desc = "", noindex = false }) {
    const { lang, t, nonce } = c, other = lang === "ar" ? "en" : "ar";
    const switchHref = `${path}${other === "en" ? (path.includes("?") ? "&" : "?") + "lang=en" : ""}`;
    const hero = `<div class="hero"><form class="s" role="search" method="get" action="/help/search"><input type="search" name="q" placeholder="${h(t.search)}" aria-label="${h(t.search)}" maxlength="200" value="${h(c.query || "")}">${lang === "en" ? `<input type="hidden" name="lang" value="en">` : ""}<button type="submit">${h(t.go)}</button></form></div>`;
    return publicPage({ w: c.w, lang, nonce, title, section: t.help, homeHref: c.q("/help"), switchHref, nav: [{ href: c.q("/changelog"), text: t.whatsNew }], hero, body, desc, noindex });
  }
  const notFound = (res, c) => send(res, page(c, { title: c.t.notFound, path: "/help", noindex: true, body: `<div class="card"><h1>${h(c.t.notFound)}</h1><p>${h(c.t.notFoundText)}</p><a class="btn" href="${h(c.q("/help"))}">${h(c.t.help)}</a></div>` }), 404, { nonce: c.nonce });
  const titleOf = (a, lang) => a[`title_${lang}`] || a[`title_${lang === "ar" ? "en" : "ar"}`];
  const cardOf = (c, a) => { const l = hasLang(a, c.lang) ? c.lang : c.lang === "ar" ? "en" : "ar"; return `<li><a class="card" href="${h(c.q(`/help/a/${a.slug}`))}"><b dir="auto">${h(titleOf(a, c.lang))}</b><span class="muted" dir="auto">${h(excerpt(a[`body_${l}`]))}</span></a></li>`; };

  app.get("/help/sitemap.xml", (req, res) => {
    const w = siteWorkspace(store); if (!w) return res.status(404).send("Not found");
    const base = publicBase(env), arts = live(w), cats = CATEGORIES.filter((x) => arts.some((a) => a.category === x.id));
    const url = (loc, mod) => `<url><loc>${h(base + loc)}</loc>${mod ? `<lastmod>${h(String(mod).slice(0, 10))}</lastmod>` : ""}</url>`;
    const rows = [url("/help"), url("/help?lang=en"), ...cats.flatMap((x) => [url(`/help/${x.id}`), url(`/help/${x.id}?lang=en`)]),
      ...arts.flatMap((a) => [hasLang(a, "ar") ? url(`/help/a/${a.slug}`, a.updated_at || a.published_at) : "", hasLang(a, "en") ? url(`/help/a/${a.slug}?lang=en`, a.updated_at || a.published_at) : ""].filter(Boolean))];
    res.set({ "Content-Type": "application/xml; charset=utf-8", "X-Content-Type-Options": "nosniff", "Cache-Control": "public, max-age=300" })
      .send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${rows.join("")}</urlset>\n`);
  });
  app.get("/help", (req, res) => {
    const c = ctx(req); if (!c.w) return notFound(res, c);
    const arts = live(c.w);
    const cats = CATEGORIES.map((x) => ({ ...x, n: arts.filter((a) => a.category === x.id).length })).filter((x) => x.n);
    const body = `<section><h1 class="t">${h(c.t.categories)}</h1>${cats.length ? `<div class="grid">${cats.map((x) => `<a class="card" href="${h(c.q(`/help/${x.id}`))}"><b>${h(x[c.lang])}</b><span class="muted">${x.n} ${h(x.n === 1 ? c.t.article : c.t.articles)}</span></a>`).join("")}</div>` : `<p class="muted">${h(c.t.noArticles)}</p>`}</section>`;
    send(res, page(c, { title: "", path: "/help", body, desc: c.lang === "ar" ? "إجابات وخطوات لاستخدام المنتج." : "Answers and steps for using the product." }), 200, { nonce: c.nonce });
  });
  app.get("/help/search", (req, res) => {
    const c = ctx(req); if (!c.w) return notFound(res, c);
    if (limited("s:" + req.ip, 60, 60e3)) return res.status(429).type("text").send("Too many searches. Please try again in a minute.");
    c.query = String(req.query.q || "").slice(0, 200);
    const found = c.query.trim() ? searchArticles(live(c.w), c.query).slice(0, 30) : [];
    const body = `<div class="crumb"><a href="${h(c.q("/help"))}">${h(c.t.help)}</a></div><h1 class="t">${h(c.t.results)} “<span dir="auto">${h(c.query)}</span>”</h1>
      ${found.length ? `<ul class="list">${found.map((a) => cardOf(c, a)).join("")}</ul>` : `<p class="muted">${h(c.t.none)}</p>`}`;
    send(res, page(c, { title: c.t.results, path: `/help/search?q=${encodeURIComponent(c.query)}`, body, noindex: true }), 200, { cache: false, nonce: c.nonce });
  });
  app.get("/help/a/:slug", (req, res) => {
    const c = ctx(req); if (!c.w) return notFound(res, c);
    const a = live(c.w).find((x) => x.slug === String(req.params.slug || "").toLowerCase());
    if (!a) return notFound(res, c);
    const l = hasLang(a, c.lang) ? c.lang : c.lang === "ar" ? "en" : "ar";
    const rel = (a.related_ids || []).map((id) => store.getOps(COLL.articles, c.w.id, id)).filter((x) => x && isLive(x));
    const cat = catName(a.category, c.lang), fr = freshness(a);
    const more = supportLink(c.w, c.t);
    const body = `<article><div class="crumb"><a href="${h(c.q("/help"))}">${h(c.t.help)}</a> › <a href="${h(c.q(`/help/${a.category}`))}">${h(cat)}</a></div>
      <h1 dir="${l === "ar" ? "rtl" : "ltr"}" lang="${l}">${h(a[`title_${l}`])}</h1><p class="muted">${h(c.t.updated)}: <span dir="ltr">${h(fr.last_reviewed || "")}</span></p>
      ${l !== c.lang ? `<p class="note">${h(T[l === "ar" ? "en" : "ar"].onlyOther)}</p>` : ""}
      <div class="body card" dir="${l === "ar" ? "rtl" : "ltr"}" lang="${l}">${renderMarkdown(a[`body_${l}`])}</div></article>
      ${rel.length ? `<section><h2 class="t">${h(c.t.related)}</h2><ul class="list">${rel.map((x) => cardOf(c, x)).join("")}</ul></section>` : ""}
      <section class="card" id="feedback">${req.query.voted ? `<p><b>${h(c.t.thanks)}</b></p>` : `<form method="post" action="/help/a/${h(a.slug)}/vote" class="row"><span>${h(c.t.helpful)}</span>${c.lang === "en" ? `<input type="hidden" name="lang" value="en">` : ""}<button type="submit" name="helpful" value="yes">${h(c.t.yes)}</button><button class="ghost" type="submit" name="helpful" value="no">${h(c.t.no)}</button></form>`}</section>
      ${more ? `<section class="card row"><b>${h(c.t.need)}</b>${more}</section>` : ""}`;
    send(res, page(c, { title: a[`title_${l}`], path: `/help/a/${a.slug}`, body, desc: plainText(a[`body_${l}`]).slice(0, 160) }), 200, { cache: !req.query.voted, nonce: c.nonce });
  });
  // One vote per address per article per day (kept in memory only), 20 votes per 10 minutes per address. Stored: counters only.
  app.post("/help/a/:slug/vote", (req, res) => {
    const w = siteWorkspace(store); if (!w) return res.status(404).send("Not found");
    const a = live(w).find((x) => x.slug === String(req.params.slug || "").toLowerCase());
    if (!a) return res.status(404).type("text").send("Not found");
    const lang = (req.body?.lang || req.query.lang) === "en" ? "en" : "ar";
    const back = `/help/a/${a.slug}?${lang === "en" ? "lang=en&" : ""}voted=1#feedback`;
    const v = String(req.body?.helpful || "");
    if (!["yes", "no"].includes(v)) return res.redirect(303, `/help/a/${a.slug}${lang === "en" ? "?lang=en" : ""}`);
    const now = help.now(), key = crypto.createHash("sha256").update(`${req.ip}|${a.id}|${todayOf(now)}`).digest("base64url");
    if (limited("v:" + req.ip, 20, 10 * 60e3) || voted.has(key)) return res.redirect(303, back);
    voted.set(key, now);
    if (voted.size > 20000) for (const [k, t] of voted) if (now - t > 864e5) voted.delete(k);
    recordVote(store, a, v === "yes", now);
    res.redirect(303, back);
  });
  app.get("/help/:category", (req, res) => {
    const c = ctx(req); if (!c.w) return notFound(res, c);
    const cat = CATEGORIES.find((x) => x.id === req.params.category);
    if (!cat) return notFound(res, c);
    const arts = live(c.w).filter((a) => a.category === cat.id).sort((x, y) => titleOf(x, c.lang).localeCompare(titleOf(y, c.lang)));
    if (!arts.length) return notFound(res, c);
    const body = `<div class="crumb"><a href="${h(c.q("/help"))}">${h(c.t.help)}</a></div><h1 class="t">${h(cat[c.lang])}</h1><ul class="list">${arts.map((a) => cardOf(c, a)).join("")}</ul>`;
    send(res, page(c, { title: cat[c.lang], path: `/help/${cat.id}`, body }), 200, { nonce: c.nonce });
  });
}

export function mountHelp(app, { store, help, env = process.env }) {
  ensureHelp(store);
  const P = "/api/workspaces/:ws/helpcenter";
  const W = (req, res) => { const w = store.getWorkspace(req.params.ws); if (!w) res.status(404).json({ detail: "Workspace not found" }); return w; };
  const by = (req) => `${req.user?.name || "you"}${req.headers["x-mwiz-via"] === "assistant" ? " (via Ask DPA AD)" : ""}`;
  const now = () => help.now();
  const outcome = (ws, o, note) => app.locals.workforce?.event(AGENT_ID, ws, o, note);
  const get = (req, res, w) => { const a = store.getOps(COLL.articles, w.id, req.params.id); if (!a) res.status(404).json({ detail: "Article not found" }); return a; };
  const base = () => publicBase(env);
  const view = (req, w, a) => {
    const s = settingsOf(w), v = voteCounts(store, w.id, a.id, now());
    return { ...a, votes: v, fresh: freshness(a, now()), live: isLive(a), live_url: isLive(a) ? `${base()}/help/a/${a.slug}` : null, langs: { ar: hasLang(a, "ar"), en: hasLang(a, "en") },
      next: NEXT[a.status] || [], publish_block: reviewBlock(a, req.user, s), can_edit: levelOk(req.perms?.helpcenter, "edit"),
      support_article: a.support_article_id ? (store.listArticles(w.id).find((x) => x.id === a.support_article_id) || { id: a.support_article_id, question: "Support article removed", missing: true }) : null,
      related: (a.related_ids || []).map((id) => store.getOps(COLL.articles, w.id, id)).filter(Boolean).map((x) => ({ id: x.id, title: x.title_en || x.title_ar, status: x.status })) };
  };
  const summary = (w, a) => ({ id: a.id, slug: a.slug, category: a.category, title_ar: a.title_ar, title_en: a.title_en, status: a.status, visibility: a.visibility, author_name: a.author_name, reviewer_name: a.reviewer_name,
    last_reviewed: a.last_reviewed, updated_at: a.updated_at || a.created_at, by_ai: !!a.by_ai, sample: !!a.sample, langs: { ar: hasLang(a, "ar"), en: hasLang(a, "en") }, live: isLive(a), fresh: freshness(a, now()), votes: voteCounts(store, w.id, a.id, now()) });
  // An AI draft is judged once: published unchanged = accepted, published after edits = edited, thrown away = rejected.
  const judge = (w, a, kind) => {
    if (!a.by_ai || a.ai_judged) return;
    a.ai_judged = kind === "publish" ? (contentHash(a) === a.ai_hash ? "accepted" : "edited") : "rejected";
    outcome(w.id, a.ai_judged, `Help article "${String(a.title_en || a.title_ar).slice(0, 60)}" ${kind === "publish" ? "published" : kind === "delete" ? "deleted" : "archived"}`);
  };

  app.get(`${P}/meta`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const site = siteWorkspace(store);
    res.json({ categories: CATEGORIES, statuses: STATUSES, visibility: VISIBILITY, next: NEXT, people: people(store), settings: settingsOf(w), stale_days: STALE_DAYS,
      site: { workspace_id: site?.id || null, is_this: site?.id === w.id, chosen: !!store.db.help_site.workspace_id, url: `${base()}/help`, can_choose: req.user?.id === "owner" || levelOk(req.perms?.admin, "edit") },
      support_link: w.support?.widget_enabled && w.support.widget_key ? `/support/${w.support.widget_key}` : settingsOf(w).contact_email ? `mailto:${settingsOf(w).contact_email}` : null,
      support_articles: store.listArticles(w.id).map((a) => ({ id: a.id, question: a.question, language: a.language, category: a.category })),
      edit: levelOk(req.perms?.helpcenter, "edit"), me: { id: req.user?.id, owner: req.user?.id === "owner" || req.user?.role_id === "owner" }, agent_level: help.level(), today: todayOf(now()) });
  });
  app.put(`${P}/settings`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const b = req.body || {}, { out, err } = cleanSettings(b);
    if (err.length) return res.status(422).json({ detail: err.join("; ") });
    if (b.public_site !== undefined) {
      if (!(req.user?.id === "owner" || levelOk(req.perms?.admin, "edit"))) return res.status(403).json({ detail: "Only the Owner or an Admin can choose which workspace the public help site shows." });
      store.db.help_site.workspace_id = b.public_site ? w.id : null;
    }
    w.help = { ...settingsOf(w), ...out }; store.save();
    res.json({ settings: settingsOf(w), site_workspace_id: siteWorkspace(store)?.id || null });
  });

  app.get(`${P}/articles`, (req, res) => {
    const w = W(req, res); if (!w) return;
    let list = store.listOps(COLL.articles, w.id);
    const st = String(req.query.status || ""), cat = String(req.query.category || ""), q = String(req.query.q || "").slice(0, 200);
    if (st === "stale") list = list.filter((a) => freshness(a, now()).stale); else if (st) list = list.filter((a) => a.status === st);
    if (cat) list = list.filter((a) => a.category === cat);
    list = q.trim() ? searchArticles(list, q) : list.sort((a, b) => String(b.updated_at || b.created_at).localeCompare(String(a.updated_at || a.created_at)));
    const all = store.listOps(COLL.articles, w.id);
    res.json({ articles: list.map((a) => summary(w, a)), totals: { all: all.length, published: all.filter((a) => a.status === "published").length, in_review: all.filter((a) => a.status === "in_review").length,
      drafts: all.filter((a) => a.status === "draft").length, stale: all.filter((a) => freshness(a, now()).stale).length, not_helpful: all.filter((a) => a.status === "published" && voteCounts(store, w.id, a.id, now()).no_30 >= 3).length } });
  });
  app.post(`${P}/articles`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const b = req.body || {}, { out, err } = cleanArticle(b, { store, wsId: w.id });
    if (err.length) return res.status(422).json({ detail: err.join("; ") });
    const a = store.addOps(COLL.articles, w.id, { title_ar: "", title_en: "", body_ar: "", body_en: "", related_ids: [], support_article_id: null, ...out, slug: "", status: "draft",
      author_id: req.user.id, author_name: req.user.name, reviewer_id: null, reviewer_name: "", last_reviewed: null, published_at: null, by_ai: false, log: [] }, false);
    a.slug = out.slug || uniqueSlug(store, w.id, slugFrom(out.title_en) || `${out.category}-${a.id}`, a.id);
    logPush(a, by(req), "Created as a draft", now()); store.save();
    res.status(201).json(view(req, w, a));
  });
  app.get(`${P}/articles/:id`, (req, res) => { const w = W(req, res); if (!w) return; const a = get(req, res, w); if (a) res.json(view(req, w, a)); });
  app.put(`${P}/articles/:id`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const a = get(req, res, w); if (!a) return;
    const { out, err } = cleanArticle(req.body || {}, { store, wsId: w.id, partial: true, selfId: a.id });
    if (err.length) return res.status(422).json({ detail: err.join("; ") });
    const changed = Object.keys(out).filter((k) => JSON.stringify(out[k]) !== JSON.stringify(a[k]));
    if (a.status === "published" && changed.some((k) => CONTENT_KEYS.includes(k) || k === "slug")) return res.status(409).json({ detail: "Published articles are locked. Move it back to Draft to change its text (it leaves the public site until it's reviewed again)." });
    const merged = { ...a, ...out };
    if (!merged.title_ar && !merged.title_en) return res.status(422).json({ detail: "Give the article a title (Arabic or English)" });
    Object.assign(a, out, { updated_at: new Date(now()).toISOString() });
    if (changed.length) logPush(a, by(req), `Edited: ${changed.map((k) => k.replace(/_/g, " ")).join(", ")}`, now());
    store.save();
    res.json(view(req, w, a));
  });
  app.post(`${P}/articles/:id/status`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const a = get(req, res, w); if (!a) return;
    const to = String(req.body?.status || "");
    if (!(NEXT[a.status] || []).includes(to)) return res.status(409).json({ detail: `A ${a.status.replace("_", " ")} article can move to: ${(NEXT[a.status] || []).join(", ").replace(/_/g, " ") || "nothing"}.` });
    const at = new Date(now()).toISOString();
    if (to === "in_review" && !(hasLang(a, "ar") || hasLang(a, "en"))) return res.status(422).json({ detail: "Write a title and a body in at least one language first." });
    if (to === "published") {
      const block = reviewBlock(a, req.user, settingsOf(w));
      if (block) return res.status(403).json({ detail: block });
      if (!(hasLang(a, "ar") || hasLang(a, "en"))) return res.status(422).json({ detail: "Write a title and a body in at least one language first." });
      if (/\[ADD\b/i.test(CONTENT_KEYS.map((k) => a[k]).join(" "))) return res.status(422).json({ detail: "Fill in every [ADD] before publishing (or delete the language you aren't publishing)." });
      Object.assign(a, { reviewer_id: req.user.id, reviewer_name: req.user.name, last_reviewed: todayOf(now()), published_at: at });
      judge(w, a, "publish");
    }
    if (to === "in_review") Object.assign(a, { submitted_by: req.user.name, submitted_at: at });
    if (to === "archived" && a.status !== "published") judge(w, a, "archive");
    const from = a.status;
    Object.assign(a, { status: to, updated_at: at });
    logPush(a, by(req), `${from.replace("_", " ")} → ${to.replace("_", " ")}${to === "published" ? ` (reviewed by ${req.user.name})` : ""}`, now());
    store.save();
    res.json(view(req, w, a));
  });
  // "Still correct": a person re-reads a published article; it counts as a review for freshness.
  app.post(`${P}/articles/:id/reviewed`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const a = get(req, res, w); if (!a) return;
    if (a.status !== "published") return res.status(409).json({ detail: "Only published articles are re-reviewed." });
    Object.assign(a, { last_reviewed: todayOf(now()), reviewer_id: req.user.id, reviewer_name: req.user.name, updated_at: new Date(now()).toISOString() });
    logPush(a, by(req), "Re-reviewed: still correct", now()); store.save();
    res.json(view(req, w, a));
  });
  app.delete(`${P}/articles/:id`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const a = get(req, res, w); if (!a) return;
    if (a.status === "published") return res.status(409).json({ detail: "Archive a published article before deleting it." });
    judge(w, a, "delete");
    store.deleteOps(COLL.articles, w.id, a.id);
    for (const x of store.listOps(COLL.articles, w.id)) if (x.related_ids?.includes(a.id)) x.related_ids = x.related_ids.filter((y) => y !== a.id);
    store.db[COLL.votes] = store.db[COLL.votes].filter((v) => !(v.workspace_id === w.id && v.article_id === a.id));
    store.save();
    res.json({ ok: true });
  });

  app.get(`${P}/gaps`, (req, res) => { const w = W(req, res); if (w) res.json({ gaps: gapList(store, w, now()), min: 5 }); });

  // ---- AI Help writer (drafts only)
  app.post(`${P}/ai/draft`, async (req, res) => {
    const w = W(req, res); if (!w) return;
    const b = req.body || {}, f = sourceFacts(store, w, { source: String(b.source || ""), support_article_id: b.support_article_id, ticket_ids: b.ticket_ids, category: b.category });
    if (f.error) return res.status(422).json({ detail: f.error });
    const d = await help.draft(w, f);
    const a = store.addOps(COLL.articles, w.id, { ...d.article, category: f.category, visibility: "public", related_ids: [], support_article_id: f.support_article_id, slug: "", status: "draft",
      author_id: req.user.id, author_name: req.user.name, reviewer_id: null, reviewer_name: "", last_reviewed: null, published_at: null, by_ai: d.by_ai, ai_note: d.note,
      source: { kind: String(b.source), label: f.label, ticket_ids: f.ticket_ids || [], support_article_id: f.support_article_id }, log: [] }, false);
    if (d.by_ai) a.ai_hash = contentHash(a);
    const clean = (t) => slugFrom(String(t || "").replace(/\[ADD[^\]]*\]/gi, "").replace(/^Sample ·/, ""));
    a.slug = uniqueSlug(store, w.id, clean(a.title_en) || `${f.category}-${a.id}`, a.id);
    logPush(a, by(req), `${d.by_ai ? "AI Help writer drafted" : "Plain draft made"} from ${f.label}`, now()); store.save();
    res.status(201).json({ article: view(req, w, a), by_ai: d.by_ai, note: d.note });
  });
  app.post(`${P}/articles/:id/ai/translate`, async (req, res) => {
    const w = W(req, res); if (!w) return;
    const a = get(req, res, w); if (!a) return;
    const to = req.body?.to === "en" ? "en" : req.body?.to === "ar" ? "ar" : null;
    if (!to) return res.status(422).json({ detail: "to must be ar or en" });
    const from = to === "ar" ? "en" : "ar";
    if (!hasLang(a, from)) return res.status(422).json({ detail: `Write the ${from === "ar" ? "Arabic" : "English"} version first.` });
    if (a.status === "published") return res.status(409).json({ detail: "Published articles are locked. Move it back to Draft first." });
    const t = await help.translate(w, a, to);
    a.translation = { lang: to, title: t.title, body: t.body, by_ai: t.by_ai, note: t.note, at: new Date(now()).toISOString() };
    store.save();
    res.json({ translation: a.translation });
  });
  app.post(`${P}/articles/:id/translation`, (req, res) => {
    const w = W(req, res); if (!w) return;
    const a = get(req, res, w); if (!a) return;
    const tr = a.translation; if (!tr) return res.status(404).json({ detail: "No translation draft" });
    const act = String(req.body?.action || "");
    if (act === "discard") { if (tr.by_ai) outcome(w.id, "rejected", "Translation discarded"); delete a.translation; store.save(); return res.json(view(req, w, a)); }
    if (act !== "apply") return res.status(422).json({ detail: "action must be apply or discard" });
    if (a.status === "published") return res.status(409).json({ detail: "Published articles are locked. Move it back to Draft first." });
    const title = req.body?.title !== undefined ? String(req.body.title).trim().slice(0, 200) : tr.title, body = req.body?.body !== undefined ? String(req.body.body).slice(0, 40000) : tr.body;
    if (tr.by_ai) outcome(w.id, title === tr.title && body === tr.body ? "accepted" : "edited", `Translation to ${tr.lang} used`);
    Object.assign(a, { [`title_${tr.lang}`]: title, [`body_${tr.lang}`]: body, updated_at: new Date(now()).toISOString() });
    delete a.translation;
    logPush(a, by(req), `${tr.lang === "ar" ? "Arabic" : "English"} version from ${tr.by_ai ? "the AI translation" : "the translation draft"}`, now()); store.save();
    res.json(view(req, w, a));
  });
}
