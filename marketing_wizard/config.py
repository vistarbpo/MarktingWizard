"""Runtime configuration, read from environment variables."""

from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    model: str = "claude-opus-5-5"
    # Effort controls thinking depth and token spend. Opus 5.5 defaults to
    # "medium"; strategy work benefits from "high", so we set it explicitly.
    effort: str = "high"
    max_tokens: int = 32000
    db_path: str = "data/marketing_wizard.db"
    # "claude", "offline" (schema-valid placeholder output for demos/tests),
    # or "" to auto-detect: Claude when credentials exist, else offline.
    provider: str = ""


def get_settings() -> Settings:
    return Settings(
        model=os.getenv("MWIZ_MODEL", Settings.model),
        effort=os.getenv("MWIZ_EFFORT", Settings.effort),
        max_tokens=int(os.getenv("MWIZ_MAX_TOKENS", Settings.max_tokens)),
        db_path=os.getenv("MWIZ_DB", Settings.db_path),
        provider=os.getenv("MWIZ_PROVIDER", Settings.provider),
    )
