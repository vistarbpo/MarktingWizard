"""The engine: runs playbooks against a workspace's brief and brand memory."""

from __future__ import annotations

import json
from typing import Any, Callable, Optional

from .llm import Provider
from .models import Asset, Workspace
from .playbooks import LAUNCH_KIT, PLAYBOOKS, Playbook
from .storage import Store

SYSTEM_PROMPT = """You are Marketing Wizard, a senior B2B marketing strategist and conversion \
copywriter who has taken many SaaS products and agencies from zero to predictable pipeline.

How you work:
- Ground everything in the brand brief and the prior strategy work you are given. Stay consistent \
with established positioning, personas and voice.
- Be specific and concrete. Prefer the customer's own language, numbers and vivid outcomes over \
abstract adjectives ("powerful", "seamless", "revolutionary", "game-changing").
- Never invent customer names, statistics, testimonials or awards. When proof is missing, write a \
clearly marked placeholder such as [ADD CUSTOMER METRIC] so the team knows what to fill in.
- Write copy that is ready to ship, in the brand voice, and respects each channel's norms.
- Fill every field of the requested output format."""


class _SafeDict(dict):
    def __missing__(self, key: str) -> str:
        return "{" + key + "}"


class PlaybookNotFound(KeyError):
    pass


class Engine:
    def __init__(self, store: Store, provider: Provider):
        self.store = store
        self.provider = provider

    def get_playbook(self, key: str) -> Playbook:
        try:
            return PLAYBOOKS[key]
        except KeyError:
            raise PlaybookNotFound(key) from None

    def build_prompt(self, pb: Playbook, ws: Workspace, inputs: dict[str, Any]) -> tuple[str, dict]:
        merged = {f.name: f.default for f in pb.inputs}
        merged.update({k: v for k, v in inputs.items() if v not in (None, "")})
        task = pb.instructions.format_map(_SafeDict({k: str(v) for k, v in merged.items()}))

        parts = [f"<brand_brief>\n{ws.brief.as_prompt()}\n</brand_brief>"]
        for dep in pb.uses_context_from:
            prior = self.store.latest_asset(ws.id, dep)
            if prior:
                parts.append(
                    f'<prior_work playbook="{dep}">\n{json.dumps(prior.output, indent=1)}\n</prior_work>'
                )
        parts.append(f"<task title=\"{pb.title}\">\n{task}\n</task>")
        return "\n\n".join(parts), merged

    def run(self, ws_id: int, playbook_key: str, inputs: Optional[dict[str, Any]] = None) -> Asset:
        pb = self.get_playbook(playbook_key)
        ws = self.store.get_workspace(ws_id)
        if ws is None:
            raise LookupError(f"workspace {ws_id} not found")
        prompt, merged = self.build_prompt(pb, ws, inputs or {})
        output = self.provider.generate_json(SYSTEM_PROMPT, prompt, pb.schema)
        output = pb.output_model.model_validate(output).model_dump()
        return self.store.save_asset(
            Asset(
                workspace_id=ws_id,
                playbook=pb.key,
                inputs=merged,
                output=output,
                provider=self.provider.name,
            )
        )

    def run_launch_kit(
        self,
        ws_id: int,
        inputs: Optional[dict[str, dict[str, Any]]] = None,
        on_step: Optional[Callable[[str, Asset], None]] = None,
    ) -> list[Asset]:
        """Run the full chain; each step builds on the previous ones."""
        results = []
        for key in LAUNCH_KIT:
            asset = self.run(ws_id, key, (inputs or {}).get(key))
            results.append(asset)
            if on_step:
                on_step(key, asset)
        return results
