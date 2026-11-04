/* Guides: the "i" pop-up on every page. One entry per route in ROUTE_MODULE (app.js); a test checks each one.
   Data only, no code: guide-ui.js draws it. Module names come from the sidebar (NAV in app.js), who can use a module
   from /api/guide/meta (DEFAULT_ROLES in lib/access.js) and the AI agents from AGENTS in lib/agents.js.
   Each guide:
     what    one or two plain sentences
     flow    3-6 steps; actor is "ai", "person" or "system"; who is optional (defaults: AI / You / Automatic)
     tasks   2-5 { title, steps[] } using the page's real tab and button labels
     rules   2-4 guard-rails taken from CLAUDE.md and docs/*.md
     docs    doc files in docs/ (plain text: the app doesn't serve them)
     related routes that open from the pop-up
   Never put a number here that isn't a real default in the code or the docs. */

const GUIDES = {
  /* ------------------------------------------------------------ Home */
  command: {
    what: "Home is the Command Center: one screen that shows what needs a person today across every module you can see. Each panel opens the page that does the work.",
    flow: [
      { actor: "system", label: "Each module keeps its own data", who: "Automatic" },
      { actor: "ai", label: "AI agents draft and do routine steps", who: "AI Workforce" },
      { actor: "system", label: "Home collects what needs a person", who: "Automatic" },
      { actor: "person", label: "You open each item and decide", who: "You" },
    ],
    map: [
      { key: "grow", line: "Win stores: Store CRM outreach, the sales pipeline, content, paid ads, market intel and partners." },
      { key: "customers", line: "Keep customers: AI Support, billing and invoices, customer health, the public help center." },
      { key: "brain", line: "The company brief, knowledge, KPIs and AI playbooks that every module reads." },
      { key: "product", line: "Roadmap, feedback, releases and the public changelog." },
      { key: "finance", line: "Cash, income, expenses, unit economics, VAT and pricing." },
      { key: "ops", line: "Tasks, compliance deadlines, the tool stack and incidents." },
      { key: "team", line: "AI agents, hiring, attendance and payroll for the team in India." },
      { key: "settings", line: "Logins and roles, security and backups, legal documents, the investor room." },
    ],
    tasks: [
      { title: "Start your day", steps: ["Open Home.", "Read the Needs you list from top to bottom.", "Click an item: it opens the page where you act on it.", "Press Refresh to see the updated list."] },
      { title: "Try the dashboard with sample data", steps: ["Click Load sample data (top right).", "Open any module: it has sample stores, deals and customers.", "Before real work, click Remove sample data."] },
      { title: "Learn any page", steps: ["Click the round i button next to the page title, or press ?.", "Read the flow: violet steps are AI, green steps are a person, grey steps run by themselves."] },
    ],
    rules: [
      "AI does every step it can; people do only what must be human: approvals, live calls, contracts and anything the AI flags.",
      "AI drafts are reviewed by a person before anything reaches a customer.",
      "Home only shows modules your role can see; the rest is hidden, not just greyed out.",
      "Sample stores are never sent a real message.",
    ],
    docs: ["docs/SOP.md", "docs/ai-workforce-plan.md"],
    related: ["sop", "okr", "workforce", "access"],
  },

  /* ------------------------------------------------------------ Run the company */
  sop: {
    what: "The SOP is the one checklist for running the company: what to do once, every week, every month and every quarter. Each step opens the page that does the work.",
    flow: [
      { actor: "system", label: "Checklist resets each week, month and quarter", who: "Automatic" },
      { actor: "person", label: "Open a step's page and do it", who: "Step owner" },
      { actor: "ai", label: "Playbooks and agents do the drafting", who: "AI" },
      { actor: "person", label: "Tick the step when done", who: "You" },
    ],
    tasks: [
      { title: "Do this week's steps", steps: ["Click the This week card at the top.", "For each step, click its Open … button.", "Do the work on that page, come back and tick the box."] },
      { title: "See progress", steps: ["Look at the four cards at the top: done out of total for each period.", "Ticks are shared by the whole team."] },
    ],
    rules: [
      "Ticks are shared: when one person ticks a step, everyone sees it done.",
      "Ticks reset at the start of each week, month and quarter.",
    ],
    docs: ["docs/SOP.md"],
    related: ["command", "kpis", "playbooks", "okr"],
  },

  okr: {
    what: "Goals & review holds the quarterly goals (objectives with 2 to 5 key results) and the weekly business review drafted every Monday.",
    flow: [
      { actor: "person", label: "Set objectives and key results", who: "Owner, Admin, Team lead" },
      { actor: "system", label: "Linked key results read live metrics", who: "Automatic" },
      { actor: "person", label: "Owners check in with confidence", who: "Key result owner" },
      { actor: "ai", label: "Monday review drafted with cited notes", who: "AI Chief of staff" },
      { actor: "person", label: "Review, comment, mark reviewed", who: "Owner, Admin" },
    ],
    tasks: [
      { title: "Set a goal for the quarter", steps: ["Open the Goals tab.", "Open New objective, fill it in and click Create draft.", "Click Add key result for each one (link a metric or type values by hand).", "Click Activate."] },
      { title: "Check in on your key result", steps: ["Goals tab → find your key result.", "Click Check in, set the value (if typed by hand), confidence and a note.", "Click Save check-in."] },
      { title: "Run the weekly review", steps: ["Open the Weekly review tab.", "Pick this week's review (or click Draft this week's review).", "Read it, add a Comment, then Mark reviewed (Owner or Admin)."] },
      { title: "Close a quarter", steps: ["Goals tab → Grade and close.", "Optionally click Ask the AI Chief of staff for a suggested score.", "Write the retro and click Close with this score."] },
    ],
    rules: [
      "The AI only suggests a grade; the grade and the retro are a person's call.",
      "The review keeps the AI notes only if every bullet cites a row and every number is in the rows; otherwise a factual summary with [ADD] is used.",
      "A review marked reviewed is locked.",
      "Metrics from modules you can't view are hidden (for example MRR needs Finance or Billing).",
    ],
    docs: ["docs/okr-wbr.md"],
    related: ["command", "meetings", "kpis", "finance"],
  },

  meetings: {
    what: "Meetings turns meeting notes into tasks. Paste or upload the notes, check the AI draft of action items, and each ticked item is created in the module where it belongs.",
    flow: [
      { actor: "person", label: "Add the meeting and paste notes", who: "You" },
      { actor: "ai", label: "Drafts summary, decisions and action items", who: "AI Meeting secretary" },
      { actor: "person", label: "Tick items, fix owners and dates", who: "You" },
      { actor: "system", label: "Creates each item in its module", who: "Automatic" },
      { actor: "person", label: "Send the follow-up email", who: "You, via Store CRM" },
    ],
    tasks: [
      { title: "Turn notes into tasks", steps: ["Meetings tab → open New meeting, fill it in, click Add meeting.", "Paste the notes (or upload .txt, .vtt, .srt or .docx) and click Save notes.", "Click Draft action items.", "Tick the items to keep, then click Create ticked items.", "Click Mark reviewed."] },
      { title: "Send a follow-up", steps: ["Open the meeting → Draft follow-up.", "Edit the text (Arabic first, then English).", "Send it via Store CRM, or Copy it."] },
      { title: "See your tasks", steps: ["Open the My action items tab.", "Click Mark done when an item is finished."] },
    ],
    rules: [
      "No audio transcription on the server: notes are pasted or uploaded as text.",
      "The AI draft is kept only if it invents no numbers, quotes or items; otherwise a rule-based draft with [ADD] is used.",
      "Items for modules you can't edit are refused.",
      "Investor and hiring meetings are private: Owner, Admin, attendees and the creator only.",
    ],
    docs: ["docs/meetings.md"],
    related: ["ops", "pipeline", "crm", "okr"],
  },

  /* ------------------------------------------------------------ Marketing brain */
  overview: {
    what: "The Marketing brain overview shows how complete the company data is, and what the AI playbooks have produced so far.",
    flow: [
      { actor: "person", label: "Fill in the Brief and Knowledge", who: "You" },
      { actor: "person", label: "Log KPI values", who: "You" },
      { actor: "ai", label: "Playbooks write plans from that data", who: "AI Marketing strategist" },
      { actor: "system", label: "Every output is saved in the Library", who: "Automatic" },
    ],
    tasks: [
      { title: "Fill the gaps", steps: ["Look at Data completeness and the list What the engine still needs.", "Click a question: it opens the page and field to fill.", "Fill it in and click Save changes."] },
      { title: "Run a playbook", steps: ["Click Run a playbook (top right).", "Pick a playbook, check the inputs, click Generate."] },
    ],
    rules: [
      "The more real data you add, the sharper the output. Use real results only: never invented numbers.",
      "Playbook outputs are drafts for a person to review.",
    ],
    docs: ["docs/SOP.md"],
    related: ["brief", "knowledge", "kpis", "playbooks"],
  },
  brief: {
    what: "The Brief is the company's core facts: product, customers, markets, pricing and goals. Every playbook and many AI agents read it.",
    flow: [
      { actor: "person", label: "Type the company facts", who: "You" },
      { actor: "system", label: "Saved for the workspace", who: "Automatic" },
      { actor: "ai", label: "Playbooks and agents read it", who: "AI" },
    ],
    tasks: [
      { title: "Update the brief", steps: ["Edit any field in Company, Market, Product or Go-to-market.", "Click Save changes (top right)."] },
      { title: "Find what is missing", steps: ["Open Overview in the Marketing brain.", "Click a question in What the engine still needs: it opens the field to fill."] },
    ],
    rules: [
      "Proof points: real results only (ROAS, CTR, time saved, customers).",
      "Pricing is a draft until real costs are in (Finance → Pricing).",
    ],
    docs: ["docs/dpa-ad-pricing.md"],
    related: ["knowledge", "overview", "playbooks"],
  },
  knowledge: {
    what: "Knowledge holds notes the AI should know: customer research, competitor facts, objections, messaging and more, sorted by category.",
    flow: [
      { actor: "person", label: "Add a note with a category", who: "You" },
      { actor: "system", label: "Saved and filtered by category", who: "Automatic" },
      { actor: "ai", label: "Playbooks use the notes as context", who: "AI" },
    ],
    tasks: [
      { title: "Add a note", steps: ["Click Add knowledge.", "Pick a category, give a title and paste the content.", "Click Save note."] },
      { title: "Find a note", steps: ["Click a category chip to filter.", "Click Show all to read a long note."] },
    ],
    rules: [
      "Only add facts you can stand behind: the AI repeats what it reads here.",
      "Notes are shared with everyone whose role can view Marketing.",
    ],
    docs: ["docs/SOP.md"],
    related: ["brief", "playbooks", "intel"],
  },
  kpis: {
    what: "KPIs tracks the marketing numbers each period against a target, so the AI can analyze trends and the SOP can check them.",
    flow: [
      { actor: "person", label: "Load the SOP KPIs or add your own", who: "You" },
      { actor: "person", label: "Type this period's values", who: "KPI owner" },
      { actor: "ai", label: "KPI report explains what changed", who: "AI" },
    ],
    tasks: [
      { title: "Set up KPIs", steps: ["Click Load SOP KPIs, or Add KPI for your own.", "Set a target for each."] },
      { title: "Log this period", steps: ["Type the values in This period.", "Click Save values.", "Click Analyze: it opens the KPI report playbook."] },
    ],
    rules: [
      "Log real values only; leave a KPI empty if you don't have the number.",
      "Weekly KPIs use ISO weeks (2026-W44), monthly ones use months (2026-10).",
    ],
    docs: ["docs/SOP.md"],
    related: ["sop", "playbooks", "okr"],
  },
  playbooks: {
    what: "Playbooks are AI tasks that write marketing work (plans, copy, reports) from your Brief, Knowledge and KPI data.",
    flow: [
      { actor: "person", label: "Pick a playbook and check inputs", who: "You" },
      { actor: "ai", label: "Writes the output", who: "AI Marketing strategist" },
      { actor: "system", label: "Saved in the Library", who: "Automatic" },
      { actor: "person", label: "Review and use it", who: "You" },
    ],
    tasks: [
      { title: "Run one playbook", steps: ["Pick a playbook in the list on the left.", "Check the inputs.", "Click Generate and wait for it to finish."] },
      { title: "Run everything for a launch", steps: ["Click Run full launch kit (top right).", "Each output is saved in the Library."] },
    ],
    rules: [
      "The AI never invents numbers or results: missing facts come back as [ADD] placeholders.",
      "Outputs are drafts: a person reviews them before use.",
    ],
    docs: ["docs/SOP.md"],
    related: ["library", "brief", "knowledge"],
  },
  library: {
    what: "The Library keeps every playbook output with its full history, so nothing the AI wrote is lost.",
    flow: [
      { actor: "ai", label: "A playbook writes an output", who: "AI" },
      { actor: "system", label: "Saved here with date and title", who: "Automatic" },
      { actor: "person", label: "Read, copy or export", who: "You" },
    ],
    tasks: [
      { title: "Reuse an output", steps: ["Pick an output in the list.", "Click Copy Markdown, or Delete it."] },
      { title: "Export everything", steps: ["Click Export all as Markdown (top right)."] },
    ],
    rules: [
      "Outputs are drafts: check facts before anything goes to a customer.",
      "Deleting an output removes it for the whole team.",
    ],
    docs: ["docs/SOP.md"],
    related: ["playbooks", "overview"],
  },

  /* ------------------------------------------------------------ Grow */
  crm: {
    what: "The Store CRM is the database of Salla and Zid stores, with AI outreach by email and WhatsApp, an inbox of replies and a pipeline from new store to active customer.",
    flow: [
      { actor: "person", label: "Import stores (CSV)", who: "You" },
      { actor: "system", label: "Scores and segments each store", who: "Automatic" },
      { actor: "ai", label: "Writes the outreach sequence", who: "AI Sequence writer" },
      { actor: "person", label: "Review and launch the campaign", who: "You" },
      { actor: "system", label: "Sends in Saudi hours, stops on reply", who: "Scheduler" },
      { actor: "ai", label: "Sorts replies and drafts answers", who: "AI Inbox triage" },
    ],
    tasks: [
      { title: "Add stores", steps: ["Click Import stores (top right) and choose a CSV (Arabic or English headers).", "Or open Stores → Add store for one store."] },
      { title: "Start a campaign", steps: ["Open the Campaigns tab → New campaign (or Load starter campaigns).", "Pick the segment, then click Write sequence.", "Read every step, then Save and launch."] },
      { title: "Answer replies", steps: ["Open the Inbox tab.", "Read the AI draft, edit it, click Send reply.", "Click Mark done."] },
      { title: "Go live", steps: ["Settings tab: connect email and WhatsApp.", "After a week in Test mode, click Live."] },
    ],
    rules: [
      "Test mode by default: campaigns run on schedule but nothing leaves the server.",
      "Sends only 09:00–21:00 Riyadh time, never on Friday; sequences stop when a store replies.",
      "Every email has an unsubscribe link; \"stop\" / \"إلغاء\" is honoured; WhatsApp only to opted-in numbers.",
      "Sample stores are never sent for real.",
    ],
    docs: ["docs/dpa-ad-sales-system.md"],
    related: ["pipeline", "studio", "billing", "success"],
  },
  pipeline: {
    what: "The Sales pipeline tracks each store you want as a customer from lead to paying. AI drafts every message; you review it and mark it sent.",
    flow: [
      { actor: "person", label: "Add a lead", who: "You" },
      { actor: "system", label: "Shows the next step and best plan", who: "Automatic" },
      { actor: "ai", label: "Drafts the message or prospect page", who: "AI Sales assistant" },
      { actor: "person", label: "Send it, call, demo", who: "You" },
      { actor: "person", label: "Move the stage", who: "You" },
    ],
    tasks: [
      { title: "Add a store", steps: ["Click Add lead (top right).", "Fill in the store name, city, platform and products."] },
      { title: "Do the next step", steps: ["Open a deal on the Pipeline board.", "Read Next step, click AI: draft this now.", "Edit the draft, send it yourself, then click I sent it."] },
      { title: "Move a deal", steps: ["Drag the card to the next column, or open it and click a Stage chip.", "At Paying, click Create customer in Billing."] },
      { title: "See the numbers", steps: ["Open the Insights tab for the funnel, close rate and MRR forecast."] },
    ],
    rules: [
      "Nothing is sent until you mark it sent: AI drafts only.",
      "Steps only a person may do (calls, demos, contracts) are tagged for you.",
      "Prices come from the draft plans in Finance → Pricing.",
    ],
    docs: ["docs/dpa-ad-sales-system.md", "docs/dpa-ad-pricing.md"],
    related: ["crm", "billing", "intel", "meetings"],
  },
  studio: {
    what: "Creative Studio plans, writes, designs, approves and publishes DPA AD's own content: social posts, reels and the designed emails the Store CRM sends.",
    flow: [
      { actor: "ai", label: "Plans the month and writes copy (AR + EN)", who: "AI Content strategist, Copywriter" },
      { actor: "person", label: "Edit, design, send for review", who: "Creative team" },
      { actor: "person", label: "Approve", who: "Approver in Brand kit" },
      { actor: "system", label: "Publishes when due (or you post by hand)", who: "Scheduler" },
      { actor: "system", label: "Pulls results", who: "Automatic" },
    ],
    tasks: [
      { title: "Plan the month", steps: ["Click Plan month with AI (top right).", "Open the Calendar tab and check each idea."] },
      { title: "Make a post", steps: ["Click New content.", "Write or let the AI write the copy, attach media from the Assets tab (or Design with a template).", "Click Send for review; an approver clicks Approve."] },
      { title: "Publish", steps: ["Open the approved post.", "Click Publish now, or download the pack, post it by hand and click Mark posted."] },
      { title: "Connect accounts", steps: ["Open the Accounts tab and connect each platform.", "Results appear in the Results tab."] },
    ],
    rules: [
      "Publishing is in Test mode by default, and auto-publish is off.",
      "Only approved or scheduled items publish; a failed post is tried 3 times, then stops.",
      "Editing an approved item sends it back to review.",
      "Audio uploads need \"I have the rights\".",
    ],
    docs: ["docs/creative-studio-plan.md"],
    related: ["crm", "ads", "helpcenter"],
  },
  ads: {
    what: "Paid Ads runs DPA AD's own campaigns on Meta, Snapchat and TikTok (Google optional), so you know the cost per lead, trial and paying store.",
    flow: [
      { actor: "ai", label: "Plans a campaign", who: "AI Media buyer" },
      { actor: "person", label: "Edit and approve the plan", who: "Owner, Admin, Team lead" },
      { actor: "system", label: "Creates it PAUSED on the platform", who: "Automatic" },
      { actor: "person", label: "Activate it", who: "Approver" },
      { actor: "system", label: "Pulls insights, checks guardrails", who: "Scheduler" },
    ],
    tasks: [
      { title: "Plan a campaign", steps: ["Open the Campaigns tab → Plan a campaign.", "Set the goal, budget and channels.", "Read the plan, Save edits, then Approve."] },
      { title: "Set budgets and rules", steps: ["Open Budgets & rules.", "Set the monthly budgets (SAR) and click Save.", "Add + Pause rule or + Daily cap rule."] },
      { title: "Bring in results", steps: ["Open Accounts and connect an ad account, or Import from Ads Manager (CSV) → Read the file."] },
      { title: "Track a link", steps: ["Open UTM builder, fill it in, click Copy link."] },
    ],
    rules: [
      "Test mode by default: nothing changes on any ad platform.",
      "Campaigns are always created PAUSED; only an approver activates them.",
      "Guardrails act alone only in Live with the AI Budget pacer at level 2; otherwise each hit waits for a person.",
    ],
    docs: ["docs/paid-ads.md"],
    related: ["studio", "finance", "crm", "results"],
  },
  intel: {
    what: "Market intel collects what competitors and the market are doing, shows why deals are won or lost, sizes the market, and drafts a weekly brief.",
    flow: [
      { actor: "person", label: "Add signals and competitors", who: "You" },
      { actor: "system", label: "Imports signals, watches pages weekly", who: "Automatic" },
      { actor: "person", label: "Review each page change", who: "You" },
      { actor: "ai", label: "Drafts the weekly brief with sources", who: "AI Market analyst" },
      { actor: "person", label: "Approve the brief", who: "You" },
    ],
    tasks: [
      { title: "Log a signal", steps: ["Signals tab → open Add a signal.", "Fill in what happened, type and impact, click Add signal.", "Or click Import to pull them from Sales, Support, Product and Store CRM."] },
      { title: "Track a competitor", steps: ["Competitors tab → Add competitor.", "Type the pricing as read, with the source link.", "Tick Check it every week to watch a public page; Mark reviewed on each change."] },
      { title: "Weekly brief", steps: ["Weekly brief tab → Draft the brief.", "Edit, Save edits, then Approve or Reject."] },
    ],
    rules: [
      "Competitor pricing is only what a person typed from the competitor's page, with the link and date.",
      "Page watches are off until switched on, and fetch at most once a week.",
      "The brief keeps the AI text only if it cites this week's items and invents none.",
      "Market sizing has no default numbers: every input needs a source.",
    ],
    docs: ["docs/market-intel.md", "docs/competitive-analysis.md"],
    related: ["pipeline", "product", "support", "crm"],
  },
  partners: {
    what: "Partners & referrals tracks agencies, creators and other partners, their referral links and coupons, which customers they brought, and the commission they earn.",
    flow: [
      { actor: "person", label: "Add a partner and a link or coupon", who: "You" },
      { actor: "system", label: "Counts clicks and attributes stores", who: "Automatic" },
      { actor: "system", label: "Commission from Billing payments", who: "Automatic" },
      { actor: "person", label: "Approve and pay statements", who: "Owner or Finance" },
      { actor: "ai", label: "Drafts partner emails", who: "AI Partnerships manager" },
    ],
    tasks: [
      { title: "Add a partner", steps: ["Partners tab → open New partner, fill it in, click Add partner.", "Open the partner → Add link to get a /r/ referral link."] },
      { title: "Give a coupon", steps: ["Open the Coupons tab → New coupon (or New coupon for this partner on the partner page).", "Set the discount and duration, click Create coupon."] },
      { title: "Pay commission", steps: ["Open the Statements tab → Draft statements.", "Check the lines, click Approve, then Mark paid."] },
      { title: "Share results with a partner", steps: ["Partner page → Create portal link → Copy and mark used."] },
    ],
    rules: [
      "Referral links redirect only to https pages on allowed hosts (default dpa.ad and subdomains).",
      "Commission comes only from Billing payments (before VAT) and credit notes of attributed customers.",
      "Coupons over 50% or forever need the Owner; one coupon per customer, no stacking.",
      "Partner emails are drafts; any send goes through the Store CRM with every outreach rule.",
    ],
    docs: ["docs/partners.md"],
    related: ["billing", "crm", "finance", "ads"],
  },
  results: {
    what: "ROAS results proves whether DPA AD's designed ads sell more than plain packshots, store by store, from ad CSV exports.",
    flow: [
      { actor: "person", label: "Export ad results from Ads Manager", who: "You" },
      { actor: "person", label: "Import the CSV for a store", who: "You" },
      { actor: "system", label: "Maps templates, compares ROAS", who: "Automatic" },
      { actor: "ai", label: "Writes a case study", who: "AI Results analyst" },
    ],
    tasks: [
      { title: "Import results", steps: ["Click Import ad results (top right).", "Choose the store and channel, pick the file, click Read the file.", "Check the template mapping, click Save results."] },
      { title: "Make a case study", steps: ["Find the store in Results by store.", "Click AI: case study and review the draft."] },
      { title: "Update KPIs", steps: ["Click Log to KPIs (top right)."] },
    ],
    rules: [
      "Numbers come only from the files you import; the verdict needs enough data to be confident.",
      "Case studies are drafts: check with the store before you publish anything.",
    ],
    docs: [],
    related: ["ads", "kpis", "studio"],
  },

  /* ------------------------------------------------------------ Customers */
  support: {
    what: "AI Support answers customers from the help articles. Money, legal, data, bugs and upset customers go to a person.",
    flow: [
      { actor: "system", label: "Message arrives (chat, comments, DMs)", who: "Automatic" },
      { actor: "ai", label: "Drafts or sends an answer", who: "AI Support agent" },
      { actor: "system", label: "Hands over when a rule says so", who: "Automatic" },
      { actor: "person", label: "Check, reply, resolve", who: "Support team" },
    ],
    tasks: [
      { title: "Answer a conversation", steps: ["Inbox tab → filter Needs you.", "Open a conversation, click AI: draft reply.", "Edit it, send it, click I sent this reply, then Resolve."] },
      { title: "Log a message from elsewhere", steps: ["Click Add customer message, paste it, click Add and let AI reply."] },
      { title: "Teach the AI", steps: ["Help center tab → AI: write starter articles (EN + AR), or Add article.", "Edit each answer and Save article."] },
      { title: "Add chat to the website", steps: ["Website chat tab: switch it on.", "Click Copy embed code and paste it into the site."] },
    ],
    rules: [
      "In the inbox the AI drafts and a person sends.",
      "On the website chat the AI replies live (when switched on) and hands over when a rule says so.",
      "Money, legal, data, bug and upset-customer messages always go to a person.",
    ],
    docs: ["docs/help-center.md"],
    related: ["helpcenter", "success", "billing", "product"],
  },
  billing: {
    what: "Billing & customers runs subscriptions: invoices with VAT and the ZATCA QR, payments, reminders for overdue invoices, and a 360 view of each customer.",
    flow: [
      { actor: "person", label: "Create the customer and plan", who: "Billing editor" },
      { actor: "system", label: "Billing run issues invoices each hour", who: "Scheduler" },
      { actor: "system", label: "Payments matched, reminders sent", who: "Automatic" },
      { actor: "ai", label: "Drafts reminders and explanations", who: "AI Billing assistant" },
      { actor: "person", label: "Approve credit notes, voids, changes", who: "Billing editor" },
    ],
    tasks: [
      { title: "Add a customer", steps: ["Click New customer (top right), or Create customer in Billing from a paying deal or CRM store.", "Pick the plan and billing cycle, click Create customer."] },
      { title: "Record a payment", steps: ["Invoices tab → find the invoice.", "Click Record payment."] },
      { title: "Fix a wrong invoice", steps: ["Invoices tab → click Credit note (or Void) on the issued invoice.", "Issued invoices never change: a credit note corrects them."] },
      { title: "Chase overdue invoices", steps: ["Open the Dunning tab.", "Click AI: draft reminder, edit it, then Approve and send."] },
    ],
    rules: [
      "Test mode by default: invoices are numbered, but no card links, no ZATCA calls and no emails until Settings is Live.",
      "Issued invoices are immutable; a void goes through a credit note.",
      "Reminders go out on days 1, 3 and 7 after the due date; a store is paused after 14 days overdue (defaults in Settings).",
      "VAT is added only when Finance says the company is VAT-registered.",
    ],
    docs: ["docs/billing-zatca.md"],
    related: ["finance", "success", "partners", "pipeline"],
  },
  success: {
    what: "Customer success watches each paying customer's health, raises churn alerts as owned tasks, finds upgrade chances and renewals, and runs NPS and CSAT surveys.",
    flow: [
      { actor: "system", label: "Daily health snapshot per customer", who: "Scheduler" },
      { actor: "system", label: "Rules raise churn alerts", who: "Automatic" },
      { actor: "ai", label: "Explains the risk, drafts a save plan", who: "AI Retention watcher" },
      { actor: "person", label: "Owner calls, acts, closes the alert", who: "Alert owner" },
      { actor: "ai", label: "Drafts renewal and upgrade emails", who: "AI Expansion & renewal writer" },
    ],
    tasks: [
      { title: "Work an alert", steps: ["Open the Alerts tab.", "Click AI: save plan, then Add note as you act.", "Click Done… (or Snooze…) with what happened."] },
      { title: "Prepare a renewal", steps: ["Open the Renewals tab.", "Click AI: renewal email, edit, then Approve and send."] },
      { title: "Send a survey", steps: ["Open NPS & CSAT → New survey.", "Pick the type and channel, click Create survey."] },
      { title: "Check everything now", steps: ["Click Check now (top right) to take today's snapshots and check every rule."] },
    ],
    rules: [
      "Test mode by default: surveys and AI emails are only logged until Settings is Live (the Store CRM's Test mode also applies).",
      "Sample stores are never sent for real; messages outside Saudi hours wait.",
      "Every threshold is a starting point in Settings; tune it with real data.",
      "Money only shows for roles that can see Billing.",
    ],
    docs: ["docs/customer-success.md"],
    related: ["billing", "support", "crm", "helpcenter"],
  },
  helpcenter: {
    what: "The Help center writes and publishes customer help articles in Arabic and English on the public /help site.",
    flow: [
      { actor: "ai", label: "Drafts from support articles or tickets", who: "AI Help writer" },
      { actor: "person", label: "Author edits, sends for review", who: "Author" },
      { actor: "person", label: "Another person reviews and publishes", who: "Reviewer" },
      { actor: "system", label: "Live on /help, votes counted", who: "Automatic" },
    ],
    tasks: [
      { title: "Write an article", steps: ["Articles tab → open Draft with the AI Help writer (or New article).", "Pick the source and category, click Draft the article.", "Edit it, then Send for review."] },
      { title: "Publish", steps: ["A different person opens the article and reads it.", "Click Publish."] },
      { title: "Translate", steps: ["Open the article → Translate with AI.", "Check it and click Use this Arabic (or English) version."] },
      { title: "Fill gaps", steps: ["Open the Gaps tab: ticket topics with no article.", "Click Draft from … resolved tickets."] },
    ],
    rules: [
      "A different person than the author reviews and publishes (the Owner may self-publish, configurable).",
      "[ADD] blocks publishing; published text is locked until moved back to draft.",
      "The AI keeps its text only if every number is in the sources; prices come only from the plans.",
      "Votes are counters only: no personal data.",
    ],
    docs: ["docs/help-center.md"],
    related: ["support", "changelog", "success"],
  },

  /* ------------------------------------------------------------ Product */
  product: {
    what: "Roadmap & releases holds what DPA AD will build (Now, Next, Later), the customer feedback behind it, and each release.",
    flow: [
      { actor: "system", label: "Feedback from Support and Sales", who: "Automatic" },
      { actor: "ai", label: "Groups feedback, writes specs", who: "AI Product analyst" },
      { actor: "person", label: "Decide what gets built", who: "Product owner" },
      { actor: "ai", label: "Writes release notes (EN + AR)", who: "AI" },
      { actor: "person", label: "Approve and release", who: "Product owner" },
    ],
    tasks: [
      { title: "Add an idea", steps: ["Roadmap tab → Add idea.", "Drag it to Now, Next or Later."] },
      { title: "Use customer feedback", steps: ["Feedback tab → Import from Support.", "Untick what you don't agree with, click Apply selected."] },
      { title: "Ship a release", steps: ["Releases tab → New release → Create draft release.", "Click AI: changelog + notes (EN + AR) and check it.", "Click Approve and release, then Draft changelog entry."] },
    ],
    rules: [
      "AI collects, groups, scores and writes; people decide what gets built and approve each release.",
      "AI drafts are for review: nothing is published from here.",
    ],
    docs: ["docs/changelog.md"],
    related: ["changelog", "support", "intel"],
  },
  changelog: {
    what: "The Changelog publishes \"What's new\" entries in Arabic and English on the public /changelog page, with RSS and JSON Feed.",
    flow: [
      { actor: "person", label: "A release is shipped", who: "Product" },
      { actor: "ai", label: "Drafts the entry from the release", who: "AI Release notes writer" },
      { actor: "person", label: "Edit, send for review", who: "Author" },
      { actor: "person", label: "Another person publishes", who: "Reviewer" },
      { actor: "person", label: "Email the people who asked", who: "You, via Store CRM" },
    ],
    tasks: [
      { title: "Draft from a release", steps: ["Entries tab → Shipped releases without an entry → Draft changelog entry.", "Fill every [ADD], then Send for review."] },
      { title: "Publish", steps: ["A different person opens the entry and clicks Publish."] },
      { title: "Tell the requesters", steps: ["Open the published entry → Who asked for this.", "Click Draft … emails, check each, then Send through the Store CRM."] },
    ],
    rules: [
      "A different person than the author publishes; [ADD] blocks publishing; published text is locked.",
      "The AI uses numbers only from the release and its items, and never names requesters or competitors.",
      "Notices are sent only by a person, through the Store CRM (Live mode only 09:00–21:00 Riyadh, not Friday).",
    ],
    docs: ["docs/changelog.md"],
    related: ["product", "helpcenter", "crm"],
  },

  /* ------------------------------------------------------------ Finance and operations */
  finance: {
    what: "Finance shows cash, burn, runway, income, expenses, unit economics and VAT, and holds the draft pricing calculator.",
    flow: [
      { actor: "system", label: "Billing payments and ad spend flow in", who: "Automatic" },
      { actor: "person", label: "Add income, expenses, bank balance", who: "Finance" },
      { actor: "ai", label: "Reads bank lines, writes CFO reports", who: "AI CFO" },
      { actor: "person", label: "Approve payments, file VAT", who: "Finance" },
    ],
    tasks: [
      { title: "Log an expense", steps: ["Click Add expense (top right), fill it in, click Save expense."] },
      { title: "Import bank lines", steps: ["Expenses tab → AI bookkeeper: paste the lines.", "Click AI: read these lines, check them, click Save selected."] },
      { title: "Update cash", steps: ["Overview tab → Update bank balance → Save."] },
      { title: "Check VAT", steps: ["Open Reports & VAT and read the estimate before filing."] },
    ],
    rules: [
      "AI keeps the books and drafts; people approve payments, file VAT and sign.",
      "Nothing is sent or filed from here.",
      "Pricing is a draft until real costs are in.",
    ],
    docs: ["docs/dpa-ad-pricing.md", "docs/billing-zatca.md"],
    related: ["billing", "ads", "people", "investors"],
  },
  ops: {
    what: "Operations holds the team's tasks, Saudi compliance and renewal deadlines, the tool stack and incidents.",
    flow: [
      { actor: "person", label: "Type a goal", who: "You" },
      { actor: "ai", label: "Plans it into tasks", who: "AI Operations planner" },
      { actor: "person", label: "Keep the tasks you want", who: "You" },
      { actor: "system", label: "Deadlines and renewals show on Home", who: "Automatic" },
    ],
    tasks: [
      { title: "Plan work", steps: ["Tasks tab → type a goal in AI planner, click AI: plan it.", "Tick the tasks, click Add selected tasks."] },
      { title: "Track deadlines", steps: ["Deadlines tab → Load Saudi starter calendar.", "Click Set real date on each one and Save date."] },
      { title: "Handle an incident", steps: ["Incidents tab → Log incident.", "Post updates as you go.", "Click AI: customer notice + postmortem and review it."] },
    ],
    rules: [
      "AI owns every task it can; people own approvals, filings, signatures, live calls and incident decisions.",
      "AI notices are drafts: nothing is published from here.",
    ],
    docs: ["docs/security-compliance.md"],
    related: ["compliance", "finance", "meetings"],
  },

  /* ------------------------------------------------------------ Team */
  workforce: {
    what: "AI Workforce manages every AI agent like an employee: its job, the person responsible, its autonomy level, monthly budget, cost and track record.",
    flow: [
      { actor: "ai", label: "Agents do their jobs", who: "AI agents" },
      { actor: "system", label: "Records outcome and cost", who: "Automatic" },
      { actor: "person", label: "Set level, budget, owner", who: "Owner, Admin" },
      { actor: "system", label: "Moves an agent down after mistakes", who: "Automatic" },
    ],
    tasks: [
      { title: "Change an agent's level", steps: ["Click an agent in the Agents list.", "Pick its Autonomy for this job, set the Monthly budget (USD), click Save."] },
      { title: "See who's working", steps: ["Switch between 3D office, Floor plan and Org chart.", "Filter the Agents list by team."] },
    ],
    rules: [
      "Levels: Off, Drafts (a person approves every item), Auto + spot-check, Fully automatic.",
      "An agent at level 2 or more moves down by itself after 3 rejections or errors in its last 20 items.",
      "An agent stops when it's paused or over its monthly budget.",
    ],
    docs: ["docs/ai-workforce-plan.md"],
    related: ["team", "command", "access"],
  },
  team: {
    what: "Hiring holds the AI-first org chart (which roles are AI agents and which must be people) and the hiring pipeline for the human roles.",
    flow: [
      { actor: "person", label: "Design the org: AI or person per role", who: "Owner" },
      { actor: "ai", label: "Writes the job post, screens candidates", who: "AI Recruiter" },
      { actor: "person", label: "Interview and decide", who: "Hiring manager" },
      { actor: "person", label: "Sign the offer", who: "Owner" },
    ],
    tasks: [
      { title: "Set up the org", steps: ["Click Org chart (top right) → Load suggested AI-first org, or Add role.", "For each human seat, fill in Why this must be a person."] },
      { title: "Hire for a role", steps: ["Click Hiring → Add candidate.", "Open the candidate, click AI: do this now for the next step.", "Drag the candidate between stages."] },
    ],
    rules: [
      "AI screens and drafts; people interview, decide and sign.",
      "The AI Recruiter judges skills and evidence only, and never sends on its own.",
    ],
    docs: ["docs/ai-workforce-plan.md"],
    related: ["workforce", "people", "legal"],
  },
  people: {
    what: "Attendance & payroll is for the team employed in India: punching in, leave, holidays and the monthly payroll with PF, ESI, PT and TDS estimates.",
    flow: [
      { actor: "person", label: "Punch in and out (My day)", who: "Each employee" },
      { actor: "system", label: "Daily status and leave balances", who: "Automatic" },
      { actor: "person", label: "Approve leave and corrections", who: "Manager" },
      { actor: "system", label: "Payroll draft for the month", who: "Automatic" },
      { actor: "person", label: "Approve, lock, pay, post to Finance", who: "Payroll editor" },
    ],
    tasks: [
      { title: "Add an employee", steps: ["Employees tab → Add employee.", "Link their dashboard login so they can punch in."] },
      { title: "Approve leave", steps: ["Open the Leave tab (or Today → Leave to approve).", "Click Approve or Reject."] },
      { title: "Run payroll", steps: ["Payroll tab → pick the Payroll month → Open.", "Check each line, click Approve and lock.", "Download Bank CSV, then Mark paid and Post to Finance."] },
    ],
    rules: [
      "Every rate is a FY 2025-26 default to verify with the CA.",
      "Approved runs are locked; only an Owner reverses one, with a reason.",
      "Salaries are hidden from roles without Payroll view.",
    ],
    docs: ["docs/hr-india.md"],
    related: ["team", "finance", "legal"],
  },

  /* ------------------------------------------------------------ Settings */
  access: {
    what: "Teams & roles gives each person their own login, sets what each role can do per module (None, View or Edit), groups people into teams and logs every change.",
    flow: [
      { actor: "person", label: "Add a person with a role", who: "Owner, Admin" },
      { actor: "person", label: "Set None / View / Edit per module", who: "Owner, Admin" },
      { actor: "system", label: "Server checks every request", who: "Automatic" },
      { actor: "system", label: "Every change goes in the Activity log", who: "Automatic" },
    ],
    tasks: [
      { title: "Give someone a login", steps: ["People tab → Add person.", "Type the name and email, pick a role, click Save."] },
      { title: "Change what a role can do", steps: ["Roles tab → pick None, View or Edit for each module.", "Or click Add role for a new one."] },
      { title: "See who changed what", steps: ["Open the Activity tab."] },
    ],
    rules: [
      "The server enforces access; the menu only hides what the server already refuses.",
      "The Owner role is locked and can do everything.",
      "The shared team password signs in as the Owner: give everyone their own login.",
    ],
    docs: ["docs/security-compliance.md"],
    related: ["compliance", "workforce", "command"],
  },
  compliance: {
    what: "Security & compliance holds backups, the personal data register, data requests, sub-processors, policies, access reviews, breach checklists and the public status page.",
    flow: [
      { actor: "system", label: "Nightly encrypted backup", who: "Scheduler" },
      { actor: "system", label: "Uptime check, security checks", who: "Automatic" },
      { actor: "ai", label: "Drafts policies and status updates", who: "AI Compliance officer" },
      { actor: "person", label: "Approve, answer data requests", who: "Owner, Admin" },
    ],
    tasks: [
      { title: "Check backups", steps: ["Backups tab → click Verify on the latest backup.", "Click Back up now before a big change."] },
      { title: "Answer a data request", steps: ["Data requests tab → Log request.", "Click Find data, then Export JSON or Delete data….", "To delete, type DELETE and click Delete permanently."] },
      { title: "Post on the status page", steps: ["Status page tab → Add notice, or Post update… on an incident."] },
    ],
    rules: [
      "Backups run nightly from 02:00 Riyadh, encrypted with BACKUP_KEY; only an Owner can download one.",
      "Deleting a person's data needs a logged request and the typed word DELETE.",
      "AI drafts; people approve every policy and update.",
    ],
    docs: ["docs/security-compliance.md"],
    related: ["access", "ops", "legal"],
  },
  legal: {
    what: "Legal & documents is the company's private document vault: certificates, licences, contracts and policies, with renewal and notice deadlines, templates and a signature log. Not legal advice.",
    flow: [
      { actor: "person", label: "Upload a document or create from a template", who: "Owner, Admin" },
      { actor: "ai", label: "Summarizes with a quote for every point", who: "AI Legal assistant" },
      { actor: "person", label: "Accept obligations, record signatures", who: "You" },
      { actor: "system", label: "Reminds before renewals and deadlines", who: "Automatic" },
    ],
    tasks: [
      { title: "Add a document", steps: ["Documents tab → open New document, fill in the dates, click Add document.", "Open it and Upload the file."] },
      { title: "Summarize a contract", steps: ["Open the document → Summarize the contract.", "Accept the suggested obligations you want to track."] },
      { title: "Make a draft from a template", steps: ["Templates tab → pick a template and counterparty.", "Click Create draft and fill every [ADD] and [CONFIRM]."] },
      { title: "See what's due", steps: ["Open the What's due tab."] },
    ],
    rules: [
      "Not legal advice: templates and AI summaries are starting points for a lawyer.",
      "Restricted documents are Owner and Admin only, everywhere.",
      "\"Signed\" needs a recorded signature with the signed file.",
      "Files are private; every download goes in the activity log.",
    ],
    docs: ["docs/legal-documents.md"],
    related: ["compliance", "investors", "people", "ops"],
  },
  investors: {
    what: "The Investor room tracks investors and the round, freezes live metrics into snapshots, shares a data room by expiring links, and drafts the monthly update.",
    flow: [
      { actor: "person", label: "Add investors and the round", who: "Owner" },
      { actor: "system", label: "Reads metrics live (\"No data yet\" if empty)", who: "Automatic" },
      { actor: "person", label: "Freeze metrics, fill the data room", who: "Owner" },
      { actor: "person", label: "Share an expiring link", who: "Owner" },
      { actor: "ai", label: "Drafts the monthly update with sources", who: "AI Investor relations" },
    ],
    tasks: [
      { title: "Add an investor", steps: ["Pipeline tab → open Add an investor, fill it in, click Add investor."] },
      { title: "Share the data room", steps: ["Data room tab → Add to the data room.", "Share links tab → New share link, pick items and expiry, click Create link.", "Click Copy link."] },
      { title: "Send the monthly update", steps: ["Monthly update tab → Draft the update.", "Write the lowlights, fill every [ADD], click Approve.", "Copy, Download .md, or Add to the data room."] },
    ],
    rules: [
      "Owner edits, Admin views; everyone else can't see the room at all.",
      "Metrics show \"No data yet\" instead of 0 or estimates.",
      "Share links expire, can have a passcode (stored only as a hash), can be revoked, and every view is logged.",
    ],
    docs: ["docs/investor-room.md"],
    related: ["finance", "legal", "okr"],
  },
};
