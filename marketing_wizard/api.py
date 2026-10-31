"""HTTP API + web UI.

Run:  uvicorn marketing_wizard.api:app --reload
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Optional

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .config import get_settings
from .engine import Engine, PlaybookNotFound
from .export import asset_markdown, workspace_markdown
from .llm import LLMError, get_provider
from .models import Asset, BrandBrief, Workspace
from .playbooks import LAUNCH_KIT, PLAYBOOKS
from .storage import Store

STATIC = Path(__file__).parent / "static"


class RunRequest(BaseModel):
    inputs: dict[str, Any] = {}


class LaunchKitRequest(BaseModel):
    inputs: dict[str, dict[str, Any]] = {}


def create_app(store: Optional[Store] = None, engine: Optional[Engine] = None) -> FastAPI:
    settings = get_settings()
    store = store or Store(settings.db_path)
    engine = engine or Engine(store, get_provider(settings))

    app = FastAPI(title="Marketing Wizard", version="0.1.0")

    def _ws(ws_id: int) -> Workspace:
        ws = store.get_workspace(ws_id)
        if ws is None:
            raise HTTPException(404, "Workspace not found")
        return ws

    @app.get("/api/health")
    def health() -> dict:
        return {"ok": True, "provider": engine.provider.name, "model": settings.model}

    @app.get("/api/playbooks")
    def playbooks() -> dict:
        return {"playbooks": [p.describe() for p in PLAYBOOKS.values()], "launch_kit": LAUNCH_KIT}

    @app.get("/api/workspaces")
    def list_workspaces() -> list[Workspace]:
        return store.list_workspaces()

    @app.post("/api/workspaces", status_code=201)
    def create_workspace(brief: BrandBrief) -> Workspace:
        return store.create_workspace(brief)

    @app.get("/api/workspaces/{ws_id}")
    def get_workspace(ws_id: int) -> Workspace:
        return _ws(ws_id)

    @app.put("/api/workspaces/{ws_id}")
    def update_workspace(ws_id: int, brief: BrandBrief) -> Workspace:
        _ws(ws_id)
        return store.update_workspace(ws_id, brief)

    @app.delete("/api/workspaces/{ws_id}", status_code=204)
    def delete_workspace(ws_id: int) -> None:
        if not store.delete_workspace(ws_id):
            raise HTTPException(404, "Workspace not found")

    @app.get("/api/workspaces/{ws_id}/assets")
    def list_assets(ws_id: int, playbook: Optional[str] = None) -> list[Asset]:
        _ws(ws_id)
        return store.list_assets(ws_id, playbook)

    @app.post("/api/workspaces/{ws_id}/run/{playbook}", status_code=201)
    def run(ws_id: int, playbook: str, req: RunRequest) -> Asset:
        _ws(ws_id)
        try:
            return engine.run(ws_id, playbook, req.inputs)
        except PlaybookNotFound:
            raise HTTPException(404, f"Unknown playbook '{playbook}'")
        except LLMError as e:
            raise HTTPException(502, str(e))

    @app.post("/api/workspaces/{ws_id}/launch-kit", status_code=201)
    def launch_kit(ws_id: int, req: LaunchKitRequest) -> list[Asset]:
        _ws(ws_id)
        try:
            return engine.run_launch_kit(ws_id, req.inputs)
        except LLMError as e:
            raise HTTPException(502, str(e))

    @app.get("/api/assets/{asset_id}/markdown", response_class=PlainTextResponse)
    def asset_md(asset_id: int) -> str:
        asset = store.get_asset(asset_id)
        if asset is None:
            raise HTTPException(404, "Asset not found")
        return asset_markdown(asset)

    @app.get("/api/workspaces/{ws_id}/export", response_class=PlainTextResponse)
    def export(ws_id: int) -> str:
        return workspace_markdown(_ws(ws_id), store.list_assets(ws_id))

    @app.get("/")
    def index() -> FileResponse:
        return FileResponse(STATIC / "index.html")

    app.mount("/static", StaticFiles(directory=STATIC), name="static")
    return app


app = create_app()
