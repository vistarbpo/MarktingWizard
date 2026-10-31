const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
function md(text) {
  const html = window.marked ? marked.parse(text) : "<pre>" + esc(text) + "</pre>";
  const clean = window.DOMPurify ? DOMPurify.sanitize(html) : esc(text);
  const box = document.createElement("div"); box.innerHTML = clean;
  box.querySelectorAll("table").forEach((t) => { const w = document.createElement("div"); w.className = "tw"; t.replaceWith(w); w.appendChild(t); });
  return box.innerHTML;
}
const api = async (url, opts) => {
  const r = await fetch(url, opts);
  if (r.status === 401) { location.href = "/login"; throw new Error("auth"); }
  return r;
};

let CFG = { playbooks: [], brief: {}, aiReady: false }, assets = [];

function show(view) {
  ["playbooks", "pricing", "brief", "asset"].forEach((v) => ($("#v-" + v).hidden = v !== view));
  document.querySelectorAll(".nav button").forEach((b) => b.dataset.view === view ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current"));
  window.scrollTo(0, 0);
}
document.querySelectorAll(".nav button").forEach((b) => (b.onclick = () => show(b.dataset.view)));

const latest = (key) => assets.find((a) => a.playbook === key);

function renderGrid() {
  $("#pbGrid").innerHTML = CFG.playbooks.map((p) => `<div class="card"><span class="cat">${esc(p.cat)}</span><h3>${esc(p.title)}</h3><p>${esc(p.desc)}</p>
    <div class="row"><button class="btn" data-run="${p.key}">Generate</button>${latest(p.key) ? '<span class="done">✓ saved</span>' : ""}</div></div>`).join("");
  document.querySelectorAll("[data-run]").forEach((b) => (b.onclick = () => openRun(b.dataset.run)));
}
function renderHistory() {
  const h = $("#hist");
  if (!assets.length) { h.innerHTML = '<span class="msg">Nothing generated yet. Pick a playbook to start.</span>'; return; }
  h.innerHTML = assets.map((a, i) => `<button data-i="${i}">${esc(a.title)}<small>${new Date(a.createdAt).toLocaleString()}</small></button>`).join("");
  h.querySelectorAll("button").forEach((b) => (b.onclick = () => openAsset(assets[+b.dataset.i])));
}
async function loadAssets() {
  try { assets = await (await api("/api/assets")).json(); } catch { assets = []; }
  renderHistory(); renderGrid();
}

function openAsset(a) {
  $("#assetTitle").textContent = a.title;
  $("#assetMeta").textContent = new Date(a.createdAt).toLocaleString();
  $("#assetBody").innerHTML = md(a.text);
  $("#copyBtn").onclick = async () => {
    try { await navigator.clipboard.writeText(a.text); $("#copyBtn").textContent = "Copied"; }
    catch { const r = document.createRange(); r.selectNodeContents($("#assetBody")); const s = getSelection(); s.removeAllRanges(); s.addRange(r); $("#copyBtn").textContent = "Text selected"; }
    setTimeout(() => ($("#copyBtn").textContent = "Copy text"), 1500);
  };
  const del = $("#delBtn"); del.textContent = "Delete";
  del.onclick = async () => {
    if (del.textContent === "Delete") { del.textContent = "Click again to delete"; return; }
    await api("/api/assets/" + a.id, { method: "DELETE" });
    await loadAssets(); show("playbooks");
  };
  show("asset");
}

let ctl = null;
function openRun(key) {
  const p = CFG.playbooks.find((x) => x.key === key);
  const panel = $("#runPanel"); panel.hidden = false;
  const ctxNames = (p.ctx || []).map((k) => CFG.playbooks.find((x) => x.key === k).title);
  panel.innerHTML = `<h2>${esc(p.title)}</h2>
    <p class="msg">${ctxNames.length ? "Uses your latest " + ctxNames.map(esc).join(" and ") + " if you've generated them." : "Uses the DAP ADS brand brief."}</p>
    ${p.inputs.length ? `<div class="fields">${p.inputs.map(([n, l, d]) => `<label class="f" for="in-${n}">${esc(l)}<input id="in-${n}" value="${esc(d)}"></label>`).join("")}</div>` : ""}
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px"><button class="btn primary" id="goBtn">Generate</button><button class="btn" id="stopBtn" hidden>Stop</button></div>
    <p class="msg" id="runMsg"></p><article class="doc" id="live"></article>`;
  $("#goBtn").onclick = () => run(p);
  $("#stopBtn").onclick = () => ctl?.abort();
  if (!CFG.aiReady) { $("#goBtn").disabled = true; $("#runMsg").textContent = "Generating is off: add ANTHROPIC_API_KEY to the app's environment variables in hPanel."; }
  panel.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function run(p) {
  const inputs = {}; p.inputs.forEach(([n]) => (inputs[n] = $("#in-" + n).value.trim()));
  const go = $("#goBtn"), stop = $("#stopBtn"), msg = $("#runMsg"), live = $("#live");
  go.disabled = true; stop.hidden = false; msg.className = "msg"; msg.textContent = "Thinking… this can take a minute or two."; live.innerHTML = "";
  ctl = new AbortController();
  let text = "";
  try {
    const r = await api("/api/run/" + p.key, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ inputs }), signal: ctl.signal });
    if (!r.body) throw new Error("no body");
    const reader = r.body.getReader(), dec = new TextDecoder();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      text += dec.decode(value, { stream: true });
      const shown = text.split("\n\n[[MWIZ_")[0];
      if (shown) { msg.textContent = "Writing…"; live.innerHTML = md(shown); }
    }
    const err = text.split("[[MWIZ_ERROR]]")[1];
    if (err) { msg.className = "msg err"; msg.textContent = err; }
    else if (text.includes("[[MWIZ_SAVED]]")) { msg.textContent = "Saved to History."; await loadAssets(); }
    else if (!r.ok) { msg.className = "msg err"; msg.textContent = text || "The server returned an error."; }
  } catch (e) {
    if (e.message === "auth") return;
    msg.className = "msg err";
    msg.textContent = e.name === "AbortError" ? "Stopped. Nothing was saved." : "Lost the connection to the server. Try again.";
  } finally { go.disabled = !CFG.aiReady; stop.hidden = true; }
}

(async () => {
  try { CFG = await (await api("/api/config")).json(); } catch { return; }
  const el = $("#aiState");
  el.textContent = CFG.aiReady ? "Claude connected" : "Generating off: no API key";
  el.className = "pill " + (CFG.aiReady ? "live" : "off");
  $("#briefList").innerHTML = Object.entries(CFG.brief).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("");
  renderGrid();
  try { $("#pricingDoc").innerHTML = md(await (await api("/pricing.md")).text()); } catch {}
  loadAssets();
})();
