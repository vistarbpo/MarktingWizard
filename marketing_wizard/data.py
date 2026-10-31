"""Company data: default KPI set (from the SOP) and data-gap questions."""

from __future__ import annotations

from .models import KPI, NOTE_CATEGORIES, BrandBrief, Note

# The KPI set from the SaaS Marketing & Growth SOP, tailored to a catalog-driven
# AI creative product sold to online stores.
DEFAULT_KPIS: list[KPI] = [
    KPI(stage="Discovery", name="App listing views", formula="Views of our app store pages", owner="Marketplace Manager"),
    KPI(stage="Discovery", name="Rating", formula="Average app store star rating", unit="stars", owner="Marketplace Manager", target=4.8),
    KPI(stage="Acquisition", name="Signups / installs", formula="New accounts or app installs", owner="Marketplace Manager"),
    KPI(stage="Acquisition", name="Listing conversion", formula="Installs / listing views", unit="%", owner="Marketplace Manager"),
    KPI(stage="Acquisition", name="Demos booked", formula="Qualified demos booked", owner="Sales"),
    KPI(stage="Acquisition", name="Agency-sourced signups", formula="Signups referred by partner agencies", frequency="monthly", owner="Partnerships"),
    KPI(stage="Activation", name="Feed import rate", formula="Stores with feed imported in 48h / signups", unit="%", owner="Onboarding"),
    KPI(stage="Activation", name="Time to first creatives", formula="Median hours from signup to first export", unit="hours", owner="Onboarding", higher_is_better=False),
    KPI(stage="Activation", name="Activation rate", formula="Feed imported + creatives exported in 7 days / signups", unit="%", owner="Onboarding"),
    KPI(stage="Revenue", name="Trial-to-paid", formula="Paying stores / finished trials", unit="%", owner="Head of Growth"),
    KPI(stage="Revenue", name="Net new MRR", formula="New + expansion - churned - contraction MRR", unit="$", owner="Head of Growth"),
    KPI(stage="Revenue", name="ARPA by SKU plan", formula="MRR / paying stores", unit="$", frequency="monthly", owner="Head of Growth"),
    KPI(stage="Revenue", name="Credit top-up revenue", formula="Revenue from extra credits", unit="$", owner="Head of Growth"),
    KPI(stage="Value", name="Stores running creative tests", formula="Paying stores that exported creatives this month", owner="Customer Success"),
    KPI(stage="Value", name="Creatives per product", formula="Creatives exported / products in feed", frequency="monthly", owner="Customer Success"),
    KPI(stage="Value", name="Merchant ROAS", formula="Ad revenue / ad spend on our creatives", unit="x", frequency="monthly", owner="Customer Success"),
    KPI(stage="Retention", name="Churn rate", formula="Stores lost / active stores at start of month", unit="%", frequency="monthly", owner="Customer Success", higher_is_better=False),
    KPI(stage="Retention", name="Net revenue retention", formula="(Start MRR + expansion - contraction - churn) / start MRR", unit="%", frequency="monthly", owner="Customer Success"),
    KPI(stage="Economics", name="CAC", formula="Sales + marketing spend / new paying stores", unit="$", frequency="monthly", owner="Head of Growth", higher_is_better=False),
    KPI(stage="Economics", name="CAC payback", formula="CAC / (ARPA x gross margin)", unit="months", frequency="quarterly", owner="Head of Growth", higher_is_better=False),
]

_BRIEF_QUESTIONS = {
    "one_liner": "What does the product do, in one sentence?",
    "target_customers": "Who exactly buys it (store type, size, country, role of the buyer)?",
    "problems_solved": "What problems does it solve for those customers?",
    "key_features": "What are the main features?",
    "differentiators": "Why do customers choose you over alternatives?",
    "competitors": "Who are the competitors, or what do customers use instead today?",
    "pricing": "What are the plans and prices (SKU limits, credits)?",
    "markets": "Which markets and languages, in what order?",
    "integrations": "How do customers connect today, and what is planned with dates?",
    "proof_points": "What results can you show (customers, ROAS, time saved, case studies)?",
    "brand_voice": "How should the brand sound?",
    "goals": "What are the goals for this quarter, with numbers?",
    "budget": "What is the monthly marketing budget?",
}

_NOTE_QUESTIONS = {
    "results": "Add real customer results: before/after ROAS, CTR, time saved.",
    "objections": "Add the objections you hear most in demos, and how you answer them.",
    "customers": "Add 3-5 real or target customer examples (store, catalog size, why they bought).",
    "competitors": "Add what you know about each competitor: pricing, strengths, weaknesses.",
    "sales": "Add your sales process: demo script, trial length, who decides.",
}


def data_gaps(brief: BrandBrief, notes: list[Note], kpis_with_values: int, kpi_count: int) -> list[dict]:
    """What the engine still needs to know, as plain questions, most important first."""
    gaps: list[dict] = []
    for field, question in _BRIEF_QUESTIONS.items():
        if not getattr(brief, field).strip():
            gaps.append({"area": "brief", "field": field, "question": question})
    have = {n.category for n in notes}
    for cat, question in _NOTE_QUESTIONS.items():
        if cat not in have:
            gaps.append({"area": "knowledge", "field": cat, "question": question})
    if kpi_count == 0:
        gaps.append({"area": "kpis", "field": "setup", "question": "Load the SOP KPI set so you can start tracking."})
    elif kpis_with_values == 0:
        gaps.append({"area": "kpis", "field": "values", "question": "Log this week's KPI numbers so reports can analyze them."})
    return gaps


assert set(_NOTE_QUESTIONS) <= set(NOTE_CATEGORIES)
