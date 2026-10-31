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


def test_knowledge_and_kpis_feed_prompts(engine, ws):
    from marketing_wizard.data import DEFAULT_KPIS
    from marketing_wizard.models import KPIValue, Note

    engine.store.add_note(ws.id, Note(category="results", title="Case A", content="ROAS 2.1 -> 3.4"))
    kpi = engine.store.add_kpi(ws.id, DEFAULT_KPIS[2])
    engine.store.log_kpi_value(kpi.id, KPIValue(period="2026-W43", value=40))
    engine.store.log_kpi_value(kpi.id, KPIValue(period="2026-W44", value=55))
    engine.store.log_kpi_value(kpi.id, KPIValue(period="2026-W44", value=60))  # overwrite

    engine.run(ws.id, "kpi_report")
    prompt = engine.provider.prompts[-1]
    assert "ROAS 2.1 -> 3.4" in prompt
    assert "2026-W43=40, 2026-W44=60" in prompt

    engine.run(ws.id, "positioning")
    assert "<kpi_data>" not in engine.provider.prompts[-1]
    assert "<company_knowledge>" in engine.provider.prompts[-1]


def test_data_api_and_gaps(engine):
    client = TestClient(create_app(engine.store, engine))
    ws = client.post("/api/workspaces", json={"company_name": "Gap Co"}).json()
    base = f"/api/workspaces/{ws['id']}"

    gaps = client.get(f"{base}/gaps").json()
    assert any(g["field"] == "pricing" for g in gaps)
    assert any(g["area"] == "kpis" for g in gaps)

    assert client.post(f"{base}/notes", json={"category": "nope", "title": "t", "content": "c"}).status_code == 422
    note = client.post(f"{base}/notes", json={"category": "results", "title": "t", "content": "c"}).json()
    assert not any(g["field"] == "results" for g in client.get(f"{base}/gaps").json())

    kpis = client.post(f"{base}/kpis/load-defaults").json()
    assert len(kpis) > 10
    assert client.post(f"{base}/kpis/load-defaults").json() == []  # idempotent
    r = client.post(f"{base}/kpis/{kpis[0]['id']}/values", json={"period": "2026-W44", "value": 12})
    assert r.status_code == 201
    assert len(client.get(f"{base}/kpis").json()["values"]) == 1
    assert client.post(f"{base}/kpis/99999/values", json={"period": "x", "value": 1}).status_code == 404

    assert client.delete(f"{base}/notes/{note['id']}").status_code == 204
    assert client.get("/static/app.js").status_code == 200
