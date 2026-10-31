"""HTTP API + web UI.

Run:  uvicorn marketing_wizard.api:app --reload
"""

from __future__ import annotations

import base64
import secrets
from pathlib import Path
from typing import Any, Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, PlainTextResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .config import get_settings
from .engine import Engine, PlaybookNotFound
from .export import asset_markdown, workspace_markdown
from .llm import LLMError, get_provider
from .data import DEFAULT_KPIS, data_gaps
from .models import KPI, NOTE_CATEGORIES, Asset, BrandBrief, KPIValue, Note, Workspace
from .playbooks import LAUNCH_KIT, PLAYBOOKS
from .storage import Store

STATIC = Path(__file__).parent / "static"


class RunRequest(BaseModel):
    inputs: dict[str, Any] = {}


class LaunchKitRequest(BaseModel):
    inputs: dict[str, dict[str, Any]] = {}


def _authorized(request: Request, username: str, password: str) -> bool:
    header = request.headers.get("authorization", "")
    if not header.lower().startswith("basic "):
        return False
    try:
        user, _, pwd = base64.b64decode(header[6:]).decode().partition(":")
    except ValueError:
        return False
    return secrets.compare_digest(user.encode(), username.encode()) & secrets.compare_digest(
        pwd.encode(), password.encode()
    )


def create_app(store: Optional[Store] = None, engine: Optional[Engine] = None) -> FastAPI:
    settings = get_settings()
    store = store or Store(settings.db_path)
    engine = engine or Engine(store, get_provider(settings))

    app = FastAPI(title="Marketing Wizard", version="0.1.0")

    if settings.password:
        @app.middleware("http")
        async def require_login(request: Request, call_next):
            # /api/ping stays open so hosting platforms can run health checks.
            if request.url.path == "/api/ping" or _authorized(request, settings.username, settings.password):
                return await call_next(request)
            return Response(
                "Login required", status_code=401,
                headers={"WWW-Authenticate": 'Basic realm="Marketing Wizard"'},
            )

    @app.get("/api/ping")
    def ping() -> dict:
        return {"ok": True}

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

    # -- company knowledge ("add more data")
    @app.get("/api/note-categories")
    def note_categories() -> list[str]:
        return NOTE_CATEGORIES

    @app.get("/api/workspaces/{ws_id}/notes")
    def list_notes(ws_id: int) -> list[Note]:
        _ws(ws_id)
        return store.list_notes(ws_id)

    @app.post("/api/workspaces/{ws_id}/notes", status_code=201)
    def add_note(ws_id: int, note: Note) -> Note:
        _ws(ws_id)
        if note.category not in NOTE_CATEGORIES:
            raise HTTPException(422, f"category must be one of {NOTE_CATEGORIES}")
        return store.add_note(ws_id, note)

    @app.delete("/api/workspaces/{ws_id}/notes/{note_id}", status_code=204)
    def delete_note(ws_id: int, note_id: int) -> None:
        if not store.delete_note(ws_id, note_id):
            raise HTTPException(404, "Note not found")

    # -- KPIs
    @app.get("/api/workspaces/{ws_id}/kpis")
    def list_kpis(ws_id: int) -> dict:
        _ws(ws_id)
        return {"kpis": store.list_kpis(ws_id), "values": store.list_kpi_values(ws_id)}

    @app.post("/api/workspaces/{ws_id}/kpis", status_code=201)
    def add_kpi(ws_id: int, kpi: KPI) -> KPI:
        _ws(ws_id)
        return store.add_kpi(ws_id, kpi)

    @app.post("/api/workspaces/{ws_id}/kpis/load-defaults", status_code=201)
    def load_default_kpis(ws_id: int) -> list[KPI]:
        _ws(ws_id)
        existing = {k.name for k in store.list_kpis(ws_id)}
        return [store.add_kpi(ws_id, k) for k in DEFAULT_KPIS if k.name not in existing]

    @app.delete("/api/workspaces/{ws_id}/kpis/{kpi_id}", status_code=204)
    def delete_kpi(ws_id: int, kpi_id: int) -> None:
        if not store.delete_kpi(ws_id, kpi_id):
            raise HTTPException(404, "KPI not found")

    @app.post("/api/workspaces/{ws_id}/kpis/{kpi_id}/values", status_code=201)
    def log_value(ws_id: int, kpi_id: int, value: KPIValue) -> KPIValue:
        kpi = store.get_kpi(kpi_id)
        if kpi is None or kpi.workspace_id != ws_id:
            raise HTTPException(404, "KPI not found")
        return store.log_kpi_value(kpi_id, value)

    @app.get("/api/workspaces/{ws_id}/gaps")
    def gaps(ws_id: int) -> list[dict]:
        ws = _ws(ws_id)
        kpis = store.list_kpis(ws_id)
        with_values = {v.kpi_id for v in store.list_kpi_values(ws_id)}
        return data_gaps(ws.brief, store.list_notes(ws_id), len(with_values), len(kpis))

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
