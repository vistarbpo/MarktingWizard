"""Core domain models."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from pydantic import BaseModel, Field


class BrandBrief(BaseModel):
    """Everything the engine needs to know about a product. Fill it once, reuse everywhere."""

    company_name: str
    product_name: str = ""
    website: str = ""
    one_liner: str = Field("", description="What the product does in one sentence.")
    category: str = Field("", description="e.g. 'B2B SaaS - sales analytics', 'Design agency'.")
    business_model: str = Field("saas", description="'saas' or 'agency' (or anything else).")
    target_customers: str = Field("", description="Who buys it: industries, company size, roles.")
    problems_solved: str = ""
    key_features: str = ""
    differentiators: str = ""
    competitors: str = ""
    pricing: str = ""
    markets: str = Field("", description="Countries/regions and languages, in launch order.")
    integrations: str = Field("", description="How customers connect: platforms, feeds, API - live vs planned.")
    proof_points: str = Field("", description="Customers, metrics, case studies, awards.")
    brand_voice: str = Field("", description="e.g. 'confident, plain-spoken, a little witty'.")
    goals: str = Field("", description="e.g. '100 demo calls/month', 'launch in DACH'.")
    budget: str = ""
    extra_notes: str = ""

    def as_prompt(self) -> str:
        lines = []
        for name, field in BrandBrief.model_fields.items():
            value = getattr(self, name)
            if value:
                label = name.replace("_", " ").title()
                lines.append(f"- {label}: {value}")
        return "\n".join(lines)


class Workspace(BaseModel):
    """A brand being marketed. SaaS teams have one; agencies have one per client."""

    id: Optional[int] = None
    brief: BrandBrief
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class Asset(BaseModel):
    """One generated deliverable (a playbook run)."""

    id: Optional[int] = None
    workspace_id: int
    playbook: str
    inputs: dict[str, Any] = Field(default_factory=dict)
    output: dict[str, Any]
    provider: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


NOTE_CATEGORIES = [
    "product", "pricing", "customers", "competitors", "results", "objections", "sales", "brand", "other",
]


class Note(BaseModel):
    """A piece of company knowledge. Every playbook reads all notes for its workspace."""

    id: Optional[int] = None
    workspace_id: Optional[int] = None
    category: str = "other"
    title: str
    content: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class KPI(BaseModel):
    id: Optional[int] = None
    workspace_id: Optional[int] = None
    stage: str = ""
    name: str
    formula: str = ""
    unit: str = ""
    frequency: str = "weekly"
    owner: str = ""
    target: Optional[float] = None
    higher_is_better: bool = True


class KPIValue(BaseModel):
    id: Optional[int] = None
    kpi_id: Optional[int] = None
    period: str = Field(description="e.g. '2026-W44', '2026-10', or an ISO date.")
    value: float
    note: str = ""
