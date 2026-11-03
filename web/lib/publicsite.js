// The shared shell of DPA AD's public pages before the login wall: the Help center (/help, helpcenterroutes.js) and
// the Changelog (/changelog, changelogroutes.js). Self-contained HTML: no scripts at all (the CSP has no script-src,
// so default-src 'none' blocks every script), the only style block carries a per-response nonce, no tracking and no
// external fonts. Brand: the workspace's company name and the Creative Studio brand kit's primary and accent colours.
import crypto from "node:crypto";

export const h = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export const hex = (v, d) => (/^#[0-9a-f]{6}$/i.test(String(v || "")) ? v : d);
export const newNonce = () => crypto.randomBytes(12).toString("base64");
export const langOf = (req) => (req.query.lang === "en" ? "en" : "ar");
// A link on the page's language: /x (Arabic) or /x?lang=en, plus any extra query values.
export const linkFor = (lang) => (p, extra = {}) => { const s = new URLSearchParams({ ...(lang === "en" ? { lang: "en" } : {}), ...extra }).toString(); return s ? `${p}${p.includes("?") ? "&" : "?"}${s}` : p; };

export const PUBLIC_HEADERS = { "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Referrer-Policy": "strict-origin-when-cross-origin" };
export function sendPublic(res, html, status = 200, { cache = true, nonce } = {}) {
  res.status(status).set({ "Content-Type": "text/html; charset=utf-8", ...PUBLIC_HEADERS,
    "Content-Security-Policy": `default-src 'none'; style-src 'nonce-${nonce}'; img-src 'self' https: data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`,
    "Cache-Control": cache && status === 200 ? "public, max-age=60" : "no-store" }).send(html);
}
export function brandOf(w) {
  const brand = w?.creative?.brand?.colors || {};
  return { company: w?.brief?.company_name || "DPA AD", primary: hex(brand.primary, "#1f5eff"), accent: hex(brand.accent, "#ff7a1a"), website: w?.brief?.website || "" };
}

const CSS = `*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}body{margin:0;font:16px/1.65 system-ui,-apple-system,"Segoe UI",Tahoma,"Noto Sans Arabic",sans-serif;background:var(--bg);color:var(--text)}
a{color:var(--p)}a:focus-visible,button:focus-visible,input:focus-visible{outline:3px solid var(--p);outline-offset:2px}
header{background:var(--card);border-bottom:1px solid var(--border)}.wrap{max-width:860px;margin:0 auto;padding:0 16px}
.top{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px 12px;padding:14px 0}.brand{font-weight:700;text-decoration:none;color:var(--text);font-size:17px;min-width:0;overflow-wrap:anywhere}.brand span{color:var(--p)}
.links{display:flex;flex-wrap:wrap;gap:4px 14px;align-items:center;font-size:14px}.lang{font-size:14px;white-space:nowrap}.links a[aria-current]{color:var(--text);font-weight:600;text-decoration:none}
.hero{padding:8px 0 18px}.hero h1{margin:0 0 10px;font-size:24px;line-height:1.3}
form.s{display:flex;gap:8px}form.s input{flex:1;min-width:0;font:inherit;padding:10px 12px;border:1px solid var(--border);border-radius:10px;background:var(--bg);color:var(--text)}
.btn,button{font:inherit;font-size:15px;padding:9px 16px;border-radius:10px;border:1px solid var(--p);background:var(--p);color:#fff;cursor:pointer;text-decoration:none;display:inline-block}
.btn.ghost,button.ghost{background:transparent;color:var(--p)}main{padding:20px 0 40px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:12px}
.card{background:var(--card);border:1px solid var(--border);border-radius:14px;padding:16px;min-width:0;overflow-wrap:anywhere}a.card{display:block;text-decoration:none;color:var(--text)}a.card:hover{border-color:var(--p)}
.card b{display:block;font-size:16px}.muted{color:var(--muted);font-size:14px}ul.list{list-style:none;margin:0;padding:0;display:grid;gap:8px}ul.list a{display:block}
.crumb{font-size:14px;color:var(--muted);margin-bottom:8px}.crumb a{color:var(--muted)}article h1{font-size:26px;line-height:1.3;margin:0 0 6px}
.body h2{font-size:20px;margin:24px 0 8px}.body h3{font-size:17px;margin:20px 0 6px}.body h4{font-size:16px;margin:16px 0 4px}.body img{max-width:100%;height:auto;border-radius:10px}
.body pre{background:var(--soft);padding:12px;border-radius:10px;overflow-x:auto;direction:ltr;text-align:left}.body code{background:var(--soft);padding:1px 5px;border-radius:6px;font-size:.92em}.body pre code{padding:0;background:none}
.body ul,.body ol{padding-inline-start:22px}.note{background:var(--soft);border-radius:10px;padding:10px 12px;font-size:14px}.row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
main>*+*{margin-top:16px}.body>:first-child{margin-top:0}.body>:last-child{margin-bottom:0}footer{color:var(--muted);font-size:13px;padding:20px 16px 28px;border-top:1px solid var(--border)}h2.t{font-size:18px;margin:0 0 10px}
.chips{display:flex;flex-wrap:wrap;gap:6px}.chip{display:inline-block;font-size:13px;line-height:1.4;padding:4px 10px;border-radius:999px;border:1px solid var(--border);background:var(--card);color:var(--text);text-decoration:none;white-space:nowrap}
a.chip:hover{border-color:var(--p)}.chip.on{background:var(--p);border-color:var(--p);color:#fff}.kind{font-weight:600;color:#fff;background:var(--p);border-color:var(--p)}.kind.fixed{background:#1d8a5a;border-color:#1d8a5a}.kind.improved{background:var(--a);border-color:var(--a)}.kind.announcement{background:#6d4fd8;border-color:#6d4fd8}
.entry{display:grid;gap:8px}.entry h2{font-size:19px;line-height:1.35;margin:0}.entry h2 a{color:var(--text);text-decoration:none}.entry h2 a:hover{color:var(--p)}.when{color:var(--muted);font-size:14px}.hero-img{display:block;width:100%;height:auto;border-radius:12px;margin:4px 0}
.pager{display:flex;justify-content:space-between;gap:12px}.m0{margin:0}.mt8{margin-top:8px}.mt12{margin-top:12px}.entry .muted{margin:0}`;

// One page. `nav` is a list of { href, text, current } shown next to the language switch (the cross-links between
// /help and /changelog); `hero` is optional HTML under the header (the help search form).
export function publicPage({ w, lang, nonce, title = "", section, homeHref, switchHref, nav = [], hero = "", body, desc = "", noindex = false, alternate = [] }) {
  const { company, primary, accent, website } = brandOf(w);
  const other = lang === "ar" ? "en" : "ar";
  return `<!doctype html><html lang="${lang}" dir="${lang === "ar" ? "rtl" : "ltr"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${h(title ? `${title} · ` : "")}${h(company)} ${h(section)}</title>${desc ? `<meta name="description" content="${h(desc.slice(0, 160))}">` : ""}${noindex ? `<meta name="robots" content="noindex">` : ""}${alternate.map((a) => `<link rel="alternate" type="${h(a.type)}" title="${h(a.title)}" href="${h(a.href)}">`).join("")}
<style nonce="${nonce}">:root{color-scheme:light dark;--p:${primary};--a:${accent};--bg:#f7f7f5;--card:#fff;--text:#16181d;--muted:#5d636e;--border:#e3e4e8;--soft:#eef2ff}
@media(prefers-color-scheme:dark){:root{--bg:#111316;--card:#1a1d22;--text:#eceef2;--muted:#a2a8b3;--border:#2c3038;--soft:#1f2533}}
${CSS}</style></head><body>
<header><div class="wrap"><div class="top"><a class="brand" href="${h(homeHref)}">${h(company)} <span>· ${h(section)}</span></a><nav class="links" aria-label="${lang === "ar" ? "روابط" : "Links"}">${nav.map((n) => `<a href="${h(n.href)}"${n.current ? ' aria-current="page"' : ""}>${h(n.text)}</a>`).join("")}<a class="lang" href="${h(switchHref)}" hreflang="${other}" lang="${other}">${other === "en" ? "English" : "العربية"}</a></nav></div>
${hero}</div></header>
<main class="wrap">${body}</main><footer class="wrap">© ${h(company)}${website ? ` · <a href="${h(website)}" rel="noopener">${h(String(website).replace(/^https?:\/\//, ""))}</a>` : ""}</footer></body></html>`;
}
