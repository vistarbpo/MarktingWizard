/* Creative Studio phases 2-3 UI: Accounts (OAuth connect, Test/Live, auto-publish, publish log),
   publishing in the content drawer (Publish now, per-channel status, retries) and the Results tab.
   Uses globals from app.js (S, $, api, esc, md, toast, fmtDate, fmtNum) and studio.js (CS, csP, csEdit, csCh, csLoad, csRerender). */

const CP = { acc: null, res: null, pub: null };
const cpModeBadge = (mode) => `<span class="badge ${mode === "live" ? "good" : "warn"}">${mode === "live" ? "LIVE" : "TEST MODE"}</span>`;
const cpLogTone = { published: "good", test: "warn", failed: "bad", retry: "warn", account: "", settings: "accent" };

/* ------------------------------------------------ Accounts tab */
CS_TABS.push({ key: "accounts", label: "Accounts", view: () => `<div id="cpAcc"><p class="muted">Loading…</p></div>`, after: cpAccLoad });
async function cpAccLoad() {
  try { CP.acc = await api(`${csP()}/accounts`); } catch (e) { $("#cpAcc").innerHTML = `<p class="muted">${esc(e.message)}</p>`; return; }
  cpAccRender();
}
function cpAccRender() {
  const box = $("#cpAcc"); if (!box || !CP.acc) return;
  const A = CP.acc, s = A.settings, edit = csEdit(), appr = A.can_approve;
  const chName = (c) => esc(csCh(c)?.name || c);
  box.innerHTML = `
    ${A.notice ? `<div class="notice ${A.notice.ok ? "cp-ok" : ""}" style="margin-bottom:14px">${esc(A.notice.text)}</div>` : ""}
    <div class="card card-pad cp-mode ${s.mode}" style="margin-bottom:16px"><div class="row gap-12" style="flex-wrap:wrap;justify-content:space-between">
      <div class="stack" style="gap:4px;min-width:0;flex:1"><div class="row gap-8">${cpModeBadge(s.mode)}<b>${s.mode === "live" ? "Publishing is live: approved posts go to the connected accounts." : "Test mode: nothing is posted. Each publish is logged as \"would publish\" below."}</b></div>
        <span class="subtle s-small">Only approved or scheduled content can publish; editing it sends it back to review. Channels without a connected account (and X, Snapchat) stay "download and post".</span></div>
      ${appr ? `<button class="btn ${s.mode === "live" ? "" : "btn-primary"}" data-cpact="mode">${s.mode === "live" ? "Back to Test mode" : "Switch to Live"}</button>` : `<span class="subtle s-small">Approvers switch modes.</span>`}</div>
      <label class="chip" style="margin-top:12px;align-self:flex-start"><input type="checkbox" data-cpact="auto" ${s.auto_publish ? "checked" : ""} ${appr ? "" : "disabled"}> Auto-publish scheduled posts at their time (Riyadh)</label>
      <span class="subtle s-small">${s.auto_publish ? "On: the scheduler checks every minute and posts scheduled items when their date and time pass." : "Off: when a scheduled post is due, it waits for a person to click \"Publish now\" in the post."}</span></div>
    <div class="cp-grid">${A.providers.map((p) => {
      const a = p.account, st = !p.configured ? ["Not set up", ""] : !a ? ["Not connected", ""] : a.status !== "connected" ? ["Reconnect", "bad"] : a.expired ? ["Login expired", "bad"] : ["Connected", "good"];
      const exp = a?.expires_at ? new Date(a.expires_at) : null, soon = exp && exp - Date.now() < 10 * 864e5;
      return `<div class="card card-pad stack cp-card"><div class="row between gap-8"><h3>${esc(p.name)}</h3><span class="badge ${st[1]}">${st[0]}</span></div>
        <span class="subtle s-small">Posts: ${p.channels.map(chName).join(", ")}</span>
        ${a ? `<div class="stack" style="gap:4px"><span><b dir="auto">${esc(a.name)}</b>${a.target ? ` · <span dir="auto">${esc(a.target.ig_username ? "@" + a.target.ig_username + " (Instagram) · " + a.target.page_name : a.target.page_name || a.target.name || "")}</span>` : ""}</span>
            ${a.targets?.length > 1 && edit ? `<select class="input input-sm" data-cptarget="${a.id}" aria-label="Page or profile to post as">${a.targets.map((t) => `<option value="${esc(t.id)}" ${t.id === a.selected ? "selected" : ""}>${esc(t.page_name || t.name)}${t.ig_username ? " · @" + esc(t.ig_username) : t.page_id ? " · no Instagram linked" : ""}</option>`).join("")}</select>` : ""}
            <span class="subtle s-small">Connected by ${esc(a.connected_by || "")} · ${fmtDate(a.connected_at)}${exp ? ` · login ${a.can_refresh ? "renews automatically" : `expires ${exp.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`}` : ""}${p.id === "meta" ? " · Page posting doesn't expire" : ""}</span>
            ${soon && !a.can_refresh && p.id !== "meta" ? `<span class="badge warn">Reconnect soon</span>` : ""}
            ${a.last_error ? `<span class="badge bad">${esc(a.last_error)}</span>` : ""}
            ${a.missing_scopes?.length ? `<span class="subtle s-small">Not granted yet: ${a.missing_scopes.map(esc).join(", ")}</span>` : ""}</div>` : ""}
        ${p.review.length ? `<details><summary class="s-small">Needs the platform's app review</summary><p class="subtle s-small">${p.review.map(esc).join(", ")}</p></details>` : ""}
        <details ${p.configured ? "" : "open"}><summary class="s-small">Developer console setup</summary><div class="stack s-small" style="gap:6px;margin-top:6px">
          <span>Redirect URL to register:</span><div class="row gap-8"><code class="cp-code">${esc(p.redirect_uri)}</code><button class="btn btn-sm btn-ghost" data-cpcopy="${esc(p.redirect_uri)}">Copy</button></div>
          <div>Env vars in hPanel: ${p.env.map((e) => `<code>${esc(e)}</code>`).join(" ")}</div>
          <div>Scopes: ${p.scopes.map((x) => `<code>${esc(x)}</code>`).join(" ")}</div>
          <div><a href="${esc(p.console)}" target="_blank" rel="noopener">Open the developer console</a></div><div class="subtle">${esc(p.notes)}</div></div></details>
        ${edit ? `<div class="row gap-8" style="flex-wrap:wrap;margin-top:auto">${p.configured ? `<a class="btn btn-sm ${a ? "" : "btn-primary"}" href="/oauth/${p.id}/start?ws=${S.ws.id}">${a ? "Reconnect" : "Connect"}</a>` : `<span class="subtle s-small">Add the env vars to connect.</span>`}${a ? `<button class="btn btn-sm btn-ghost" data-cpdisc="${a.id}" style="color:var(--bad)">Disconnect</button>` : ""}</div>` : ""}</div>`;
    }).join("")}
      <div class="card card-pad stack cp-card"><div class="row between"><h3>Download and post</h3><span class="badge">Manual</span></div>
        <span class="subtle s-small">${A.manual.map((m) => esc(m.name)).join(", ")}: no organic posting API we can use. Download the pack in the post, post it by hand, then tap "Mark posted".</span></div>
      <div class="card card-pad stack cp-card"><div class="row between"><h3>Meta webhook (DMs, comments)</h3><span class="badge ${A.webhook.verify_set && A.webhook.secret_set ? "good" : "warn"}">${A.webhook.verify_set && A.webhook.secret_set ? "Ready" : "Needs env vars"}</span></div>
        <div class="row gap-8"><code class="cp-code">${esc(A.webhook.url)}</code><button class="btn btn-sm btn-ghost" data-cpcopy="${esc(A.webhook.url)}">Copy</button></div>
        <span class="subtle s-small">Callback URL for Messenger and Instagram webhooks (fields: messages, comments, feed). Verify token = META_VERIFY_TOKEN; signatures are checked with META_APP_SECRET. DMs and comments land in AI Support. Comments are also checked every 15 minutes in Live mode.</span></div></div>
    <div class="card" style="margin-top:16px"><div class="card-head"><h2>Publish log</h2><span class="subtle s-small">Last ${A.log.length}</span></div>
      ${A.log.length ? `<ul class="cp-log">${A.log.map((l) => `<li><span class="subtle s-small num">${fmtDate(l.at)}</span><span class="badge ${cpLogTone[l.status] || ""}">${esc(l.status)}</span><span dir="auto">${l.item_id ? `<button class="linklike" data-csopen="${esc(l.item_id)}">${esc(l.title || "post")}</button>: ` : ""}${esc(l.text)}${l.url ? ` <a href="${esc(l.url)}" target="_blank" rel="noopener">open</a>` : ""}</span></li>`).join("")}</ul>` : `<p class="muted s-small" style="padding:0 20px 16px">Nothing published yet.</p>`}</div>`;
}

/* ------------------------------------------------ Drawer: publishing for this item */
CS_DRAWER_HOOKS.push(async (item) => {
  const box = $("#csPubBox"); if (!box || !postChannelsOf(item).length) return;
  let P;
  try { P = await api(`${csP()}/items/${item.id}/publishing`); } catch { return; }
  if (!$("#csPubBox") || CS.draft?.id !== item.id) return;
  CP.pub = P;
  const ok = ["approved", "scheduled"].includes(item.status), appr = CS.meta.can_approve, edit = csEdit();
  const direct = Object.entries(P.channels).filter(([, c]) => c.direct && !c.published);
  const when = P.due_at ? new Date(P.due_at).toLocaleString(undefined, { timeZone: "Asia/Riyadh", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) + " Riyadh" : "no date";
  $("#csPubBox").innerHTML = `<div class="card card-pad stack cp-pub"><div class="row gap-8" style="justify-content:space-between;flex-wrap:wrap"><div class="row gap-8"><span class="eyebrow" style="margin:0">Publishing</span>${cpModeBadge(P.mode)}</div>
      ${edit && appr && ok && direct.length ? `<button class="btn btn-sm btn-primary" data-cpact="publish">${P.mode === "live" ? "Publish now" : "Publish now (test)"}</button>` : ""}</div>
    <span class="subtle s-small">${item.status === "scheduled" ? `Scheduled for ${esc(when)}. ${P.auto_publish ? "Auto-publish is on: it posts by itself when due." : P.due ? "Due now: waiting for someone to click Publish now (auto-publish is off)." : "Auto-publish is off: at that time it waits for Publish now."}` : ok ? "Approved: publish now, or schedule it to post at its date and time." : "Publishing opens after approval."}</span>
    <ul class="cp-chans">${Object.entries(P.channels).map(([ch, c]) => {
      const st = c.state || {}, pub = c.published;
      const status = pub ? `<span class="badge good">${pub.via === "api" ? "Published" : "Posted by hand"}</span>${pub.url ? ` <a href="${esc(pub.url)}" target="_blank" rel="noopener" class="s-small">open</a>` : ""}${pub.note ? ` <span class="subtle s-small">${esc(pub.note)}</span>` : ""}`
        : st.failed ? `<span class="badge bad">Failed ${st.attempts}×</span> <span class="s-small" style="color:var(--bad)">${esc(st.last_error)}</span>${edit && appr && ok ? ` <button class="btn btn-sm" data-cpretry="${ch}">Retry</button>` : ""}`
        : st.last_error ? `<span class="badge warn">Retrying ${st.attempts}/3</span> <span class="subtle s-small">${esc(st.last_error)}</span>`
        : st.test_at && P.mode !== "live" ? `<span class="badge warn">Test logged</span>` : "";
      return `<li><b class="s-small">${esc(csCh(ch).name)}</b><span class="subtle s-small">${c.direct ? `via ${esc(c.provider_name)} ${esc(c.account || "")}` : c.provider_name ? `${esc(c.provider_name)} not connected: download and post` : "download and post"}</span><span>${status}</span></li>`;
    }).join("")}</ul>
    ${P.log.length ? `<details><summary class="s-small">Log (${P.log.length})</summary><ul class="cp-log">${P.log.map((l) => `<li><span class="subtle s-small num">${fmtDate(l.at)}</span><span class="badge ${cpLogTone[l.status] || ""}">${esc(l.status)}</span><span dir="auto">${esc(l.text)}</span></li>`).join("")}</ul></details>` : ""}</div>`;
});
const postChannelsOf = (i) => (i.channels || []).filter((c) => c !== "email");

/* ------------------------------------------------ Results tab */
CS_TABS.push({ key: "results", label: "Results", view: () => `<div id="cpRes"><p class="muted">Loading…</p></div>`, after: cpResLoad });
async function cpResLoad() {
  try { CP.res = await api(`${csP()}/results`); } catch (e) { $("#cpRes").innerHTML = `<p class="muted">${esc(e.message)}</p>`; return; }
  cpResRender();
}
const CP_KEYS = [["reach", "Reach"], ["views", "Views"], ["likes", "Likes"], ["comments", "Comments"], ["saves", "Saves"], ["shares", "Shares"]];
const cpN = (v) => (v === null || v === undefined ? "–" : fmtNum(v));
function cpTable(rows, first) {
  return `<div class="table-wrap"><table><thead><tr><th>${first}</th><th class="num">Posts</th>${CP_KEYS.map(([, l]) => `<th class="num">${l}</th>`).join("")}<th class="num">Engagement</th></tr></thead>
    <tbody>${rows.map((r) => `<tr><td dir="auto">${esc(r.name)}</td><td class="num">${r.posts}</td>${CP_KEYS.map(([k]) => `<td class="num">${cpN(r[k])}</td>`).join("")}<td class="num"><b>${cpN(r.engagement)}</b></td></tr>`).join("")}</tbody></table></div>`;
}
function cpResRender() {
  const box = $("#cpRes"); if (!box) return;
  const R = CP.res, edit = csEdit();
  const eng = (m) => ["likes", "comments", "saves", "shares"].reduce((a, k) => a + (Number(m[k]) || 0), 0);
  box.innerHTML = `<div class="row gap-8" style="justify-content:space-between;margin-bottom:14px;flex-wrap:wrap"><p class="muted" style="font-size:13px;max-width:720px">Numbers pulled from Instagram, Facebook, YouTube and TikTok for posts published from here, every 6 hours. Only real platform numbers are shown; a dash means the platform didn't give that metric. Engagement = likes + comments + saves + shares.</p>
      <div class="row gap-8">${cpModeBadge(R.mode)}${edit ? `<button class="btn btn-sm" data-cpact="fetch" ${R.mode === "live" ? "" : "disabled title=\"Live mode only\""}>Pull results now</button><button class="btn btn-sm btn-primary" data-cpact="summary" ${R.posts.length ? "" : "disabled"}>AI: what worked</button>` : ""}</div></div>
    ${R.posts.length ? `
    <div class="cp-tiles">${CP_KEYS.map(([k, l]) => `<div class="card card-pad"><span class="eyebrow">${l}</span><span class="cp-big num">${cpN(R.totals[k])}</span></div>`).join("")}</div>
    ${R.summary ? `<div class="card card-pad" style="margin-top:16px"><div class="row between"><span class="eyebrow">What worked · ${fmtDate(R.summary.at)} · from ${R.summary.posts} posts</span></div><div class="doc">${md(R.summary.text)}</div></div>` : ""}
    <div class="grid-2" style="margin-top:16px"><div class="card"><div class="card-head"><h2>By channel</h2></div>${cpTable(R.by_channel, "Channel")}</div>
      <div class="card"><div class="card-head"><h2>By pillar</h2></div>${cpTable(R.by_pillar, "Pillar")}</div></div>
    <div class="card" style="margin-top:16px"><div class="card-head"><h2>Top posts</h2></div><ol class="cp-top">${R.top.map((p) => `<li><button class="linklike" data-csopen="${esc(p.item_id)}" dir="auto">${esc(p.title)}</button> <span class="subtle s-small">${esc(csCh(p.channel)?.name || p.channel)}</span> <b class="num">${fmtNum(eng(p.metrics))}</b>${p.url ? ` <a href="${esc(p.url)}" target="_blank" rel="noopener" class="s-small">open</a>` : ""}</li>`).join("")}</ol></div>
    <div class="card" style="margin-top:16px"><div class="card-head"><h2>Every post</h2></div><div class="table-wrap"><table><thead><tr><th>Post</th><th>Channel</th>${CP_KEYS.map(([, l]) => `<th class="num">${l}</th>`).join("")}<th>Updated</th></tr></thead>
      <tbody>${R.posts.map((p) => `<tr><td><button class="linklike" data-csopen="${esc(p.item_id)}" dir="auto">${esc(p.title)}</button>${p.errors.length ? ` <span class="badge warn" title="${esc(p.errors.join("; "))}">some metrics unavailable</span>` : ""}</td><td>${esc(csCh(p.channel)?.name || p.channel)}</td>${CP_KEYS.map(([k]) => `<td class="num">${cpN(p.metrics[k])}</td>`).join("")}<td class="subtle s-small">${fmtDate(p.at)}</td></tr>`).join("")}</tbody></table></div></div>`
    : `<div class="card empty"><h2>No results yet</h2><p>${R.mode === "live" ? "Results appear about 6 hours after posts are published from here (or click Pull results now)." : "Publishing is in Test mode, so nothing has been posted or measured. Switch to Live in Accounts once the accounts are connected."}${R.published_without_results ? ` ${R.published_without_results} published item(s) don't have numbers yet.` : ""}</p></div>`}
    ${R.manual.length ? `<p class="subtle s-small" style="margin-top:12px">${R.manual.length} post(s) were posted by hand (download and post): their numbers stay in each platform's own app.</p>` : ""}`;
}

/* ------------------------------------------------ Events */
document.addEventListener("click", async (e) => {
  if (S.route !== "studio") return;
  const t = e.target;
  const cp = t.closest("[data-cpcopy]"); if (cp) return navigator.clipboard.writeText(cp.dataset.cpcopy).then(() => toast("Copied"), () => prompt("Copy", cp.dataset.cpcopy));
  const disc = t.closest("[data-cpdisc]");
  if (disc) { if (!confirm("Disconnect this account? Scheduled posts for it fall back to download and post.")) return; try { await api(`${csP()}/accounts/${disc.dataset.cpdisc}`, { method: "DELETE" }); toast("Disconnected"); return cpAccLoad(); } catch (err) { return toast(err.message, true); } }
  const rt = t.closest("[data-cpretry]");
  if (rt) { rt.disabled = true; try { const r = await api(`${csP()}/items/${CS.draft.id}/retry`, { method: "POST", body: JSON.stringify({ channel: rt.dataset.cpretry }) }); cpToast(r.result); await cpRefreshDrawer(); } catch (err) { toast(err.message, true); rt.disabled = false; } return; }
  const a = t.closest("[data-cpact]"); if (!a || a.tagName === "INPUT") return;
  try {
    switch (a.dataset.cpact) {
      case "mode": {
        const live = CP.acc.settings.mode !== "live";
        if (live && !confirm("Switch to Live? Approved posts will be published to the connected accounts, and replies from AI Support on comments and DMs will be sent.")) return;
        await api(`${csP()}/publish/settings`, { method: "PUT", body: JSON.stringify({ mode: live ? "live" : "test" }) });
        toast(live ? "Publishing is live" : "Back in Test mode"); return cpAccLoad();
      }
      case "publish": {
        if (CP.pub?.mode === "live" && !confirm("Publish this now to the connected accounts?")) return;
        a.disabled = true; a.textContent = "Publishing…";
        const r = await api(`${csP()}/items/${CS.draft.id}/publish`, { method: "POST", body: "{}" });
        cpToast(r.result); return cpRefreshDrawer();
      }
      case "fetch": { a.disabled = true; const r = await api(`${csP()}/results/fetch`, { method: "POST", body: "{}" }); toast(`${r.updated} post(s) updated${r.errors ? `, ${r.errors} error(s)` : ""}`); return cpResLoad(); }
      case "summary": { a.disabled = true; a.textContent = "Writing…"; try { await api(`${csP()}/results/summary`, { method: "POST", body: "{}" }); toast("Summary written from the real numbers"); } finally { a.disabled = false; a.textContent = "AI: what worked"; } return cpResLoad(); }
    }
  } catch (err) { toast(err.message, true); a.disabled = false; }
});
document.addEventListener("change", async (e) => {
  if (S.route !== "studio") return;
  const t = e.target;
  if (t.dataset?.cpact === "auto") {
    try { await api(`${csP()}/publish/settings`, { method: "PUT", body: JSON.stringify({ auto_publish: t.checked }) }); toast(t.checked ? "Auto-publish on" : "Auto-publish off: due posts wait for Publish now"); cpAccLoad(); }
    catch (err) { toast(err.message, true); t.checked = !t.checked; }
  }
  if (t.dataset?.cptarget) { try { await api(`${csP()}/accounts/${t.dataset.cptarget}`, { method: "PUT", body: JSON.stringify({ selected: t.value }) }); toast("Posting as the selected page"); cpAccLoad(); } catch (err) { toast(err.message, true); } }
});
function cpToast(r) {
  if (!r) return toast("Nothing to publish");
  const parts = [];
  if (r.published.length) parts.push(`Published: ${r.published.map((c) => csCh(c).name).join(", ")}`);
  if (r.test.length) parts.push(`Test mode, logged: ${r.test.map((c) => csCh(c).name).join(", ")}`);
  if (r.failed.length) parts.push(`Failed: ${r.failed.map((f) => `${csCh(f.channel).name} (${f.error})`).join(", ")}`);
  toast(parts.join(" · ") || r.skipped.map((s) => s.reason).join(" · ") || "Nothing to publish", !!r.failed.length);
}
async function cpRefreshDrawer() { const id = CS.draft.id; await csLoad(); csRerender(); await csOpen(id, CS.chTab); }
