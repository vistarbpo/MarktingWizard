// Login security routes. Public (before the login wall): POST /login, /logout, the second step /login/code,
// forced enrolment /login/enrol, "Forgot password?" /forgot and the reset page /reset/<token>. These pages are
// self-contained like the public pages (publicsite.js): no scripts, one nonce'd style block, no-store, no referrer.
// Private (after the wall): /api/me/security, /api/me/2fa/*, /api/admin/security and the per-person actions in
// Teams & roles. None of them can be called by Ask DPA AD (requests it makes carry x-mwiz-via: assistant).
import crypto from "node:crypto";
import { checkPassword } from "./access.js";
import { REQUIRE, REQUIRE_IDS, CODE_TRIES, maskEmail, passwordProblem, twoStepRequired } from "./auth.js";
import { h, newNonce } from "./publicsite.js";
import { qrSvg } from "./qr.js";

const CSS = `*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:16px;font:15px/1.6 Inter,system-ui,-apple-system,"Segoe UI",Tahoma,"Noto Sans Arabic",sans-serif;background:var(--bg);color:var(--text)}
:root{color-scheme:light dark;--bg:#f7f7f5;--card:#fff;--text:#171716;--muted:#5c5c57;--border:#e4e4df;--p:#1f5eff;--bad:#c0362c;--good:#1a7f4b;--soft:#f2f2ef}
@media(prefers-color-scheme:dark){:root{--bg:#0e0f11;--card:#16171a;--text:#ececea;--muted:#a3a39c;--border:#2a2c31;--p:#5b8cff;--bad:#ff6b5e;--good:#4cc38a;--soft:#1d1f23}}
main{width:100%;max-width:420px}.brand{display:flex;align-items:center;gap:8px;font-weight:600;margin-bottom:20px}.brand i{width:20px;height:20px;border-radius:6px;background:var(--p);display:inline-block}
.card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:24px;display:grid;gap:14px;min-width:0;overflow-wrap:anywhere}
h1{font-size:20px;margin:0;line-height:1.3}p{margin:0}.muted{color:var(--muted);font-size:14px}.ar{direction:rtl;text-align:right;font-family:Tahoma,"Noto Sans Arabic",system-ui,sans-serif}
label{display:block;font-weight:500;font-size:14px;margin-bottom:4px}input{width:100%;font:inherit;padding:9px 12px;border:1px solid var(--border);border-radius:8px;background:var(--bg);color:var(--text)}
input:focus-visible,a:focus-visible,button:focus-visible{outline:3px solid var(--p);outline-offset:2px}input.code{font-size:22px;letter-spacing:.3em;text-align:center;font-family:ui-monospace,Menlo,monospace}
button{font:inherit;font-weight:600;height:42px;border-radius:8px;border:1px solid var(--p);background:var(--p);color:#fff;cursor:pointer;width:100%}a{color:var(--p)}
.err{color:var(--bad);font-weight:500;font-size:14px}.ok{color:var(--good);font-weight:500;font-size:14px}.qr{display:flex;justify-content:center}.qr svg{max-width:100%;height:auto;border-radius:8px}
code,.mono{font-family:ui-monospace,Menlo,monospace;font-size:14px;background:var(--soft);padding:2px 6px;border-radius:6px;word-break:break-all}
ol.codes{margin:0;padding:12px 12px 12px 36px;background:var(--soft);border-radius:8px;columns:2;font-family:ui-monospace,Menlo,monospace;font-size:15px}.links{display:flex;flex-wrap:wrap;gap:6px 16px;font-size:14px}.f{display:grid;gap:14px}`;

function page(res, { title, body, status = 200 }) {
  const nonce = newNonce();
  res.status(status).set({
    "Content-Type": "text/html; charset=utf-8", "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer", "Cache-Control": "no-store",
    "Content-Security-Policy": `default-src 'none'; style-src 'nonce-${nonce}'; img-src 'self' data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`,
  }).send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${h(title)} · DPA AD</title><style nonce="${nonce}">${CSS}</style></head><body><main><div class="brand"><i aria-hidden="true"></i><span>DPA AD · Marketing Wizard</span></div>
<div class="card">${body}</div></main></body></html>`);
}
const both = (en, ar) => `<p>${en}</p><p class="ar" lang="ar" dir="rtl">${ar}</p>`;
const SHARED_NOTE = both(`<span class="muted">The shared team password (sign-in with no email) can't be reset here: it is <code>DASHBOARD_PASSWORD</code> in hPanel.</span>`, `<span class="muted">كلمة مرور الفريق المشتركة (الدخول بدون إيميل) ما تنعاد من هنا: تتغيّر من hPanel.</span>`);

export function mountAuthPublic(app, { store, auth, password, userById }) {
  const iso = () => new Date(auth.clock()).toISOString();
  const audit = (u, path, summary) => store.logAudit({ user_id: u?.id || "", user_name: u?.name || "Someone", method: "POST", path, module: "admin", summary });

  // ---- the brute-force brake: 10 failed attempts per IP in 15 minutes (passwords and second-step codes together)
  const attempts = new Map();
  const slot = (ip) => { let a = attempts.get(ip); if (!a || auth.clock() - a.t > 15 * 60e3) { a = { n: 0, t: auth.clock() }; attempts.set(ip, a); } return a; };
  const locked = (ip) => slot(ip).n >= 10;
  const failed = (ip) => { slot(ip).n++; };
  app.locals.loginAttempts = attempts;

  const finish = (req, res, uid, how) => { attempts.delete(req.ip); auth.issueSession(res, uid, req, how); };

  app.post("/login", (req, res) => {
    const ip = req.ip;
    if (locked(ip)) return res.redirect("/login?e=locked");
    const given = String(req.body.password || "");
    const email = String(req.body.email || "").trim().toLowerCase();
    if (!email && password && !auth.sharedLoginEnabled()) return res.redirect("/login?e=shared_off");
    let u = null, uid = null;
    if (email) {
      u = store.db.users.find((x) => x.email === email && x.active);
      if (password && u && checkPassword(given, u)) uid = u.id;
    } else if (password && given.length === password.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(password))) uid = "owner";
    if (!uid) { failed(ip); return res.redirect("/login?e=" + (password ? "bad" : "unset")); }
    if (uid !== "owner") {
      if (auth.mfaOn(uid)) {
        if (auth.codeLocked(uid)) return res.redirect("/login?e=code_locked");
        auth.startPending(res, uid, "code");
        return res.redirect("/login/code");
      }
      if (auth.needsEnrol(u)) { auth.startPending(res, uid, "enrol"); return res.redirect("/login/enrol"); }
    }
    finish(req, res, uid, "password");
    res.redirect("/");
  });
  app.post("/logout", (req, res) => {
    auth.endSession(req);
    res.setHeader("Set-Cookie", "mwiz=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0");
    res.redirect("/login");
  });

  // ---- second step
  const codeForm = (req, err = "") => {
    const rec = req.query.recovery === "1" || req.body?.mode === "recovery";
    const msg = err || { bad: "That code doesn't match. Try the newest code.", badrec: "That recovery code doesn't match or was already used." }[req.query.e] || "";
    return `<h1>Two-step sign-in</h1>${both(rec ? "Type one of your recovery codes. Each code works once." : "Open your authenticator app and type the 6-digit code for DPA AD.", rec ? "اكتب واحد من رموز الاسترداد. كل رمز يشتغل مرة وحدة." : "افتح تطبيق المصادقة واكتب الرمز المكوّن من 6 أرقام.")}
${msg ? `<p class="err" role="alert">${h(msg)}</p>` : ""}
<form method="post" action="/login/code" class="f">${rec
      ? `<input type="hidden" name="mode" value="recovery"><div><label for="recovery">Recovery code · رمز الاسترداد</label><input id="recovery" name="recovery" autocomplete="off" autocapitalize="off" spellcheck="false" required autofocus placeholder="xxxxx-xxxxx"></div>`
      : `<div><label for="code">Code · الرمز</label><input class="code" id="code" name="code" inputmode="numeric" pattern="[0-9 ]{6,7}" maxlength="7" autocomplete="one-time-code" required autofocus></div>`}
<button type="submit">Continue · متابعة</button></form>
<div class="links">${rec ? `<a href="/login/code">Use the authenticator app instead · استخدم التطبيق</a>` : `<a href="/login/code?recovery=1">Lost your phone? Use a recovery code · استخدم رمز استرداد</a>`}<a href="/login">Start again · من البداية</a></div>
<p class="muted">This step expires 5 minutes after your password. · تنتهي هذه الخطوة بعد 5 دقائق.</p>`;
  };
  const pendingFor = (req, kind) => { const p = auth.pendingOf(req); return p && !p.expired && p.kind === kind ? p : p?.expired ? "expired" : null; };
  app.get("/login/code", (req, res) => {
    const p = pendingFor(req, "code");
    if (!p || p === "expired") return res.redirect(p ? "/login?e=expired" : "/login");
    page(res, { title: "Two-step sign-in", body: codeForm(req) });
  });
  app.post("/login/code", (req, res) => {
    const p = pendingFor(req, "code");
    if (!p || p === "expired") { auth.dropPending(null, res); return res.redirect(p ? "/login?e=expired" : "/login"); }
    if (locked(req.ip)) { auth.dropPending(p, res); return res.redirect("/login?e=locked"); }
    if (auth.codeLocked(p.uid)) { auth.dropPending(p, res); return res.redirect("/login?e=code_locked"); }
    const rec = req.body?.mode === "recovery";
    const how = auth.checkSecond(p.uid, rec ? { recovery: req.body?.recovery } : { code: req.body?.code });
    const u = userById(p.uid);
    if (how && u) {
      auth.dropPending(p, res); auth.codeOk(p.uid);
      finish(req, res, p.uid, how === "recovery" ? "recovery code" : "two-step");
      if (how === "recovery") audit(u, "/login/code", `signed in with a recovery code (${auth.recoveryLeft(u.id)} left)`);
      return res.redirect("/");
    }
    p.ref.tries++; failed(req.ip); auth.codeFailed(p.uid);
    if (p.ref.tries >= CODE_TRIES) {
      auth.dropPending(p, res);
      audit(u, "/login/code", `sign-in stopped after ${CODE_TRIES} wrong two-step codes`);
      return res.redirect("/login?e=code_dropped");
    }
    res.redirect(rec ? "/login/code?recovery=1&e=badrec" : "/login/code?e=bad");
  });

  // ---- enrolment page: forced by the policy after the password (pending), or a signed-in person who must enrol
  const enrolWho = (req) => {
    const p = pendingFor(req, "enrol");
    if (p && p !== "expired") { const u = userById(p.uid); return u ? { user: u, pending: p } : null; }
    const u = auth.sessionUser(req);
    return u && auth.needsEnrol(u) ? { user: u, pending: null } : null;
  };
  const enrolBody = (user, err = "") => {
    const { secret, uri } = auth.startEnrol(user);
    return `<h1>Set up two-step sign-in</h1>${both("Your role must use two-step sign-in. Scan this QR code with an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…), then type the 6-digit code it shows.", "دورك يتطلب الدخول بخطوتين. امسح الرمز بتطبيق مصادقة ثم اكتب الرمز المكوّن من 6 أرقام.")}
<div class="qr">${qrSvg(uri, { px: 200, label: "QR code for the authenticator app" })}</div>
<p class="muted">Can't scan? Enter this key by hand · أو أدخل المفتاح يدويًا: <span class="mono">${h(secret.replace(/(.{4})/g, "$1 ").trim())}</span></p>
${err ? `<p class="err" role="alert">${h(err)}</p>` : ""}
<form method="post" action="/login/enrol" class="f"><div><label for="code">Code from the app · الرمز</label><input class="code" id="code" name="code" inputmode="numeric" maxlength="7" autocomplete="one-time-code" required autofocus></div><button type="submit">Turn on and continue · تفعيل</button></form>
<div class="links"><a href="/login">Sign in again later · لاحقًا</a></div>`;
  };
  app.get("/login/enrol", (req, res) => {
    const who = enrolWho(req);
    if (!who) return res.redirect(auth.pendingOf(req)?.expired ? "/login?e=expired" : "/login");
    page(res, { title: "Set up two-step sign-in", body: enrolBody(who.user) });
  });
  app.post("/login/enrol", (req, res) => {
    const who = enrolWho(req);
    if (!who) return res.redirect("/login?e=expired");
    if (auth.limited("enrol:" + who.user.id, 20, 15 * 60e3)) return page(res, { status: 429, title: "Too many tries", body: `<h1>Too many tries</h1>${both("Wait 15 minutes and sign in again.", "انتظر 15 دقيقة وحاول مرة ثانية.")}` });
    const r = auth.confirmEnrol(who.user, req.body?.code);
    if (r.error) {
      if (who.pending) { who.pending.ref.tries++; if (who.pending.ref.tries >= CODE_TRIES) { auth.dropPending(who.pending, res); return res.redirect("/login?e=code_dropped"); } }
      return page(res, { status: 422, title: "Set up two-step sign-in", body: enrolBody(who.user, r.error) });
    }
    if (who.pending) { auth.dropPending(who.pending, res); finish(req, res, who.user.id, "two-step"); }
    audit(who.user, "/login/enrol", "turned on two-step login");
    page(res, { title: "Recovery codes", body: recoveryBody(r.codes, "/") });
  });

  // ---- forgot password: always the same answer, whether or not the email has a login
  const NEUTRAL = both("If that email has a login, we've sent a link to reset the password. It works once, for 30 minutes. Check your spam folder too.", "إذا كان الإيميل له حساب، أرسلنا رابط لإعادة تعيين كلمة المرور. يشتغل مرة وحدة لمدة 30 دقيقة. شيّك على مجلد الرسائل غير المرغوبة.");
  const forgotForm = (err = "") => `<h1>Forgot your password?</h1>${both("Type the email you sign in with. We'll email you a link to choose a new password.", "اكتب الإيميل اللي تدخل فيه، ونرسل لك رابط لاختيار كلمة مرور جديدة.")}
${err ? `<p class="err" role="alert">${h(err)}</p>` : ""}
<form method="post" action="/forgot" class="f"><div><label for="email">Email · البريد الإلكتروني</label><input id="email" name="email" type="email" autocomplete="username" required autofocus placeholder="you@dpa.ad"></div><button type="submit">Send the link · أرسل الرابط</button></form>
${SHARED_NOTE}${both(`<span class="muted">No email arriving? An Owner or Admin can create a reset link for you in Teams &amp; roles.</span>`, `<span class="muted">ما وصلك شي؟ المالك أو المشرف يقدر يسوي لك رابط من صفحة الفرق والأدوار.</span>`)}
<div class="links"><a href="/login">Back to sign in · رجوع</a></div>`;
  app.get("/forgot", (req, res) => page(res, { title: "Forgot password", body: forgotForm() }));
  app.post("/forgot", (req, res) => {
    const email = String(req.body?.email || "").trim().toLowerCase().slice(0, 200);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return page(res, { status: 422, title: "Forgot password", body: forgotForm("Type a valid email.") });
    const tooMany = () => page(res, { status: 429, title: "Too many requests", body: `<h1>Too many requests</h1>${both("Too many reset requests. Try again in an hour.", "طلبات كثيرة. حاول بعد ساعة.")}<div class="links"><a href="/login">Back to sign in · رجوع</a></div>` });
    if (auth.limited("forgot-ip:" + req.ip, 20, 3600e3)) return tooMany();
    if (auth.limited("forgot-email:" + crypto.createHash("sha256").update(email).digest("hex"), 5, 3600e3)) return tooMany();
    // Answer first; the work happens after, so a known and an unknown email take the same time.
    page(res, { title: "Check your email", body: `<h1>Check your email</h1>${NEUTRAL}${SHARED_NOTE}<div class="links"><a href="/login">Back to sign in · رجوع</a></div>` });
    auth.sends.push(Promise.resolve().then(() => {
      const u = store.db.users.find((x) => x.email === email && x.active);
      if (!u) return audit(null, "/forgot", `password reset requested for an email with no login (${maskEmail(email)})`);
      if (!auth.mailReady()) return audit(u, "/forgot", "password reset requested: no email sent (SMTP is not set up). An Owner or Admin can create a reset link in Teams & roles");
      const t = auth.newResetToken(u.id, "self");
      audit(u, "/forgot", "password reset requested: link emailed (30 minutes, single use)");
      return auth.sendReset(u, t.link);
    }));
  });

  // ---- reset page
  const resetForm = (u, err = "") => `<h1>Choose a new password</h1>${both(`For <b>${h(u.email)}</b>. Use at least 10 characters. Signing in again is needed on every device.`, `للحساب ${h(u.email)}. استخدم 10 أحرف على الأقل. بعدها تحتاج تدخل من جديد على كل الأجهزة.`)}
${err ? `<p class="err" role="alert">${h(err)}</p>` : ""}
<form method="post" class="f"><input type="text" name="username" value="${h(u.email)}" autocomplete="username" hidden>
<div><label for="pw">New password · كلمة المرور الجديدة</label><input id="pw" name="password" type="password" autocomplete="new-password" minlength="10" required autofocus></div>
<div><label for="pw2">Type it again · أعد كتابتها</label><input id="pw2" name="confirm" type="password" autocomplete="new-password" minlength="10" required></div>
<button type="submit">Save the new password · حفظ</button></form>${SHARED_NOTE}`;
  const deadLink = (res) => page(res, { status: 410, title: "Link not valid", body: `<h1>This link doesn't work any more</h1>${both("Reset links work once and expire (30 minutes for emailed links). A newer link or a password change also stops older links.", "روابط إعادة التعيين تشتغل مرة وحدة وتنتهي. رابط أحدث أو تغيير كلمة المرور يوقف الروابط القديمة.")}<div class="links"><a href="/forgot">Ask for a new link · اطلب رابط جديد</a><a href="/login">Sign in · الدخول</a></div>` });
  app.get("/reset/:token", (req, res) => {
    const r = auth.resetOf(req.params.token);
    if (!r) return deadLink(res);
    page(res, { title: "New password", body: resetForm(r.user) });
  });
  app.post("/reset/:token", (req, res) => {
    if (auth.limited("reset-ip:" + req.ip, 10, 15 * 60e3)) return page(res, { status: 429, title: "Too many tries", body: `<h1>Too many tries</h1>${both("Wait 15 minutes and try again.", "انتظر 15 دقيقة وحاول مرة ثانية.")}` });
    const r = auth.resetOf(req.params.token);
    if (!r) return deadLink(res);
    const pw = String(req.body?.password || ""), problem = passwordProblem(pw);
    if (problem) return page(res, { status: 422, title: "New password", body: resetForm(r.user, problem) });
    if (pw !== String(req.body?.confirm || "")) return page(res, { status: 422, title: "New password", body: resetForm(r.user, "The two passwords are different.") });
    r.reset.used_at = iso();
    const ended = auth.setPassword(r.user, pw);
    store.save();
    audit(r.user, "/reset", `password reset with a ${r.reset.by === "self" ? "link emailed to them" : "link created by " + r.reset.by}; ${ended} session${ended === 1 ? "" : "s"} ended`);
    page(res, { title: "Password changed", body: `<h1>Password changed</h1>${both("Your new password is saved and you're signed out everywhere. Sign in with it now.", "تم حفظ كلمة المرور الجديدة وتم تسجيل خروجك من كل الأجهزة. ادخل الحين.")}<div class="links"><a href="/login">Sign in · الدخول</a></div>` });
  });
}

export function recoveryBody(codes, next) {
  return `<h1>Save your recovery codes</h1>${both("Two-step sign-in is on. If you lose your phone, each of these codes signs you in once. Store them in a password manager: they won't be shown again.", "تم تفعيل الدخول بخطوتين. إذا ضاع جوالك، كل رمز من هذه الرموز يدخلك مرة وحدة. احفظها في مدير كلمات المرور: ما راح تظهر مرة ثانية.")}
<ol class="codes">${codes.map((c) => `<li>${h(c)}</li>`).join("")}</ol><div class="links"><a href="${h(next)}">I've saved them: continue · متابعة</a></div>`;
}

// ---- private routes (after the login wall)
export function mountAuth(app, { store, auth }) {
  const isOwner = (req) => req.user.role_id === "owner";
  const personal = (req) => (req.user.id === "owner" ? null : store.db.users.find((x) => x.id === req.user.id) || null);
  const log = (req, summary, path) => store.logAudit({ user_id: req.user.id, user_name: req.user.name, method: req.method, path, module: "admin", summary });
  // Security actions are done by the person themself, never through Ask DPA AD.
  const SECURE = ["/api/me/password", "/api/me/2fa", "/api/admin/security", "/api/admin/users/"];
  app.use((req, res, next) => {
    if (req.headers["x-mwiz-via"] === "assistant" && SECURE.some((p) => req.path.startsWith(p)) && (!req.path.startsWith("/api/admin/users/") || /\/(2fa-reset|reset-link|sign-out)$/.test(req.path)))
      return res.status(403).json({ detail: "Security actions can't be done through Ask DPA AD. Use My account or Teams & roles yourself." });
    next();
  });

  app.get("/api/me/security", (req, res) => res.json({ shared_login: req.user.id === "owner", two_step: auth.mfaInfo(req.user.id), required: twoStepRequired(auth.policy(), req.user), sessions: auth.sessionCount(req.user.id) }));
  const refuseShared = (req, res) => { if (req.user.id !== "owner") return false; res.status(422).json({ detail: "The shared team password can't use two-step login. Create your own Owner login in Teams & roles." }); return true; };
  const slow = (req, res) => { if (!auth.limited("me2fa:" + req.user.id, 10, 15 * 60e3)) return false; res.status(429).json({ detail: "Too many tries. Wait 15 minutes." }); return true; };
  const secondOk = (req) => auth.checkSecond(req.user.id, { code: req.body?.code, recovery: req.body?.recovery });

  app.post("/api/me/2fa/start", (req, res) => {
    if (refuseShared(req, res)) return;
    if (auth.mfaOn(req.user.id)) return res.status(409).json({ detail: "Two-step login is already on. To move it to a new phone, turn it off and set it up again." });
    const { secret, uri } = auth.startEnrol(req.user);
    res.json({ secret, uri, qr_svg: qrSvg(uri, { px: 200, label: "QR code for the authenticator app" }) });
  });
  app.post("/api/me/2fa/confirm", (req, res) => {
    if (refuseShared(req, res) || slow(req, res)) return;
    if (auth.mfaOn(req.user.id)) return res.status(409).json({ detail: "Two-step login is already on." });
    const r = auth.confirmEnrol(req.user, req.body?.code);
    if (r.error) return res.status(422).json({ detail: r.error });
    log(req, "turned on two-step login", "/api/me/2fa/confirm");
    res.json({ ok: true, recovery_codes: r.codes });
  });
  app.post("/api/me/2fa/disable", (req, res) => {
    if (refuseShared(req, res) || slow(req, res)) return;
    const u = personal(req);
    if (!auth.mfaOn(u.id)) return res.status(409).json({ detail: "Two-step login is already off." });
    if (!checkPassword(String(req.body?.password || ""), u)) return res.status(422).json({ detail: "Your password is wrong." });
    if (!secondOk(req)) return res.status(422).json({ detail: "That code doesn't match (or the recovery code was used)." });
    auth.disable(u.id);
    log(req, "turned off two-step login", "/api/me/2fa/disable");
    res.json({ ok: true, required: twoStepRequired(auth.policy(), req.user) });
  });
  app.post("/api/me/2fa/recovery", (req, res) => {
    if (refuseShared(req, res) || slow(req, res)) return;
    const u = personal(req);
    if (!auth.mfaOn(u.id)) return res.status(409).json({ detail: "Turn on two-step login first." });
    if (!checkPassword(String(req.body?.password || ""), u)) return res.status(422).json({ detail: "Your password is wrong." });
    if (!secondOk(req)) return res.status(422).json({ detail: "That code doesn't match." });
    const codes = auth.newRecovery(u.id);
    log(req, "made new two-step recovery codes (the old ones stopped working)", "/api/me/2fa/recovery");
    res.json({ ok: true, recovery_codes: codes });
  });

  // ---- Teams & roles: the policy and per-person actions (module admin, Edit; Owner targets need an Owner)
  const security = () => {
    const p = auth.policy(), act = store.db.users.filter((u) => u.active);
    return { ...p, options: REQUIRE, mail_ready: auth.mailReady(), shared_login_enabled: auth.sharedLoginEnabled(),
      owners_with_two_step: act.filter((u) => u.role_id === "owner" && auth.mfaOn(u.id)).length, sessions: auth.activeSessions().length };
  };
  app.get("/api/admin/security", (req, res) => res.json(security()));
  app.put("/api/admin/security", (req, res) => {
    const b = req.body || {}, cur = auth.policy(), changes = [];
    if (b.require !== undefined) {
      if (!REQUIRE_IDS.includes(b.require)) return res.status(422).json({ detail: "Pick who must use two-step login." });
      if (b.require !== cur.require) { cur.require = b.require; changes.push(`two-step login required for: ${REQUIRE.find((r) => r.id === b.require).name}`); }
    }
    if (b.shared_login_disabled !== undefined && !!b.shared_login_disabled !== !!cur.shared_login_disabled) {
      if (!isOwner(req)) return res.status(403).json({ detail: "Only an Owner can switch the shared team password login on or off." });
      if (b.shared_login_disabled) {
        const ok = store.db.users.some((u) => u.active && u.role_id === "owner" && auth.mfaOn(u.id));
        if (!ok) return res.status(422).json({ detail: "First make sure a personal Owner login has two-step login on, so nobody is locked out." });
      }
      cur.shared_login_disabled = !!b.shared_login_disabled;
      changes.push(cur.shared_login_disabled ? "disabled the shared team password login" : "enabled the shared team password login again");
    }
    store.db.auth_policy = cur; store.save();
    res.locals.audit = changes.length ? `Login security: ${changes.join("; ")}` : "Login security: no change";
    res.json(security());
  });
  const target = (req, res) => {
    const u = store.db.users.find((x) => x.id === req.params.id);
    if (!u) { res.status(404).json({ detail: "Person not found" }); return null; }
    if (u.role_id === "owner" && !isOwner(req)) { res.status(403).json({ detail: "Only an Owner can change an Owner." }); return null; }
    return u;
  };
  app.post("/api/admin/users/:id/2fa-reset", (req, res) => {
    const u = target(req, res); if (!u) return;
    if (!auth.mfaOn(u.id)) return res.status(409).json({ detail: `${u.name} doesn't have two-step login on.` });
    auth.disable(u.id);
    res.locals.audit = `reset two-step login for ${u.name} (they set it up again${twoStepRequired(auth.policy(), u) ? " at their next sign-in" : " if they want"})`;
    res.json({ ok: true });
  });
  app.post("/api/admin/users/:id/reset-link", (req, res) => {
    const u = target(req, res); if (!u) return;
    if (!u.active) return res.status(422).json({ detail: "Reactivate this person first." });
    const t = auth.newResetToken(u.id, req.user.name);
    res.locals.audit = `created a one-time password reset link for ${u.name} (valid 24 hours)`;
    res.json({ link: t.link, expires_at: t.expires_at });
  });
  app.post("/api/admin/users/:id/sign-out", (req, res) => {
    const u = target(req, res); if (!u) return;
    const n = auth.endSessions(u.id);
    res.locals.audit = `signed ${u.name} out everywhere (${n} session${n === 1 ? "" : "s"})`;
    res.json({ ended: n });
  });
}
