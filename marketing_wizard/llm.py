"""LLM providers.

`ClaudeProvider` calls the Claude API with structured outputs, so every
playbook returns JSON that matches its schema. `OfflineProvider` returns
schema-shaped placeholder JSON so the engine, API and UI work without a key.
"""

from __future__ import annotations

import json
import os
import shutil
from typing import Any, Protocol

from .config import Settings


class LLMError(RuntimeError):
    pass


class Provider(Protocol):
    name: str

    def generate_json(self, system: str, prompt: str, schema: dict[str, Any]) -> dict[str, Any]: ...


class ClaudeProvider:
    name = "claude"

    def __init__(self, settings: Settings):
        import anthropic

        self._anthropic = anthropic
        # Credentials resolve from ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN /
        # an `ant auth login` profile.
        self.client = anthropic.Anthropic()
        self.settings = settings

    def generate_json(self, system: str, prompt: str, schema: dict[str, Any]) -> dict[str, Any]:
        anthropic = self._anthropic
        try:
            # Streaming avoids HTTP timeouts on long, high-max_tokens outputs.
            with self.client.beta.messages.stream(
                model=self.settings.model,
                max_tokens=self.settings.max_tokens,
                system=system,
                messages=[{"role": "user", "content": prompt}],
                thinking={"type": "adaptive"},
                output_config={
                    "effort": self.settings.effort,
                    "format": {"type": "json_schema", "schema": schema},
                },
                # If a safety classifier declines, retry server-side on
                # Anthropic's recommended fallback model.
                betas=["server-side-fallback-2026-07-01"],
                fallbacks="default",
            ) as stream:
                message = stream.get_final_message()
        except anthropic.AuthenticationError as e:
            raise LLMError("Claude API authentication failed - check ANTHROPIC_API_KEY.") from e
        except anthropic.RateLimitError as e:
            raise LLMError("Claude API rate limit hit - retry shortly.") from e
        except anthropic.APIStatusError as e:
            raise LLMError(f"Claude API error {e.status_code}: {e.message}") from e
        except anthropic.APIConnectionError as e:
            raise LLMError("Could not reach the Claude API.") from e

        if message.stop_reason == "refusal":
            raise LLMError("The model declined this request. Try rephrasing the brief.")
        if message.stop_reason == "max_tokens":
            raise LLMError("Output was cut off (max_tokens). Raise MWIZ_MAX_TOKENS.")

        text = next((b.text for b in message.content if b.type == "text"), None)
        if text is None:
            raise LLMError("The model returned no text output.")
        try:
            return json.loads(text)
        except json.JSONDecodeError as e:
            raise LLMError("The model returned invalid JSON.") from e


class OfflineProvider:
    """Deterministic, schema-valid placeholder output. No network, no key."""

    name = "offline"

    def generate_json(self, system: str, prompt: str, schema: dict[str, Any]) -> dict[str, Any]:
        return _fill(schema, path="output")


def _fill(schema: dict[str, Any], path: str) -> Any:
    t = schema.get("type")
    if "enum" in schema:
        return schema["enum"][0]
    if t == "object":
        return {k: _fill(v, f"{path}.{k}") for k, v in schema.get("properties", {}).items()}
    if t == "array":
        n = max(schema.get("minItems", 2), 2)
        return [_fill(schema["items"], f"{path}[{i}]") for i in range(n)]
    if t == "integer":
        return 1
    if t == "number":
        return 1.0
    if t == "boolean":
        return True
    desc = schema.get("description", "")
    return f"[offline sample] {path.split('.')[-1]}" + (f" - {desc}" if desc else "")


def _has_claude_credentials() -> bool:
    if os.getenv("ANTHROPIC_API_KEY") or os.getenv("ANTHROPIC_AUTH_TOKEN"):
        return True
    # An `ant auth login` profile also works with the zero-arg client.
    return shutil.which("ant") is not None and os.path.isdir(
        os.path.expanduser("~/.config/anthropic")
    )


def get_provider(settings: Settings) -> Provider:
    choice = settings.provider.lower()
    if choice == "offline":
        return OfflineProvider()
    if choice == "claude" or _has_claude_credentials():
        return ClaudeProvider(settings)
    return OfflineProvider()
