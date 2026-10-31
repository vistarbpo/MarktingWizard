/* ROAS results: does DPA AD's designed catalog creative sell more than plain packshots?
   Import ad-level CSV exports from Meta / Snap / TikTok Ads Manager per store, check the
   template mapping, then see ROAS by template, designed-vs-plain lift with a confidence check,
   per-store results and AI case studies. Uses app.js globals (S, $, api, esc, md, toast, ROUTES). */

const RO = { d: null, parsed: null };
const TYPE_COLOR = { designed: "var(--accent)", video: "#8a7cf0", plain: "var(--text-3)" };
const x2 = (v) => (v == null ? "–" : `${Number(v).toFixed(2)}x`);
const pct = (v, d = 0) => (v == null ? "–" : `${v > 0 ? "+" : ""}${(v * 100).toFixed(d)}%`);
const sarK = (n) => { const a = Math.abs(n || 0); return "SAR " + (a >= 1e6 ? (a / 1e6).toFixed(1) + "M" : a >= 1e4 ? Math.round(a / 1e3) + "k" : Math.round(a).toLocaleString("en-US")); };
const VERDICT_TONE = { "designed wins": "good", "plain wins": "bad", "no clear difference yet": "warn", "too few purchases to be sure": "warn", "not enough data": "" };

ROUTES.results = { title: "ROAS results", crumb: "Customers", render: renderRoas };

async function roLoad() { RO.d = await api(`/api/workspaces/${S.ws.id}/roas`); }

async function renderRoas(view) {
  view.innerHTML = `<p class="muted">Loading…</p>`;
  await roLoad();
  $("#pageActions").innerHTML = `<button class="btn" data-raction="log-kpi" ${RO.d.summary.overall.designed.roas == null ? "disabled" : ""}>Log to KPIs</button><button class="btn btn-primary" data-raction="import">Import ad results</button>`;
  const s = RO.d.summary, o = s.overall;
  view.innerHTML = `
    <section class="s-kpis">
      ${[["Spend tracked", sarK(s.totals.spend), `${s.stores.length} store${s.stores.length === 1 ? "" : "s"} · ${s.rows} ad-days`],
         ["ROAS: designed", x2(o.designed.roas), `${o.designed.purchases} purchases`],
         ["ROAS: plain packshot", x2(o.plain.roas), `${o.plain.purchases} purchases`],
         ["Lift", pct(o.roas_lift), "designed vs plain ROAS", o.roas_lift > 0 ? "" : o.roas_lift < 0 ? "bad" : ""],
         ["Confidence", o.test ? (o.test.p < 0.05 ? "High" : "Low") : "–", o.test ? `${o.test.p < 0.001 ? "p < 0.001" : "p = " + o.test.p} on conversion rate` : "needs both kinds of ads", o.test && o.test.p < 0.05 ? "" : "warn"],
         ["Verdict", esc(o.verdict), o.enough ? "30+ purchases each side" : "aim for 30+ purchases each side", VERDICT_TONE[o.verdict] === "bad" ? "bad" : VERDICT_TONE[o.verdict] === "warn" ? "warn" : ""],
      ].map(([l, v, sub, tone = ""]) => `<div class="card s-kpi ${tone}"><span class="eyebrow">${l}</span><b class="num" style="white-space:normal">${v}</b><span class="subtle">${sub}</span></div>`).join("")}
    </section>
    <div id="rImport" style="margin-top:16px"></div>
    ${s.rows ? `<div class="cc" style="margin-top:16px">
      ${roLiftPanel(o)}
      ${roTemplates(s)}
      ${roTrend(s)}
      ${roStores(s)}
      ${roBatches()}
    </div>` : `<div class="card empty" style="margin-top:16px"><h2>Prove that designed ads sell more</h2>
      <p>For each beta or paying store, export ad results from Meta, Snap or TikTok Ads Manager at <b>ad level</b> (ad name, amount spent, impressions, clicks, purchases, purchase value, by day) and paste the CSV here. Run designed DPA AD creatives next to the store's plain catalog ads so there's something to compare.</p>
      <button class="btn btn-primary" data-raction="import">Import ad results</button></div>`}`;
}

function roLiftPanel(o) {
  const max = Math.max(o.designed.roas || 0, o.plain.roas || 0, 0.01);
  const bar = (label, a, color) => `<div class="r-lift-row"><span>${label}</span><span class="r-bar"><i style="width:${((a.roas || 0) / max) * 100}%;background:${color}"></i></span><b class="num">${x2(a.roas)}</b></div>
    <div class="r-lift-sub subtle s-small num">${sarK(a.spend)} spend · ${sarK(a.revenue)} revenue · CTR ${a.ctr == null ? "–" : (a.ctr * 100).toFixed(2) + "%"} · conv ${a.cvr == null ? "–" : (a.cvr * 100).toFixed(2) + "%"} · CPA ${a.cpa == null ? "–" : sarK(a.cpa)}</div>`;
  return `<section class="card card-pad cc-span-6">
    <div class="row between"><span class="eyebrow">Designed vs plain, all stores</span><span class="badge ${VERDICT_TONE[o.verdict]}">${esc(o.verdict)}</span></div>
    <div class="r-big num">${pct(o.roas_lift)}<span> ROAS from designed creatives</span></div>
    ${bar("Designed + video", o.designed, "var(--accent)")}
    ${bar("Plain packshot", o.plain, "var(--text-3)")}
    <p class="subtle s-small">Confidence comes from comparing conversion rates (purchases per click) with a two-sided test; under p = 0.05 with 30+ purchases on each side, the difference is unlikely to be chance.</p>
  </section>`;
}

function roTemplates(s) {
  const t = s.templates.filter((x) => x.spend > 0).slice(0, 10);
  if (!t.length) return "";
  const max = Math.max(...t.map((x) => x.roas || 0), 0.01);
  return `<section class="card card-pad cc-span-6"><div class="row between"><span class="eyebrow">ROAS by template</span><div class="s-legend" style="margin:0">${Object.entries(TYPE_COLOR).map(([k, c]) => `<span><i class="s-dot" style="background:${c}"></i>${k}</span>`).join("")}</div></div>
    <div class="r-tpl">${t.map((x) => `<div class="r-tpl-row"><span class="r-tpl-name" title="${esc(x.template)}">${esc(x.template)}</span>
      <span class="r-bar"><i style="width:${((x.roas || 0) / max) * 100}%;background:${TYPE_COLOR[x.creative_type]}"></i></span>
      <b class="num">${x2(x.roas)}</b><span class="subtle s-small num">${sarK(x.spend)} · ${x.stores} store${x.stores === 1 ? "" : "s"}</span></div>`).join("")}</div>
    <p class="subtle s-small">Use the winners as defaults for new stores; retire templates that lose to the plain packshot.</p></section>`;
}

function roTrend(s) {
  const w = s.weeks.filter((x) => x.designed != null || x.plain != null);
  if (w.length < 2) return "";
  const W = 900, H = 220, L = 44, R = 16, T = 14, B = 30;
  const max = Math.ceil(Math.max(...w.flatMap((x) => [x.designed || 0, x.plain || 0]), 1));
  const X = (i) => L + (i / (w.length - 1)) * (W - L - R), Y = (v) => T + (H - T - B) * (1 - v / max);
  let svg = "";
  for (let v = 0; v <= max; v += Math.max(1, Math.round(max / 4))) svg += `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--border)"></line><text class="s-svg-mono" x="${L - 8}" y="${Y(v) + 4}" text-anchor="end">${v}x</text>`;
  w.forEach((x, i) => { svg += `<text class="s-svg-mono" x="${X(i)}" y="${H - 8}" text-anchor="middle">${x.week.slice(5)}</text>`; });
  for (const [k, c] of [["plain", "var(--text-3)"], ["designed", "var(--accent)"]]) {
    const pts = w.map((x, i) => (x[k] == null ? null : `${X(i)},${Y(x[k])}`)).filter(Boolean);
    if (pts.length > 1) svg += `<polyline points="${pts.join(" ")}" fill="none" stroke="${c}" stroke-width="2.5"></polyline>`;
    w.forEach((x, i) => { if (x[k] != null) svg += `<circle cx="${X(i)}" cy="${Y(x[k])}" r="3" fill="${c}"><title>${x.week} ${k} ${x2(x[k])}</title></circle>`; });
  }
  return `<section class="card card-pad cc-span-12"><div class="row between"><span class="eyebrow">Weekly ROAS</span><div class="s-legend" style="margin:0"><span><i class="s-dot" style="background:var(--accent)"></i>Designed + video</span><span><i class="s-dot" style="background:var(--text-3)"></i>Plain packshot</span></div></div>
    <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block;margin-top:8px" role="img" aria-label="Weekly ROAS, designed vs plain">${svg}</svg></section>`;
}

function roStores(s) {
  return `<section class="card cc-span-12"><div class="card-head" style="padding:14px 20px"><h3>Results by store</h3></div>
    <div class="table-wrap"><table class="f-table"><thead><tr><th>Store</th><th>Channels</th><th class="num">Designed ROAS</th><th class="num">Plain ROAS</th><th class="num">Lift</th><th>Verdict</th><th class="num">Spend</th><th></th></tr></thead><tbody>
    ${s.stores.map((x) => `<tr><td><b>${esc(x.store)}</b></td><td class="s-small">${x.channels.map(esc).join(", ")}</td><td class="num">${x2(x.designed.roas)}</td><td class="num">${x2(x.plain.roas)}</td>
      <td class="num" style="color:${x.roas_lift > 0 ? "var(--good)" : x.roas_lift < 0 ? "var(--bad)" : "inherit"}"><b>${pct(x.roas_lift)}</b></td>
      <td><span class="badge ${VERDICT_TONE[x.verdict]}">${esc(x.verdict)}</span></td><td class="num">${sarK(x.designed.spend + x.plain.spend)}</td>
      <td><button class="btn btn-sm" data-rcase="${esc(x.store)}">AI: case study</button></td></tr>`).join("")}
    </tbody></table></div>
    <div id="rCase" class="s-draft" style="padding:0 20px 20px" hidden></div></section>`;
}

function roBatches() {
  const b = RO.d.batches;
  return `<section class="card card-pad cc-span-12"><span class="eyebrow">Imports</span>
    <ul class="s-timeline">${b.map((x) => `<li><span class="badge">${esc(x.channel)}</span><span class="s-small" style="flex:1"><b>${esc(x.store)}</b> · ${x.rows} rows · ${x.from} → ${x.to}</span><button class="btn btn-sm btn-ghost btn-danger" data-rdel="${x.id}">Delete import</button></li>`).join("")}</ul></section>`;
}

function roImportForm() {
  const d = RO.d;
  $("#rImport").innerHTML = `<section class="card card-pad stack">
    <div><h2>Import ad results</h2><p class="subtle s-small">Ads Manager → export at <b>ad level</b>, broken down by day, with: Ad name, Amount spent, Impressions, Link clicks (Snap: swipe ups), Purchases, Purchase conversion value. Tip: name ads like <span class="mono">Abaya | [tpl:Ramadan Gold] | video</span> or <span class="mono">… | plain</span> so templates are exact.</p></div>
    <div class="row gap-8" style="flex-wrap:wrap">
      <div class="field"><label for="ri-store">Store</label><select class="input" id="ri-store"><option value="">Choose a store…</option>${d.stores.map((s) => `<option value="${s.id}">${esc(s.name)} (${s.stage})</option>`).join("")}<option value="__other">Another store (type name)</option></select></div>
      <div class="field" id="ri-other-wrap" hidden><label for="ri-other">Store name</label><input class="input" id="ri-other"></div>
      <div class="field"><label for="ri-ch">Channel</label><select class="input" id="ri-ch"><option value="">Detect from columns</option>${d.channels.map((c) => `<option>${c}</option>`).join("")}</select></div>
      <div class="field"><label for="ri-cur">Currency in the file</label><select class="input" id="ri-cur"><option>SAR</option><option>USD</option></select></div>
    </div>
    <textarea class="input mono" id="ri-csv" rows="6" placeholder="Paste the CSV here (with its header row)"></textarea>
    <div class="row gap-8"><button class="btn" data-raction="parse">Read the file</button><button class="btn btn-ghost" data-raction="close-import">Cancel</button><span class="subtle s-small" id="ri-msg"></span></div>
    <div id="ri-preview"></div>
  </section>`;
}

function roPreview() {
  const p = RO.parsed;
  $("#ri-preview").innerHTML = `<p class="s-small"><b>${p.rows.length}</b> ad-days from <b>${p.ads.length}</b> ads · channel <b>${esc(p.channel)}</b>. Check each ad's template and type, then save.</p>
    <div class="table-wrap"><table class="f-table"><thead><tr><th>Ad</th><th>Template</th><th>Type</th><th class="num">Spend</th><th class="num">Revenue</th><th class="num">ROAS</th></tr></thead><tbody>
    ${p.ads.map((a, i) => `<tr><td class="s-small">${esc(a.ad_name)}</td><td><input class="input input-sm" data-rtpl="${i}" value="${esc(a.template)}"></td>
      <td><select class="input input-sm" data-rtype="${i}">${RO.d.types.map((t) => `<option ${t === a.creative_type ? "selected" : ""}>${t}</option>`).join("")}</select></td>
      <td class="num">${sarK(a.spend_sar)}</td><td class="num">${sarK(a.revenue_sar)}</td><td class="num">${a.spend_sar ? x2(a.revenue_sar / a.spend_sar) : "–"}</td></tr>`).join("")}
    </tbody></table></div>
    <div class="row gap-8" style="margin-top:10px"><button class="btn btn-primary" data-raction="save">Save results</button></div>`;
}

document.addEventListener("click", async (e) => {
  if (S.route !== "results") return;
  const t = e.target, base = `/api/workspaces/${S.ws.id}/roas`;
  try {
    const del = t.closest("[data-rdel]");
    if (del) { if (del.dataset.confirm !== "1") { del.dataset.confirm = "1"; del.textContent = "Click again"; return; } await api(`${base}/batches/${del.dataset.rdel}`, { method: "DELETE" }); toast("Import deleted"); return renderRoas($("#view")); }
    const cs = t.closest("[data-rcase]");
    if (cs) {
      const box = $("#rCase"); box.hidden = false; box.innerHTML = `<p class="subtle s-small">AI is writing the case study…</p>`;
      const res = await fetch(`${base}/case-study`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ store: cs.dataset.rcase }) });
      if (!res.ok) { let m = res.statusText; try { m = (await res.json()).detail; } catch {} throw new Error(m); }
      const reader = res.body.getReader(), dec = new TextDecoder(); let text = "";
      for (;;) { const { done, value } = await reader.read(); if (done) break; text += dec.decode(value, { stream: true }); box.innerHTML = `<div class="doc s-draft-body">${md(text.split("\n\n[[MWIZ_")[0])}</div>`; }
      const err = text.split("[[MWIZ_ERROR]]")[1]; if (err !== undefined) throw new Error(err.trim());
      box.insertAdjacentHTML("beforeend", `<p class="subtle s-small">Saved to Knowledge → results, so Sales and Marketing AI can use it. Add a real quote from the store owner before publishing.</p>`);
      return;
    }
    const a = t.closest("[data-raction]"); if (!a) return;
    const act = a.dataset.raction;
    if (act === "import") { roImportForm(); $("#ri-store").focus(); return; }
    if (act === "close-import") { $("#rImport").innerHTML = ""; RO.parsed = null; return; }
    if (act === "parse") {
      const r = await api(`${base}/parse`, { method: "POST", body: JSON.stringify({ text: $("#ri-csv").value, currency: $("#ri-cur").value, channel: $("#ri-ch").value }) });
      RO.parsed = r; if (!$("#ri-ch").value) $("#ri-ch").value = r.channel; $("#ri-msg").textContent = ""; roPreview(); return;
    }
    if (act === "save") {
      const sel = $("#ri-store").value, other = sel === "__other" ? $("#ri-other").value.trim() : "";
      if (!sel || (sel === "__other" && !other)) return toast("Pick the store these results belong to", true);
      const mapping = Object.fromEntries(RO.parsed.ads.map((ad, i) => [ad.ad_name, { template: $(`[data-rtpl="${i}"]`).value, creative_type: $(`[data-rtype="${i}"]`).value }]));
      const r = await api(`${base}/import`, { method: "POST", body: JSON.stringify({ deal_id: sel !== "__other" ? sel : null, store: other, channel: $("#ri-ch").value || RO.parsed.channel, rows: RO.parsed.rows, mapping }) });
      RO.parsed = null; toast(`Imported ${r.rows} rows`); return renderRoas($("#view"));
    }
    if (act === "log-kpi") { const r = await api(`${base}/log-kpi`, { method: "POST", body: "{}" }); return toast(`Logged ${r.kpi} ${r.value}x for ${r.period}`); }
  } catch (err) { toast(err.message || "Something went wrong", true); }
});
document.addEventListener("change", (e) => { if (e.target.id === "ri-store") $("#ri-other-wrap").hidden = e.target.value !== "__other"; });

if (S.route === "results" && S.ws) render();
