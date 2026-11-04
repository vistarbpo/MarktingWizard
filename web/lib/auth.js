// Login security: sessions, two-step login (TOTP, RFC 6238), recovery codes, password reset links and the
// "require two-step login" policy. No dependencies beyond node:crypto. Routes are in authroutes.js; docs in
// docs/security-compliance.md section "Login security".
//
// Storage (db.json, never returned by /api/admin):
// - auth_sessions: one row per signed-in browser. The cookie carries a random session id; only its SHA-256 is stored.
// - auth_mfa: per person: the TOTP secret sealed with the token key (social.js seal(), TOKEN_KEY), the last used time
//   step (replay guard) and 10 recovery codes hashed with scrypt. Rotating TOKEN_KEY makes the secrets unreadable:
//   everyone with two-step login has to enrol again (an Owner/Admin resets it from Teams & roles).
// - auth_resets: password reset tokens, SHA-256 only, 30 minutes (admin links 24 hours), single use.
// - auth_policy: { require: "nobody" | "admins" | "all", shared_login_disabled }.
import crypto from "node:crypto";
import { checkPassword, hashPassword } from "./access.js";
import { seal, unseal } from "./social.js";

export const PW_MIN = 10; // the dashboard's existing rule (Teams & roles, My account): at least 10 characters
export function passwordProblem(pw) {
  const s = String(pw ?? "");
  if (s.length < PW_MIN) return `Use at least ${PW_MIN} characters.`;
  if (s.length > 200) return "Use at most 200 characters.";
  return "";
}

export const SESSION_DAYS = 30;
export const PENDING_CODE_MS = 5 * 60e3; // the second step must be done within 5 minutes
export const PENDING_ENROL_MS = 15 * 60e3; // forced enrolment: time to install an authenticator app
export const RESET_MS = 30 * 60e3; // emailed reset links
export const ADMIN_RESET_MS = 24 * 3600e3; // links an Owner/Admin creates and shares by hand
export const CODE_TRIES = 5; // wrong codes before a pending login is dropped
export const REQUIRE = [
  { id: "nobody", name: "Nobody (each person chooses)" },
  { id: "admins", name: "Owner and Admin (recommended)" },
  { id: "all", name: "Everyone with a personal login" },
];
export const REQUIRE_IDS = REQUIRE.map((r) => r.id);
export const ISSUER = "DPA AD";

const sha = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");
export const hashToken = sha;

// ---- base32 (RFC 4648, no padding), the format authenticator apps expect
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function base32Encode(buf) {
  let bits = 0, value = 0, out = "";
  for (const b of buf) { value = (value << 8) | b; bits += 8; while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
export function base32Decode(s) {
  const clean = String(s || "").toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0, value = 0; const out = [];
  for (const ch of clean) {
    const i = B32.indexOf(ch); if (i < 0) throw new Error("bad base32");
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

// ---- HOTP (RFC 4226) / TOTP (RFC 6238), HMAC-SHA1, 30-second steps
export function hotp(key, counter, digits = 6) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = crypto.createHmac("sha1", key).update(msg).digest();
  const off = mac[mac.length - 1] & 15;
  const bin = ((mac[off] & 127) << 24) | (mac[off + 1] << 16) | (mac[off + 2] << 8) | mac[off + 3];
  return String(bin % 10 ** digits).padStart(digits, "0");
}
export const timeStep = (ms, step = 30) => Math.floor(ms / 1000 / step);
export function totp(key, ms, { digits = 6, step = 30 } = {}) {
  return hotp(Buffer.isBuffer(key) ? key : base32Decode(key), timeStep(ms, step), digits);
}
// The matching time step (±1 step for clock drift) or null. A step at or before `lastStep` is refused (replay).
export function verifyTotp(secretB32, code, ms, lastStep = -1) {
  const c = String(code ?? "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(c)) return null;
  const key = base32Decode(secretB32), now = timeStep(ms);
  for (const s of [now - 1, now, now + 1]) {
    if (s <= lastStep) continue;
    const want = hotp(key, s);
    if (crypto.timingSafeEqual(Buffer.from(want), Buffer.from(c))) return s;
  }
  return null;
}
export const newSecret = () => base32Encode(crypto.randomBytes(20));
export const otpauthUri = (email, secret) => `otpauth://totp/${encodeURIComponent(ISSUER)}:${encodeURIComponent(email)}?secret=${secret}&issuer=${encodeURIComponent(ISSUER)}&algorithm=SHA1&digits=6&period=30`;

// ---- recovery codes: 10 × "xxxxx-xxxxx" (50 bits each), shown once, stored hashed (scrypt with a salt)
export const normRecovery = (s) => String(s || "").toLowerCase().replace(/[^a-z2-7]/g, "");
export function newRecoveryCodes(n = 10) {
  const codes = Array.from({ length: n }, () => { const c = base32Encode(crypto.randomBytes(7)).slice(0, 10).toLowerCase(); return `${c.slice(0, 5)}-${c.slice(5)}`; });
  return { codes, stored: codes.map((c) => ({ ...hashPassword(normRecovery(c)), used_at: null })) };
}

// Does the policy make this person use two-step login? The shared team password ("owner") can't.
export function twoStepRequired(policy, user) {
  if (!user || user.id === "owner") return false;
  const p = policy?.require || "nobody";
  return p === "all" || (p === "admins" && ["owner", "admin"].includes(user.role_id));
}

export const maskEmail = (e) => String(e || "").replace(/^(.).*?(@|$)/, "$1•••$2");

// Bilingual transactional email (no unsubscribe link: it is sent only because the person asked for it).
export function resetEmail({ link, minutes = 30, name = "" }) {
  const subject = "Reset your DPA AD dashboard password · إعادة تعيين كلمة المرور";
  const text = `${name ? `هلا ${name}،\n\n` : ""}وصلنا طلب لإعادة تعيين كلمة مرور لوحة DPA AD.\nافتح الرابط خلال ${minutes} دقيقة واختر كلمة مرور جديدة (يشتغل مرة وحدة):\n${link}\n\nإذا ما طلبته أنت، تجاهل الرسالة وكلمة مرورك تبقى نفسها.\n\n—\n\n${name ? `Hi ${name},\n\n` : ""}Someone asked to reset the password of your DPA AD dashboard login.\nOpen this link within ${minutes} minutes to choose a new password (it works once):\n${link}\n\nIf it wasn't you, ignore this email: your password stays the same.`;
  const e = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const html = `<div style="font-family:Tahoma,Arial,sans-serif;font-size:15px;line-height:1.7;color:#111">
<div dir="rtl"><p>${name ? `هلا ${e(name)}،<br>` : ""}وصلنا طلب لإعادة تعيين كلمة مرور لوحة DPA AD. افتح الرابط خلال ${minutes} دقيقة (يشتغل مرة وحدة).</p><p><a href="${e(link)}">إعادة تعيين كلمة المرور</a></p><p style="color:#666">إذا ما طلبته أنت، تجاهل الرسالة.</p></div>
<hr style="border:0;border-top:1px solid #ddd">
<div dir="ltr"><p>${name ? `Hi ${e(name)},<br>` : ""}Someone asked to reset the password of your DPA AD dashboard login. Open the link within ${minutes} minutes (it works once).</p><p><a href="${e(link)}">Reset my password</a></p><p style="color:#666">If it wasn't you, ignore this email: your password stays the same.</p></div></div>`;
  return { subject, text, html, headers: {} };
}

// ---- the engine (app.locals.auth)
export function createAuth({ store, password, key, userById, senders = null, mailReady = () => false, publicUrl = "https://wizard.dpa.ad", clock = () => Date.now(), log = console }) {
  for (const k of ["auth_sessions", "auth_mfa", "auth_resets"]) store.db[k] ||= [];
  store.db.auth_policy ||= { require: "nobody", shared_login_disabled: false };
  const db = store.db;
  const auth = { clock, sends: [] };
  const now = () => auth.clock();
  const iso = (ms = now()) => new Date(ms).toISOString();

  // Session cookies are signed with a key derived from the password, so changing it logs everyone out.
  const secret = crypto.createHash("sha256").update("mwiz:" + password).digest();
  const sign = (v) => v + "." + crypto.createHmac("sha256", secret).update(v).digest("base64url");
  auth.sign = sign;
  const cookieValue = (req, name) => new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).exec(req.headers.cookie || "")?.[1] || null;

  // ---- policy
  auth.policy = () => ({ require: "nobody", shared_login_disabled: false, ...(db.auth_policy || {}) });
  auth.sharedLoginEnabled = () => !!password && !auth.policy().shared_login_disabled;

  // ---- sessions. Cookie value "<userId>~<expiry>~<sessionId>" (signed); only sha256(sessionId) is stored.
  // Cookies from before sessions were tracked (no session id) are no longer accepted: everyone signs in once more.
  auth.sessionOf = (req) => {
    const m = cookieValue(req, "mwiz");
    if (!m || !password) return null;
    const value = m.slice(0, m.lastIndexOf("."));
    const expected = sign(value);
    if (expected.length !== m.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(m))) return null;
    const [uid, exp, sid] = value.split("~");
    if (!sid || !(Number(exp) > now())) return null;
    const h = sha(sid), s = db.auth_sessions.find((x) => x.id === h);
    if (!s || s.user_id !== uid || Date.parse(s.expires_at) <= now()) return null;
    if (uid === "owner" && !auth.sharedLoginEnabled()) return null;
    const user = userById(uid);
    if (!user) return null;
    if (!s.last_seen_at || now() - Date.parse(s.last_seen_at) > 10 * 60e3) s.last_seen_at = iso(); // saved with the next write
    return { user, session: s };
  };
  auth.sessionUser = (req) => auth.sessionOf(req)?.user || null;
  auth.issueSession = (res, uid, req, how = "password") => {
    const sid = crypto.randomBytes(24).toString("base64url"), expires = now() + SESSION_DAYS * 864e5;
    db.auth_sessions = db.auth_sessions.filter((s) => Date.parse(s.expires_at) > now());
    db.auth_sessions.push({ id: sha(sid), user_id: uid, created_at: iso(), expires_at: iso(expires), last_seen_at: iso(), how, browser: uaFamily(req?.headers?.["user-agent"]) });
    if (uid !== "owner") { const u = db.users.find((x) => x.id === uid); if (u) u.last_login_at = iso(); }
    store.save();
    res.append("Set-Cookie", `mwiz=${sign(`${uid}~${expires}~${sid}`)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`);
  };
  auth.endSession = (req) => {
    const cur = auth.sessionOf(req)?.session;
    if (cur) { db.auth_sessions = db.auth_sessions.filter((s) => s !== cur); store.save(); }
  };
  // End every session of a person, optionally keeping one (the browser that made the change).
  auth.endSessions = (uid, keep = null) => {
    const before = db.auth_sessions.length;
    db.auth_sessions = db.auth_sessions.filter((s) => s.user_id !== uid || s === keep);
    store.save();
    return before - db.auth_sessions.length;
  };
  auth.activeSessions = () => db.auth_sessions.filter((s) => Date.parse(s.expires_at) > now());
  auth.sessionCount = (uid) => auth.activeSessions().filter((s) => s.user_id === uid).length;

  // ---- two-step login records
  const mfaOf = (uid) => db.auth_mfa.find((m) => m.user_id === uid) || null;
  auth.mfaOn = (uid) => !!mfaOf(uid)?.on;
  auth.needsEnrol = (user) => twoStepRequired(auth.policy(), user) && !auth.mfaOn(user.id);
  auth.recoveryLeft = (uid) => (mfaOf(uid)?.recovery || []).filter((r) => !r.used_at).length;
  auth.mfaInfo = (uid) => { const m = mfaOf(uid); return { on: !!m?.on, enrolled_at: m?.on ? m.enrolled_at : null, recovery_left: m?.on ? auth.recoveryLeft(uid) : 0 }; };

  // Start (or restart) enrolment: a new secret waits until a code from it is confirmed.
  auth.startEnrol = (user) => {
    let m = mfaOf(user.id);
    if (!m) { m = { user_id: user.id, on: false, secret: null, last_step: -1, recovery: [], enrolled_at: null }; db.auth_mfa.push(m); }
    const pending = m.pending && Date.parse(m.pending_at) > now() - PENDING_ENROL_MS ? unseal(m.pending, key) : null;
    const s = pending?.s || newSecret();
    if (!pending) { m.pending = seal({ s }, key); m.pending_at = iso(); store.save(); }
    return { secret: s, uri: otpauthUri(user.email, s) };
  };
  // Confirm enrolment with a code from the new secret. Returns the recovery codes (shown once) or null.
  auth.confirmEnrol = (user, code) => {
    const m = mfaOf(user.id);
    const p = m?.pending && Date.parse(m.pending_at) > now() - PENDING_ENROL_MS ? unseal(m.pending, key) : null;
    if (!p) return { error: "Start again: the setup expired." };
    const step = verifyTotp(p.s, code, now());
    if (step === null) return { error: "That code doesn't match. Check the time on your phone and try the newest code." };
    const rc = newRecoveryCodes();
    Object.assign(m, { on: true, secret: seal({ s: p.s }, key), last_step: step, recovery: rc.stored, enrolled_at: iso(), pending: null, pending_at: null });
    store.save();
    return { codes: rc.codes };
  };
  // A current code or an unused recovery code. Returns "totp" | "recovery" | null; a code is used once.
  auth.checkSecond = (uid, { code = "", recovery = "" } = {}) => {
    const m = mfaOf(uid);
    if (!m?.on) return null;
    if (String(code).trim()) {
      const s = unseal(m.secret, key)?.s;
      if (!s) return null; // TOKEN_KEY changed: the secret can't be read; recovery codes still work
      const step = verifyTotp(s, code, now(), m.last_step ?? -1);
      if (step === null) return null;
      m.last_step = step; store.save();
      return "totp";
    }
    const r = normRecovery(recovery);
    if (r.length !== 10) return null;
    const hit = (m.recovery || []).find((x) => !x.used_at && checkPassword(r, x));
    if (!hit) return null;
    hit.used_at = iso(); store.save();
    return "recovery";
  };
  auth.disable = (uid) => { db.auth_mfa = db.auth_mfa.filter((m) => m.user_id !== uid); store.save(); };
  auth.newRecovery = (uid) => { const m = mfaOf(uid); if (!m?.on) return null; const rc = newRecoveryCodes(); m.recovery = rc.stored; store.save(); return rc.codes; };

  // ---- pending logins (memory only: a restart means signing in again)
  const pending = new Map();
  const prune = () => { for (const [k, p] of pending) if (p.exp <= now()) pending.delete(k); };
  auth.startPending = (res, uid, kind) => {
    prune();
    const id = crypto.randomBytes(24).toString("base64url"), ms = kind === "enrol" ? PENDING_ENROL_MS : PENDING_CODE_MS;
    pending.set(sha(id), { uid, kind, exp: now() + ms, tries: 0 });
    res.append("Set-Cookie", `mwiz_pending=${id}; Path=/login; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.round(ms / 1000)}`);
  };
  auth.pendingOf = (req) => {
    const id = cookieValue(req, "mwiz_pending"); if (!id) return null;
    const k = sha(id), p = pending.get(k);
    if (!p) return null;
    if (p.exp <= now()) { pending.delete(k); return { expired: true }; }
    return { ...p, key: k, ref: p };
  };
  auth.dropPending = (p, res) => { if (p?.key) pending.delete(p.key); res?.append("Set-Cookie", "mwiz_pending=; Path=/login; HttpOnly; Secure; SameSite=Lax; Max-Age=0"); };
  auth.pendingCount = () => { prune(); return pending.size; };

  // Wrong second-step codes per person (across pending logins): 10 in 15 minutes pauses the code step.
  const codeFails = new Map();
  auth.codeLocked = (uid) => { const f = codeFails.get(uid); return !!f && now() - f.t < 15 * 60e3 && f.n >= 10; };
  auth.codeFailed = (uid) => { const f = codeFails.get(uid); if (!f || now() - f.t >= 15 * 60e3) codeFails.set(uid, { n: 1, t: now() }); else f.n++; };
  auth.codeOk = (uid) => codeFails.delete(uid);

  // ---- rate limits (sliding windows in memory)
  const hits = new Map();
  auth.limited = (bucket, max, windowMs) => {
    const t = now(), list = (hits.get(bucket) || []).filter((x) => t - x < windowMs);
    if (list.length >= max) { hits.set(bucket, list); return true; }
    list.push(t); hits.set(bucket, list);
    return false;
  };

  // ---- password reset tokens
  // A new token invalidates the person's older ones; a password change invalidates all of them.
  auth.newResetToken = (uid, by = "self") => {
    const token = crypto.randomBytes(32).toString("base64url");
    for (const r of db.auth_resets) if (r.user_id === uid && !r.used_at && !r.invalid_at) r.invalid_at = iso();
    const ms = by === "self" ? RESET_MS : ADMIN_RESET_MS;
    db.auth_resets = db.auth_resets.filter((r) => Date.parse(r.expires_at) > now() - 7 * 864e5); // keep a week of history
    db.auth_resets.push({ id: store.newId(), user_id: uid, hash: sha(token), by, created_at: iso(), expires_at: iso(now() + ms), used_at: null, invalid_at: null });
    store.save();
    return { token, link: `${publicUrl}/reset/${token}`, expires_at: iso(now() + ms) };
  };
  auth.resetOf = (token) => {
    const t = String(token || "");
    if (!/^[A-Za-z0-9_-]{43}$/.test(t)) return null;
    const r = db.auth_resets.find((x) => x.hash === sha(t));
    if (!r || r.used_at || r.invalid_at || Date.parse(r.expires_at) <= now()) return null;
    const u = db.users.find((x) => x.id === r.user_id && x.active);
    return u ? { reset: r, user: u } : null;
  };
  auth.invalidateResets = (uid) => { for (const r of db.auth_resets) if (r.user_id === uid && !r.used_at && !r.invalid_at) r.invalid_at = iso(); };
  // Set a new password: every reset link stops working and every session of that person ends (except `keep`).
  auth.setPassword = (u, pw, keep = null) => {
    Object.assign(u, hashPassword(pw));
    auth.invalidateResets(u.id);
    return auth.endSessions(u.id, keep);
  };
  auth.mailReady = () => !!mailReady();
  auth.sendReset = (u, link) => {
    const p = Promise.resolve().then(() => senders.email({ to: u.email, ...resetEmail({ link, name: u.name }) }))
      .catch((e) => log.warn?.("password reset email failed:", e?.message || e));
    auth.sends.push(p);
    return p;
  };
  auth.flush = () => Promise.all(auth.sends.splice(0));
  return auth;
}

export function uaFamily(ua) {
  const s = String(ua || "");
  return /Edg\//.test(s) ? "Edge" : /Chrome\//.test(s) ? "Chrome" : /Firefox\//.test(s) ? "Firefox" : /Safari\//.test(s) ? "Safari" : s ? "Other" : "";
}
