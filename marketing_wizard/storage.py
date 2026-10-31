"""SQLite persistence for workspaces and generated assets."""

from __future__ import annotations

import json
import os
import sqlite3
import threading
from typing import Optional

from .models import KPI, Asset, BrandBrief, KPIValue, Note, Workspace

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
CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    category TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS kpis (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS kpi_values (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kpi_id INTEGER NOT NULL REFERENCES kpis(id) ON DELETE CASCADE,
    period TEXT NOT NULL,
    value REAL NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    UNIQUE (kpi_id, period)
);
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

    # -- knowledge notes
    def add_note(self, ws_id: int, note: Note) -> Note:
        with self._lock, self._conn:
            cur = self._conn.execute(
                "INSERT INTO notes (workspace_id, category, title, content, created_at) VALUES (?, ?, ?, ?, ?)",
                (ws_id, note.category, note.title, note.content, note.created_at.isoformat()),
            )
        return note.model_copy(update={"id": cur.lastrowid, "workspace_id": ws_id})

    def list_notes(self, ws_id: int) -> list[Note]:
        rows = self._conn.execute(
            "SELECT * FROM notes WHERE workspace_id = ? ORDER BY category, id", (ws_id,)
        ).fetchall()
        return [Note(**dict(r)) for r in rows]

    def delete_note(self, ws_id: int, note_id: int) -> bool:
        with self._lock, self._conn:
            cur = self._conn.execute(
                "DELETE FROM notes WHERE id = ? AND workspace_id = ?", (note_id, ws_id)
            )
        return cur.rowcount > 0

    # -- KPIs
    def add_kpi(self, ws_id: int, kpi: KPI) -> KPI:
        data = kpi.model_dump_json(exclude={"id", "workspace_id"})
        with self._lock, self._conn:
            cur = self._conn.execute(
                "INSERT INTO kpis (workspace_id, data) VALUES (?, ?)", (ws_id, data)
            )
        return kpi.model_copy(update={"id": cur.lastrowid, "workspace_id": ws_id})

    def list_kpis(self, ws_id: int) -> list[KPI]:
        rows = self._conn.execute(
            "SELECT * FROM kpis WHERE workspace_id = ? ORDER BY id", (ws_id,)
        ).fetchall()
        return [KPI.model_validate_json(r["data"]).model_copy(update={"id": r["id"], "workspace_id": ws_id}) for r in rows]

    def get_kpi(self, kpi_id: int) -> Optional[KPI]:
        r = self._conn.execute("SELECT * FROM kpis WHERE id = ?", (kpi_id,)).fetchone()
        if not r:
            return None
        return KPI.model_validate_json(r["data"]).model_copy(update={"id": r["id"], "workspace_id": r["workspace_id"]})

    def delete_kpi(self, ws_id: int, kpi_id: int) -> bool:
        with self._lock, self._conn:
            cur = self._conn.execute("DELETE FROM kpis WHERE id = ? AND workspace_id = ?", (kpi_id, ws_id))
        return cur.rowcount > 0

    def log_kpi_value(self, kpi_id: int, value: KPIValue) -> KPIValue:
        """Insert or overwrite the value for one KPI and period."""
        with self._lock, self._conn:
            self._conn.execute(
                "INSERT INTO kpi_values (kpi_id, period, value, note) VALUES (?, ?, ?, ?)"
                " ON CONFLICT(kpi_id, period) DO UPDATE SET value = excluded.value, note = excluded.note",
                (kpi_id, value.period, value.value, value.note),
            )
            row = self._conn.execute(
                "SELECT id FROM kpi_values WHERE kpi_id = ? AND period = ?", (kpi_id, value.period)
            ).fetchone()
        return value.model_copy(update={"id": row["id"], "kpi_id": kpi_id})

    def list_kpi_values(self, ws_id: int) -> list[KPIValue]:
        rows = self._conn.execute(
            "SELECT v.* FROM kpi_values v JOIN kpis k ON k.id = v.kpi_id"
            " WHERE k.workspace_id = ? ORDER BY v.period, v.kpi_id",
            (ws_id,),
        ).fetchall()
        return [KPIValue(**dict(r)) for r in rows]

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
