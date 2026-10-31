"""Playbooks: the marketing jobs the engine can do.

Each playbook = instructions + typed inputs + a typed output schema. Add a new
one by defining an output model and calling `register(...)`.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from pydantic import BaseModel, Field

from .schema import strict_schema


# ---------------------------------------------------------------- outputs ---

class Positioning(BaseModel):
    competitive_alternatives: list[str] = Field(description="What customers would use if this product didn't exist.")
    unique_attributes: list[str]
    value_themes: list[str] = Field(description="Customer value the unique attributes enable.")
    best_fit_customers: str
    market_category: str
    positioning_statement: str
    elevator_pitch: str
    tagline_options: list[str]
    words_to_use: list[str]
    words_to_avoid: list[str]


class Persona(BaseModel):
    name: str = Field(description="Memorable persona name, e.g. 'Ops Olivia'.")
    job_title: str
    seniority: str
    buying_role: str = Field(description="Economic buyer, champion, user, blocker...")
    goals: list[str]
    pains: list[str]
    objections: list[str]
    buying_triggers: list[str]
    channels: list[str] = Field(description="Where they spend attention: communities, publications, events.")
    messaging_hooks: list[str]


class ICPReport(BaseModel):
    ideal_customer_profile: str
    firmographics: list[str]
    disqualifiers: list[str]
    personas: list[Persona]


class MessageRow(BaseModel):
    persona: str
    core_message: str
    value_props: list[str]
    proof: list[str]
    call_to_action: str


class MessagingMatrix(BaseModel):
    master_message: str
    rows: list[MessageRow]


class PageSection(BaseModel):
    heading: str
    body: str


class FAQ(BaseModel):
    question: str
    answer: str


class LandingPage(BaseModel):
    seo_title: str
    meta_description: str
    hero_headline: str
    hero_subheadline: str
    primary_cta: str
    secondary_cta: str
    sections: list[PageSection]
    social_proof: list[str]
    faqs: list[FAQ]
    ab_test_headlines: list[str]


class Email(BaseModel):
    send_day: int = Field(description="Days after sequence start.")
    subject: str
    preview_text: str
    body: str


class EmailSequence(BaseModel):
    sequence_name: str
    target_persona: str
    strategy: str
    emails: list[Email]


class SocialPost(BaseModel):
    platform: str
    format: str = Field(description="text, carousel, thread, short video script...")
    hook: str
    body: str
    call_to_action: str
    hashtags: list[str]


class SocialPack(BaseModel):
    content_angle: str
    posts: list[SocialPost]


class AdGroup(BaseModel):
    name: str
    audience_targeting: str
    keywords_or_interests: list[str]
    headlines: list[str]
    descriptions: list[str]
    creative_concept: str


class AdCampaign(BaseModel):
    platform: str
    objective: str
    budget_split: str
    ad_groups: list[AdGroup]
    negative_keywords_or_exclusions: list[str]
    success_metrics: list[str]


class Article(BaseModel):
    title: str
    target_keyword: str
    search_intent: str
    funnel_stage: str
    outline: list[str]


class ContentPillar(BaseModel):
    pillar: str
    pillar_page_title: str
    articles: list[Article]


class SEOPlan(BaseModel):
    strategy_summary: str
    pillars: list[ContentPillar]
    quick_wins: list[str]


class Phase(BaseModel):
    name: str
    weeks: str
    objectives: list[str]
    actions: list[str]
    channels: list[str]
    kpis: list[str]


class GTMPlan(BaseModel):
    north_star_metric: str
    summary: str
    channel_priorities: list[str]
    budget_allocation: list[str]
    phases: list[Phase]
    risks_and_mitigations: list[str]


class Battlecard(BaseModel):
    competitor: str
    their_pitch: str
    their_strengths: list[str]
    their_weaknesses: list[str]
    how_we_win: list[str]
    landmine_questions: list[str] = Field(description="Questions that expose the competitor's weak spots.")
    objection_handling: list[FAQ]


class Battlecards(BaseModel):
    cards: list[Battlecard]


class CalendarItem(BaseModel):
    week: int
    day: str
    channel: str
    format: str
    topic: str
    hook: str
    goal: str


class ContentCalendar(BaseModel):
    theme: str
    items: list[CalendarItem]


class ProposalSection(BaseModel):
    heading: str
    body: str


class AgencyProposal(BaseModel):
    title: str
    executive_summary: str
    understanding_of_needs: list[str]
    sections: list[ProposalSection]
    deliverables: list[str]
    timeline: list[str]
    pricing_options: list[str]
    next_steps: list[str]


class KPIStatus(BaseModel):
    kpi: str
    latest_value: str
    vs_target: str
    trend: str
    status: str = Field(description="green, yellow, red, or no-data")


class Action(BaseModel):
    action: str
    owner: str
    due: str
    expected_impact: str


class KPIReport(BaseModel):
    headline: str = Field(description="One sentence: are we on track, with the key number.")
    what_happened: list[KPIStatus]
    why: list[str] = Field(description="Likely causes of red/yellow KPIs, broken down by channel, segment or funnel step.")
    so_what: str = Field(description="Effect on the north star and quarter goals.")
    now_what: list[Action] = Field(description="At most 3 actions.")
    data_gaps: list[str] = Field(description="Missing or suspicious data to fix before the next report.")


# -------------------------------------------------------------- registry ---

@dataclass
class InputField:
    name: str
    label: str
    default: str = ""
    help: str = ""


@dataclass
class Playbook:
    key: str
    title: str
    category: str
    description: str
    instructions: str
    output_model: type[BaseModel]
    inputs: list[InputField] = field(default_factory=list)
    # Earlier playbooks whose latest output is fed in as context ("brand memory").
    uses_context_from: list[str] = field(default_factory=list)
    for_agencies: bool = False
    # Feed the workspace's KPI definitions and logged values into the prompt.
    uses_kpis: bool = False

    @property
    def schema(self) -> dict[str, Any]:
        return strict_schema(self.output_model)

    def describe(self) -> dict[str, Any]:
        return {
            "key": self.key,
            "title": self.title,
            "category": self.category,
            "description": self.description,
            "for_agencies": self.for_agencies,
            "uses_context_from": self.uses_context_from,
            "uses_kpis": self.uses_kpis,
            "inputs": [vars(i) for i in self.inputs],
        }


PLAYBOOKS: dict[str, Playbook] = {}


def register(pb: Playbook) -> Playbook:
    PLAYBOOKS[pb.key] = pb
    return pb


register(Playbook(
    key="positioning",
    title="Positioning & Messaging Foundation",
    category="Strategy",
    description="Competitive alternatives, unique value, category, positioning statement and taglines.",
    instructions=(
        "Build sharp positioning using the competitive-alternatives method: start from what "
        "customers would do without this product, isolate the unique attributes, translate them "
        "into value, then name who cares most and the market category that makes the value obvious. "
        "Give 5 tagline options. Be specific - no generic claims like 'powerful' or 'seamless'."
    ),
    output_model=Positioning,
))

register(Playbook(
    key="icp_personas",
    title="ICP & Buyer Personas",
    category="Strategy",
    description="Ideal customer profile, disqualifiers and 3 buying-committee personas.",
    instructions=(
        "Define the ideal customer profile and {persona_count} personas covering the buying "
        "committee (economic buyer, champion, end user). Use concrete pains, triggers and the real "
        "places these people spend attention."
    ),
    output_model=ICPReport,
    inputs=[InputField("persona_count", "Number of personas", "3")],
    uses_context_from=["positioning"],
))

register(Playbook(
    key="messaging_matrix",
    title="Messaging Matrix",
    category="Strategy",
    description="Master message plus persona-specific value props, proof and CTAs.",
    instructions="Write one master message and one row per persona. Tie every value prop to proof.",
    output_model=MessagingMatrix,
    uses_context_from=["positioning", "icp_personas"],
))

register(Playbook(
    key="landing_page",
    title="Landing Page Copy",
    category="Website",
    description="Conversion-focused page copy with SEO meta, sections, FAQs and A/B headlines.",
    instructions=(
        "Write landing page copy for: {page_goal}. Lead with the outcome, not the feature. "
        "Include 5-7 sections (problem, solution, how it works, features-as-benefits, proof, "
        "pricing teaser, final CTA), 5 FAQs that handle real objections and 3 A/B headline variants."
    ),
    output_model=LandingPage,
    inputs=[InputField("page_goal", "Page goal", "Book a demo", "e.g. free trial signups, waitlist")],
    uses_context_from=["positioning", "messaging_matrix"],
))

register(Playbook(
    key="cold_email_sequence",
    title="Outbound Email Sequence",
    category="Sales",
    description="Multi-step cold/warm email sequence for one persona.",
    instructions=(
        "Write a {steps}-email outbound sequence for {persona}. Each email under 120 words, one "
        "idea per email, personalisation placeholders like {{first_name}} and {{company}}, a "
        "low-friction CTA, and a breakup email at the end. No spammy subject lines."
    ),
    output_model=EmailSequence,
    inputs=[
        InputField("persona", "Target persona", "the economic buyer"),
        InputField("steps", "Number of emails", "5"),
    ],
    uses_context_from=["icp_personas", "messaging_matrix"],
))

register(Playbook(
    key="social_posts",
    title="Social Media Post Pack",
    category="Content",
    description="Ready-to-post social content with hooks, bodies and CTAs.",
    instructions=(
        "Write {count} {platform} posts about: {topic}. Strong first-line hooks, native to the "
        "platform's format, mix educational, story and proof posts, at most one promotional post in five."
    ),
    output_model=SocialPack,
    inputs=[
        InputField("platform", "Platform", "LinkedIn", "LinkedIn, X, Instagram, TikTok..."),
        InputField("count", "Number of posts", "5"),
        InputField("topic", "Topic / angle", "the core problem we solve"),
    ],
    uses_context_from=["positioning", "messaging_matrix"],
))

register(Playbook(
    key="ad_campaign",
    title="Paid Ads Campaign",
    category="Paid",
    description="Campaign structure, targeting, keywords and ad copy for one ad platform.",
    instructions=(
        "Design a {platform} campaign with objective '{objective}' and monthly budget {budget}. "
        "Create 3 ad groups by intent or audience, 5 headlines and 3 descriptions each, respecting "
        "{platform}'s character limits."
    ),
    output_model=AdCampaign,
    inputs=[
        InputField("platform", "Ad platform", "Google Search", "Google Search, Meta, LinkedIn..."),
        InputField("objective", "Objective", "demo requests"),
        InputField("budget", "Monthly budget", "$3,000"),
    ],
    uses_context_from=["icp_personas", "messaging_matrix"],
))

register(Playbook(
    key="seo_content_plan",
    title="SEO Content Plan",
    category="Content",
    description="Topic pillars, keyword-targeted article clusters with outlines, and quick wins.",
    instructions=(
        "Build an SEO plan with {pillars} pillars and 4 articles per pillar, spanning top, middle "
        "and bottom of funnel (include comparison and 'alternative to' pages). Keywords should be "
        "realistic for a growing domain."
    ),
    output_model=SEOPlan,
    inputs=[InputField("pillars", "Number of pillars", "3")],
    uses_context_from=["positioning", "icp_personas"],
))

register(Playbook(
    key="gtm_plan",
    title="90-Day Go-To-Market Plan",
    category="Strategy",
    description="Phased plan with channels, weekly actions, KPIs and budget split.",
    instructions=(
        "Create a 90-day go-to-market plan toward the stated goals with team size '{team}'. Three "
        "phases (foundation, launch, scale), prioritise 2-3 channels that fit the ICP and budget, "
        "concrete weekly actions and measurable KPIs."
    ),
    output_model=GTMPlan,
    inputs=[InputField("team", "Marketing team", "1 marketer + founder")],
    uses_context_from=["positioning", "icp_personas"],
))

register(Playbook(
    key="competitor_battlecards",
    title="Competitor Battlecards",
    category="Sales",
    description="How to win against each competitor, with landmine questions and objection handling.",
    instructions=(
        "Create a battlecard for each listed competitor (or the 3 most likely if none are listed). "
        "Be fair about their strengths; only claim weaknesses that are commonly known or "
        "verifiable, and flag anything the team should verify."
    ),
    output_model=Battlecards,
    uses_context_from=["positioning"],
))

register(Playbook(
    key="content_calendar",
    title="Content Calendar",
    category="Content",
    description="A multi-week, multi-channel publishing calendar.",
    instructions=(
        "Plan a {weeks}-week content calendar across {channels} with {per_week} items per week. "
        "Each item gets a topic, hook and goal. Balance awareness, engagement and conversion."
    ),
    output_model=ContentCalendar,
    inputs=[
        InputField("weeks", "Weeks", "4"),
        InputField("channels", "Channels", "LinkedIn, blog, newsletter"),
        InputField("per_week", "Items per week", "3"),
    ],
    uses_context_from=["positioning", "icp_personas"],
))

register(Playbook(
    key="agency_proposal",
    title="Agency Client Proposal",
    category="Agency",
    description="Win new clients: a tailored proposal written from your agency's brief.",
    instructions=(
        "The brand brief describes OUR agency. Write a tailored proposal to win this prospect: "
        "{prospect}. Show we understand their situation, propose a scoped engagement, and give "
        "three pricing options (good / better / best)."
    ),
    output_model=AgencyProposal,
    inputs=[InputField("prospect", "Prospect", "", "Who they are, what they need, budget if known")],
    for_agencies=True,
))


register(Playbook(
    key="kpi_report",
    title="KPI Report & Analysis",
    category="Reports",
    description="Analyzes your logged KPIs: what happened, why, so what, now what.",
    instructions=(
        "Write the {report_type} report from the KPI data provided. Follow the four steps: what "
        "happened (each KPI vs target and previous period, marked green/yellow/red), why (break red "
        "and yellow KPIs down to likely causes), so what (effect on the north star and quarterly "
        "goals), now what (at most 3 actions with owner and due date). Use only the numbers given - "
        "if data is missing, say so in data_gaps instead of guessing."
    ),
    output_model=KPIReport,
    inputs=[InputField("report_type", "Report type", "weekly KPI pulse", "weekly KPI pulse, monthly business review, quarterly review")],
    uses_context_from=["gtm_plan"],
    uses_kpis=True,
))


# Ordered chain for one-click "full launch kit".
LAUNCH_KIT = [
    "positioning",
    "icp_personas",
    "messaging_matrix",
    "landing_page",
    "cold_email_sequence",
    "social_posts",
    "ad_campaign",
    "gtm_plan",
]
