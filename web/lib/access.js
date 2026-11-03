// Teams & roles: people sign in with their own email and password; a role sets None / View / Edit
// per module, enforced on every API call (the menu only hides what the server already refuses).
// The original team password still signs in as the Owner, so existing access keeps working.
import crypto from "node:crypto";

export const MODULES = [
  { id: "command", name: "Command Center" },
  { id: "okr", name: "Goals & review (OKRs, weekly business review)" },
  { id: "sop", name: "SOP" },
  { id: "marketing", name: "Marketing (Brief, Knowledge, KPIs, Playbooks, Library)" },
  { id: "sales", name: "Sales pipeline" },
  { id: "product", name: "Product" },
  { id: "crm", name: "Store CRM & outreach" },
  { id: "creative", name: "Creative Studio" },
  { id: "ads", name: "Paid Ads" },
  { id: "intel", name: "Market intel (competitors, signals, win/loss, sizing, weekly brief)" },
  { id: "workforce", name: "AI Workforce (agents, levels, budgets)" },
  { id: "support", name: "AI Support" },
  { id: "results", name: "ROAS results" },
  { id: "finance", name: "Finance" },
  { id: "billing", name: "Billing & customers" },
  { id: "success", name: "Customer success (health, churn alerts, renewals, NPS)" },
  { id: "ops", name: "Operations" },
  { id: "team", name: "Team & hiring, attendance and leave" },
  { id: "payroll", name: "Payroll & salaries" },
  { id: "admin", name: "Teams & roles (people, access)" },
  { id: "compliance", name: "Security & compliance (backups, PDPL, status page)" },
];
export const MODULE_IDS = MODULES.map((m) => m.id);
export const LEVELS = ["none", "view", "edit"];
const rank = { none: 0, view: 1, edit: 2 };

const all = (lvl) => Object.fromEntries(MODULE_IDS.map((m) => [m, lvl]));
export const DEFAULT_ROLES = [
  { id: "owner", name: "Owner", locked: true, description: "Everything, including people, roles and billing decisions.", perms: all("edit") },
  { id: "admin", name: "Admin", description: "Runs the dashboard day to day and manages people.", perms: all("edit") },
  { id: "manager", name: "Team lead", description: "Edits all work modules; sees Finance; no access settings.", perms: { ...all("edit"), finance: "view", admin: "none", workforce: "view", payroll: "none", compliance: "view", billing: "view" } },
  { id: "member", name: "Team member", description: "Edits marketing, sales, support, product and operations work; no Finance.", perms: { ...all("edit"), command: "view", sop: "edit", team: "view", finance: "none", admin: "none", workforce: "view", payroll: "none", compliance: "none", billing: "none", ads: "view" } },
  { id: "finance", name: "Finance", description: "Bookkeeper or accountant: Finance only, plus the overview.", perms: { ...all("none"), command: "view", sop: "view", finance: "edit", ops: "view", payroll: "edit", billing: "edit", ads: "view", success: "view", okr: "view" } },
  { id: "creative", name: "Creative", description: "Content team: Creative Studio; reads Knowledge, CRM and ROAS results; no Finance.", perms: { ...all("none"), command: "view", sop: "view", creative: "edit", marketing: "view", results: "view", crm: "view", workforce: "view", ads: "view", intel: "view", okr: "view" } },
  { id: "viewer", name: "Viewer", description: "Investor or adviser: can look, can't change anything; no Finance detail.", perms: { ...all("view"), finance: "none", admin: "none", payroll: "none" } },
];

export const STARTER_TEAMS = [
  { name: "Leadership", modules: ["command", "sop", "finance", "billing", "team", "admin"], description: "Strategy, money, people and the SOP." },
  { name: "Growth & Sales", modules: ["marketing", "sales", "results"], description: "Marketing, the pipeline and proving ROAS." },
  { name: "Customer Success", modules: ["support", "success", "results"], description: "AI Support escalations, onboarding and case studies." },
  { name: "Product & Engineering", modules: ["product", "ops"], description: "Roadmap, releases, incidents and the tool stack." },
];

// ---- passwords
export function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString("base64url");
  return { salt, hash: crypto.scryptSync(String(pw), salt, 32).toString("base64url") };
}
export function checkPassword(pw, user) {
  if (!user?.hash || !user?.salt) return false;
  const h = crypto.scryptSync(String(pw), user.salt, 32);
  const want = Buffer.from(user.hash, "base64url");
  return h.length === want.length && crypto.timingSafeEqual(h, want);
}

export const levelOk = (have, need) => rank[have || "none"] >= rank[need];

// Which module an API call belongs to. null = any signed-in person may call it.
export function moduleFor(method, path) {
  const p = path.split("?")[0].split("/").filter(Boolean); // ["api", ...]
  if (p[0] !== "api") return null;
  if (p[1] === "admin") return "admin";
  if (p[1] === "me") return null;
  if (p[1] === "workforce") return "workforce";
  if (p[1] === "compliance") return "compliance";
  if (p[1] !== "workspaces") return null; // meta endpoints, playbook list, health
  if (p.length === 2) return method === "GET" ? null : "admin"; // list / create workspaces
  const seg = p[3];
  if (seg === undefined) return method === "GET" ? null : method === "DELETE" ? "admin" : "marketing"; // read / edit brief / delete
  return ({ notes: "marketing", kpis: "marketing", gaps: "marketing", assets: "marketing", run: "marketing", export: "marketing",
    deals: "sales", product: "product", support: "support", roas: "results", finance: "finance", ops: "ops", hr: "team", people: "team", payroll: "payroll", billing: "billing", success: "success", customers: "support",
    sop: "sop", command: "command", crm: "crm", creative: "creative", ads: "ads", intel: "intel", okr: "okr", "sample-data": "admin" })[seg] || "admin";
}

// One short line for the activity log.
export function describe(method, path) {
  const p = path.split("?")[0].split("/").filter(Boolean).slice(3);
  const verb = { POST: "added", PUT: "changed", DELETE: "deleted" }[method] || method;
  return `${verb} ${p.filter((x) => !/^\d+$/.test(x)).join(" ").replace(/-/g, " ") || "workspace"}`.slice(0, 120);
}
