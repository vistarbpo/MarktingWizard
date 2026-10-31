// Marketing Wizard hosted dashboard.
// Env: ANTHROPIC_API_KEY (required to generate), DASHBOARD_PASSWORD (required to log in),
//      MWIZ_MODEL (default claude-opus-5-5), MWIZ_EFFORT (default high), DATA_DIR, PORT.
import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BRIEF, PLAYBOOKS } from "./playbooks.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const PASSWORD = process.env.DASHBOARD_PASSWORD || "";
const MODEL = process.env.MWIZ_MODEL || "claude-opus-5-5";
const EFFORT = process.env.MWIZ_EFFORT || "high";
const DATA_DIR = process.env.DATA_DIR || path.join(os.homedir(), "marketing-wizard-data");
const DB_FILE = path.join(DATA_DIR, "assets.json");
// Session cookies are signed with a key derived from the password, so changing the password logs everyone out.
const SECRET = crypto.createHash("sha256").update("mwiz:" + PASSWORD).digest();
const client = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;

fs.mkdirSync(DATA_DIR, { recursive: true });
const loadAssets = () => { try { return JSON.parse(fs.readFileSync(DB_FILE, "utf8")); } catch { return []; } };
const saveAssets = (list) => { fs.writeFileSync(DB_FILE + ".tmp", JSON.stringify(list, null, 1)); fs.renameSync(DB_FILE + ".tmp", DB_FILE); };

const sign = (v) => v + "." + crypto.createHmac("sha256", SECRET).update(v).digest("base64url");
function validSession(req) {
  const m = /(?:^|;\s*)mwiz=([^;]+)/.exec(req.headers.cookie || "");
  if (!m || !PASSWORD) return false;
  const [v, mac] = [m[1].slice(0, m[1].lastIndexOf(".")), m[1]];
  const expected = sign(v);
  if (expected.length !== mac.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(mac))) return false;
  return Number(v) > Date.now();
}

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "200kb" }));
app.use(express.urlencoded({ extended: false }));

// Simple brute-force brake on the login form.
const attempts = new Map();
app.post("/login", (req, res) => {
  const ip = req.ip;
  const a = attempts.get(ip) || { n: 0, t: Date.now() };
  if (Date.now() - a.t > 15 * 60e3) { a.n = 0; a.t = Date.now(); }
  if (a.n >= 10) return res.redirect("/login?e=locked");
  const given = String(req.body.password || "");
  const ok = PASSWORD && given.length === PASSWORD.length &&
    crypto.timingSafeEqual(Buffer.from(given), Buffer.from(PASSWORD));
  if (!ok) { a.n++; attempts.set(ip, a); return res.redirect("/login?e=" + (PASSWORD ? "bad" : "unset")); }
  attempts.delete(ip);
  const expires = Date.now() + 30 * 864e5;
  res.setHeader("Set-Cookie", `mwiz=${sign(String(expires))}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${30 * 86400}`);
  res.redirect("/");
});
app.post("/logout", (req, res) => {
  res.setHeader("Set-Cookie", "mwiz=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0");
  res.redirect("/login");
});
app.get("/login", (req, res) => res.sendFile(path.join(__dirname, "public", "login.html")));
app.get("/healthz", (req, res) => res.json({ ok: true }));

// Everything below needs a session.
app.use((req, res, next) => {
  if (validSession(req)) return next();
  if (req.path.startsWith("/api/")) return res.status(401).json({ error: "Please log in again." });
  res.redirect("/login");
});

app.get("/api/config", (req, res) => res.json({
  brief: BRIEF, model: MODEL, aiReady: !!client,
  playbooks: PLAYBOOKS.map(({ task, ...p }) => p),
}));
app.get("/api/assets", (req, res) => res.json(loadAssets()));
app.delete("/api/assets/:id", (req, res) => {
  saveAssets(loadAssets().filter((a) => a.id !== req.params.id));
  res.json({ ok: true });
});

function buildPrompt(pb, inputs, assets) {
  let task = pb.task;
  for (const [name] of pb.inputs) task = task.replaceAll(`{${name}}`, String(inputs[name] ?? "").slice(0, 500));
  const memory = (pb.ctx || [])
    .map((k) => assets.find((a) => a.playbook === k))
    .filter(Boolean)
    .map((a) => `### Earlier work: ${a.title}\n${a.text}`)
    .join("\n\n");
  return `## Brand brief\n${Object.entries(BRIEF).map(([k, v]) => `- ${k}: ${v}`).join("\n")}\n\n` +
    (memory ? `## Earlier strategy work\n${memory}\n\n` : "") +
    `## Task: ${pb.title}\n${task}\n\nWrite the answer in Markdown with clear ## headings, bullet lists and tables where useful. Start directly with the content, no preamble.`;
}

const SYSTEM = "You are a senior SaaS marketing strategist writing for the brand in the brief. " +
  "Stay consistent with any earlier strategy work provided. Be specific and concrete, and match the brand voice. " +
  "Never invent customers, statistics, testimonials or awards; where proof is needed write placeholders like [ADD CUSTOMER METRIC]. " +
  "Mark any competitor fact you are unsure of with (verify).";

// Streams plain text back to the browser, then saves the finished asset.
app.post("/api/run/:key", async (req, res) => {
  const pb = PLAYBOOKS.find((p) => p.key === req.params.key);
  if (!pb) return res.status(404).json({ error: "Unknown playbook." });
  if (!client) return res.status(503).json({ error: "ANTHROPIC_API_KEY is not set on the server." });
  const inputs = req.body?.inputs || {};
  const assets = loadAssets();
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("X-Accel-Buffering", "no");
  const ac = new AbortController();
  res.on("close", () => { if (!res.writableFinished) ac.abort(); });
  try {
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 64000,
      thinking: { type: "adaptive" },
      output_config: { effort: EFFORT },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM,
      messages: [{ role: "user", content: buildPrompt(pb, inputs, assets) }],
    }, { signal: ac.signal });
    stream.on("text", (delta) => res.write(delta));
    const msg = await stream.finalMessage();
    if (msg.stop_reason === "refusal") {
      res.write("\n\n[[MWIZ_ERROR]]Claude declined this request. Try rewording the inputs.");
      return res.end();
    }
    const text = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    const asset = { id: crypto.randomUUID(), playbook: pb.key, title: pb.title, inputs, text, createdAt: Date.now() };
    saveAssets([asset, ...loadAssets()].slice(0, 500));
    res.write("\n\n[[MWIZ_SAVED]]" + asset.id);
    res.end();
  } catch (e) {
    if (ac.signal.aborted) return;
    let msg = "Something went wrong reaching Claude. Try again in a moment.";
    if (e instanceof Anthropic.AuthenticationError) msg = "The server's Anthropic API key was rejected. Check ANTHROPIC_API_KEY in hPanel.";
    else if (e instanceof Anthropic.RateLimitError) msg = "Rate limited by the Anthropic API. Wait a minute and try again.";
    else if (e instanceof Anthropic.BadRequestError) msg = "The Anthropic API rejected the request: " + e.message;
    console.error("generate failed:", e?.status, e?.message);
    if (!res.headersSent) res.status(502);
    res.write("\n\n[[MWIZ_ERROR]]" + msg);
    res.end();
  }
});

app.use(express.static(path.join(__dirname, "public"), { index: "index.html" }));
app.listen(PORT, () => console.log(`Marketing Wizard listening on ${PORT} (model ${MODEL}, AI ${client ? "on" : "off"})`));
