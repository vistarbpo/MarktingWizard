// "Ask DPA AD": one assistant across the dashboard. Claude answers with tools that call the dashboard's own
// API using the signed-in person's session, so it can only see and change what that person's role allows,
// and every change is in the activity log under their name. Changes wait for a confirmation in the chat
// (low-risk ones run directly when the Coordinator agent is at level 2 in AI Workforce).
import crypto from "node:crypto";
import { costOf } from "./agents.js";

const enc = (o) => encodeURIComponent(JSON.stringify(o));
const W = (ctx) => `/api/workspaces/${ctx.ws}`;
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o?.[k] !== undefined && o[k] !== null && o[k] !== "").map((k) => [k, o[k]]));
const storeFilter = (i) => pick(i, ["q", "category", "city", "stage", "platform", "tags", "owner_id", "min_products", "max_products", "has_email", "has_whatsapp", "quiet_days", "min_score"]);
const arr = { type: "array", items: { type: "string" } };
const FILTER_PROPS = {
  q: { type: "string", description: "Text search in store name, link, email, phone" },
  category: { ...arr, description: "Categories, e.g. [\"Perfumes & oud\"]. Categories: Fashion & abayas, Perfumes & oud, Beauty & cosmetics, Electronics & accessories, Home & furniture, Food & sweets, Coffee & dates, Kids & toys, Gifts & flowers, Health & supplements, Sports, Jewelry & watches, Books & stationery, Other" },
  city: { ...arr, description: "Cities, e.g. [\"Riyadh\"]" },
  stage: { ...arr, description: "Stages: new, contacted, engaged (replied), qualified, onboarding, active, churned, not_now, do_not_contact" },
  platform: { ...arr, description: "Platforms, e.g. [\"Salla\",\"Zid\",\"Shopify\"]" },
  tags: { ...arr, description: "Tags, e.g. [\"icp\",\"running-ads\"]" },
  min_products: { type: "number" }, max_products: { type: "number" },
  has_email: { type: "boolean" }, has_whatsapp: { type: "boolean" },
  quiet_days: { type: "number", description: "Not contacted in this many days" },
};

// Each tool: what Claude sees, the module it needs, whether it changes data, and how it runs.
export const TOOLS = [
  { name: "get_overview", module: "command", description: "The founder overview: path to ARR goal, what needs a person today, growth funnel, runway, outreach, pipeline, support, content, AI workforce.",
    input_schema: { type: "object", properties: {} },
    run: async (ctx) => { const d = await ctx.call("GET", `${W(ctx)}/command`); return d.error ? d : pick(d, ["goal", "revenue", "close", "outreach", "creative", "workforce", "finance", "support", "ops", "product", "roas", "needs", "sop", "data_completeness"]); } },
  { name: "find_stores", module: "crm", description: "Search the Store CRM database with filters. Returns the total and up to `limit` stores (best fit first unless sorted).",
    input_schema: { type: "object", properties: { ...FILTER_PROPS, sort: { type: "string", enum: ["score", "products", "recent", "name"] }, limit: { type: "number", description: "Max stores to list, 1-50 (default 10)" } } },
    run: async (ctx, i) => { const d = await ctx.call("GET", `${W(ctx)}/crm/contacts?f=${enc(storeFilter(i))}&sort=${i.sort || "score"}&size=${Math.max(1, Math.min(50, i.limit || 10))}`); return d.error ? d : { total: d.total, of_all: d.all, stores: d.rows.map((c) => pick(c, ["id", "store_name", "domain", "category", "city", "platform", "products", "score", "stage", "tags", "owner_name", "email", "phone", "last_contacted_at", "last_reply_at"])) }; } },
  { name: "get_store", module: "crm", description: "One store's full record: details, stage, campaigns, recent messages and notes.",
    input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    run: async (ctx, i) => { const d = await ctx.call("GET", `${W(ctx)}/crm/contacts/${encodeURIComponent(i.id)}`); return d.error ? d : { contact: (({ unsub_token, ...c }) => c)(d.contact), messages: d.messages.slice(-10).map((m) => pick(m, ["at", "direction", "channel", "status", "subject", "body", "intent", "summary"])), notes: d.notes.slice(-10), enrollments: d.enrollments, deal: d.deal }; } },
  { name: "outreach_overview", module: "crm", description: "Store CRM numbers: stores by stage and category, reachability, this week's sends and replies, reply rate, inbox, calls, funnel targets.",
    input_schema: { type: "object", properties: {} },
    run: async (ctx) => { const d = await ctx.call("GET", `${W(ctx)}/crm/overview`); return d.error ? d : pick(d, ["total", "by_stage", "categories", "platforms", "reachable", "week", "inbox", "calls", "campaigns", "mode", "rates"]); } },
  { name: "list_campaigns", module: "crm", description: "Store CRM campaigns with status, audience size and results.",
    input_schema: { type: "object", properties: {} },
    run: async (ctx) => { const d = await ctx.call("GET", `${W(ctx)}/crm/campaigns`); return d.error ? d : d.map((c) => ({ ...pick(c, ["id", "name", "type", "status", "audience", "daily_limit"]), steps: c.steps.length, stats: pick(c.stats, ["enrolled", "active", "sent", "test", "replied", "reply_rate", "eta_days"]) })); } },
  { name: "list_deals", module: "sales", description: "Sales pipeline deals with stage, plan and next step, plus the pipeline summary.",
    input_schema: { type: "object", properties: { stage: { type: "string", description: "Optional: lead, contacted, demo, beta, trial, paying, lost" } } },
    run: async (ctx, i) => { const d = await ctx.call("GET", `${W(ctx)}/deals`); return d.error ? d : { summary: pick(d.summary, ["paying_mrr", "paying_count", "expected_mrr", "open_count", "open_value", "close"]), deals: d.deals.filter((x) => !i.stage || x.stage === i.stage).slice(0, 40).map((x) => ({ ...pick(x, ["id", "name", "stage", "plan", "plan_usd", "skus", "city", "platform", "days_quiet"]), next: x.next?.text })) }; } },
  { name: "finance_snapshot", module: "finance", description: "Cash, burn, runway, MRR, gross margin, unit economics (CAC, LTV), VAT position, finance to-dos.",
    input_schema: { type: "object", properties: {} },
    run: async (ctx) => { const d = await ctx.call("GET", `${W(ctx)}/finance`); return d.error ? d : pick(d.snapshot, ["cash", "revenue", "costs", "runway_months", "gross_margin", "unit", "vat", "needs"]); } },
  { name: "list_content", module: "creative", description: "Creative Studio content items (title, status, date, channels, checks), optionally filtered by status or date range.",
    input_schema: { type: "object", properties: { status: { type: "string", description: "idea, draft, review, approved, scheduled, published, archived" }, from: { type: "string", description: "YYYY-MM-DD" }, to: { type: "string", description: "YYYY-MM-DD" } } },
    run: async (ctx, i) => { const d = await ctx.call("GET", `${W(ctx)}/creative/items`); return d.error ? d : { counts: d.counts, post_today: d.post_today.length, items: d.items.filter((x) => (!i.status || x.status === i.status) && (!i.from || (x.date || "") >= i.from) && (!i.to || (x.date || "9") <= i.to)).slice(0, 40).map((x) => ({ ...pick(x, ["id", "title", "status", "date", "pillar", "channels", "season"]), problems: x.checks.filter((c) => c.level === "bad").length })) }; } },
  { name: "workforce_status", module: "workforce", description: "AI Workforce: every AI agent with its level, person responsible, monthly cost and budget, quality, and what needs attention.",
    input_schema: { type: "object", properties: {} },
    run: async (ctx) => { const d = await ctx.call("GET", "/api/workforce"); return d.error ? d : { totals: d.totals, needs: d.needs.filter((n) => !n.soft), agents: d.agents.map((a) => ({ id: a.id, name: a.name, team: a.team, level: a.config.level, paused: a.config.paused, cost_month: a.stats.cost_month, budget: a.config.budget_usd, quality: a.stats.quality, can_promote: a.stats.can_promote })) }; } },
  { name: "search_knowledge", module: "marketing", description: "Search the company Knowledge notes (results, objections, competitors, pricing, sales learnings).",
    input_schema: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
    run: async (ctx, i) => { const d = await ctx.call("GET", `${W(ctx)}/notes`); if (d.error) return d; const q = String(i.q || "").toLowerCase(); return d.filter((n) => `${n.title} ${n.content} ${n.category}`.toLowerCase().includes(q)).slice(0, 8).map((n) => ({ ...pick(n, ["id", "category", "title"]), content: n.content.slice(0, 1500) })); } },
  { name: "list_okrs", module: "okr", description: "Goals & review: this quarter's objectives (or another quarter, e.g. 2026-Q3) with progress, and each key result's start, target, current value, confidence, owner and days since its last check-in. Metrics the person can't see come back hidden.",
    input_schema: { type: "object", properties: { quarter: { type: "string", description: "YYYY-Qn, default this quarter" } } },
    run: async (ctx, i) => { const d = await ctx.call("GET", `${W(ctx)}/okr/objectives${i.quarter ? `?quarter=${encodeURIComponent(i.quarter)}` : ""}`); return d.error ? d : { quarter: d.quarter, objectives: d.objectives.map((o) => ({ ...pick(o, ["id", "title", "level", "team_name", "status", "progress", "partial", "score", "owner_name"]), key_results: o.krs.map((k) => pick(k, ["id", "title", "kind", "metric_name", "unit", "start", "target", "current", "progress", "confidence", "owner_name", "owner_id", "days_since_checkin", "stale", "hidden"])) })) }; } },
  { name: "list_partners", module: "partners", description: "Partners & referrals: every partner with type, status, referral links and its funnel (clicks, leads, trials, paying customers; MRR referred only for roles with Billing view), plus statements waiting. Optional: status (prospect, talking, signed, active, paused, ended) and type (agency, freelancer, platform, tech, reseller, customer).",
    input_schema: { type: "object", properties: { status: { type: "string" }, type: { type: "string" } } },
    run: async (ctx, i) => { const q = new URLSearchParams(pick(i, ["status", "type"])).toString(); const d = await ctx.call("GET", `${W(ctx)}/partners${q ? "?" + q : ""}`); return d.error ? d : { total: d.partners.length, totals: d.totals, statements: d.statements, partners: d.partners.slice(0, 40).map((p) => ({ ...pick(p, ["id", "name", "type", "status", "city", "contact_name", "stats"]), links: p.codes.map((c) => c.link) })) }; } },
  { name: "list_help_articles", module: "helpcenter", description: "Help center: customer-facing help articles (Arabic and English) with status (draft, in_review, published, archived), category, slug, last review date, whether they are stale (not reviewed in 180 days) and helpful / not helpful votes in the last 30 days. Optional: status (or 'stale'), category, q (search, Arabic or English). Also returns the ticket topics with no published article (gaps).",
    input_schema: { type: "object", properties: { status: { type: "string", enum: ["draft", "in_review", "published", "archived", "stale"] }, category: { type: "string" }, q: { type: "string" } } },
    run: async (ctx, i) => { const q = new URLSearchParams(pick(i, ["status", "category", "q"])).toString(); const d = await ctx.call("GET", `${W(ctx)}/helpcenter/articles${q ? "?" + q : ""}`); if (d.error) return d; const g = await ctx.call("GET", `${W(ctx)}/helpcenter/gaps`);
      return { totals: d.totals, articles: d.articles.slice(0, 40).map((a) => ({ ...pick(a, ["id", "slug", "category", "title_ar", "title_en", "status", "last_reviewed", "author_name", "reviewer_name"]), stale: a.fresh?.stale || false, helpful_30d: a.votes?.yes_30 || 0, not_helpful_30d: a.votes?.no_30 || 0, live: a.live })),
        gaps: (g.gaps || []).map((x) => pick(x, ["category", "name", "tickets", "resolved"])) }; } },
  { name: "list_changelog", module: "product", description: "Changelog (public What's new page): entries with status (draft, in_review, published, archived), type (new, improved, fixed, announcement), tags, date, linked release, whether text still has [ADD], plus totals and the shipped releases and whether each has an entry. Optional: status, type, tag, q (text search).",
    input_schema: { type: "object", properties: { status: { type: "string", enum: ["draft", "in_review", "published", "archived"] }, type: { type: "string", enum: ["new", "improved", "fixed", "announcement"] }, tag: { type: "string" }, q: { type: "string" } } },
    run: async (ctx, i) => { const q = new URLSearchParams(pick(i, ["status", "type", "tag", "q"])).toString(); const d = await ctx.call("GET", `${W(ctx)}/changelog/entries${q ? "?" + q : ""}`); if (d.error) return d;
      return { totals: d.totals, entries: d.entries.slice(0, 40).map((e) => ({ ...pick(e, ["id", "slug", "type", "tags", "date", "title_ar", "title_en", "status", "release_id", "author_name", "reviewer_name", "has_add", "live"]) })), shipped_releases: d.releases.slice(0, 20) }; } },
  { name: "list_documents", module: "legal", description: "Legal & documents: company documents and contracts the person may see (restricted ones only for Owner/Admin), with type, status, parties, issue and expiry dates, auto-renew, notice days and the next deadlines (renewal date, notice deadline, days left). Optional: type (cr, vat_cert, chamber, articles, bank_letter, trademark, licence, india_reg, insurance, nda, customer_contract, partner_agreement, vendor_contract, employment_contract, policy, board_resolution, cap_table, other), status (draft, in_review, signed, active, expired, terminated), state (expiring, expired) and q (text search). Not legal advice.",
    input_schema: { type: "object", properties: { type: { type: "string" }, status: { type: "string" }, state: { type: "string", enum: ["expiring", "expired"] }, q: { type: "string" } } },
    run: async (ctx, i) => { const q = new URLSearchParams(pick(i, ["type", "status", "state", "q"])).toString(); const d = await ctx.call("GET", `${W(ctx)}/legal/documents${q ? "?" + q : ""}`); return d.error ? d : { total: d.documents.length, totals: d.totals, today: d.today, documents: d.documents.slice(0, 40).map((x) => ({ ...pick(x, ["id", "title", "type", "status", "confidentiality", "parties", "issue_date", "expiry_date", "auto_renew", "notice_days", "owner_name", "signatures", "open_obligations"]), renewal_date: x.dates.renewal_date, days_left: x.dates.days_left, notice_deadline: x.dates.notice_deadline, state: x.dates.state })) }; } },
  { name: "list_meetings", module: "meetings", description: "Meetings the person can see (investor and hiring meetings only for Owner/Admin and their attendees), newest first: date and time (Riyadh), type, attendees, whether notes are in and the action-item draft's status. Optional: type (internal, sales_call, customer, partner, investor, hiring) and days (only the last N days).",
    input_schema: { type: "object", properties: { type: { type: "string", enum: ["internal", "sales_call", "customer", "partner", "investor", "hiring"] }, days: { type: "number" } } },
    run: async (ctx, i) => { const q = new URLSearchParams(pick(i, ["type", "days"])).toString(); const d = await ctx.call("GET", `${W(ctx)}/meetings${q ? "?" + q : ""}`); return d.error ? d : { total: d.meetings.length, meetings: d.meetings.slice(0, 30).map((m) => pick(m, ["id", "title", "date", "time", "type", "attendees", "has_notes", "draft_status", "draft_items", "waiting_review"])) }; } },
  { name: "list_market_signals", module: "intel", description: "Market intel signals (competitor moves, platform changes on Meta/Snap/TikTok/Google/Salla/Zid, regulation, customer requests, win/loss reasons, trends) with counts by theme. Optional filters.",
    input_schema: { type: "object", properties: { type: { type: "string", enum: ["competitor_move", "platform_change", "regulation", "customer_request", "win_loss", "trend"] }, tag: { type: "string" }, impact: { type: "string", enum: ["low", "med", "high"] }, days: { type: "number", description: "Only the last N days" } } },
    run: async (ctx, i) => { const q = new URLSearchParams(pick(i, ["type", "tag", "impact", "days"])).toString(); const d = await ctx.call("GET", `${W(ctx)}/intel/signals${q ? "?" + q : ""}`); return d.error ? d : { total: d.total, shown: d.signals.length, themes: { tags: d.themes.tags.slice(0, 15), types: d.themes.types, platforms: d.themes.platforms, impact: d.themes.impact }, signals: d.signals.slice(0, 40).map((s) => pick(s, ["id", "date", "type", "platform", "impact", "tags", "title", "source_url", "module"])) }; } },

  // ---- changes (confirmed by the person in the chat)
  { name: "update_stores", module: "crm", write: true, risk: "high", description: "Change stores in bulk: move to a stage, add or remove a tag, assign an owner (user id), or tag the best-fit N as the focus list ('icp'). Give `ids` or a `filter`.",
    input_schema: { type: "object", properties: { action: { type: "string", enum: ["stage", "tag", "untag", "owner", "icp"] }, value: { type: "string", description: "Stage id, tag, user id, or N for icp" }, ids: arr, filter: { type: "object", properties: FILTER_PROPS } }, required: ["action", "value"] },
    preview: async (ctx, i) => {
      if (i.ids?.length) return `${i.action === "stage" ? `Move ${i.ids.length} store(s) to "${i.value}"` : i.action === "owner" ? `Assign ${i.ids.length} store(s) to user ${i.value}` : `${i.action === "untag" ? "Remove" : "Add"} tag "${i.value}" on ${i.ids.length} store(s)`}`;
      const d = await ctx.call("GET", `${W(ctx)}/crm/contacts?f=${enc(storeFilter(i.filter || {}))}&size=1`);
      const n = d.error ? "?" : d.total, f = Object.entries(storeFilter(i.filter || {})).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join("/") : v}`).join(", ") || "all stores";
      return i.action === "stage" ? `Move ${n} stores (${f}) to "${i.value}"` : i.action === "icp" ? `Tag the best-fit ${i.value} of ${n} stores (${f}) as the focus list "icp"` : i.action === "owner" ? `Assign ${n} stores (${f}) to user ${i.value}` : `${i.action === "untag" ? "Remove" : "Add"} tag "${i.value}" on ${n} stores (${f})`;
    },
    run: (ctx, i) => ctx.call("POST", `${W(ctx)}/crm/bulk`, i.ids?.length ? { ids: i.ids, action: i.action, value: i.value } : { filter: storeFilter(i.filter || {}), action: i.action, value: i.action === "icp" ? Number(i.value) : i.value }) },
  { name: "add_store_note", module: "crm", write: true, risk: "low", description: "Add a note to one store in the CRM.",
    input_schema: { type: "object", properties: { id: { type: "string" }, text: { type: "string" } }, required: ["id", "text"] },
    preview: async (ctx, i) => `Add a note to store ${i.id}: "${String(i.text).slice(0, 120)}"`,
    run: (ctx, i) => ctx.call("POST", `${W(ctx)}/crm/contacts/${encodeURIComponent(i.id)}/notes`, { text: i.text }) },
  { name: "draft_campaign", module: "crm", write: true, risk: "high", description: "Create a Store CRM campaign as a DRAFT (it is never launched by the assistant). Steps: [{channel: email|whatsapp|call, delay_days, subject, body}] in Saudi Arabic; use {{store_name}}, {{owner_name}}, {{category_ar}}, {{sender_name}}.",
    input_schema: { type: "object", properties: { name: { type: "string" }, type: { type: "string", enum: ["outreach", "newsletter", "nurture"] }, filter: { type: "object", properties: FILTER_PROPS }, steps: { type: "array", items: { type: "object", properties: { channel: { type: "string" }, delay_days: { type: "number" }, subject: { type: "string" }, body: { type: "string" } } } } }, required: ["name", "type", "steps"] },
    preview: async (ctx, i) => `Create the draft campaign "${i.name}" (${i.type}, ${(i.steps || []).length} steps). It won't send until a person launches it.`,
    run: (ctx, i) => ctx.call("POST", `${W(ctx)}/crm/campaigns`, { name: i.name, type: i.type, filter: storeFilter(i.filter || {}), steps: i.steps }) },
  { name: "add_deal", module: "sales", write: true, risk: "high", description: "Add a store to the Sales pipeline.",
    input_schema: { type: "object", properties: { name: { type: "string" }, skus: { type: "number" }, category: { type: "string" }, city: { type: "string" }, platform: { type: "string" }, stage: { type: "string" }, notes: { type: "string" } }, required: ["name"] },
    preview: async (ctx, i) => `Add "${i.name}" to the Sales pipeline${i.stage ? ` at "${i.stage}"` : ""}${i.skus ? ` (${i.skus} products)` : ""}`,
    run: (ctx, i) => ctx.call("POST", `${W(ctx)}/deals`, pick(i, ["name", "skus", "category", "city", "platform", "stage", "notes"])) },
  { name: "create_content", module: "creative", write: true, risk: "low", description: "Add a content idea or draft to the Creative Studio calendar. Channels: ig_post, ig_carousel, ig_reel, ig_story, tiktok, snapchat, yt_short, yt_video, fb_post, linkedin, x, email, whatsapp. Pillars: education, proof, product, seasonal, founder.",
    input_schema: { type: "object", properties: { title: { type: "string" }, date: { type: "string", description: "YYYY-MM-DD" }, channels: arr, pillar: { type: "string" }, brief: { type: "string" }, season: { type: "string" } }, required: ["title"] },
    preview: async (ctx, i) => `Add "${i.title}" to the content calendar${i.date ? ` on ${i.date}` : ""}${i.channels?.length ? ` for ${i.channels.join(", ")}` : ""}`,
    run: (ctx, i) => ctx.call("POST", `${W(ctx)}/creative/items`, pick(i, ["title", "date", "channels", "pillar", "brief", "season"])) },
  { name: "add_task", module: "ops", write: true, risk: "low", description: "Add an Operations task. Areas: Marketing, Sales, Support, Finance, People, Product, Operations. owner_kind: ai or human.",
    input_schema: { type: "object", properties: { title: { type: "string" }, area: { type: "string" }, due: { type: "string", description: "YYYY-MM-DD" }, priority: { type: "number", description: "1 high, 2 normal, 3 low" }, owner_kind: { type: "string", enum: ["ai", "human"] }, owner: { type: "string" }, notes: { type: "string" } }, required: ["title"] },
    preview: async (ctx, i) => `Add the task "${i.title}"${i.due ? ` due ${i.due}` : ""}${i.area ? ` (${i.area})` : ""}`,
    run: (ctx, i) => ctx.call("POST", `${W(ctx)}/ops/tasks`, pick(i, ["title", "area", "due", "priority", "owner_kind", "owner", "notes"])) },
  { name: "add_knowledge_note", module: "marketing", write: true, risk: "low", description: "Save a Knowledge note. Categories: results, customers, objections, competitors, pricing, product, sales, brand, other.",
    input_schema: { type: "object", properties: { category: { type: "string" }, title: { type: "string" }, content: { type: "string" } }, required: ["category", "title", "content"] },
    preview: async (ctx, i) => `Save the Knowledge note "${i.title}" (${i.category})`,
    run: (ctx, i) => ctx.call("POST", `${W(ctx)}/notes`, pick(i, ["category", "title", "content"])) },
  { name: "okr_check_in", module: "okr", write: true, risk: "low", description: "Check in on a key result in Goals & review: the person's confidence (on_track, at_risk, off_track), a short note, and for manual key results the current value. Linked key results read their value from the live metric (don't send a value). The person must own the key result (or be an Owner, Admin or Team lead). Get the id from list_okrs.",
    input_schema: { type: "object", properties: { kr_id: { type: "string" }, value: { type: "number", description: "Manual key results only: the current value the person told you" }, confidence: { type: "string", enum: ["on_track", "at_risk", "off_track"] }, note: { type: "string" } }, required: ["kr_id"] },
    preview: async (ctx, i) => { const k = await ctx.call("GET", `${W(ctx)}/okr/krs/${encodeURIComponent(i.kr_id)}`); const t = k.error ? `key result #${i.kr_id}` : `"${String(k.title).slice(0, 100)}"`; return `Check in on ${t}${!k.error && k.kind === "linked" ? " (value from the live metric)" : i.value !== undefined ? `: value ${i.value}` : ""}${i.confidence ? `, ${String(i.confidence).replace("_", " ")}` : ""}${i.note ? `, note "${String(i.note).slice(0, 120)}"` : ""}`; },
    run: (ctx, i) => ctx.call("POST", `${W(ctx)}/okr/krs/${encodeURIComponent(i.kr_id)}/checkins`, pick(i, ["value", "confidence", "note"])) },
  { name: "add_meeting_notes", module: "meetings", write: true, risk: "low", description: "Save meeting notes or a pasted transcript in Meetings, either on an existing meeting (meeting_id from list_meetings; replaces its notes unless append is true) or on a new meeting (title, date YYYY-MM-DD and time HH:MM in Riyadh, type). Only the text the person gave you: never write notes yourself. The AI Meeting secretary drafts the action items afterwards on the Meetings page, where a person reviews them.",
    input_schema: { type: "object", properties: { meeting_id: { type: "string" }, notes: { type: "string" }, append: { type: "boolean" }, title: { type: "string" }, date: { type: "string", description: "YYYY-MM-DD (Riyadh)" }, time: { type: "string", description: "HH:MM (Riyadh, 24 h)" }, type: { type: "string", enum: ["internal", "sales_call", "customer", "partner", "investor", "hiring"] } }, required: ["notes"] },
    preview: async (ctx, i) => { const n = String(i.notes || "").length; if (i.meeting_id) { const m = await ctx.call("GET", `${W(ctx)}/meetings/${encodeURIComponent(i.meeting_id)}`); return `${i.append ? "Add" : "Save"} ${n.toLocaleString("en-US")} characters of notes ${i.append ? "to" : "on"} ${m.error ? `meeting #${i.meeting_id}` : `"${String(m.title).slice(0, 100)}" (${m.date})`}${!i.append && !m.error && m.notes ? ", replacing the notes already there" : ""}`; } return `Create the meeting "${String(i.title || "").slice(0, 100)}" on ${i.date || "[date]"} ${i.time || "10:00"} (${String(i.type || "internal").replace("_", " ")}) with ${n.toLocaleString("en-US")} characters of notes`; },
    run: (ctx, i) => (i.meeting_id ? ctx.call("POST", `${W(ctx)}/meetings/${encodeURIComponent(i.meeting_id)}/notes`, { text: i.notes, append: !!i.append }) : ctx.call("POST", `${W(ctx)}/meetings`, { ...pick(i, ["title", "date", "time", "type"]), notes: i.notes })) },
  { name: "add_market_signal", module: "intel", write: true, risk: "low", description: "Add a market signal to Market intel. Only record what the person told you or a source says; give the source link when there is one. Types: competitor_move, platform_change (needs platform: Meta, Snap, TikTok, Google, Salla or Zid), regulation, customer_request, win_loss, trend. Impact: low, med, high.",
    input_schema: { type: "object", properties: { title: { type: "string" }, type: { type: "string", enum: ["competitor_move", "platform_change", "regulation", "customer_request", "win_loss", "trend"] }, platform: { type: "string" }, source_url: { type: "string" }, date: { type: "string", description: "YYYY-MM-DD" }, impact: { type: "string", enum: ["low", "med", "high"] }, tags: arr, module: { type: "string", description: "Linked module: sales, product, crm, creative, ads, marketing, support, success, finance, compliance" }, text: { type: "string" } }, required: ["title", "type"] },
    preview: async (ctx, i) => `Add the market signal "${String(i.title).slice(0, 120)}" (${String(i.type).replace("_", " ")}${i.platform ? `, ${i.platform}` : ""}${i.impact ? `, ${i.impact} impact` : ""})${i.source_url ? ` from ${i.source_url}` : " with no source link"}`,
    run: (ctx, i) => ctx.call("POST", `${W(ctx)}/intel/signals`, pick(i, ["title", "type", "platform", "source_url", "date", "impact", "tags", "module", "text"])) },
  { name: "add_partner", module: "partners", write: true, risk: "low", description: "Add a partner in Partners & referrals (it gets a referral code and link). Types: agency, freelancer (freelancer or creator), platform (Salla/Zid app stores, Salla Partners), tech, reseller, customer (a customer who refers customers). Status: prospect, talking, signed, active, paused, ended (default prospect). Only what the person told you: never invent contacts or commission terms.",
    input_schema: { type: "object", properties: { name: { type: "string" }, type: { type: "string", enum: ["agency", "freelancer", "platform", "tech", "reseller", "customer"] }, status: { type: "string", enum: ["prospect", "talking", "signed", "active", "paused", "ended"] }, city: { type: "string" }, country: { type: "string" }, contact_name: { type: "string" }, contact_email: { type: "string" }, contact_phone: { type: "string" }, notes: { type: "string" } }, required: ["name", "type"] },
    preview: async (ctx, i) => `Add the partner "${String(i.name).slice(0, 120)}" (${i.type}, ${i.status || "prospect"})${i.contact_name || i.contact_email ? `, contact ${[i.contact_name, i.contact_email].filter(Boolean).join(" ")}` : ""}${i.city ? `, ${i.city}` : ""}, with a new referral link`,
    run: (ctx, i) => ctx.call("POST", `${W(ctx)}/partners`, { ...pick(i, ["name", "type", "status", "city", "country", "notes"]), ...(i.contact_name || i.contact_email || i.contact_phone ? { contact: { name: i.contact_name || "", email: i.contact_email || "", phone: i.contact_phone || "" } } : {}) }) },
  { name: "draft_help_article", module: "helpcenter", write: true, risk: "low", description: "Ask the AI Help writer to draft a help center article (saved as a Draft; a different person reviews and publishes it). Sources: a support article (source support_article + support_article_id), resolved tickets (source tickets + ticket_ids), or a gap topic from list_help_articles (source gap + category: it uses that topic's resolved tickets). It uses only facts in the sources and writes [ADD] for gaps.",
    input_schema: { type: "object", properties: { source: { type: "string", enum: ["support_article", "tickets", "gap"] }, support_article_id: { type: "string" }, ticket_ids: arr, category: { type: "string" } }, required: ["source"] },
    preview: async (ctx, i) => i.source === "support_article" ? `Draft a help article (AI Help writer, saved as a draft for review) from support article #${i.support_article_id || "?"}` : i.source === "gap" ? `Draft a help article (AI Help writer, saved as a draft for review) for the help center gap "${i.category || "?"}" from its resolved tickets` : `Draft a help article (AI Help writer, saved as a draft for review) from ${(i.ticket_ids || []).length} resolved ticket${(i.ticket_ids || []).length === 1 ? "" : "s"}`,
    run: async (ctx, i) => { const d = await ctx.call("POST", `${W(ctx)}/helpcenter/ai/draft`, pick(i, ["source", "support_article_id", "ticket_ids", "category"])); return d.error ? d : { id: d.article.id, status: d.article.status, title_ar: d.article.title_ar, title_en: d.article.title_en, by_ai: d.by_ai, note: d.note }; } },
  { name: "draft_changelog_entry", module: "product", write: true, risk: "low", description: "Ask the AI Release notes writer to draft a customer-facing changelog entry (What's new, Arabic and English) from a shipped release and its roadmap items. Saved as a Draft; a different person reviews and publishes it. Use list_changelog first to find shipped releases without an entry (release_id). It uses only the release and its items and writes [ADD] for gaps.",
    input_schema: { type: "object", properties: { release_id: { type: "string" } }, required: ["release_id"] },
    preview: async (ctx, i) => { const m = await ctx.call("GET", `${W(ctx)}/changelog/meta`); const r = (m.all_releases || []).find((x) => x.id === String(i.release_id)); return `Draft a changelog entry (AI Release notes writer, saved as a draft for review) from ${r ? `release ${String(r.version).slice(0, 40)}${r.status === "released" ? "" : " (not shipped yet: it will be refused)"}` : `release #${i.release_id} (not found)`}`; },
    run: async (ctx, i) => { const d = await ctx.call("POST", `${W(ctx)}/changelog/from-release/${encodeURIComponent(i.release_id)}`, {}); return d.error ? d : { id: d.entry.id, status: d.entry.status, type: d.entry.type, tags: d.entry.tags, title_ar: d.entry.title_ar, title_en: d.entry.title_en, by_ai: d.by_ai, note: d.note }; } },
  { name: "add_document_reminder", module: "legal", write: true, risk: "low", description: "Add a reminder (or another obligation) to a document in Legal & documents, with a due date. Use list_documents first to find the document id. Kinds: reminder (default), payment, notice, renewal, termination_notice, other. Repeat: none, monthly, quarterly, yearly. Only what the person asked for: never invent dates or terms.",
    input_schema: { type: "object", properties: { document_id: { type: "string" }, title: { type: "string" }, due_date: { type: "string", description: "YYYY-MM-DD" }, kind: { type: "string", enum: ["reminder", "payment", "notice", "renewal", "termination_notice", "other"] }, repeat: { type: "string", enum: ["none", "monthly", "quarterly", "yearly"] }, notes: { type: "string" } }, required: ["document_id", "title", "due_date"] },
    preview: async (ctx, i) => { const d = await ctx.call("GET", `${W(ctx)}/legal/documents/${encodeURIComponent(i.document_id)}`); return `Add the ${String(i.kind || "reminder").replace("_", " ")} "${String(i.title).slice(0, 120)}" due ${i.due_date}${i.repeat && i.repeat !== "none" ? ` (repeats ${i.repeat})` : ""} to ${d?.error ? `document ${i.document_id} (not found)` : `"${String(d.title).slice(0, 100)}"`}`; },
    run: (ctx, i) => ctx.call("POST", `${W(ctx)}/legal/documents/${encodeURIComponent(i.document_id)}/obligations`, { kind: i.kind || "reminder", ...pick(i, ["title", "due_date", "repeat", "notes"]) }) },
];
export const TOOL_LABELS = { list_help_articles: "help articles", list_changelog: "the changelog", get_overview: "the overview", find_stores: "stores", get_store: "a store", outreach_overview: "outreach numbers", list_campaigns: "campaigns", list_deals: "the pipeline", finance_snapshot: "finance", list_content: "content", workforce_status: "AI Workforce", search_knowledge: "Knowledge", list_market_signals: "market signals", list_okrs: "goals", list_meetings: "meetings", list_partners: "partners", list_documents: "documents" };

export function systemPrompt({ company, me, role, today }) {
  return `You are "Ask DPA AD", the assistant inside DPA AD's company dashboard (wizard.dpa.ad). DPA AD is a Saudi SaaS that turns Salla/Zid/Shopify store catalogs into designed image and video ads. You help ${company}'s team run the company: answer questions from the dashboard's real data and make changes for them.

How you work:
- Use the tools for every fact. Never guess or invent numbers, stores, customers or results; if a tool doesn't have it, say so and say where the person can add it.
- You act as the signed-in person (${me}, role: ${role}). If a tool says their role can't do something, tell them plainly.
- Changes go through tools marked as changes; the person confirms each one in the chat before it happens. Never claim a change was made unless its tool result says so. You can't launch campaigns, send messages, delete anything or change roles, budgets or agent levels: tell the person which page does it.
- Before a bulk change, check how many stores match with find_stores, and mention the number.
- Answer in the person's language (Saudi Arabic or English). Be short: lead with the answer, then the key numbers, then one suggested next step. Use simple Markdown (short lists, small tables).
- Money: SAR or USD as the data gives it. Dates are Riyadh time. Today is ${today}.`;
}

export function createAssistant({ store, workforce, client, model = "claude-opus-5-5", log = console }) {
  const threads = new Map();
  const gc = () => { const cut = Date.now() - 3 * 3600e3; for (const [k, t] of threads) if (t.touched < cut) threads.delete(k); while (threads.size > 300) threads.delete(threads.keys().next().value); };
  const byName = Object.fromEntries(TOOLS.map((t) => [t.name, t]));

  function toolsFor(perms) {
    return TOOLS.filter((t) => { const lv = perms[t.module] || "none"; return t.write ? lv === "edit" : lv !== "none"; });
  }
  const needsConfirm = (t) => t.write && !(t.risk === "low" && workforce.level("coordinator") >= 2);

  async function callModel(thread) {
    workforce.check("coordinator");
    const t0 = Date.now();
    let resp;
    try {
      resp = await client({ model, system: thread.system, tools: thread.tools.map(({ name, description, input_schema }) => ({ name, description, input_schema })), messages: thread.messages });
    } catch (e) {
      workforce.run("coordinator", thread.ws, { ok: false, ms: Date.now() - t0, model, error: e?.message || "error" });
      throw e;
    }
    const u = resp.usage || null;
    workforce.run("coordinator", thread.ws, { ok: true, ms: Date.now() - t0, model: resp.model || model, in: u?.input_tokens || 0, out: u?.output_tokens || 0, cost: Math.round(costOf(u, resp.model || model, model) * 1e6) / 1e6 });
    return resp;
  }

  async function execute(thread, use) {
    const t = byName[use.name];
    if (!t || !thread.tools.includes(t)) return { type: "tool_result", tool_use_id: use.id, content: JSON.stringify({ error: "This tool isn't available for this person's role." }), is_error: true };
    try {
      const out = await t.run(thread.ctx, use.input || {});
      thread.steps.push({ tool: use.name, write: !!t.write, ok: !out?.error });
      return { type: "tool_result", tool_use_id: use.id, content: JSON.stringify(out ?? { ok: true }).slice(0, 12000), ...(out?.error ? { is_error: true } : {}) };
    } catch (e) {
      return { type: "tool_result", tool_use_id: use.id, content: JSON.stringify({ error: e?.message || "failed" }), is_error: true };
    }
  }

  // Works through tool calls in order; stops at the first change that needs the person's OK.
  async function work(thread, results, queue) {
    while (queue.length) {
      const use = queue.shift(), t = byName[use.name];
      if (t && thread.tools.includes(t) && needsConfirm(t)) {
        const summary = t.preview ? await t.preview(thread.ctx, use.input || {}).catch(() => `Run ${use.name}`) : `Run ${use.name}`;
        thread.pending = { id: crypto.randomBytes(6).toString("hex"), use, results, queue, summary, tool: use.name };
        return { pending: { id: thread.pending.id, summary, tool: use.name } };
      }
      results.push(await execute(thread, use));
      if (t?.write) workforce.event("coordinator", thread.ws, "auto", `${use.name}: ran without asking (level 2, low risk)`);
    }
    thread.messages.push({ role: "user", content: results });
    return loop(thread);
  }

  async function loop(thread) {
    for (let i = 0; i < 8; i++) {
      const resp = await callModel(thread);
      thread.messages.push({ role: "assistant", content: resp.content });
      if (resp.stop_reason === "refusal") return { reply: "I can't help with that request." };
      if (resp.stop_reason === "max_tokens") return { reply: "That answer got too long. Try a narrower question." };
      const uses = resp.content.filter((b) => b.type === "tool_use");
      const text = resp.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
      if (resp.stop_reason !== "tool_use" || !uses.length) return { reply: text || "Done." };
      const r = await work(thread, [], [...uses]);
      return r;
    }
    return { reply: "I stopped after several steps. Ask me to continue if you need more." };
  }

  function newThread(req, ws) {
    const w = store.getWorkspace(ws);
    const role = store.db.roles.find((r) => r.id === req.user.role_id)?.name || req.user.role_id;
    const today = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
    return { id: crypto.randomBytes(9).toString("base64url"), user_id: req.user.id, ws: String(ws), touched: Date.now(), messages: [], steps: [], pending: null,
      system: systemPrompt({ company: w?.brief?.company_name || "DPA AD", me: req.user.name, role, today }), tools: toolsFor(req.perms), ctx: null };
  }
  const ctxFor = (req, ws) => ({
    ws: String(ws),
    call: async (method, path, body) => {
      const r = await fetch(`http://127.0.0.1:${req.socket.localPort}${path}`, { method, headers: { "Content-Type": "application/json", cookie: req.headers.cookie || "", "x-mwiz-via": "assistant" }, body: body ? JSON.stringify(body) : undefined });
      const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = { text: t.slice(0, 2000) }; }
      return r.ok ? j : { error: j.detail || `HTTP ${r.status}`, status: r.status };
    },
  });
  const done = (thread, r) => { const steps = thread.steps; thread.steps = []; return { thread_id: thread.id, ...r, steps }; };

  return {
    threads,
    async chat(req, { thread_id, message, ws, page }) {
      gc();
      let thread = thread_id && threads.get(thread_id);
      if (!thread || thread.user_id !== req.user.id || thread.ws !== String(ws)) { thread = newThread(req, ws); threads.set(thread.id, thread); }
      thread.touched = Date.now(); thread.ctx = ctxFor(req, ws); thread.tools = toolsFor(req.perms);
      const text = { type: "text", text: `${page ? `[Looking at: ${page}] ` : ""}${String(message).slice(0, 4000)}` };
      if (thread.pending) {
        // A new message while a change waits counts as "not confirmed".
        const p = thread.pending; thread.pending = null;
        const rest = [p.use, ...p.queue].map((u) => ({ type: "tool_result", tool_use_id: u.id, content: JSON.stringify({ declined: "The person moved on without confirming; nothing was changed." }) }));
        thread.messages.push({ role: "user", content: [...p.results, ...rest, text] });
      } else thread.messages.push({ role: "user", content: [text] });
      return done(thread, await loop(thread));
    },
    async confirm(req, { thread_id, action_id, approve }) {
      const thread = threads.get(thread_id);
      if (!thread || thread.user_id !== req.user.id) return { error: "This conversation has expired. Ask again." };
      const p = thread.pending;
      if (!p || p.id !== action_id) return { error: "Nothing is waiting for confirmation." };
      thread.pending = null; thread.touched = Date.now(); thread.ctx = ctxFor(req, thread.ws); thread.tools = toolsFor(req.perms);
      if (approve) { p.results.push(await execute(thread, p.use)); workforce.event("coordinator", thread.ws, "accepted", p.summary); }
      else { p.results.push({ type: "tool_result", tool_use_id: p.use.id, content: JSON.stringify({ declined: "The person declined this change; nothing was changed." }) }); workforce.event("coordinator", thread.ws, "rejected", p.summary); }
      return done(thread, await work(thread, p.results, p.queue));
    },
  };
}

// The real Claude client (Anthropic SDK). Opus 5.5 with adaptive thinking, medium effort for quick chat,
// server-side refusal fallback, and the stable system prompt cached.
export async function claudeAssistantClient() {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const anthropic = new Anthropic();
  return (p) => anthropic.beta.messages.create({
    model: p.model, max_tokens: 16000, thinking: { type: "adaptive" }, output_config: { effort: "medium" },
    betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
    system: [{ type: "text", text: p.system, cache_control: { type: "ephemeral" } }], tools: p.tools, messages: p.messages,
  });
}
