// Marketing Wizard: hosted app entry point (Hostinger runs this file).
// Env: DASHBOARD_PASSWORD (required to log in), ANTHROPIC_API_KEY (required to generate),
//      MWIZ_MODEL (default claude-opus-5-5), MWIZ_EFFORT (default high), DATA_DIR, PORT.
import os from "node:os";
import path from "node:path";
import { createApp } from "./lib/app.js";
import { claudeProvider, demoProvider } from "./lib/engine.js";
import { Store } from "./lib/store.js";

const password = process.env.DASHBOARD_PASSWORD || process.env.MWIZ_PASSWORD || "";
const store = new Store(process.env.DATA_DIR || path.join(os.homedir(), "marketing-wizard-data"));
const provider = process.env.ANTHROPIC_API_KEY
  ? claudeProvider({ model: process.env.MWIZ_MODEL || "claude-opus-5-5", effort: process.env.MWIZ_EFFORT || "high" })
  : demoProvider();
const port = process.env.PORT || 3000;

createApp({ store, provider, password }).listen(port, () =>
  console.log(`Marketing Wizard listening on ${port} (provider ${provider.name}, login ${password ? "on" : "NOT SET"})`));
