// Product samples per store (Creative Studio phase 4a, "your products as ads").
// Each CRM store can carry up to 6 of its own products: { title, price, image_url, url }.
// Sources: CSV import columns, Shopify's public /products.json, or a best-effort read of the store's
// home page (schema.org Product JSON-LD, then og:image / og:title on product pages it links to).
// Best effort until DPA AD's render engine can supply real designed images.
//
// Fetch safety: server-side only, https/http only, DNS resolved and private/loopback/link-local
// addresses refused (on every redirect, and again at connect time), 8 s timeout, ~2 MB cap,
// "DPA-AD-bot (+https://dpa.ad)" user agent, at most 2 fetches at a time, a polite delay between stores.
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import zlib from "node:zlib";
import { Readable } from "node:stream";

export const MAX_PRODUCTS = 6;
export const USER_AGENT = "DPA-AD-bot (+https://dpa.ad)";
export const FETCH_LIMITS = { timeoutMs: 8000, maxBytes: 2 * 1024 * 1024, maxRedirects: 4, concurrency: 2, delayMs: 1500, bulkCap: 500 };
export const PRODUCT_SOURCES = { csv: "CSV import", shopify: "Shopify products.json", jsonld: "Store page (schema.org Product)", og: "Product pages (og:image)", manual: "Edited by hand" };

// ---- cleaning ------------------------------------------------------------------------------------
const str = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const decodeEntities = (s) => String(s ?? "").replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|#39|nbsp);/gi, (m, e) => {
  const k = e.toLowerCase();
  if (k[0] === "#") { const n = k[1] === "x" ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ""; }
  return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " }[k] ?? m;
});
// Images in results are https only (protocol-relative "//cdn…" is upgraded; http:// is dropped).
export function httpsImage(u, base) {
  let s = str(decodeEntities(u), 1000);
  if (!s) return "";
  if (s.startsWith("//")) s = "https:" + s;
  try { s = new URL(s, base || undefined).href; } catch { return ""; }
  return /^https:\/\/[^\s"'<>]+$/i.test(s) ? s : "";
}
export function webLink(u, base) {
  const s = str(decodeEntities(u), 1000);
  if (!s) return "";
  try { const h = new URL(s.startsWith("//") ? "https:" + s : s, base || undefined).href; return /^https?:\/\/[^\s"'<>]+$/i.test(h) ? h : ""; } catch { return ""; }
}
const CUR = { SAR: "ر.س", "ر.س": "ر.س" };
export function formatPrice(amount, currency = "") {
  const a = str(amount, 30), c = str(currency, 10).toUpperCase();
  if (!a) return "";
  const n = Number(a.replace(/,/g, ""));
  const num = Number.isFinite(n) && /^[\d.,\s]+$/.test(a) ? (Number.isInteger(n) ? String(n) : n.toFixed(2)) : a;
  return c && /^[\d.]+$/.test(num) ? `${num} ${CUR[c] || c}` : num;
}
export function cleanProducts(list, base) {
  return (Array.isArray(list) ? list : []).map((p) => ({
    title: str(decodeEntities(p?.title), 120), price: str(p?.price, 30), image_url: httpsImage(p?.image_url, base), url: webLink(p?.url, base),
  })).filter((p) => p.title || p.image_url).slice(0, MAX_PRODUCTS);
}
// Products that can be shown as an ad card: they need a photo.
export const withImages = (c) => (c?.products_sample || []).filter((p) => /^https:\/\//.test(p.image_url || ""));

// ---- parsing: Shopify ----------------------------------------------------------------------------
export function parseShopifyProducts(json, domain) {
  const base = `https://${domain}`;
  const items = Array.isArray(json?.products) ? json.products : [];
  return cleanProducts(items.map((p) => {
    const img = p.images?.[0]?.src || p.image?.src || "";
    const v = p.variants?.[0] || {};
    return { title: p.title, price: formatPrice(v.price ?? ""), image_url: img, url: p.handle ? `${base}/products/${encodeURIComponent(p.handle)}` : "" };
  }), base);
}

// ---- parsing: schema.org JSON-LD and Open Graph --------------------------------------------------
const types = (o) => [].concat(o?.["@type"] || []).map((t) => String(t).toLowerCase());
function* walk(o, depth = 0) {
  if (!o || typeof o !== "object" || depth > 8) return;
  if (Array.isArray(o)) { for (const x of o) yield* walk(x, depth + 1); return; }
  yield o;
  for (const k of ["@graph", "itemListElement", "item", "mainEntity", "hasVariant", "isRelatedTo", "offers"]) if (o[k]) yield* walk(o[k], depth + 1);
}
const firstImage = (img) => { const x = Array.isArray(img) ? img[0] : img; return typeof x === "string" ? x : x?.url || x?.contentUrl || ""; };
function offerPrice(offers) {
  const o = Array.isArray(offers) ? offers[0] : offers;
  if (!o || typeof o !== "object") return "";
  const amount = o.price ?? o.lowPrice ?? o.priceSpecification?.price ?? "";
  return formatPrice(amount, o.priceCurrency || o.priceSpecification?.priceCurrency || "");
}
export function extractJsonLdProducts(html, baseUrl) {
  const out = [], seen = new Set();
  const re = /<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi;
  for (const m of String(html || "").matchAll(re)) {
    let data;
    try { data = JSON.parse(m[1].trim().replace(/^<!--|-->$/g, "")); } catch { continue; }
    for (const o of walk(data)) {
      if (!types(o).includes("product")) continue;
      const p = { title: o.name, price: offerPrice(o.offers), image_url: firstImage(o.image), url: o.url || o["@id"] || "" };
      const key = `${p.title}|${firstImage(o.image)}`;
      if (seen.has(key)) continue;
      seen.add(key); out.push(p);
    }
  }
  return cleanProducts(out, baseUrl);
}
const metaContent = (html, names) => {
  for (const n of names) {
    const a = new RegExp(`<meta\\b[^>]*(?:property|name)\\s*=\\s*["']${n.replace(/[:.]/g, "\\$&")}["'][^>]*>`, "i").exec(html);
    const c = a && /content\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(a[0]);
    if (c) return c[1] ?? c[2] ?? "";
  }
  return "";
};
export function extractOgProduct(html, pageUrl) {
  const h = String(html || "");
  const title = metaContent(h, ["og:title", "twitter:title"]) || (/<title[^>]*>([^<]*)<\/title>/i.exec(h)?.[1] || "");
  const image = metaContent(h, ["og:image:secure_url", "og:image", "twitter:image"]);
  const amount = metaContent(h, ["product:price:amount", "og:price:amount"]);
  const currency = metaContent(h, ["product:price:currency", "og:price:currency"]);
  const p = cleanProducts([{ title, price: formatPrice(decodeEntities(amount), currency), image_url: image, url: metaContent(h, ["og:url"]) || pageUrl }], pageUrl)[0];
  return p && p.image_url ? p : null;
}
// Links on the home page that look like product pages, on the same site. Salla: /slug/p123456;
// Zid and Shopify: /products/slug; others: /product/…, /item/…
export function productLinks(html, baseUrl, max = MAX_PRODUCTS) {
  const base = new URL(baseUrl), host = base.hostname.replace(/^www\./, "");
  const out = new Set();
  for (const m of String(html || "").matchAll(/<a\b[^>]*href\s*=\s*(?:"([^"]+)"|'([^']+)')/gi)) {
    let u;
    try { u = new URL(decodeEntities(m[1] ?? m[2]), base); } catch { continue; }
    if (!/^https?:$/.test(u.protocol) || u.hostname.replace(/^www\./, "") !== host) continue;
    if (!/\/p\d{4,}\/?$|\/products?\/[^/?#]+|\/item\/[^/?#]+|\/منتج|\/product-/i.test(decodeURIComponent(u.pathname))) continue;
    if (/\/products?\/?$|\/collections?\//i.test(u.pathname)) continue;
    u.hash = ""; out.add(u.href);
    if (out.size >= max) break;
  }
  return [...out];
}
export const looksLikeShopify = (html) => /cdn\.shopify\.com|Shopify\.theme|shopify-section/i.test(String(html || ""));

// ---- SSRF protection -----------------------------------------------------------------------------
function v4Private(ip) {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((x) => !(x >= 0 && x <= 255))) return true;
  const [a, b] = p;
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 192 && b === 0 && p[2] === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
}
export function isPrivateIp(ip) {
  const s = String(ip || "").toLowerCase().replace(/^\[|\]$/g, "").split("%")[0];
  const kind = net.isIP(s);
  if (kind === 4) return v4Private(s);
  if (kind !== 6) return true; // not an IP at all: refuse
  if (s === "::" || s === "::1") return true;
  const mapped = /^::ffff:(?:0:)?(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (mapped) return v4Private(mapped[1]);
  if (/^::ffff:[0-9a-f]{1,4}:[0-9a-f]{1,4}$/.test(s)) { const [, hi, lo] = /^::ffff:([0-9a-f]+):([0-9a-f]+)$/.exec(s); const n = (parseInt(hi, 16) << 16) | parseInt(lo, 16); return v4Private([n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".")); }
  const first = parseInt(s.split(":")[0] || "0", 16);
  return (first & 0xfe00) === 0xfc00 /* fc00::/7 unique local */ || (first & 0xffc0) === 0xfe80 /* link-local */ || (first & 0xffc0) === 0xfec0 /* site-local */ ||
    (first & 0xff00) === 0xff00 /* multicast */ || first === 0x2002 /* 6to4 can wrap private v4 */ || s.startsWith("64:ff9b:") || s.startsWith("100::") || s.startsWith("2001:db8:");
}
const defaultLookup = (host) => dns.promises.lookup(host, { all: true, verbatim: true });
export class FetchRefused extends Error {}
// Throws unless the URL is http(s) on a public address.
export async function assertPublicUrl(url, lookup = defaultLookup) {
  let u;
  try { u = new URL(url); } catch { throw new FetchRefused("Not a valid link"); }
  if (!/^https?:$/.test(u.protocol)) throw new FetchRefused("Only http and https links are fetched");
  if (u.username || u.password) throw new FetchRefused("Links with a login aren't fetched");
  if (u.port && !["80", "443", "8080", "8443"].includes(u.port)) throw new FetchRefused("Unusual port refused");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (!host || /^(localhost|.*\.localhost|.*\.local|.*\.internal)$/i.test(host)) throw new FetchRefused("Private address refused");
  let addrs;
  if (net.isIP(host)) addrs = [{ address: host }];
  else { try { addrs = await lookup(host); } catch { throw new FetchRefused(`The store's domain doesn't resolve (${host})`); } }
  addrs = [].concat(addrs || []).map((a) => (typeof a === "string" ? { address: a } : a));
  if (!addrs.length) throw new FetchRefused(`The store's domain doesn't resolve (${host})`);
  if (addrs.some((a) => isPrivateIp(a.address))) throw new FetchRefused("Private, loopback or link-local address refused");
  return u;
}

// Default transport: node http/https with a lookup that re-checks the address at connect time,
// so a DNS answer can't change to a private address between the check and the request.
export function guardedFetch(url, { headers = {}, signal } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url), mod = u.protocol === "https:" ? https : http;
    const lookup = (host, opts, cb) => dns.lookup(host, { ...opts, all: true, verbatim: true }, (err, list) => {
      if (err) return cb(err);
      const bad = list.find((a) => isPrivateIp(a.address));
      if (bad) return cb(new FetchRefused("Private, loopback or link-local address refused"));
      if (opts?.all) return cb(null, list);
      cb(null, list[0].address, list[0].family);
    });
    const req = mod.request(u, { method: "GET", headers: { ...headers, "Accept-Encoding": "gzip, deflate, br" }, lookup, signal }, (res) => {
      const enc = String(res.headers["content-encoding"] || "").toLowerCase();
      const stream = enc === "gzip" ? res.pipe(zlib.createGunzip()) : enc === "deflate" ? res.pipe(zlib.createInflate()) : enc === "br" ? res.pipe(zlib.createBrotliDecompress()) : res;
      stream.on("error", () => {});
      const h = new Headers();
      for (const [k, v] of Object.entries(res.headers)) if (k !== "content-encoding" && k !== "content-length") h.set(k, Array.isArray(v) ? v.join(", ") : String(v));
      const status = res.statusCode >= 200 && res.statusCode <= 599 ? res.statusCode : 502;
      resolve(new Response([101, 204, 205, 304].includes(status) ? null : Readable.toWeb(stream), { status, headers: h }));
    });
    req.on("error", reject);
    req.end();
  });
}

async function readCapped(res, maxBytes) {
  if (!res.body) return { text: "", truncated: false };
  const reader = res.body.getReader(), chunks = [];
  let size = 0, truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength; chunks.push(value);
    if (size > maxBytes) { truncated = true; await reader.cancel().catch(() => {}); break; }
  }
  return { text: Buffer.concat(chunks.map((c) => Buffer.from(c))).subarray(0, maxBytes).toString("utf8"), truncated };
}

// GET one URL safely. Redirects are followed by hand so every hop is checked.
export async function safeGet(url, { fetchImpl = guardedFetch, lookup = defaultLookup, accept = "text/html,application/json;q=0.9,*/*;q=0.5", limits = FETCH_LIMITS } = {}) {
  let cur = url;
  for (let hop = 0; hop <= limits.maxRedirects; hop++) {
    const u = await assertPublicUrl(cur, lookup);
    const signal = AbortSignal.timeout(limits.timeoutMs);
    let res;
    try { res = await fetchImpl(u.href, { method: "GET", redirect: "manual", signal, headers: { "User-Agent": USER_AGENT, Accept: accept, "Accept-Language": "ar,en;q=0.8" } }); }
    catch (e) {
      if (e instanceof FetchRefused) throw e;
      throw new Error(e?.name === "TimeoutError" || e?.name === "AbortError" ? "The store didn't answer within 8 seconds" : `Couldn't reach the store (${String(e?.cause?.code || e?.code || e?.message || e).slice(0, 80)})`);
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      await res.body?.cancel?.().catch(() => {});
      cur = new URL(res.headers.get("location"), u).href; continue;
    }
    const len = Number(res.headers.get("content-length") || 0);
    if (len > limits.maxBytes * 4) { await res.body?.cancel?.().catch(() => {}); throw new Error("The page is too large to read"); }
    const { text, truncated } = await readCapped(res, limits.maxBytes);
    return { url: u.href, status: res.status, ok: res.status >= 200 && res.status < 300, type: res.headers.get("content-type") || "", text, truncated };
  }
  throw new Error("Too many redirects");
}

// ---- one store -----------------------------------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function fetchStoreProducts(contact, opts = {}) {
  const at = new Date().toISOString();
  const done = (products, source, reason = "") => ({ products: products.slice(0, MAX_PRODUCTS), source, reason, fetched_at: at, ok: products.length > 0 });
  const domain = String(contact?.domain || "").trim().toLowerCase();
  if (!domain) return done([], "", "No store link to read");
  const base = `https://${domain}`;
  const get = (u, accept) => safeGet(u, { ...opts, accept });
  const shopify = async () => {
    const r = await get(`${base}/products.json?limit=${MAX_PRODUCTS}`, "application/json");
    if (!r.ok) return [];
    try { return parseShopifyProducts(JSON.parse(r.text), new URL(r.url).hostname).filter((p) => p.image_url); } catch { return []; }
  };
  try {
    if (contact.platform === "Shopify" || /myshopify\.com$/.test(domain)) {
      const p = await shopify();
      if (p.length) return done(p, "shopify");
    }
    const home = await get(base + "/");
    if (!home.ok) return done([], "", `The store's home page answered ${home.status}`);
    const pageBase = home.url;
    const ld = extractJsonLdProducts(home.text, pageBase).filter((p) => p.image_url);
    if (ld.length) return done(ld, "jsonld");
    if (contact.platform !== "Shopify" && looksLikeShopify(home.text)) { const p = await shopify().catch(() => []); if (p.length) return done(p, "shopify"); }
    const links = productLinks(home.text, pageBase);
    if (!links.length) return done([], "", "No product data on the home page (no schema.org Product) and no product links found. The store may load products with JavaScript: add samples by hand or by CSV.");
    const found = [];
    let source = "og";
    for (const link of links) {
      try {
        const page = await get(link);
        if (!page.ok) continue;
        const ld2 = extractJsonLdProducts(page.text, page.url).filter((p) => p.image_url);
        if (ld2.length) { found.push({ ...ld2[0], url: ld2[0].url || page.url }); source = "jsonld"; }
        else { const og = extractOgProduct(page.text, page.url); if (og) found.push(og); }
      } catch (e) { if (e instanceof FetchRefused) throw e; }
      if (found.length >= MAX_PRODUCTS) break;
      if (opts.pageDelayMs) await sleep(opts.pageDelayMs);
    }
    return found.length ? done(found, source) : done([], "", `Opened ${links.length} product page${links.length > 1 ? "s" : ""} but found no https product photo in their data`);
  } catch (e) {
    return done([], "", String(e?.message || e).slice(0, 200));
  }
}

// ---- service: one store now, or a background job for many --------------------------------------
export function createProducts({ crm, fetchImpl, lookup, limits = {}, delayMs = FETCH_LIMITS.delayMs, pageDelayMs = 300 } = {}) {
  const L = { ...FETCH_LIMITS, ...limits };
  const opts = { ...(fetchImpl ? { fetchImpl } : {}), ...(lookup ? { lookup } : {}), limits: L, pageDelayMs };
  // At most L.concurrency stores are read at the same time across single fetches and jobs.
  let active = 0; const queue = [];
  const slot = () => new Promise((r) => { if (active < L.concurrency) { active++; r(); } else queue.push(r); });
  const release = () => { const n = queue.shift(); if (n) n(); else active--; };

  async function fetchOne(c) {
    await slot();
    try {
      const r = await fetchStoreProducts(c, opts);
      const f = { products_fetched_at: r.fetched_at, products_error: r.ok ? "" : r.reason };
      // A failed fetch never wipes samples that came from a CSV or were edited by hand.
      if (r.ok) Object.assign(f, { products_sample: r.products, products_source: r.source });
      crm.update(c.workspace_id, c.id, f);
      return r;
    } finally { release(); }
  }

  const jobs = new Map();
  const view = (j) => j && { id: j.id, workspace_id: j.workspace_id, status: j.status, total: j.total, done: j.done, found: j.found, failed: j.failed, started_at: j.started_at, finished_at: j.finished_at, by: j.by, errors: j.errors.slice(-8), capped: j.capped };
  function latest(wsId) { return view([...jobs.values()].filter((j) => j.workspace_id === String(wsId)).at(-1)); }
  function start(wsId, contacts, { by = "" } = {}) {
    const running = [...jobs.values()].find((j) => j.workspace_id === String(wsId) && j.status === "running");
    if (running) return { job: view(running), already: true };
    const list = contacts.filter((c) => c.domain).slice(0, L.bulkCap);
    const j = { id: "pj" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), workspace_id: String(wsId), status: "running", total: list.length, done: 0, found: 0, failed: 0,
      started_at: new Date().toISOString(), finished_at: null, by, errors: [], capped: contacts.length > L.bulkCap, cancel: false };
    jobs.set(j.id, j);
    if (jobs.size > 50) jobs.delete(jobs.keys().next().value);
    let next = 0;
    const worker = async (w) => {
      while (next < list.length && !j.cancel) {
        const c = list[next++];
        try {
          const r = await fetchOne(crm.get(wsId, c.id) || c);
          if (r.ok) j.found++; else { j.failed++; j.errors.push({ store: c.store_name, reason: r.reason }); }
        } catch (e) { j.failed++; j.errors.push({ store: c.store_name, reason: String(e?.message || e).slice(0, 200) }); }
        j.done++;
        if (next < list.length && delayMs) await sleep(delayMs);
      }
    };
    j.promise = Promise.all(Array.from({ length: Math.min(L.concurrency, list.length) }, (_, w) => worker(w))).then(() => {
      j.status = j.cancel ? "stopped" : "done"; j.finished_at = new Date().toISOString(); crm.save();
    });
    return { job: view(j), already: false };
  }
  const get = (wsId, id) => { const j = jobs.get(id); return j && j.workspace_id === String(wsId) ? view(j) : null; };
  const stop = (wsId, id) => { const j = jobs.get(id); if (j && j.workspace_id === String(wsId)) j.cancel = true; return get(wsId, id); };
  const wait = (id) => jobs.get(id)?.promise; // tests
  return { fetchOne, start, get, stop, latest, wait, limits: L };
}
