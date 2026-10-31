"""Render generated assets as Markdown, ready to paste into docs or hand to a client."""

from __future__ import annotations

from typing import Any

from .models import Asset, Workspace
from .playbooks import PLAYBOOKS


def _label(key: str) -> str:
    return key.replace("_", " ").capitalize()


def _render(value: Any, depth: int) -> list[str]:
    lines: list[str] = []
    if isinstance(value, dict):
        for k, v in value.items():
            if isinstance(v, (dict, list)):
                lines.append(f"{'#' * min(depth, 6)} {_label(k)}")
                lines.extend(_render(v, depth + 1))
            else:
                lines.append(f"**{_label(k)}:** {v}")
            lines.append("")
    elif isinstance(value, list):
        if all(not isinstance(v, (dict, list)) for v in value):
            lines.extend(f"- {v}" for v in value)
        else:
            for i, item in enumerate(value, 1):
                title = next((item[k] for k in ("name", "title", "heading", "subject", "competitor",
                                               "pillar", "persona", "question", "hook") if isinstance(item, dict) and k in item), f"#{i}")
                lines.append(f"{'#' * min(depth, 6)} {i}. {title}")
                lines.extend(_render(item, depth + 1))
    else:
        lines.append(str(value))
    return lines


def asset_markdown(asset: Asset) -> str:
    pb = PLAYBOOKS.get(asset.playbook)
    title = pb.title if pb else asset.playbook
    body = "\n".join(_render(asset.output, 3)).strip()
    return f"## {title}\n\n{body}\n"


def workspace_markdown(ws: Workspace, assets: list[Asset]) -> str:
    seen, latest = set(), []
    for a in assets:  # assets are newest-first; keep the latest per playbook
        if a.playbook not in seen:
            seen.add(a.playbook)
            latest.append(a)
    parts = [f"# {ws.brief.company_name} - Marketing Kit\n", "## Brand brief\n", ws.brief.as_prompt(), ""]
    parts += [asset_markdown(a) for a in reversed(latest)]
    return "\n".join(parts)
