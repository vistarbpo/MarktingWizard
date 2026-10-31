"""SQLite persistence for workspaces and generated assets."""

from __future__ import annotations

import json
import os
import sqlite3
import threading
from typing import Optional

from .models import Asset, BrandBrief, Workspace

_SCHEMA = """
CREATE TABLE IF NOT EXISTS workspaces (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    brief TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS assets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    playbook TEXT NOT NULL,
    inputs TEXT NOT NULL,
    output TEXT NOT NULL,
    provider TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_assets_ws ON assets(workspace_id, playbook, id);
"""


class Store:
    def __init__(self, path: str):
        if path != ":memory:":
            os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        self._conn = sqlite3.connect(path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA foreign_keys = ON")
        self._conn.executescript(_SCHEMA)
        self._lock = threading.Lock()

    # -- workspaces
    def create_workspace(self, brief: BrandBrief) -> Workspace:
        ws = Workspace(brief=brief)
        with self._lock, self._conn:
            cur = self._conn.execute(
                "INSERT INTO workspaces (brief, created_at) VALUES (?, ?)",
                (brief.model_dump_json(), ws.created_at.isoformat()),
            )
        ws.id = cur.lastrowid
        return ws

    def update_workspace(self, ws_id: int, brief: BrandBrief) -> Optional[Workspace]:
        with self._lock, self._conn:
            self._conn.execute(
                "UPDATE workspaces SET brief = ? WHERE id = ?", (brief.model_dump_json(), ws_id)
            )
        return self.get_workspace(ws_id)

    def get_workspace(self, ws_id: int) -> Optional[Workspace]:
        row = self._conn.execute("SELECT * FROM workspaces WHERE id = ?", (ws_id,)).fetchone()
        return self._ws(row) if row else None

    def list_workspaces(self) -> list[Workspace]:
        rows = self._conn.execute("SELECT * FROM workspaces ORDER BY id").fetchall()
        return [self._ws(r) for r in rows]

    def delete_workspace(self, ws_id: int) -> bool:
        with self._lock, self._conn:
            cur = self._conn.execute("DELETE FROM workspaces WHERE id = ?", (ws_id,))
        return cur.rowcount > 0

    # -- assets
    def save_asset(self, asset: Asset) -> Asset:
        with self._lock, self._conn:
            cur = self._conn.execute(
                "INSERT INTO assets (workspace_id, playbook, inputs, output, provider, created_at)"
                " VALUES (?, ?, ?, ?, ?, ?)",
                (
                    asset.workspace_id,
                    asset.playbook,
                    json.dumps(asset.inputs),
                    json.dumps(asset.output),
                    asset.provider,
                    asset.created_at.isoformat(),
                ),
            )
        asset.id = cur.lastrowid
        return asset

    def list_assets(self, ws_id: int, playbook: Optional[str] = None) -> list[Asset]:
        q, args = "SELECT * FROM assets WHERE workspace_id = ?", [ws_id]
        if playbook:
            q += " AND playbook = ?"
            args.append(playbook)
        rows = self._conn.execute(q + " ORDER BY id DESC", args).fetchall()
        return [self._asset(r) for r in rows]

    def get_asset(self, asset_id: int) -> Optional[Asset]:
        row = self._conn.execute("SELECT * FROM assets WHERE id = ?", (asset_id,)).fetchone()
        return self._asset(row) if row else None

    def latest_asset(self, ws_id: int, playbook: str) -> Optional[Asset]:
        items = self.list_assets(ws_id, playbook)
        return items[0] if items else None

    @staticmethod
    def _ws(row: sqlite3.Row) -> Workspace:
        return Workspace(
            id=row["id"],
            brief=BrandBrief.model_validate_json(row["brief"]),
            created_at=row["created_at"],
        )

    @staticmethod
    def _asset(row: sqlite3.Row) -> Asset:
        return Asset(
            id=row["id"],
            workspace_id=row["workspace_id"],
            playbook=row["playbook"],
            inputs=json.loads(row["inputs"]),
            output=json.loads(row["output"]),
            provider=row["provider"],
            created_at=row["created_at"],
        )
