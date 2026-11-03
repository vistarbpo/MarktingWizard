// Backups: a consistent snapshot of db.json + crm.json (+ optionally media/) as a gzip'd tar, encrypted
// with AES-256-GCM (BACKUP_KEY), kept in DATA_DIR/backups (last 14 nightly + 8 weekly + 10 manual) and,
// when configured, copied off-site to S3-compatible storage (SigV4 signed with node:crypto) and/or by email.
// Nothing here needs a dependency beyond Node itself (nodemailer is already used by the Store CRM).
//
// Env: BACKUP_KEY (64 hex chars, or a long passphrase; without it backups stay local and unencrypted),
//      BACKUP_S3_ENDPOINT, BACKUP_S3_BUCKET, BACKUP_S3_KEY, BACKUP_S3_SECRET, BACKUP_S3_REGION (default us-east-1),
//      BACKUP_S3_PREFIX (default "marketing-wizard/"), BACKUP_S3_PATH_STYLE (1/0; default 1 except on amazonaws.com),
//      BACKUP_EMAIL_TO, BACKUP_EMAIL_MAX_MB (default 15), BACKUP_MEDIA (0 to leave media out), BACKUP_MEDIA_MAX_MB (default 200).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { promisify } from "node:util";

const gzip = promisify(zlib.gzip), gunzip = promisify(zlib.gunzip);
export const KEEP = { nightly: 14, weekly: 8, manual: 10 };
export const FRESH_HOURS = 26;
const NAME_RE = /^mwiz-backup-(\d{8}T\d{9}Z)-(nightly|weekly|manual)\.tar\.gz(\.enc)?$/;
const MAGIC = Buffer.from("MWB1");
const sha256 = (b) => crypto.createHash("sha256").update(b).digest("hex");
const riyadhDate = (ms) => new Date(ms + 3 * 3600e3).toISOString().slice(0, 10);

export function backupConfig(env = process.env) {
  const endpoint = (env.BACKUP_S3_ENDPOINT || "").replace(/\/$/, "");
  const s3Ready = !!(endpoint && env.BACKUP_S3_BUCKET && env.BACKUP_S3_KEY && env.BACKUP_S3_SECRET);
  const smtpReady = !!(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS);
  return {
    key: env.BACKUP_KEY || "",
    media: env.BACKUP_MEDIA !== "0",
    media_max: Number(env.BACKUP_MEDIA_MAX_MB || 200) * 1048576,
    s3: { ready: s3Ready, endpoint, bucket: env.BACKUP_S3_BUCKET || "", access: env.BACKUP_S3_KEY || "", secret: env.BACKUP_S3_SECRET || "",
      region: env.BACKUP_S3_REGION || "us-east-1", prefix: env.BACKUP_S3_PREFIX ?? "marketing-wizard/",
      path_style: env.BACKUP_S3_PATH_STYLE ? env.BACKUP_S3_PATH_STYLE !== "0" : !/amazonaws\.com$/i.test(endpoint.replace(/^https?:\/\//, "").split("/")[0]) },
    email: { ready: !!(env.BACKUP_EMAIL_TO && smtpReady), to: env.BACKUP_EMAIL_TO || "", max: Number(env.BACKUP_EMAIL_MAX_MB || 15) * 1048576,
      smtp: { host: env.SMTP_HOST || "", port: Number(env.SMTP_PORT || 465), user: env.SMTP_USER || "", pass: env.SMTP_PASS || "", from: env.MAIL_FROM || env.SMTP_USER || "" } },
  };
}

// ---- tar (ustar), enough for regular files
function tarHeader(name, size, mtime) {
  const h = Buffer.alloc(512);
  const put = (s, off, len) => h.write(String(s).slice(0, len), off, len, "utf8");
  const oct = (n, len) => n.toString(8).padStart(len - 1, "0") + "\0";
  put(name, 0, 100); put("0000644\0", 100, 8); put(oct(0, 8), 108, 8); put(oct(0, 8), 116, 8);
  put(oct(size, 12), 124, 12); put(oct(Math.floor(mtime / 1000), 12), 136, 12);
  h.fill(0x20, 148, 156); h.write("0", 156); put("ustar\0", 257, 6); put("00", 263, 2);
  let sum = 0; for (const b of h) sum += b;
  put(sum.toString(8).padStart(6, "0") + "\0 ", 148, 8);
  return h;
}
export function tarPack(entries, mtime = Date.now()) {
  const parts = [];
  for (const { name, data } of entries) {
    if (Buffer.byteLength(name) > 100) throw new Error(`Name too long for tar: ${name}`);
    parts.push(tarHeader(name, data.length, mtime), data);
    const pad = (512 - (data.length % 512)) % 512;
    if (pad) parts.push(Buffer.alloc(pad));
  }
  parts.push(Buffer.alloc(1024));
  return Buffer.concat(parts);
}
export function tarUnpack(buf) {
  const out = [];
  for (let off = 0; off + 512 <= buf.length;) {
    const h = buf.subarray(off, off + 512);
    if (h.every((b) => b === 0)) break;
    const name = h.subarray(0, 100).toString("utf8").replace(/\0.*$/s, "");
    const size = parseInt(h.subarray(124, 136).toString("utf8").replace(/\0.*$/s, "").trim() || "0", 8);
    off += 512;
    out.push({ name, data: buf.subarray(off, off + size) });
    off += Math.ceil(size / 512) * 512;
  }
  return out;
}

// ---- AES-256-GCM. File: "MWB1" | salt(16) | iv(12) | tag(16) | ciphertext.
// BACKUP_KEY of 64 hex chars is used as the key; anything else is a passphrase run through scrypt with the salt.
const deriveKey = (secret, salt) => /^[0-9a-f]{64}$/i.test(secret) ? Buffer.from(secret, "hex") : crypto.scryptSync(String(secret), salt, 32);
export function encrypt(plain, secret) {
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", deriveKey(secret, salt), iv);
  c.setAAD(MAGIC);
  const ct = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([MAGIC, salt, iv, c.getAuthTag(), ct]);
}
export function decrypt(buf, secret) {
  if (!buf.subarray(0, 4).equals(MAGIC)) throw new Error("Not an encrypted Marketing Wizard backup.");
  if (!secret) throw new Error("This backup is encrypted: BACKUP_KEY is needed to open it.");
  const salt = buf.subarray(4, 20), iv = buf.subarray(20, 32), tag = buf.subarray(32, 48);
  const d = crypto.createDecipheriv("aes-256-gcm", deriveKey(secret, salt), iv);
  d.setAAD(MAGIC); d.setAuthTag(tag);
  try { return Buffer.concat([d.update(buf.subarray(48)), d.final()]); }
  catch { throw new Error("Could not decrypt: wrong BACKUP_KEY or the file is damaged."); }
}

// Opens a backup file (encrypted or not) into its parts, checking every checksum in the manifest.
export async function openBackup(buf, secret) {
  const raw = buf.subarray(0, 4).equals(MAGIC) ? decrypt(buf, secret) : buf;
  const files = tarUnpack(await gunzip(raw));
  const get = (n) => files.find((f) => f.name === n);
  const manifest = JSON.parse(get("manifest.json")?.data.toString("utf8") || "null");
  if (!manifest) throw new Error("The backup has no manifest.json.");
  for (const f of manifest.files) {
    const e = get(f.name);
    if (!e) throw new Error(`Missing ${f.name} in the backup.`);
    if (sha256(e.data) !== f.sha256) throw new Error(`Checksum mismatch for ${f.name}.`);
  }
  const db = JSON.parse(get("db.json").data.toString("utf8")), crm = JSON.parse(get("crm.json").data.toString("utf8"));
  return { manifest, db, crm, files };
}
export const countsOf = (obj) => Object.fromEntries(Object.entries(obj || {}).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, v.length]));

// ---- AWS Signature Version 4 (node:crypto only). Returns the headers to send, Authorization included.
const hmac = (k, s) => crypto.createHmac("sha256", k).update(s).digest();
export function uriEncode(s, keepSlash = true) {
  const e = encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
  return keepSlash ? e.replace(/%2F/g, "/") : e;
}
export function signV4({ method, url, headers = {}, payloadHash, region, service = "s3", accessKey, secretKey, date = new Date() }) {
  const u = new URL(url);
  const amzDate = date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, ""), day = amzDate.slice(0, 8);
  const all = { host: u.host, ...Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])), "x-amz-date": amzDate };
  const names = Object.keys(all).sort();
  const canonHeaders = names.map((k) => `${k}:${String(all[k]).trim().replace(/\s+/g, " ")}\n`).join("");
  const query = [...u.searchParams].map(([k, v]) => [uriEncode(k, false), uriEncode(v, false)]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join("&");
  const signed = names.join(";");
  const canonical = [method, u.pathname || "/", query, canonHeaders, signed, payloadHash].join("\n");
  const scope = `${day}/${region}/${service}/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonical)].join("\n");
  const kSign = hmac(hmac(hmac(hmac("AWS4" + secretKey, day), region), service), "aws4_request");
  const signature = crypto.createHmac("sha256", kSign).update(toSign).digest("hex");
  const out = { ...all, authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signed}, Signature=${signature}` };
  delete out.host; // fetch sets Host from the URL
  return { headers: out, signature, canonical };
}
export function s3Url(cfg, key) {
  const ep = new URL(cfg.endpoint);
  const k = uriEncode(cfg.prefix + key);
  return cfg.path_style ? `${ep.origin}/${uriEncode(cfg.bucket)}/${k}` : `${ep.protocol}//${cfg.bucket}.${ep.host}/${k}`;
}
export async function uploadS3(cfg, key, body, { fetchImpl = fetch, date = new Date() } = {}) {
  const url = s3Url(cfg, key), payloadHash = sha256(body);
  const { headers } = signV4({ method: "PUT", url, headers: { "content-type": "application/octet-stream", "x-amz-content-sha256": payloadHash }, payloadHash, region: cfg.region, accessKey: cfg.access, secretKey: cfg.secret, date });
  const res = await fetchImpl(url, { method: "PUT", headers, body, signal: AbortSignal.timeout(10 * 60e3) });
  if (!res.ok) throw new Error(`S3 upload failed: HTTP ${res.status} ${String(await res.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 200)}`);
  return { url: url.replace(/\?.*$/, ""), etag: res.headers.get?.("etag") || "" };
}

// ---- the service
export function createBackups({ store, crm, env = process.env, cfg = backupConfig(env), fetchImpl = fetch, mailer = null, log = console, now = () => Date.now() }) {
  const dir = path.join(store.dir, "backups");
  const db = store.db;
  db.backup_log ||= [];
  let running = null, timer = null;

  const parse = (name) => { const m = NAME_RE.exec(name); if (!m) return null; const s = m[1]; return { name, kind: m[2], encrypted: !!m[3], at: `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(9, 11)}:${s.slice(11, 13)}:${s.slice(13, 15)}.${s.slice(15, 18)}Z` }; };
  const safeName = (name) => (NAME_RE.test(String(name || "")) ? String(name) : null);
  const pathOf = (name) => { const n = safeName(name); return n && fs.existsSync(path.join(dir, n)) ? path.join(dir, n) : null; };
  function files() {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).map(parse).filter(Boolean).map((f) => {
      const logEntry = db.backup_log.find((l) => l.name === f.name) || {};
      return { ...f, size: fs.statSync(path.join(dir, f.name)).size, offsite: logEntry.offsite || {}, counts: logEntry.counts || null, media_files: logEntry.media_files ?? null, media_note: logEntry.media_note || "", verified: logEntry.verified || null };
    }).sort((a, b) => b.at.localeCompare(a.at));
  }
  function record(entry) {
    db.backup_log.push(entry);
    if (db.backup_log.length > 300) db.backup_log.splice(0, db.backup_log.length - 300);
    store.save();
    return entry;
  }
  const entryFor = (name) => db.backup_log.find((l) => l.name === name);

  function prune(keep = KEEP) {
    const removed = [];
    const all = files();
    for (const kind of Object.keys(keep)) {
      for (const f of all.filter((x) => x.kind === kind).slice(keep[kind])) { fs.rmSync(path.join(dir, f.name), { force: true }); removed.push(f.name); }
    }
    return removed;
  }

  async function mediaEntries() {
    const mdir = path.join(store.dir, "media");
    if (!cfg.media) return { entries: [], note: "Media left out (BACKUP_MEDIA=0)." };
    if (!fs.existsSync(mdir)) return { entries: [], note: "" };
    const names = fs.readdirSync(mdir).filter((n) => /^[A-Za-z0-9._-]+$/.test(n) && Buffer.byteLength("media/" + n) <= 100 && fs.statSync(path.join(mdir, n)).isFile());
    const total = names.reduce((a, n) => a + fs.statSync(path.join(mdir, n)).size, 0);
    if (total > cfg.media_max) return { entries: [], note: `Media left out: ${Math.round(total / 1048576)} MB is over BACKUP_MEDIA_MAX_MB (${Math.round(cfg.media_max / 1048576)} MB). Copy the media folder another way.` };
    const entries = [];
    for (const n of names) entries.push({ name: "media/" + n, data: await fs.promises.readFile(path.join(mdir, n)) });
    return { entries, note: "" };
  }

  async function build({ kind = "manual", media = true, by = "system" } = {}) {
    const t = now();
    // Consistent snapshot: flush the CRM, then serialise both databases in the same tick.
    crm?.flush?.();
    const dbJson = Buffer.from(JSON.stringify(store.db)), crmJson = Buffer.from(JSON.stringify(crm ? crm.db : {}));
    const counts = { db: countsOf(store.db), crm: countsOf(crm?.db) };
    const m = media ? await mediaEntries() : { entries: [], note: "Media not included in this backup." };
    const entries = [{ name: "db.json", data: dbJson }, { name: "crm.json", data: crmJson }, ...m.entries];
    const manifest = { app: "marketing-wizard", format: 1, created_at: new Date(t).toISOString(), kind, by, encrypted: !!cfg.key, media_included: m.entries.length, media_note: m.note,
      files: entries.map((e) => ({ name: e.name, size: e.data.length, sha256: sha256(e.data) })), counts };
    const tgz = await gzip(tarPack([{ name: "manifest.json", data: Buffer.from(JSON.stringify(manifest, null, 2)) }, ...entries], t), { level: 6 });
    const body = cfg.key ? encrypt(tgz, cfg.key) : tgz;
    const stamp = new Date(t).toISOString().replace(/[-:.]/g, "");
    const name = `mwiz-backup-${stamp}-${kind}.tar.gz${cfg.key ? ".enc" : ""}`;
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, name);
    await fs.promises.writeFile(file + ".tmp", body);
    await fs.promises.rename(file + ".tmp", file);
    return { name, file, body, counts, media_files: m.entries.length, media_note: m.note, at: new Date(t).toISOString() };
  }

  async function offsite(name, body = null) {
    const e = entryFor(name);
    const file = pathOf(name);
    if (!e || !file) throw new Error("Backup not found");
    body ||= await fs.promises.readFile(file);
    const result = { ...(e.offsite || {}) };
    if (cfg.s3.ready || cfg.email.ready) {
      if (!cfg.key || !name.endsWith(".enc")) {
        const why = "Not sent off-site: set BACKUP_KEY so backups are encrypted first.";
        if (cfg.s3.ready) result.s3 = { ok: false, at: new Date(now()).toISOString(), error: why };
        if (cfg.email.ready) result.email = { ok: false, at: new Date(now()).toISOString(), error: why };
      } else {
        if (cfg.s3.ready) {
          try { const r = await uploadS3(cfg.s3, name, body, { fetchImpl }); result.s3 = { ok: true, at: new Date(now()).toISOString(), url: r.url }; }
          catch (err) { result.s3 = { ok: false, at: new Date(now()).toISOString(), error: String(err?.message || err).slice(0, 300) }; log.error?.("[backup] s3:", err?.message); }
        }
        if (cfg.email.ready) {
          if (body.length > cfg.email.max) result.email = { ok: false, at: new Date(now()).toISOString(), error: `Too big to email (${Math.round(body.length / 1048576)} MB, limit ${Math.round(cfg.email.max / 1048576)} MB). Use S3 storage.` };
          else {
            try { await sendMail({ to: cfg.email.to, subject: `Marketing Wizard backup ${e.at.slice(0, 10)} (${e.kind})`, text: `Encrypted backup attached (${name}, ${Math.round(body.length / 1024)} KB).\nOpen it with BACKUP_KEY and web/scripts/restore-backup.js. Keep this email private.`, attachments: [{ filename: name, content: body, contentType: "application/octet-stream" }] }); result.email = { ok: true, at: new Date(now()).toISOString(), to: cfg.email.to }; }
            catch (err) { result.email = { ok: false, at: new Date(now()).toISOString(), error: String(err?.message || err).slice(0, 300) }; log.error?.("[backup] email:", err?.message); }
          }
        }
      }
    }
    e.offsite = result; store.save();
    return result;
  }
  async function sendMail(msg) {
    if (mailer) return mailer(msg);
    const { default: nodemailer } = await import("nodemailer");
    const s = cfg.email.smtp;
    const t = nodemailer.createTransport({ host: s.host, port: s.port, secure: s.port === 465, auth: { user: s.user, pass: s.pass } });
    return t.sendMail({ from: s.from, ...msg });
  }

  // Create one backup (serialised: a second call waits for the first).
  async function create({ kind = "manual", media = true, by = "system", offsite: send = true } = {}) {
    if (running) await running.catch(() => {});
    const job = (async () => {
      const t0 = now();
      try {
        const b = await build({ kind, media, by });
        const e = record({ name: b.name, at: b.at, kind, by, ok: true, size: b.body.length, encrypted: !!cfg.key, counts: b.counts, media_files: b.media_files, media_note: b.media_note, ms: now() - t0, offsite: {} });
        const removed = prune();
        if (send) await offsite(b.name, b.body);
        return { ...e, pruned: removed };
      } catch (err) {
        log.error?.("[backup] failed:", err?.message || err);
        record({ name: null, at: new Date(t0).toISOString(), kind, by, ok: false, error: String(err?.message || err).slice(0, 300) });
        throw err;
      }
    })();
    running = job;
    try { return await job; } finally { if (running === job) running = null; }
  }

  async function verify(name) {
    const file = pathOf(name);
    if (!file) throw new Error("Backup not found");
    const { manifest, db: d, crm: c } = await openBackup(await fs.promises.readFile(file), cfg.key);
    const out = { ok: true, name, created_at: manifest.created_at, kind: manifest.kind, encrypted: name.endsWith(".enc"), counts: { db: countsOf(d), crm: countsOf(c) },
      media_files: manifest.media_included, files: manifest.files.length, checked_at: new Date(now()).toISOString() };
    const e = entryFor(name);
    if (e) { e.verified = { ok: true, at: out.checked_at }; store.save(); }
    return out;
  }

  function status() {
    const list = files();
    const runs = db.backup_log;
    const lastOk = [...runs].reverse().find((r) => r.ok && list.some((f) => f.name === r.name)) || null;
    const lastRun = runs.at(-1) || null;
    const fresh = !!lastOk && now() - Date.parse(lastOk.at) < FRESH_HOURS * 3600e3;
    return {
      fresh, fresh_hours: FRESH_HOURS, last_ok: lastOk ? { name: lastOk.name, at: lastOk.at, size: lastOk.size, kind: lastOk.kind, offsite: lastOk.offsite || {} } : null,
      last_run: lastRun ? { at: lastRun.at, ok: lastRun.ok, error: lastRun.error || "" } : null,
      count: list.length, total_size: list.reduce((a, f) => a + f.size, 0), keep: KEEP,
      encrypted: !!cfg.key, media: cfg.media,
      offsite: { s3: cfg.s3.ready ? { configured: true, endpoint: cfg.s3.endpoint, bucket: cfg.s3.bucket, region: cfg.s3.region } : { configured: false },
        email: cfg.email.ready ? { configured: true, to: cfg.email.to, max_mb: Math.round(cfg.email.max / 1048576) } : { configured: false } },
      schedule: "Every night at 02:00 Riyadh time (missed runs catch up on the next start).",
      running: !!running,
    };
  }

  // Scheduler: one check a minute. A nightly backup runs once per Riyadh day from 02:00; if the server
  // was asleep at 02:00 it runs at the next check. A scheduled run is "weekly" when the last weekly is 6+ days old.
  function scheduledKind(t = now()) {
    const lastWeekly = files().find((f) => f.kind === "weekly");
    return !lastWeekly || t - Date.parse(lastWeekly.at) >= 6 * 864e5 ? "weekly" : "nightly";
  }
  function due(t = now()) {
    const riyadhHour = new Date(t + 3 * 3600e3).getUTCHours();
    if (riyadhHour < 2) return false;
    const today = riyadhDate(t);
    return !db.backup_log.some((r) => ["nightly", "weekly"].includes(r.kind) && riyadhDate(Date.parse(r.at)) === today && (r.ok || t - Date.parse(r.at) < 3600e3));
  }
  async function tick(t = now()) {
    if (running || !due(t)) return null;
    return create({ kind: scheduledKind(t), media: cfg.media, by: "schedule" });
  }
  function start({ every = 60e3 } = {}) {
    stop();
    timer = setInterval(() => tick().catch(() => {}), every);
    timer.unref?.();
  }
  function stop() { clearInterval(timer); timer = null; }

  return { cfg, dir, files, create, verify, prune, offsite, status, tick, due, scheduledKind, start, stop, pathOf };
}
