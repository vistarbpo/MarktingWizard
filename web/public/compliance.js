/* Security & compliance: backups, the PDPL data register, data subject requests, sub-processors,
   policies, quarterly access reviews, security checks, breach checklists and the public status page.
   Uses app.js globals (S, $, api, esc, md, toast, fmtDate, ROUTES, levelFor). AI drafts; people approve. */

const CMP = { d: null, tab: "overview", found: {}, verified: {}, aiDraft: null };
const CMP_TABS = [["overview", "Overview"], ["backups", "Backups"], ["register", "Data register"], ["requests", "Data requests"], ["vendors", "Sub-processors"], ["policies", "Policies"], ["access", "Access review"], ["incidents", "Breaches"], ["status", "Status page"]];
const CMP_STATE = { pass: ["good", "Pass"], warn: ["warn", "Check"], fail: ["bad", "Fix"], info: ["", "Info"] };
const cmpApi = (p, opts) => api("/api/compliance" + p, opts);
const cmpJson = (method, body) => ({ method, body: JSON.stringify(body || {}) });
const cmpEdit = () => levelFor("compliance") === "edit";
const cmpSize = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB");
const cmpWhen = (iso) => (iso ? fmtDate(iso) : "–");

ROUTES.compliance = { title: "Security & compliance", crumb: "Settings", render: cmpRender };

async function cmpLoad() { CMP.d = await cmpApi(""); }

async function cmpRender(view) {
  view.innerHTML = `<p class="muted">Loading…</p>`;
  await cmpLoad();
  $("#pageActions").innerHTML = `<a class="btn" href="/status" target="_blank" rel="noopener">Open status page</a>`;
  view.innerHTML = `<div class="cx-tabs"><div class="s-tabs" role="tablist" aria-label="Security & compliance sections">${CMP_TABS.map(([k, l]) => `<button role="tab" data-cmtab="${k}" aria-selected="${CMP.tab === k}">${l}</button>`).join("")}</div></div><div id="cmBody" style="margin-top:16px"></div>`;
  cmpRerender();
}

function cmpRerender() {
  if (S.route !== "compliance" || !$("#cmBody")) return;
  document.querySelectorAll("[data-cmtab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.cmtab === CMP.tab)));
  ({ overview: cmpOverview, backups: cmpBackups, register: cmpRegister, requests: cmpRequests, vendors: cmpVendors, policies: cmpPolicies, access: cmpAccess, incidents: cmpIncidents, status: cmpStatus })[CMP.tab]();
}

/* ------------------------------------------------ overview: security checks */
function cmpOverview() {
  const d = CMP.d, checks = d.checks, b = d.backups.status;
  const scored = checks.filter((c) => c.state !== "info"), passed = scored.filter((c) => c.state === "pass").length;
  const openReq = d.requests.filter((r) => !["completed", "rejected"].includes(r.status));
  const breaches = d.incidents.filter((i) => i.breach && (i.breach.checklist || []).some((x) => !x.done_at));
  const tile = (label, val, sub, tone = "", tab = "") => `<div class="card s-kpi ${tone} ${tab ? "clickable" : ""}" ${tab ? `data-cmtab="${tab}"` : ""}><span class="eyebrow">${label}</span><b class="num">${val}</b><span class="subtle">${sub}</span></div>`;
  $("#cmBody").innerHTML = `
    <section class="s-kpis">
      ${tile("Security checks", `${passed}/${scored.length}`, "passing", passed < scored.length ? "warn" : "")}
      ${tile("Last backup", b.last_ok ? esc(cmpWhen(b.last_ok.at)) : "Never", b.fresh ? "fresh" : `none in ${b.fresh_hours}h`, b.fresh ? "" : "warn", "backups")}
      ${tile("Data requests", openReq.length, `${openReq.filter((r) => r.overdue).length} overdue`, openReq.some((r) => r.overdue) ? "warn" : "", "requests")}
      ${tile("Open breaches", breaches.length, "with checklist items left", breaches.length ? "warn" : "", "incidents")}
      ${tile("Status page", esc(d.status.components.some((c) => c.state !== "operational") ? "Not all green" : "All green"), "set by hand + self-check", "", "status")}
    </section>
    ${checks.some((c) => c.id === "shared_login" && c.state === "warn") ? `<div class="card card-pad" style="margin-top:16px;border-color:var(--warn)"><b>The shared team password login is enabled.</b> <span class="muted s-small">Anyone with DASHBOARD_PASSWORD signs in as Owner without two-step login. Once a personal Owner has two-step login on, an Owner can disable it in Teams &amp; roles → Login security.</span></div>` : ""}
    ${d.needs.length ? `<div class="card card-pad" style="margin-top:16px;border-color:var(--warn)"><span class="eyebrow">Needs you</span><ul class="cc-list" style="margin-top:8px">${d.needs.map((n) => `<li><span class="cc-mod" style="background:var(--warn)"></span><span class="s-small">${esc(n.text)}</span></li>`).join("")}</ul></div>` : ""}
    <div class="card" style="margin-top:16px">
      <div class="card-head"><div><h2>Security checks</h2><p class="subtle s-small">Computed live from the server's settings. Fixes are done in hPanel (environment variables) or in Teams &amp; roles.</p></div></div>
      <ul class="list">${checks.map((c) => `<li style="align-items:flex-start"><span class="badge ${CMP_STATE[c.state][0]}" style="flex:none">${CMP_STATE[c.state][1]}</span>
        <div class="grow"><b>${esc(c.title)}</b><div class="subtle s-small">${esc(c.detail)}</div>${c.state !== "pass" && c.fix ? `<div class="s-small" style="margin-top:2px">→ ${esc(c.fix)}</div>` : ""}</div></li>`).join("")}</ul>
    </div>
    <p class="subtle s-small" style="margin-top:12px;max-width:80ch">This page helps DPA AD follow the Saudi Personal Data Protection Law (PDPL). It is not legal advice: deadlines and legal bases are defaults to confirm with a lawyer. ${esc(d.verify_note)}</p>`;
}

/* ------------------------------------------------ backups */
function cmpBackups() {
  const { status: b, files, can_download } = CMP.d.backups, ed = cmpEdit();
  const off = (o) => !o ? "" : o.ok ? `<span class="badge good">sent</span>` : `<span class="badge bad" title="${esc(o.error || "")}">failed</span>`;
  $("#cmBody").innerHTML = `
    <div class="cc">
      <section class="card card-pad cc-span-6 stack">
        <div class="row between"><h2>Backup health</h2><span class="badge ${b.fresh ? "good" : "bad"}">${b.fresh ? "Fresh" : "Not fresh"}</span></div>
        <dl class="cx-facts">
          <dt>Last good backup</dt><dd>${b.last_ok ? `${esc(cmpWhen(b.last_ok.at))} · ${esc(cmpSize(b.last_ok.size))} · ${esc(b.last_ok.kind)}` : "None yet"}</dd>
          <dt>Encryption</dt><dd>${b.encrypted ? "AES-256-GCM with BACKUP_KEY" : `<span style="color:var(--bad)">Off: set BACKUP_KEY in hPanel</span>`}</dd>
          <dt>Off-site: S3</dt><dd>${b.offsite.s3.configured ? `${esc(b.offsite.s3.bucket)} at ${esc(b.offsite.s3.endpoint)}` : "Not set up"}${b.last_ok?.offsite?.s3 ? " " + off(b.last_ok.offsite.s3) : ""}</dd>
          <dt>Off-site: email</dt><dd>${b.offsite.email.configured ? `to ${esc(b.offsite.email.to)} (up to ${b.offsite.email.max_mb} MB)` : "Not set up"}${b.last_ok?.offsite?.email ? " " + off(b.last_ok.offsite.email) : ""}</dd>
          <dt>Schedule</dt><dd>${esc(b.schedule)}</dd>
          <dt>Kept</dt><dd>Last ${b.keep.nightly} nightly, ${b.keep.weekly} weekly, ${b.keep.manual} manual · ${b.count} on the server (${esc(cmpSize(b.total_size))})</dd>
        </dl>
        ${b.last_run && !b.last_run.ok ? `<div class="notice" style="color:var(--bad);background:var(--bad-soft)">Last run failed: ${esc(b.last_run.error)}</div>` : ""}
        ${ed ? `<div class="row gap-8" style="flex-wrap:wrap"><button class="btn btn-primary" data-cm="backup-now">Back up now</button><label class="row gap-4 s-small"><input type="checkbox" id="cm-media" checked> include media</label></div>` : ""}
      </section>
      <section class="card card-pad cc-span-6 stack">
        <h2>Restore procedure</h2>
        <ol class="s-small cx-steps">
          <li>Press <b>Verify</b> on the backup you want: it decrypts it here and counts every collection.</li>
          <li>An Owner downloads it (or takes it from the S3 bucket / email).</li>
          <li>On a computer with Node 22 and this repo: <code>BACKUP_KEY=… node web/scripts/restore-backup.js &lt;file&gt; restored/</code>. It checks every checksum and writes <code>db.json</code>, <code>crm.json</code> and <code>media/</code>.</li>
          <li>hPanel → Node.js: stop the app. In File Manager, rename the current <code>DATA_DIR</code> files to <code>*.old</code> and upload the restored ones.</li>
          <li>Start the app, sign in and check the counts match the Verify result.</li>
        </ol>
        <p class="subtle s-small">Without BACKUP_KEY an encrypted backup can't be opened. Keep the key in a password manager, not only in hPanel. Full steps: docs/security-compliance.md.</p>
      </section>
    </div>
    <div class="card" style="margin-top:16px"><div class="card-head"><h2>Backups on the server</h2></div>
      ${files.length ? `<div class="table-wrap"><table class="f-table"><thead><tr><th>When</th><th>Kind</th><th>Size</th><th>Off-site</th><th></th></tr></thead><tbody>
        ${files.map((f) => `<tr><td>${esc(cmpWhen(f.at))}${f.encrypted ? "" : ` <span class="badge warn">not encrypted</span>`}${f.verified ? ` <span class="badge good">verified</span>` : ""}</td><td>${esc(f.kind)}</td><td class="num">${esc(cmpSize(f.size))}</td>
          <td>${f.offsite.s3 ? "S3 " + off(f.offsite.s3) : ""} ${f.offsite.email ? "Email " + off(f.offsite.email) : ""}${!f.offsite.s3 && !f.offsite.email ? `<span class="subtle">–</span>` : ""}</td>
          <td><div class="row gap-4" style="justify-content:flex-end;flex-wrap:wrap"><button class="btn btn-sm" data-cm="verify" data-name="${esc(f.name)}">Verify</button>
            ${ed && (b.offsite.s3.configured || b.offsite.email.configured) ? `<button class="btn btn-sm" data-cm="offsite" data-name="${esc(f.name)}">Send off-site</button>` : ""}
            ${can_download ? `<a class="btn btn-sm" href="/api/compliance/backups/${encodeURIComponent(f.name)}/download">Download</a>` : ""}</div></td></tr>
          ${CMP.verified[f.name] ? `<tr><td colspan="5">${cmpVerifyView(CMP.verified[f.name])}</td></tr>` : ""}`).join("")}
      </tbody></table></div>` : `<div class="empty"><h2>No backups yet</h2><p>Press Back up now. The nightly run starts at 02:00 Riyadh time.</p></div>`}
      ${can_download ? "" : `<p class="subtle s-small" style="padding:0 16px 12px">Only an Owner can download backups.</p>`}
    </div>`;
}
function cmpVerifyView(v) {
  if (v.error) return `<div class="notice" style="color:var(--bad);background:var(--bad-soft)">${esc(v.error)}</div>`;
  const list = (o) => Object.entries(o).filter(([, n]) => n).map(([k, n]) => `<span class="o-area"><b>${esc(k.replace(/_/g, " "))}</b> ${n}</span>`).join("") || `<span class="subtle">empty</span>`;
  return `<div class="stack s-small"><b style="color:var(--good)">Decrypted and parsed: every checksum matches.</b><div>db.json</div><div class="o-areas">${list(v.counts.db)}</div><div>crm.json</div><div class="o-areas">${list(v.counts.crm)}</div><div class="subtle">${v.media_files} media files · ${v.files} files in total</div></div>`;
}

/* ------------------------------------------------ data register */
function cmpRegister() {
  const ed = cmpEdit();
  $("#cmBody").innerHTML = `
    <div class="row between" style="flex-wrap:wrap;gap:8px"><p class="subtle s-small" style="max-width:75ch;margin:0">Records of processing: what personal data the dashboard holds, why, on what legal basis, where, for how long and who can see it. "Who can access" is read live from Teams &amp; roles. Replace every [CONFIRM] with a real answer.</p>
      ${ed ? `<button class="btn" data-cm="reg-new">Add entry</button>` : ""}</div>
    <div class="cx-cards" style="margin-top:12px">${CMP.d.register.map((r) => `<article class="card card-pad stack">
      <div class="row between gap-8"><h3>${esc(r.name)}</h3>${ed ? `<button class="btn btn-sm" data-cm="reg-edit" data-id="${r.id}">Edit</button>` : ""}</div>
      <dl class="cx-facts">${[["Data", r.data], ["People", r.subjects], ["Why", r.purpose], ["Legal basis", r.legal_basis], ["Where", r.where], ["Retention", r.retention], ["Source", r.source]].map(([k, v]) => `<dt>${k}</dt><dd dir="auto" class="${/\[CONFIRM/.test(v || "") ? "cx-confirm" : ""}">${esc(v || "–")}</dd>`).join("")}
        <dt>Who can access</dt><dd>${esc((r.access || []).join(", ") || "–")}</dd>${r.notes ? `<dt>Notes</dt><dd dir="auto">${esc(r.notes)}</dd>` : ""}</dl>
    </article>`).join("")}</div>`;
}
function cmpRegDialog(r) {
  const d = $("#dialog"), F = [["name", "Kind of data", 1], ["data", "What personal data", 3], ["subjects", "Whose data", 2], ["purpose", "Why we hold it", 2], ["legal_basis", "Legal basis", 2], ["where", "Where it's stored", 2], ["retention", "How long we keep it", 2], ["source", "Where it comes from", 2], ["notes", "Notes", 2]];
  d.innerHTML = `<form method="dialog"><div class="card-head" style="padding:20px 24px 0"><h2>${r ? "Edit entry" : "New entry"}</h2></div>
    <div class="card-body stack" style="padding:16px 24px">${F.map(([k, l, rows]) => `<div class="field"><label for="cmr-${k}">${l}</label>${rows === 1 ? `<input class="input" id="cmr-${k}" value="${esc(r?.[k] || "")}" dir="auto">` : `<textarea class="input" id="cmr-${k}" rows="${rows}" dir="auto">${esc(r?.[k] || "")}</textarea>`}</div>`).join("")}
      <div class="field"><label for="cmr-module">Module (sets "who can access")</label><select class="input" id="cmr-module"><option value="">–</option>${CMP.d.meta.modules.map((m) => `<option value="${m.id}" ${m.id === r?.module ? "selected" : ""}>${esc(m.name)}</option>`).join("")}</select></div></div>
    <div class="row between" style="padding:0 24px 24px">${r ? `<button class="btn btn-ghost btn-danger" value="delete">Delete</button>` : "<span></span>"}<div class="row gap-8"><button class="btn" value="cancel">Cancel</button><button class="btn btn-primary" value="ok">Save</button></div></div></form>`;
  d.showModal();
  d.onclose = async () => {
    try {
      if (d.returnValue === "delete" && r) await cmpApi(`/register/${r.id}`, { method: "DELETE" });
      else if (d.returnValue === "ok") await cmpApi(r ? `/register/${r.id}` : "/register", cmpJson(r ? "PUT" : "POST", Object.fromEntries([...F.map(([k]) => [k, $("#cmr-" + k).value]), ["module", $("#cmr-module").value]])));
      else return;
      toast("Saved"); await cmpLoad(); cmpRerender();
    } catch (e) { toast(e.message, true); }
  };
}

/* ------------------------------------------------ data subject requests */
function cmpRequests() {
  const d = CMP.d, ed = cmpEdit(), types = Object.fromEntries(d.meta.dsr_types.map((t) => [t.id, t.name]));
  const due = (r) => ["completed", "rejected"].includes(r.status) ? `<span class="badge good">${esc(r.status)}</span>` : r.overdue ? `<span class="badge bad">overdue ${-r.days_left}d</span>` : `<span class="badge ${r.due_soon ? "warn" : ""}">due ${esc(r.due)} · ${r.days_left}d</span>`;
  $("#cmBody").innerHTML = `
    <div class="cc">
      ${ed ? `<form class="card card-pad cx-span-5 stack" id="cmReqForm">
        <h2>Log a request</h2>
        <p class="subtle s-small">Access, a copy, correction or deletion. Response deadline: <b>${d.settings.dsr_days} days</b> from receipt <label class="row gap-4" style="display:inline-flex">(change: <input class="input input-sm" id="cm-dsrdays" type="number" min="1" max="90" value="${d.settings.dsr_days}" style="width:70px" aria-label="Response deadline in days">)</label>. ${esc(d.verify_note)}</p>
        <div class="s-form">
          <div class="field"><label for="cq-type">Request</label><select class="input" id="cq-type">${d.meta.dsr_types.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join("")}</select></div>
          <div class="field"><label for="cq-date">Received</label><input class="input" id="cq-date" type="date" value="${new Date().toISOString().slice(0, 10)}"></div>
          <div class="field"><label for="cq-email">Email</label><input class="input" id="cq-email" type="email" dir="ltr"></div>
          <div class="field"><label for="cq-phone">Phone / WhatsApp</label><input class="input" id="cq-phone" dir="ltr"></div>
          <div class="field"><label for="cq-name">Name</label><input class="input" id="cq-name" dir="auto"></div>
          <div class="field"><label for="cq-channel">Came in by</label><input class="input" id="cq-channel" placeholder="email, WhatsApp, letter"></div>
        </div>
        <label class="row gap-4 s-small"><input type="checkbox" id="cq-verified"> Identity checked (e.g. they wrote from the same email)</label>
        <button class="btn btn-primary" type="submit">Log request</button>
      </form>` : ""}
      <section class="card cx-span-${ed ? 7 : 12}">
        <div class="card-head"><h2>Requests</h2><span class="subtle s-small">${d.requests.length} logged</span></div>
        ${d.requests.length ? `<ul class="list">${d.requests.map((r) => `<li style="align-items:flex-start;flex-direction:column;gap:6px">
          <div class="row between gap-8" style="width:100%;flex-wrap:wrap"><b>${esc(r.ref)} · ${esc(types[r.type] || r.type)}</b>${due(r)}</div>
          <div class="subtle s-small" dir="auto">${r.erased ? "Personal data deleted: this record keeps no name, email or phone." : esc([r.subject.name, r.subject.email, r.subject.phone].filter(Boolean).join(" · "))} · received ${esc(r.received_at)}${r.channel ? " via " + esc(r.channel) : ""}${r.identity_verified ? " · identity checked" : ""}</div>
          ${r.result ? `<div class="s-small">Deleted: ${Object.entries(r.result.deleted).filter(([, n]) => n).map(([k, n]) => `${n} ${esc(k.replace(/_/g, " "))}`).join(", ") || "nothing found"} · ${esc(cmpWhen(r.result.at))} by ${esc(r.result.by)}</div>` : ""}
          ${ed ? `<div class="row gap-8" style="flex-wrap:wrap">${r.erased ? "" : `<button class="btn btn-sm" data-cm="req-find" data-id="${r.id}">Find data</button><button class="btn btn-sm" data-cm="req-export" data-id="${r.id}">Export JSON</button>${r.type === "deletion" ? `<button class="btn btn-sm btn-danger" data-cm="req-delete" data-id="${r.id}">Delete data…</button>` : ""}`}
            <select class="input input-sm" data-cmreqstatus="${r.id}" aria-label="Status" style="width:auto">${d.meta.dsr_status.map((s) => `<option ${s === r.status ? "selected" : ""}>${s}</option>`).join("")}</select></div>` : ""}
          ${CMP.found[r.id] ? cmpFoundView(CMP.found[r.id]) : ""}
          <details class="s-small"><summary class="subtle">Log (${r.log.length})</summary><ul class="s-timeline">${r.log.map((l) => `<li><span class="subtle num">${esc(cmpWhen(l.at))}</span> ${esc(l.by)}: ${esc(l.text)}</li>`).join("")}</ul></details>
        </li>`).join("")}</ul>` : `<div class="empty"><h2>No requests yet</h2><p>When someone asks what data DPA AD holds about them, or asks for deletion, log it here so the deadline is tracked.</p></div>`}
      </section>
    </div>`;
}
function cmpFoundView(f) {
  const group = (label, list) => list.length ? `<div><b>${label}</b> ${list.map((x) => `<span class="badge">${esc(x.label)} · ${esc(x.workspace)}${x.messages !== undefined ? ` · ${x.messages} msgs` : ""}</span>`).join(" ")}</div>` : "";
  return `<div class="card card-pad s-small stack" style="width:100%;background:var(--surface-2)">${f.total ? "" : "<b>Nothing found for this email or phone.</b>"}
    ${group("Store CRM", f.crm_contacts)}${group("Support tickets", f.support_tickets)}${group("HR candidates", f.hr_candidates)}${group("Sales deals (contact fields)", f.sales_deals)}${group("Billing customers (contact fields; invoices kept for tax records)", f.billing_customers || [])}${group("Survey answers", f.survey_responses || [])}${group("Legal documents (drafts: the person is taken off the parties; signed contracts are retained for legal reasons and never changed automatically: decide with a lawyer)", f.legal_documents || [])}
    ${f.mentions.deal_activities ? `<div class="subtle">Also mentioned in ${f.mentions.deal_activities} sales notes/drafts: deletion replaces the email/number there.</div>` : ""}
    <div class="subtle">Free-text that names the person without their email or number isn't found: check by hand. Backups keep copies until they rotate out.</div></div>`;
}
function cmpDeleteDialog(r) {
  const d = $("#dialog");
  d.innerHTML = `<form method="dialog"><div class="card-head" style="padding:20px 24px 0"><h2>Delete ${esc(r.ref)} data</h2></div>
    <div class="card-body stack" style="padding:16px 24px"><p class="s-small">This permanently deletes the person's Store CRM record (with every message and note), support tickets and HR candidate record, and clears their contact on sales deals. Only a record that the deletion happened is kept, without personal data. It can't be undone.</p>
      <div class="field"><label for="cm-confirm">Type DELETE to confirm</label><input class="input" id="cm-confirm" autocomplete="off"></div></div>
    <div class="row gap-8" style="padding:0 24px 24px;justify-content:flex-end"><button class="btn" value="cancel">Cancel</button><button class="btn btn-primary btn-danger" value="ok">Delete permanently</button></div></form>`;
  d.showModal();
  d.onclose = async () => {
    if (d.returnValue !== "ok") return;
    try { const out = await cmpApi(`/requests/${r.id}/delete`, cmpJson("POST", { confirm: $("#cm-confirm").value })); delete CMP.found[r.id]; toast(`Deleted: ${Object.values(out.result.deleted).reduce((a, n) => a + n, 0)} items`); await cmpLoad(); cmpRerender(); }
    catch (e) { toast(e.message, true); }
  };
}

/* ------------------------------------------------ sub-processors */
function cmpVendors() {
  const ed = cmpEdit(), DPA = { unknown: ["warn", "DPA unknown"], not_needed: ["", "DPA not needed"], requested: ["warn", "DPA requested"], signed: ["good", "DPA signed"] };
  $("#cmBody").innerHTML = `
    <div class="row between" style="flex-wrap:wrap;gap:8px"><p class="subtle s-small" style="max-width:75ch;margin:0">Every outside company that receives personal data from DPA AD. Check each one's data-processing agreement (DPA) and where it stores data: sending personal data outside Saudi Arabia has its own PDPL rules. Nothing is marked signed until you mark it.</p>
      ${ed ? `<div class="row gap-8"><button class="btn" data-cm="ven-ops">Add from Operations tool stack</button><button class="btn" data-cm="ven-new">Add vendor</button></div>` : ""}</div>
    <div class="card" style="margin-top:12px"><div class="table-wrap"><table class="f-table"><thead><tr><th>Vendor</th><th>What it does</th><th>Personal data</th><th>Country</th><th>Outside KSA</th><th>DPA</th><th></th></tr></thead><tbody>
      ${CMP.d.vendors.map((v) => `<tr><td><b>${esc(v.name)}</b>${v.in_tool_stack ? ` <span class="badge accent" title="In Operations → Tool stack">tool stack</span>` : ""}</td><td class="s-small">${esc(v.role)}</td><td class="s-small">${esc(v.data)}</td>
        <td class="s-small ${/\[CONFIRM/.test(v.country) ? "cx-confirm" : ""}">${esc(v.country)}</td><td>${v.transfer_outside_ksa === null || v.transfer_outside_ksa === undefined ? `<span class="subtle">?</span>` : v.transfer_outside_ksa ? "Yes" : "No"}</td>
        <td><span class="badge ${DPA[v.dpa]?.[0] || ""}">${esc(DPA[v.dpa]?.[1] || v.dpa)}</span></td><td>${ed ? `<button class="btn btn-sm" data-cm="ven-edit" data-id="${v.id}">Edit</button>` : ""}</td></tr>`).join("")}
    </tbody></table></div></div>`;
}
function cmpVendorDialog(v) {
  const d = $("#dialog");
  d.innerHTML = `<form method="dialog"><div class="card-head" style="padding:20px 24px 0"><h2>${v ? "Edit vendor" : "New vendor"}</h2></div>
    <div class="card-body stack" style="padding:16px 24px">
      ${[["name", "Name"], ["role", "What it does for us"], ["data", "Personal data it receives"], ["country", "Country / region of storage"], ["dpa_link", "Link to the DPA"]].map(([k, l]) => `<div class="field"><label for="cmv-${k}">${l}</label><input class="input" id="cmv-${k}" value="${esc(v?.[k] || "")}"></div>`).join("")}
      <div class="s-form"><div class="field"><label for="cmv-dpa">DPA status</label><select class="input" id="cmv-dpa">${CMP.d.meta.dpa_status.map((s) => `<option ${s === (v?.dpa || "unknown") ? "selected" : ""}>${s}</option>`).join("")}</select></div>
        <div class="field"><label for="cmv-out">Data leaves Saudi Arabia?</label><select class="input" id="cmv-out">${[["", "Not sure"], ["1", "Yes"], ["0", "No"]].map(([val, l]) => `<option value="${val}" ${String(v?.transfer_outside_ksa === null || v?.transfer_outside_ksa === undefined ? "" : v.transfer_outside_ksa ? "1" : "0") === val ? "selected" : ""}>${l}</option>`).join("")}</select></div></div>
      <div class="field"><label for="cmv-notes">Notes</label><textarea class="input" id="cmv-notes" rows="2">${esc(v?.notes || "")}</textarea></div></div>
    <div class="row between" style="padding:0 24px 24px">${v ? `<button class="btn btn-ghost btn-danger" value="delete">Delete</button>` : "<span></span>"}<div class="row gap-8"><button class="btn" value="cancel">Cancel</button><button class="btn btn-primary" value="ok">Save</button></div></div></form>`;
  d.showModal();
  d.onclose = async () => {
    try {
      if (d.returnValue === "delete" && v) await cmpApi(`/vendors/${v.id}`, { method: "DELETE" });
      else if (d.returnValue === "ok") {
        const out = $("#cmv-out").value;
        await cmpApi(v ? `/vendors/${v.id}` : "/vendors", cmpJson(v ? "PUT" : "POST", { name: $("#cmv-name").value, role: $("#cmv-role").value, data: $("#cmv-data").value, country: $("#cmv-country").value, dpa_link: $("#cmv-dpa_link").value, dpa: $("#cmv-dpa").value, transfer_outside_ksa: out === "" ? null : out === "1", notes: $("#cmv-notes").value }));
      } else return;
      toast("Saved"); await cmpLoad(); cmpRerender();
    } catch (e) { toast(e.message, true); }
  };
}

/* ------------------------------------------------ policies */
function cmpPolicies() {
  const ed = cmpEdit();
  $("#cmBody").innerHTML = `
    <p class="subtle s-small" style="max-width:75ch">Templates to edit and approve. The AI Compliance officer can improve a draft from the dashboard's real settings; it leaves [CONFIRM] where it doesn't know and never claims a certification. A policy can only be approved once every [CONFIRM] is filled.</p>
    <div class="cx-cards">${CMP.d.policies.map((p) => `<article class="card card-pad stack">
      <div class="row between gap-8"><h3>${esc(p.title)}</h3><span class="badge ${p.status === "approved" ? "good" : "warn"}">${p.status === "approved" ? "Approved" : "Draft"}</span></div>
      <div class="subtle s-small">Version ${p.version} · owner ${esc(p.owner || "not set")} · updated ${esc(cmpWhen(p.updated_at))}${p.approved_at ? ` · approved by ${esc(p.approved_by)} ${esc(cmpWhen(p.approved_at))}` : ""}</div>
      <div class="subtle s-small">${(p.body.match(/\[CONFIRM/g) || []).length} [CONFIRM] left${p.ai_draft ? " · AI draft waiting" : ""}</div>
      <div><button class="btn btn-sm" data-cm="pol-open" data-id="${p.id}">${ed ? "Open & edit" : "Read"}</button></div></article>`).join("")}</div>`;
}
async function cmpPolicyDialog(id) {
  const p = await cmpApi(`/policies/${id}`), d = $("#dialog"), ed = cmpEdit();
  d.innerHTML = `<form method="dialog" class="cx-wide"><div class="card-head" style="padding:20px 24px 0"><h2>${esc(p.title)}</h2><span class="subtle s-small">v${p.version} · ${esc(p.status)}</span></div>
    <div class="card-body stack" style="padding:16px 24px">
      <div class="field"><label for="cmp-owner">Owner</label><input class="input" id="cmp-owner" value="${esc(p.owner || "")}" ${ed ? "" : "disabled"}></div>
      <div class="field"><label for="cmp-body">Policy (Markdown)</label><textarea class="input mono" id="cmp-body" rows="14" dir="auto" ${ed ? "" : "readonly"}>${esc(p.body)}</textarea></div>
      ${ed ? `<div class="row gap-8" style="flex-wrap:wrap"><button class="btn btn-sm" type="button" data-cm="pol-ai" data-id="${p.id}">AI: improve this draft</button>${p.ai_draft ? `<button class="btn btn-sm" type="button" data-cm="pol-use">Use AI draft</button><button class="btn btn-sm btn-ghost" type="button" data-cm="pol-discard" data-id="${p.id}">Discard AI draft</button>` : ""}</div>` : ""}
      <div id="cmAiBox" class="s-draft" ${p.ai_draft ? "" : "hidden"}>${p.ai_draft ? `<div class="doc s-draft-body">${md(p.ai_draft)}</div>` : ""}</div>
    </div>
    <div class="row between" style="padding:0 24px 24px;flex-wrap:wrap;gap:8px">${ed ? `<button class="btn btn-ghost btn-danger" value="delete">Delete</button>` : "<span></span>"}<div class="row gap-8"><button class="btn" value="cancel">Close</button>${ed ? `<button class="btn" value="save">Save</button><button class="btn btn-primary" value="approve">Save &amp; approve</button>` : ""}</div></div></form>`;
  CMP.aiDraft = p.ai_draft; CMP.fromAi = false;
  d.showModal();
  d.onclose = async () => {
    const v = d.returnValue;
    if (!ed || !["save", "approve", "delete"].includes(v)) return;
    try {
      if (v === "delete") { if (!confirm("Delete this policy?")) return; await cmpApi(`/policies/${p.id}`, { method: "DELETE" }); }
      else await cmpApi(`/policies/${p.id}`, cmpJson("PUT", { owner: $("#cmp-owner").value, body: $("#cmp-body").value, from_ai: CMP.fromAi, approve: v === "approve" }));
      toast(v === "approve" ? "Approved" : "Saved");
    } catch (e) { toast(e.message, true); }
    await cmpLoad(); cmpRerender();
  };
}
async function cmpPolicyAi(id, btn) {
  const box = $("#cmAiBox"); box.hidden = false; box.innerHTML = `<p class="subtle s-small">AI is writing…</p>`; btn.disabled = true;
  try {
    const res = await fetch(`/api/compliance/policies/${id}/ai`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    if (res.status === 401) { location.href = "/login"; return; }
    if (!res.ok) { let m = res.statusText; try { m = (await res.json()).detail; } catch {} throw new Error(m); }
    const reader = res.body.getReader(), dec = new TextDecoder(); let text = "", last = 0;
    for (;;) { const { done, value } = await reader.read(); if (done) break; text += dec.decode(value, { stream: true }); if (Date.now() - last > 150) { last = Date.now(); box.innerHTML = `<div class="doc s-draft-body">${md(text.split("\n\n[[MWIZ_")[0])}</div>`; } }
    const err = text.split("[[MWIZ_ERROR]]")[1]; if (err !== undefined) throw new Error(err.trim());
    CMP.aiDraft = text.split("\n\n[[MWIZ_")[0];
    box.innerHTML = `<div class="doc s-draft-body">${md(CMP.aiDraft)}</div><div class="row gap-8"><button class="btn btn-sm" type="button" data-cm="pol-use">Use AI draft</button><span class="subtle s-small">Check every line before approving.</span></div>`;
  } catch (e) { box.innerHTML = `<div class="notice" style="color:var(--bad)">${esc(e.message)}</div>`; }
  finally { btn.disabled = false; }
}

/* ------------------------------------------------ access review */
function cmpAccess() {
  const a = CMP.d.access, ed = cmpEdit(), last = CMP.d.reviews[0];
  $("#cmBody").innerHTML = `
    <div class="card"><div class="card-head"><div><h2>Access review · ${esc(a.quarter)}</h2><p class="subtle s-small">Every active login with its role and last sign-in. Decide keep / change / remove for each; the review is recorded with your name and the date. Role changes are made in Teams &amp; roles.</p></div>
      ${last ? `<span class="badge ${last.quarter === a.quarter ? "good" : "warn"}">Last: ${esc(last.quarter)} by ${esc(last.reviewer)}</span>` : `<span class="badge warn">Never reviewed</span>`}</div>
      <div class="table-wrap"><table class="f-table"><thead><tr><th>Person</th><th>Role</th><th>Last sign-in</th><th>Decision</th><th>Note</th></tr></thead><tbody>
        ${a.rows.map((u) => `<tr><td><b>${esc(u.name)}</b><div class="subtle s-small">${esc(u.email)}</div></td><td>${esc(u.role)}</td><td class="num">${u.last_login_at ? esc(cmpWhen(u.last_login_at)) : "never"}${u.reason ? `<div class="s-small" style="color:var(--warn)">${esc(u.reason)}</div>` : ""}</td>
          <td><select class="input input-sm" data-cmdec="${esc(u.user_id)}" ${ed ? "" : "disabled"} aria-label="Decision for ${esc(u.name)}">${["keep", "change", "remove"].map((x) => `<option ${x === u.suggestion ? "selected" : ""}>${x}</option>`).join("")}</select></td>
          <td><input class="input input-sm" data-cmnote="${esc(u.user_id)}" ${ed ? "" : "disabled"} aria-label="Note for ${esc(u.name)}"></td></tr>`).join("")}
        ${a.shared_login ? `<tr><td><b>Team password</b><div class="subtle s-small">shared Owner login (DASHBOARD_PASSWORD)</div></td><td>Owner</td><td>–</td><td><select class="input input-sm" id="cm-shared" ${ed ? "" : "disabled"} aria-label="Decision for the team password">${["change", "keep", "remove"].map((x) => `<option>${x}</option>`).join("")}</select></td><td class="s-small subtle">Rotate in hPanel</td></tr>` : ""}
      </tbody></table></div>
      ${a.rows.length ? "" : `<p class="subtle s-small" style="padding:0 16px">No personal logins yet: everyone uses the team password. Add people in Teams &amp; roles.</p>`}
      ${ed ? `<div class="row gap-8" style="padding:12px 16px 16px;flex-wrap:wrap"><input class="input" id="cm-revnotes" placeholder="Notes for this review" style="flex:1;min-width:200px"><label class="row gap-4 s-small"><input type="checkbox" id="cm-apply"> deactivate people marked remove</label><button class="btn btn-primary" data-cm="rev-save">Record review</button></div>` : ""}
    </div>
    ${CMP.d.reviews.length ? `<div class="card" style="margin-top:16px"><div class="card-head"><h2>Past reviews</h2></div><ul class="list">${CMP.d.reviews.map((r) => `<li><b>${esc(r.quarter)}</b><span class="grow s-small">${esc(r.reviewer)} · ${esc(r.reviewed_at)} · ${r.decisions.filter((x) => x.decision === "keep").length} keep, ${r.decisions.filter((x) => x.decision === "change").length} change, ${r.decisions.filter((x) => x.decision === "remove").length} remove${r.applied ? ` · ${r.applied} deactivated` : ""}</span></li>`).join("")}</ul></div>` : ""}`;
}

/* ------------------------------------------------ breaches (Operations incidents) */
function cmpIncidents() {
  const ed = cmpEdit(), list = CMP.d.incidents;
  $("#cmBody").innerHTML = `
    <p class="subtle s-small" style="max-width:75ch">Incidents come from Operations → Incidents. If personal data may be exposed, flag the incident as a personal data breach: a notification checklist starts with deadlines from when the team became aware (regulator: ${CMP.d.settings.breach_regulator_hours}h, affected people: target ${CMP.d.settings.breach_subjects_hours}h). Verify the current PDPL breach notification timeline.</p>
    ${list.length ? list.map((i) => `<article class="card card-pad stack" style="margin-top:12px">
      <div class="row between gap-8" style="flex-wrap:wrap"><div><b>${esc(i.title)}</b> <span class="badge ${i.severity === "SEV1" ? "bad" : "warn"}">${esc(i.severity)}</span> <span class="badge">${esc(i.status)}</span>${i.breach ? ` <span class="badge bad">personal data breach</span>` : ""}${i.status_page ? ` <span class="badge ${i.status_page.published ? "good" : ""}">${i.status_page.published ? "on status page" : "status draft"}</span>` : ""}</div>
        <span class="subtle s-small">${esc(i.workspace)} · ${esc(cmpWhen(i.started_at))}</span></div>
      ${i.impact ? `<div class="s-small" dir="auto">${esc(i.impact)}</div>` : ""}
      ${i.breach ? `<div class="s-small subtle">Aware since ${esc(cmpWhen(i.breach.aware_at))}${i.breach.people_affected ? ` · people affected: ${esc(i.breach.people_affected)}` : ""}${i.breach.data_types ? ` · data: ${esc(i.breach.data_types)}` : ""}</div>
        <ul class="list cx-check">${i.breach.checklist.map((c) => { const late = !c.done_at && Date.parse(c.due_at) < Date.now(); return `<li style="align-items:flex-start"><input type="checkbox" data-cmbreach="${esc(i.workspace_id)}|${esc(i.id)}|${esc(c.id)}" ${c.done_at ? "checked" : ""} ${ed ? "" : "disabled"} aria-label="Done" style="margin-top:3px;flex:none">
          <div class="grow s-small" style="${c.done_at ? "text-decoration:line-through;opacity:.6" : ""}">${esc(c.text)}<div class="${late ? "" : "subtle"}" style="${late ? "color:var(--bad)" : ""}">due ${esc(cmpWhen(c.due_at))}${c.done_at ? ` · done by ${esc(c.by)}` : late ? " · overdue" : ""}</div></div></li>`; }).join("")}</ul>` : ""}
      ${ed ? `<div class="row gap-8" style="flex-wrap:wrap">${i.breach ? `<button class="btn btn-sm btn-ghost" data-cm="breach-off" data-ws="${esc(i.workspace_id)}" data-id="${esc(i.id)}">Remove breach flag</button>` : `<button class="btn btn-sm" data-cm="breach-on" data-ws="${esc(i.workspace_id)}" data-id="${esc(i.id)}">Flag as personal data breach</button>`}
        ${i.status_page ? "" : `<button class="btn btn-sm" data-cm="publish-inc" data-ws="${esc(i.workspace_id)}" data-id="${esc(i.id)}">Publish to status page…</button>`}</div>` : ""}
    </article>`).join("") : `<div class="card empty"><h2>No incidents</h2><p>Log incidents in Operations → Incidents. They appear here for breach handling and the status page.</p></div>`}`;
}
function cmpBreachDialog(ws, id) {
  const d = $("#dialog"), local = new Date(Date.now() - new Date().getTimezoneOffset() * 60e3).toISOString().slice(0, 16);
  d.innerHTML = `<form method="dialog"><div class="card-head" style="padding:20px 24px 0"><h2>Personal data breach</h2></div>
    <div class="card-body stack" style="padding:16px 24px">
      <div class="field"><label for="cmb-aware">When did the team become aware?</label><input class="input" id="cmb-aware" type="datetime-local" value="${local}"></div>
      <div class="field"><label for="cmb-people">How many people may be affected?</label><input class="input" id="cmb-people" placeholder="unknown yet"></div>
      <div class="field"><label for="cmb-data">What kinds of data?</label><input class="input" id="cmb-data" placeholder="e.g. store emails and phone numbers"></div>
      <p class="subtle s-small">Deadlines are counted from the time above. Verify the current PDPL breach notification timeline with your lawyer.</p></div>
    <div class="row gap-8" style="padding:0 24px 24px;justify-content:flex-end"><button class="btn" value="cancel">Cancel</button><button class="btn btn-primary" value="ok">Start checklist</button></div></form>`;
  d.showModal();
  d.onclose = async () => {
    if (d.returnValue !== "ok") return;
    try { await cmpApi(`/incidents/${encodeURIComponent(ws)}/${encodeURIComponent(id)}/breach`, cmpJson("POST", { aware_at: new Date($("#cmb-aware").value).toISOString(), people_affected: $("#cmb-people").value, data_types: $("#cmb-data").value })); toast("Checklist started"); await cmpLoad(); cmpRerender(); }
    catch (e) { toast(e.message, true); }
  };
}
function cmpPublishDialog(ws, id) {
  const inc = CMP.d.incidents.find((i) => i.workspace_id === ws && i.id === id), d = $("#dialog"), comps = CMP.d.status.components;
  d.innerHTML = `<form method="dialog"><div class="card-head" style="padding:20px 24px 0"><h2>Status page update</h2></div>
    <div class="card-body stack" style="padding:16px 24px">
      <p class="subtle s-small">Customer-facing text for "${esc(inc.title)}". No internal details. The AI can draft it; a person checks and publishes.</p>
      <button class="btn btn-sm" type="button" data-cm="status-ai" data-ws="${esc(ws)}" data-id="${esc(id)}">AI: draft the update</button>
      <div class="s-form"><div class="field"><label for="cms-ten">Title (English)</label><input class="input" id="cms-ten" dir="ltr"></div><div class="field"><label for="cms-tar">العنوان (عربي)</label><input class="input" id="cms-tar" dir="rtl"></div></div>
      <div class="s-form"><div class="field"><label for="cms-xen">Update (English)</label><textarea class="input" id="cms-xen" rows="3" dir="ltr"></textarea></div><div class="field"><label for="cms-xar">التحديث (عربي)</label><textarea class="input" id="cms-xar" rows="3" dir="rtl"></textarea></div></div>
      <div class="field"><label for="cms-impact">Impact</label><select class="input" id="cms-impact">${CMP.d.status.impacts.map((x) => `<option ${x === (inc.severity === "SEV1" ? "outage" : "degraded") ? "selected" : ""}>${x}</option>`).join("")}</select></div>
      <fieldset class="field"><legend class="s-small">Affected</legend><div class="row gap-8" style="flex-wrap:wrap">${comps.map((c) => `<label class="row gap-4 s-small"><input type="checkbox" data-cmscomp="${c.id}"> ${esc(c.en)}</label>`).join("")}</div></fieldset>
      <label class="row gap-4 s-small"><input type="checkbox" id="cms-pub"> Publish now (otherwise saved as a draft)</label></div>
    <div class="row gap-8" style="padding:0 24px 24px;justify-content:flex-end"><button class="btn" value="cancel">Cancel</button><button class="btn btn-primary" value="ok">Save</button></div></form>`;
  CMP.statusAi = null;
  d.showModal();
  d.onclose = async () => {
    if (d.returnValue !== "ok") return;
    const body = { ops_ws: ws, ops_id: id, title_en: $("#cms-ten").value, title_ar: $("#cms-tar").value, text_en: $("#cms-xen").value, text_ar: $("#cms-xar").value, impact: $("#cms-impact").value,
      components: [...document.querySelectorAll("[data-cmscomp]")].filter((x) => x.checked).map((x) => x.dataset.cmscomp), published: $("#cms-pub").checked, ...(CMP.statusAi ? { ai_original: CMP.statusAi } : {}) };
    try { await cmpApi("/status/incidents", cmpJson("POST", body)); toast(body.published ? "Published on the status page" : "Saved as a draft"); await cmpLoad(); cmpRerender(); }
    catch (e) { toast(e.message, true); }
  };
}

/* ------------------------------------------------ status page admin */
function cmpStatus() {
  const st = CMP.d.status, ed = cmpEdit();
  $("#cmBody").innerHTML = `
    <div class="cc">
      <section class="card cc-span-6"><div class="card-head"><div><h2>Components</h2><p class="subtle s-small">Set by hand. A published incident shows its impact on top. The dashboard also gets a self-check every 5 minutes.</p></div></div>
        <ul class="list">${st.components.map((c) => `<li style="flex-wrap:wrap;gap:8px"><b class="grow">${esc(c.en)}<span class="subtle s-small" dir="rtl"> · ${esc(c.ar)}</span></b>
          <select class="input input-sm" data-cmcomp="${c.id}" ${ed ? "" : "disabled"} style="width:auto" aria-label="State of ${esc(c.en)}">${st.states.map((s) => `<option ${s === c.state ? "selected" : ""}>${s}</option>`).join("")}</select></li>`).join("")}</ul>
      </section>
      <section class="card card-pad cc-span-6 stack"><h2>Uptime self-check</h2>
        <p class="subtle s-small">Checks PUBLIC_URL/healthz every 5 minutes while the server runs. Days with no checks show as "no data", never as up.</p>
        ${st.checks.length ? `<div class="o-areas">${st.checks.slice().reverse().map((c) => `<span class="o-area"><b>${esc(c.d)}</b> ${c.ok}/${c.ok + c.fail} ok</span>`).join("")}</div>` : `<p class="s-small">No checks yet.</p>`}
        <div class="row gap-8">${ed ? `<button class="btn btn-sm" data-cm="self-check">Check now</button>` : ""}<a class="btn btn-sm" href="/status" target="_blank" rel="noopener">Open /status</a><a class="btn btn-sm btn-ghost" href="/status.json" target="_blank" rel="noopener">status.json</a></div>
      </section>
    </div>
    <div class="card" style="margin-top:16px"><div class="card-head"><div><h2>Status incidents</h2><p class="subtle s-small">Start one from Breaches → "Publish to status page", or add maintenance here. Only published ones are public.</p></div>${ed ? `<button class="btn btn-sm" data-cm="status-new">Add notice</button>` : ""}</div>
      ${st.incidents.length ? `<ul class="list">${st.incidents.map((i) => `<li style="flex-direction:column;align-items:stretch;gap:6px">
        <div class="row between gap-8" style="flex-wrap:wrap"><b dir="auto">${esc(i.title_en || i.title_ar)}</b><div class="row gap-4"><span class="badge">${esc(i.impact)}</span><span class="badge ${i.state === "resolved" ? "good" : "warn"}">${esc(i.state)}</span><span class="badge ${i.published ? "good" : ""}">${i.published ? "public" : "draft"}</span></div></div>
        <div class="subtle s-small">${esc(i.components.join(", "))} · started ${esc(cmpWhen(i.started_at))}${i.ops ? " · from an Operations incident" : ""}</div>
        ${i.updates.slice(-2).reverse().map((u) => `<div class="s-small" dir="auto"><span class="subtle">${esc(cmpWhen(u.at))} · ${esc(u.state)}:</span> ${esc(u.text_en)}${u.text_ar ? ` <span dir="rtl">· ${esc(u.text_ar)}</span>` : ""}</div>`).join("")}
        ${ed ? `<div class="row gap-8" style="flex-wrap:wrap"><button class="btn btn-sm" data-cm="status-pub" data-id="${i.id}" data-on="${i.published ? "0" : "1"}">${i.published ? "Unpublish" : "Publish"}</button><button class="btn btn-sm" data-cm="status-upd" data-id="${i.id}">Post update…</button><button class="btn btn-sm btn-ghost btn-danger" data-cm="status-del" data-id="${i.id}">Delete</button></div>` : ""}
      </li>`).join("")}</ul>` : `<div class="empty"><p>No status incidents. The page shows "All systems operational".</p></div>`}
    </div>`;
}
function cmpStatusUpdateDialog(i) {
  const d = $("#dialog"), st = CMP.d.status;
  d.innerHTML = `<form method="dialog"><div class="card-head" style="padding:20px 24px 0"><h2>${i ? "Post an update" : "New status notice"}</h2></div>
    <div class="card-body stack" style="padding:16px 24px">
      ${i ? "" : `<div class="s-form"><div class="field"><label for="cmu-ten">Title (English)</label><input class="input" id="cmu-ten"></div><div class="field"><label for="cmu-tar">العنوان (عربي)</label><input class="input" id="cmu-tar" dir="rtl"></div></div>
        <div class="field"><label for="cmu-impact">Impact</label><select class="input" id="cmu-impact">${st.impacts.map((x) => `<option>${x}</option>`).join("")}</select></div>
        <fieldset class="field"><legend class="s-small">Affected</legend><div class="row gap-8" style="flex-wrap:wrap">${st.components.map((c) => `<label class="row gap-4 s-small"><input type="checkbox" data-cmucomp="${c.id}"> ${esc(c.en)}</label>`).join("")}</div></fieldset>`}
      <div class="field"><label for="cmu-state">State</label><select class="input" id="cmu-state">${st.inc_states.map((x) => `<option ${x === (i?.state || "investigating") ? "selected" : ""}>${x}</option>`).join("")}</select></div>
      <div class="s-form"><div class="field"><label for="cmu-xen">Update (English)</label><textarea class="input" id="cmu-xen" rows="3"></textarea></div><div class="field"><label for="cmu-xar">التحديث (عربي)</label><textarea class="input" id="cmu-xar" rows="3" dir="rtl"></textarea></div></div></div>
    <div class="row gap-8" style="padding:0 24px 24px;justify-content:flex-end"><button class="btn" value="cancel">Cancel</button><button class="btn btn-primary" value="ok">Save</button></div></form>`;
  d.showModal();
  d.onclose = async () => {
    if (d.returnValue !== "ok") return;
    const upd = { state: $("#cmu-state").value, text_en: $("#cmu-xen").value, text_ar: $("#cmu-xar").value };
    try {
      if (i) await cmpApi(`/status/incidents/${i.id}`, cmpJson("PUT", upd));
      else await cmpApi("/status/incidents", cmpJson("POST", { ...upd, title_en: $("#cmu-ten").value, title_ar: $("#cmu-tar").value, impact: $("#cmu-impact").value, components: [...document.querySelectorAll("[data-cmucomp]")].filter((x) => x.checked).map((x) => x.dataset.cmucomp) }));
      toast("Saved"); await cmpLoad(); cmpRerender();
    } catch (e) { toast(e.message, true); }
  };
}

/* ------------------------------------------------ events */
document.addEventListener("click", async (e) => {
  if (S.route !== "compliance") return;
  const tab = e.target.closest("[data-cmtab]");
  if (tab) { CMP.tab = tab.dataset.cmtab; return cmpRerender(); }
  const b = e.target.closest("[data-cm]");
  if (!b) return;
  const a = b.dataset.cm, id = b.dataset.id, d = CMP.d;
  const reload = async (msg) => { if (msg) toast(msg); await cmpLoad(); cmpRerender(); };
  try {
    if (a === "backup-now") { b.disabled = true; b.textContent = "Backing up…"; const r = await cmpApi("/backups", cmpJson("POST", { media: $("#cm-media")?.checked !== false })); await reload(`Backup done: ${cmpSize(r.size)}`); }
    else if (a === "verify") { b.disabled = true; try { CMP.verified[b.dataset.name] = await cmpApi(`/backups/${encodeURIComponent(b.dataset.name)}/verify`, cmpJson("POST")); } catch (err) { CMP.verified[b.dataset.name] = { error: err.message }; } await reload(); }
    else if (a === "offsite") { b.disabled = true; const r = await cmpApi(`/backups/${encodeURIComponent(b.dataset.name)}/offsite`, cmpJson("POST")); await reload(Object.values(r).every((x) => x.ok) ? "Sent off-site" : "Off-site copy failed: see the badge"); }
    else if (a === "reg-new") cmpRegDialog(null);
    else if (a === "reg-edit") cmpRegDialog(d.register.find((r) => r.id === id));
    else if (a === "req-find") { CMP.found[id] = await cmpApi(`/requests/${id}/find`, cmpJson("POST")); await reload(); }
    else if (a === "req-export") {
      const out = await cmpApi(`/requests/${id}/export`, cmpJson("POST"));
      const url = URL.createObjectURL(new Blob([JSON.stringify(out, null, 2)], { type: "application/json" }));
      const link = Object.assign(document.createElement("a"), { href: url, download: `${out.request}-export.json` }); document.body.append(link); link.click(); link.remove(); URL.revokeObjectURL(url);
      await reload("Export downloaded");
    }
    else if (a === "req-delete") cmpDeleteDialog(d.requests.find((r) => r.id === id));
    else if (a === "ven-new") cmpVendorDialog(null);
    else if (a === "ven-edit") cmpVendorDialog(d.vendors.find((v) => v.id === id));
    else if (a === "ven-ops") { const r = await cmpApi("/vendors/from-ops", cmpJson("POST")); await reload(r.added ? `Added ${r.added} from the tool stack` : "Nothing new in the tool stack"); }
    else if (a === "pol-open") await cmpPolicyDialog(id);
    else if (a === "pol-ai") await cmpPolicyAi(id, b);
    else if (a === "pol-use") { if (CMP.aiDraft) { $("#cmp-body").value = CMP.aiDraft; CMP.fromAi = true; toast("AI draft loaded: edit, then save"); } }
    else if (a === "pol-discard") { await cmpApi(`/policies/${id}/ai`, { method: "DELETE" }); CMP.aiDraft = null; $("#cmAiBox").hidden = true; b.remove(); toast("AI draft discarded"); }
    else if (a === "rev-save") {
      const decisions = d.access.rows.map((u) => ({ user_id: u.user_id, decision: document.querySelector(`[data-cmdec="${CSS.escape(u.user_id)}"]`).value, note: document.querySelector(`[data-cmnote="${CSS.escape(u.user_id)}"]`).value }));
      const r = await cmpApi("/reviews", cmpJson("POST", { quarter: d.access.quarter, decisions, shared_login: $("#cm-shared")?.value, notes: $("#cm-revnotes").value, apply: $("#cm-apply").checked }));
      await reload(`Review recorded${r.applied ? `: ${r.applied} deactivated` : ""}`);
    }
    else if (a === "breach-on") cmpBreachDialog(b.dataset.ws, id);
    else if (a === "breach-off") { if (!confirm("Remove the breach flag and its checklist?")) return; await cmpApi(`/incidents/${encodeURIComponent(b.dataset.ws)}/${encodeURIComponent(id)}/breach`, { method: "DELETE" }); await reload("Flag removed"); }
    else if (a === "publish-inc") cmpPublishDialog(b.dataset.ws, id);
    else if (a === "status-ai") {
      b.disabled = true; b.textContent = "AI is writing…";
      try {
        const r = await cmpApi("/status/draft", cmpJson("POST", { ops_ws: b.dataset.ws, ops_id: id }));
        CMP.statusAi = r;
        $("#cms-ten").value = r.title_en; $("#cms-tar").value = r.title_ar; $("#cms-xen").value = r.text_en; $("#cms-xar").value = r.text_ar;
        if (r.impact) $("#cms-impact").value = r.impact;
        document.querySelectorAll("[data-cmscomp]").forEach((x) => (x.checked = r.components.includes(x.dataset.cmscomp)));
      } finally { b.disabled = false; b.textContent = "AI: draft the update"; }
    }
    else if (a === "status-new") cmpStatusUpdateDialog(null);
    else if (a === "status-upd") cmpStatusUpdateDialog(d.status.incidents.find((i) => i.id === id));
    else if (a === "status-pub") { await cmpApi(`/status/incidents/${id}`, cmpJson("PUT", { published: b.dataset.on === "1" })); await reload(b.dataset.on === "1" ? "Published" : "Unpublished"); }
    else if (a === "status-del") { if (!confirm("Delete this status incident?")) return; await cmpApi(`/status/incidents/${id}`, { method: "DELETE" }); await reload("Deleted"); }
    else if (a === "self-check") { const r = await cmpApi("/status/check", cmpJson("POST")); await reload(r.ok ? "Self-check passed" : "Self-check failed"); }
  } catch (err) { toast(err.message, true); if (b.isConnected) b.disabled = false; }
});

document.addEventListener("change", async (e) => {
  if (S.route !== "compliance") return;
  const t = e.target;
  try {
    if (t.dataset.cmreqstatus) { await cmpApi(`/requests/${t.dataset.cmreqstatus}`, cmpJson("PUT", { status: t.value })); toast("Status saved"); await cmpLoad(); cmpRerender(); }
    else if (t.dataset.cmcomp) { await cmpApi(`/status/components/${t.dataset.cmcomp}`, cmpJson("PUT", { state: t.value })); toast("Component updated"); await cmpLoad(); }
    else if (t.dataset.cmbreach) { const [ws, id, item] = t.dataset.cmbreach.split("|"); await cmpApi(`/incidents/${encodeURIComponent(ws)}/${encodeURIComponent(id)}/breach`, cmpJson("PUT", { item, done: t.checked })); await cmpLoad(); cmpRerender(); }
    else if (t.id === "cm-dsrdays") { await cmpApi("/settings", cmpJson("PUT", { dsr_days: t.value })); toast("Deadline saved"); await cmpLoad(); cmpRerender(); }
  } catch (err) { toast(err.message, true); }
});

document.addEventListener("submit", async (e) => {
  if (e.target.id !== "cmReqForm") return;
  e.preventDefault();
  try {
    await cmpApi("/requests", cmpJson("POST", { type: $("#cq-type").value, received_at: $("#cq-date").value, channel: $("#cq-channel").value, identity_verified: $("#cq-verified").checked,
      subject: { name: $("#cq-name").value, email: $("#cq-email").value, phone: $("#cq-phone").value } }));
    toast("Request logged"); await cmpLoad(); cmpRerender();
  } catch (err) { toast(err.message, true); }
});

if (S.route === "compliance" && S.ws) render();
