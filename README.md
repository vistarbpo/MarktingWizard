# 🪄 Marketing Wizard

**An AI marketing engine for SaaS companies and agencies.**

AI made building products easy. Sales and marketing are still hard. Marketing Wizard turns
**one product brief** into a full, consistent marketing system: positioning, buyer personas,
messaging, landing pages, outbound sequences, social posts, ad campaigns, SEO plans,
battlecards and a 90-day go-to-market plan.

## How it works

```
 Brand brief ──► Positioning ──► ICP & Personas ──► Messaging Matrix ──┐
 (fill once)          │                 │                 │            │
                      └──── brand memory: every later playbook reads ──┘
                                        the latest strategy work
                                                 │
       ┌────────────┬──────────────┬────────────┼─────────────┬──────────────┐
  Landing page  Email sequence  Social posts  Paid ads   SEO plan   GTM plan ...
```

* **Workspaces**: one per brand. SaaS teams use one; agencies create one per client.
* **Playbooks**: each marketing job is a playbook with typed inputs and a strict JSON output
  schema. Claude's structured outputs guarantee the shape, so the output is ready to use in the UI,
  to export, or to push into other tools.
* **Brand memory**: playbooks automatically receive earlier strategy outputs (for example,
  the landing page is written from your positioning and messaging matrix), so everything stays on-message.
* **Launch kit**: one click runs the whole chain, from positioning through ads to a GTM plan.
* **No made-up proof**: the engine is told never to invent customers, stats or testimonials. It
  writes `[ADD CUSTOMER METRIC]` style placeholders instead.

### Playbooks

| Key | What you get |
|---|---|
| `positioning` | Competitive alternatives, unique value, category, positioning statement, taglines |
| `icp_personas` | ICP, disqualifiers, buying-committee personas (pains, triggers, channels) |
| `messaging_matrix` | Master message and per-persona value props, proof and CTAs |
| `landing_page` | Hero, sections, FAQs, SEO meta, A/B headlines |
| `cold_email_sequence` | Multi-step outbound sequence with personalisation tokens |
| `social_posts` | Platform-native post pack (LinkedIn, X, Instagram, TikTok...) |
| `ad_campaign` | Campaign structure, targeting, keywords and ad copy (Google, Meta, LinkedIn) |
| `seo_content_plan` | Pillars, keyword-targeted article clusters with outlines, quick wins |
| `gtm_plan` | 90-day phased plan with channels, actions, KPIs and budget split |
| `competitor_battlecards` | How to win, landmine questions, objection handling |
| `content_calendar` | Multi-week, multi-channel publishing calendar |
| `agency_proposal` | *(agencies)* A tailored proposal to win a prospect, with tiered pricing |

To add a playbook, define a Pydantic output model in `marketing_wizard/playbooks.py` and call `register(...)`.

## Quick start

```bash
pip install -e ".[dev]"
export ANTHROPIC_API_KEY=sk-ant-...   # without a key it runs in offline demo mode
mwiz serve                            # open http://127.0.0.1:8000
```

CLI:

```bash
mwiz new examples/saas_brief.json          # -> workspace 1
mwiz run 1 positioning
mwiz run 1 social_posts -i platform=LinkedIn -i count=10 -i topic="forecast accuracy"
mwiz launch-kit 1 > launch-kit.md
mwiz export 1 > everything.md
```

HTTP API (interactive docs at `/docs`):

| Method | Path | |
|---|---|---|
| `GET` | `/api/playbooks` | list playbooks and their inputs |
| `POST` | `/api/workspaces` | create a workspace from a brand brief |
| `POST` | `/api/workspaces/{id}/run/{playbook}` | run a playbook (`{"inputs": {...}}`) |
| `POST` | `/api/workspaces/{id}/launch-kit` | run the full chain |
| `GET` | `/api/workspaces/{id}/assets` | generated history |
| `GET` | `/api/workspaces/{id}/export` | everything as Markdown |

## Configuration

| Env var | Default | |
|---|---|---|
| `ANTHROPIC_API_KEY` | | Claude API key (an `ant auth login` profile also works) |
| `MWIZ_MODEL` | `claude-opus-5-5` | Claude model |
| `MWIZ_EFFORT` | `high` | `low` / `medium` / `high` / `xhigh` / `max`: depth vs. cost |
| `MWIZ_MAX_TOKENS` | `32000` | per-generation output cap |
| `MWIZ_DB` | `data/marketing_wizard.db` | SQLite path |
| `MWIZ_PROVIDER` | auto | `claude` or `offline` (placeholder output for demos and tests) |

Claude requests use adaptive thinking, streaming and structured outputs. They also opt in to
server-side refusal fallbacks (`fallbacks: "default"`).

## Tests

```bash
pytest
```

## Roadmap ideas

- Publish directly: schedule social posts, push ads to Meta/Google/LinkedIn, sync sequences to HubSpot/Apollo
- Performance loop: pull campaign metrics back in and have the engine suggest the next experiment
- Brand-voice training from existing website and content
- Multi-user auth and client-facing share links for agencies
