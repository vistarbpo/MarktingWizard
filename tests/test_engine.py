import json

import pytest
from fastapi.testclient import TestClient

from marketing_wizard.api import create_app
from marketing_wizard.engine import Engine
from marketing_wizard.llm import OfflineProvider
from marketing_wizard.models import BrandBrief
from marketing_wizard.playbooks import LAUNCH_KIT, PLAYBOOKS
from marketing_wizard.storage import Store


class RecordingProvider(OfflineProvider):
    def __init__(self):
        self.prompts = []

    def generate_json(self, system, prompt, schema):
        self.prompts.append(prompt)
        return super().generate_json(system, prompt, schema)


@pytest.fixture
def engine():
    return Engine(Store(":memory:"), RecordingProvider())


@pytest.fixture
def ws(engine):
    return engine.store.create_workspace(BrandBrief(company_name="Acme", one_liner="Does X"))


def _assert_strict(node):
    if isinstance(node, dict):
        assert "$ref" not in node
        if node.get("type") == "object":
            assert node["additionalProperties"] is False
            assert set(node["required"]) == set(node["properties"])
        for v in node.values():
            _assert_strict(v)
    elif isinstance(node, list):
        for v in node:
            _assert_strict(v)


@pytest.mark.parametrize("key", sorted(PLAYBOOKS))
def test_schemas_are_strict(key):
    _assert_strict(PLAYBOOKS[key].schema)
    json.dumps(PLAYBOOKS[key].schema)


@pytest.mark.parametrize("key", sorted(PLAYBOOKS))
def test_every_playbook_runs(engine, ws, key):
    asset = engine.run(ws.id, key)
    assert asset.id and asset.playbook == key
    PLAYBOOKS[key].output_model.model_validate(asset.output)


def test_inputs_fill_instructions(engine, ws):
    engine.run(ws.id, "social_posts", {"platform": "TikTok", "count": "7"})
    prompt = engine.provider.prompts[-1]
    assert "7 TikTok posts" in prompt
    assert "Acme" in prompt


def test_literal_placeholders_survive(engine, ws):
    engine.run(ws.id, "cold_email_sequence")
    assert "{first_name}" in engine.provider.prompts[-1]


def test_brand_memory_feeds_later_playbooks(engine, ws):
    engine.run(ws.id, "positioning")
    engine.run(ws.id, "icp_personas")
    assert '<prior_work playbook="positioning">' in engine.provider.prompts[-1]


def test_launch_kit_chain(engine, ws):
    assets = engine.run_launch_kit(ws.id)
    assert [a.playbook for a in assets] == LAUNCH_KIT
    assert '<prior_work playbook="messaging_matrix">' in engine.provider.prompts[3]


def test_api_flow(engine):
    client = TestClient(create_app(engine.store, engine))
    assert client.get("/api/health").json()["provider"] == "offline"
    assert len(client.get("/api/playbooks").json()["playbooks"]) == len(PLAYBOOKS)

    ws = client.post("/api/workspaces", json={"company_name": "Beta Co"}).json()
    r = client.post(f"/api/workspaces/{ws['id']}/run/positioning", json={"inputs": {}})
    assert r.status_code == 201
    asset_id = r.json()["id"]

    assert client.post(f"/api/workspaces/{ws['id']}/run/nope", json={}).status_code == 404
    assert client.get("/api/workspaces/999").status_code == 404
    assert "Positioning" in client.get(f"/api/assets/{asset_id}/markdown").text
    md = client.get(f"/api/workspaces/{ws['id']}/export").text
    assert md.startswith("# Beta Co - Marketing Kit")
    assert client.get("/").status_code == 200
    assert client.delete(f"/api/workspaces/{ws['id']}").status_code == 204
