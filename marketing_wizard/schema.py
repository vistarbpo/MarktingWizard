"""Convert Pydantic models into JSON schemas that structured outputs accept.

Structured outputs require `additionalProperties: false` and every property
listed in `required`. We also inline `$ref`s so the schema is self-contained.
"""

from __future__ import annotations

import copy
from typing import Any

from pydantic import BaseModel

_DROP = {"title", "default", "minItems", "maxItems", "minLength", "maxLength"}


def strict_schema(model: type[BaseModel]) -> dict[str, Any]:
    raw = model.model_json_schema()
    defs = raw.pop("$defs", {})
    return _walk(raw, defs)


def _walk(node: Any, defs: dict[str, Any]) -> Any:
    if isinstance(node, list):
        return [_walk(n, defs) for n in node]
    if not isinstance(node, dict):
        return node
    if "$ref" in node:
        name = node["$ref"].rsplit("/", 1)[-1]
        resolved = copy.deepcopy(defs[name])
        if "description" in node:
            resolved["description"] = node["description"]
        return _walk(resolved, defs)
    out = {}
    for k, v in node.items():
        if k == "properties":
            # Keys here are field names, not schema keywords - keep them all.
            out[k] = {name: _walk(sub, defs) for name, sub in v.items()}
        elif k not in _DROP:
            out[k] = _walk(v, defs)
    if out.get("type") == "object" and "properties" in out:
        out["additionalProperties"] = False
        out["required"] = list(out["properties"].keys())
    return out
