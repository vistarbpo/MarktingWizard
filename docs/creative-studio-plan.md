# Creative Studio: plan

A new dashboard module for DPA AD's own marketing content: designed emails, WhatsApp media messages, social posts, carousels and reels. You plan them on a calendar, AI makes them, a person approves them, and the studio schedules and publishes them. Status: **phases 1–3 built** (Nov 2026), plus comments and DMs into AI Support; the rest of phase 4 is planned. Section 8 says how it was built and what each platform's app review needs.

Same rule as the rest of the dashboard: AI does every step it can (ideas, copy, design, editing, scheduling, reporting); people approve, film, record voice and take anything the AI flags.

## 1. What the module does

| Area | What it does | AI does | People do |
|---|---|---|---|
| **Brand kit** | Logos, colours, Arabic + English fonts, tone of voice, do/don't list, approved claims, product screenshots | Checks every draft against it | Set it once, update rarely |
| **Content calendar** | Month and week view of everything planned, across all channels | Suggests a month of content from pillars, the Saudi season calendar and what worked last month | Approve the plan |
| **Idea bank** | Ideas from Knowledge, ROAS results, support questions, store replies, competitor ads | Turns each into a brief: angle, hook, format, channels | Star the good ones |
| **Studio (editor)** | One idea → every format: reel 9:16, post 1:1 / 4:5, carousel, story, YouTube 16:9, email, WhatsApp image | Writes Arabic and English copy, fills templates, cuts the reel, writes captions and hashtags | Tweak, record voice or face when needed |
| **Email designer** | Block-based, responsive, right-to-left Arabic, dark-mode safe, desktop and phone preview | Builds the email from a brief; plain-text version; spam-word check | Approve |
| **WhatsApp creatives** | Image or video header templates with buttons ("أرسل لي ٣ نماذج") | Drafts the template for Meta approval and per-store variants | Submit and approve templates |
| **Approvals** | Draft → In review → Approved → Scheduled → Published, with comments and version history | Flags risky claims, missing disclosures, wrong sizes | Creative lead approves; founder for big claims |
| **Scheduler and publisher** | Connected accounts, queue, best Saudi times, per-platform caption, first comment, retries, publish log | Picks times, checks each platform's rules before posting | Connect accounts once |
| **Asset library** | Every image, video, voice, music file and template, with tags, rights and AI-generated flag | Tags and finds assets | Upload real photos and footage |
| **Results** | Reach, engagement, saves, shares and watch time per post; email opens and clicks; WhatsApp reads; which pillars and formats work | Weekly "what worked" report and next month's suggestions | Decide what to double down on |

## 2. Channels

| Channel | How it publishes | What you need (one time) |
|---|---|---|
| **Email** | Through the Store CRM's sending (already built) plus the new designer | The cold-email domain and mailbox (already on the to-do list) |
| **WhatsApp** | WhatsApp Cloud API media templates (image or video header + buttons), through the CRM | WhatsApp Business account; each template approved by Meta; per-message marketing fees |
| **Instagram** (posts, carousels, reels, stories) | Meta Graph API content publishing | Instagram Business account linked to a Facebook Page; a Meta app with publishing permissions passed through App Review |
| **Facebook Page** (posts, reels) | Meta Graph API | Same Meta app and Page |
| **YouTube** (Shorts and long videos) | YouTube Data API upload | Google Cloud project with an audited app: unaudited apps can only upload private videos, and each upload uses a large share of the daily API quota |
| **TikTok** | TikTok Content Posting API | TikTok developer app that passes TikTok's audit; until then posts are private only |
| **LinkedIn** (founder and company page) | LinkedIn Posts API | LinkedIn app and page admin access |
| **X** | X API (paid tier for posting) | X developer account |
| **Snapchat** | Organic posting by API is limited; Snap ads go through the Snap Marketing API | Snap Business account |

The approvals take weeks, so each platform gets a **"download and post"** fallback from day one: the studio prepares the file, caption and hashtags, and a person posts by hand and taps "posted".

## 3. Features beyond the basics

1. **"Your products as ads" emails.** Every outreach email can show 3 sample ads made from that store's own products, using DPA AD's own rendering. This is the strongest possible hook for cold outreach, and it shows the product instead of describing it. It needs DPA AD's render engine to accept a store link.
2. **One idea, every format.** Write once and get the reel, carousel, post, story, email and WhatsApp version, in Arabic and English, sized for each platform.
3. **Saudi season calendar built in.** White Friday, Ramadan, Eid al-Fitr, Eid al-Adha, Founding Day (22 Feb), National Day (23 Sep), back to school and payday weeks. Lead times are set for each: Ramadan content is ready in January.
4. **Best times for Saudi audiences**, learned from your own results, with a different schedule during Ramadan (after iftar into the night).
5. **Content from real results.** ROAS results and case studies turn into "before / after" posts automatically. Only real numbers, and the store's written permission before naming them.
6. **Reel builder:** AI script → AI Arabic voiceover (with an option to record your own) → product shots or screen recordings → burned-in Arabic captions → licensed music → cover image.
7. **Founder content.** The SOP's daily posting step becomes a queue: AI drafts the founder's X and LinkedIn posts from the week's work, and the founder edits them in their own voice.
8. **A/B tests for content:** two hooks or two covers for the same post, the winner reported. One change at a time, like CRM campaigns.
9. **Checks before posting:** caption length, video length and size per platform, Arabic text in safe areas, AI-content disclosure label, music licence, no unapproved claims.
10. **Comments and DMs later.** Replies from Instagram, Facebook and TikTok come into AI Support (phase 4).

## 4. Team and roles

New role **Creative** in Teams & roles: edit Creative Studio, view Knowledge and ROAS results, no Finance.

AI agents:

| Agent | Job |
|---|---|
| Content strategist | Monthly calendar and briefs |
| Copywriter | Arabic and English captions, emails, scripts |
| Designer | Fills templates, makes every size |
| Video editor | Assembles reels |
| Publisher | Schedules and posts |
| Analyst | Weekly results |

People: a creative lead approves, the founder films talking-head clips and approves claims, and a part-time designer owns the templates.

## 5. How it's built

- **Data (new collections):** brand kit, templates, content items (one idea with its variants per channel), assets, connected accounts, publish jobs, results.
- **Rendering images and video needs heavy tools** (a headless browser and FFmpeg) that Hostinger's shared Node hosting can't run reliably. Three options:
  1. **DPA AD's own render engine** (recommended). The company's marketing runs on its own product, and personalized "your products" emails come for free. Depends on the product team.
  2. **A rendering API** (for example Creatomate, Shotstack or Bannerbear). Fastest to start; costs per render.
  3. **A small VPS** (Hostinger has them) running the renderer next to the dashboard. Cheapest per render; more to maintain.
- **Emails** are plain HTML and need no renderer, so they can start right away.
- **Publishing** uses each platform's official API with the account owner's login (OAuth). Tokens are stored encrypted, never in git.

## 6. Phases

| Phase | Weeks | What you get | Depends on |
|---|---|---|---|
| **1. Plan and write** | 2 | Brand kit, calendar with the Saudi seasons, idea bank, AI copy in Arabic and English, approvals, Creative role, email designer plugged into CRM campaigns, "download and post" for every platform | Nothing new |
| **2. Design and publish** (built) | 2–3 | Image templates (posts, carousels, stories, WhatsApp headers), rendering, scheduler, direct publishing to Instagram, Facebook and LinkedIn, publish log | Rendering choice; Meta app review |
| **3. Reels and video** (built) | 3 | Reel builder with voiceover, captions and music; YouTube Shorts and TikTok publishing; results pulled from each platform | Rendering; YouTube and TikTok audits; voice and music budget |
| **4. Personal and social** | 2–3 | "Your products as ads" outreach emails and WhatsApp, comments and DMs into AI Support, content A/B tests | DPA AD render API |

## 7. Decisions needed from the founder

1. **Rendering:** DPA AD's own engine, a rendering API, or a VPS?
2. **Publishing:** build direct integrations (needs each platform's app review), or use a scheduling service's API for the first months?
3. **Which channels first:** suggested Instagram, TikTok, Snapchat and email for Saudi merchants, plus LinkedIn and X for founder branding and agencies.
4. **Who approves content**, and does every post need approval or only reels and claims?
5. **Monthly budget** for AI voice, music licences, rendering and WhatsApp marketing messages.

## 8. How phases 2–3 were built (Nov 2026)

Decisions taken: render **in the person's browser** (Hostinger shared hosting can't run headless Chrome or ffmpeg), and publish through **each platform's official API** with the account owner's OAuth login. **Test mode by default**, like the Store CRM: it logs "would publish" and calls no API until an approver switches Studio → Accounts to Live. **Auto-publish is off by default**: due scheduled posts wait for someone to click "Publish now". The one check is `canAutoPublish(ws)` in `web/lib/publisher.js`, ready to tie to an AI Workforce autonomy level.

| Built | Where |
|---|---|
| Media library: upload, tags, AI-generated flag, licence note, "I have the rights" for voice and music, public URL, delete | Studio → Assets; `web/lib/media.js` |
| 8 image templates (post 4:5, square, story, carousel slide, before/after, price card, YouTube thumbnail, WhatsApp header), one click renders every size the item's channels need and attaches it (JPEG, since Instagram only takes JPEG) | Post → channel → "Design with a template"; `web/public/studio-render.js` |
| Reel builder: scenes (image or video, Arabic text, length, motion), voice or music, cover frame, 1080×1920 at 30 fps up to 60 s, MP4 attached to the reel, TikTok, Short and Snapchat channels; the script can fill the scenes | Post → video channel → "Build the reel" |
| Connected accounts: Meta (Page + Instagram), LinkedIn, YouTube, TikTok. Tokens encrypted at rest (AES-256-GCM), never sent to the browser | Studio → Accounts; `web/lib/social.js` |
| Scheduler and publishing: every minute, Riyadh time, only approved or scheduled content, 3 tries then stop, publish log | `web/lib/publisher.js` |
| Results every 6 hours: Instagram insights, Facebook post counts, YouTube statistics, TikTok video metrics; totals by channel and pillar, top posts, AI "what worked" from the real numbers only | Studio → Results |
| Comments (polled every 15 min, and by webhook) and Instagram/Messenger DMs (webhook) become AI Support tickets with an AI draft; a person sends it and it goes back through the API (DMs only within Meta's 24 h window) | AI Support; `/hooks/meta` |

Limits to know:
- **Audio in reels** needs AAC encoding in the browser: Chrome and Edge on Windows and Mac have it; Chrome on Linux doesn't (the builder says so and can still make a silent reel). Safari and Firefox may lack WebCodecs H.264: use desktop Chrome or Edge.
- **LinkedIn video** and **LinkedIn results** aren't built (they need the Videos API and analytics access). X and Snapchat stay "download and post".
- Files are public at unguessable links, because Instagram, Facebook and TikTok fetch them from our server. Don't upload anything private.

### What each platform needs before Live

| Platform | Developer console | Redirect URL to register | Needs app review | Until then |
|---|---|---|---|---|
| **Meta** (Facebook Page + Instagram) | developers.facebook.com → app (Business type) → Facebook Login for Business, Instagram Graph API, Messenger, Webhooks | `https://wizard.dpa.ad/oauth/meta/callback`; webhook `https://wizard.dpa.ad/hooks/meta` with `META_VERIFY_TOKEN` (fields: messages, comments, feed) | Advanced access for `pages_read_engagement`, `pages_manage_posts`, `instagram_basic`, `instagram_content_publish`, `instagram_manage_insights`, `instagram_manage_comments`, `pages_manage_engagement`, `pages_messaging`, `instagram_manage_messages`; Business Verification | Works only for people with a role on the app and Pages they manage; that's enough for DPA AD's own Page |
| **LinkedIn** | linkedin.com/developers → app → products "Sign In with LinkedIn using OpenID Connect" and "Share on LinkedIn" | `https://wizard.dpa.ad/oauth/linkedin/callback` | Company page posting: Community Management API (then set `LINKEDIN_ORG_ID`) | Founder's own profile only; tokens last 60 days, then reconnect |
| **YouTube** | console.cloud.google.com → enable YouTube Data API v3 → OAuth client (Web) and consent screen | `https://wizard.dpa.ad/oauth/google/callback` | Consent-screen verification for `youtube.upload`, and the YouTube API compliance audit (then `YOUTUBE_AUDITED=1`) | Uploads are private; each upload uses ~1,600 of 10,000 daily quota units |
| **TikTok** | developers.tiktok.com → app → Login Kit + Content Posting API (Direct Post) | `https://wizard.dpa.ad/oauth/tiktok/callback` | App audit for `video.publish` (then `TIKTOK_AUDITED=1`); the audit checks TikTok's posting UX rules | Every post is private (SELF_ONLY) |

Env vars (hPanel, never git): `TOKEN_KEY` (set it first; 64 hex characters), `META_APP_ID`, `META_APP_SECRET`, `META_VERIFY_TOKEN`, `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`; optional `META_GRAPH_VERSION` (default v23.0), `LINKEDIN_VERSION` (default 202510), `LINKEDIN_ORG_ID`, `YOUTUBE_AUDITED`, `TIKTOK_AUDITED`. `PUBLIC_URL` must be the real https address, because platforms fetch media from it.

Every platform call is tested with mocks only. Endpoint details most likely to drift are marked `// verify against current docs` in `web/lib/social.js`; check them on the first live post for each platform.
