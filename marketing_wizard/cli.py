"""Command-line interface.

  mwiz serve                          # web UI at http://127.0.0.1:8000
  mwiz playbooks                      # list what the engine can do
  mwiz new brief.json                 # create a workspace from a JSON brief
  mwiz run 1 positioning              # run one playbook
  mwiz run 1 social_posts -i platform=X -i count=10
  mwiz launch-kit 1                   # full chain: positioning -> ads -> GTM plan
  mwiz export 1 > kit.md              # everything as Markdown
"""

from __future__ import annotations

import argparse
import json
import sys

from .config import get_settings
from .engine import Engine
from .export import asset_markdown, workspace_markdown
from .llm import LLMError, get_provider
from .data import DEFAULT_KPIS, data_gaps
from .models import NOTE_CATEGORIES, BrandBrief, KPIValue, Note
from .playbooks import PLAYBOOKS
from .storage import Store


def _engine() -> Engine:
    s = get_settings()
    return Engine(Store(s.db_path), get_provider(s))


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="mwiz", description="Marketing Wizard engine")
    sub = p.add_subparsers(dest="cmd", required=True)

    sv = sub.add_parser("serve", help="start the web UI + API")
    sv.add_argument("--host", default="127.0.0.1")
    sv.add_argument("--port", type=int, default=8000)

    sub.add_parser("playbooks", help="list playbooks")
    sub.add_parser("workspaces", help="list workspaces")

    nw = sub.add_parser("new", help="create a workspace from a brief JSON file")
    nw.add_argument("brief_file")

    rn = sub.add_parser("run", help="run a playbook")
    rn.add_argument("workspace_id", type=int)
    rn.add_argument("playbook", choices=sorted(PLAYBOOKS))
    rn.add_argument("-i", "--input", action="append", default=[], metavar="KEY=VALUE")

    lk = sub.add_parser("launch-kit", help="run the full launch chain")
    lk.add_argument("workspace_id", type=int)

    ex = sub.add_parser("export", help="export a workspace as Markdown")
    ex.add_argument("workspace_id", type=int)

    nt = sub.add_parser("note", help="add company knowledge (results, objections, competitors...)")
    nt.add_argument("workspace_id", type=int)
    nt.add_argument("category", choices=NOTE_CATEGORIES)
    nt.add_argument("title")
    nt.add_argument("content", help="text, or @path/to/file.txt")

    kd = sub.add_parser("kpi-defaults", help="load the SOP KPI set into a workspace")
    kd.add_argument("workspace_id", type=int)

    kl = sub.add_parser("kpi-log", help="log a KPI value for a period")
    kl.add_argument("workspace_id", type=int)
    kl.add_argument("kpi", help="KPI name (case-insensitive) or id")
    kl.add_argument("period", help="e.g. 2026-W44 or 2026-10")
    kl.add_argument("value", type=float)

    gp = sub.add_parser("gaps", help="what data the engine still needs")
    gp.add_argument("workspace_id", type=int)

    a = p.parse_args(argv)

    if a.cmd == "serve":
        import uvicorn

        uvicorn.run("marketing_wizard.api:app", host=a.host, port=a.port)
        return 0
    if a.cmd == "playbooks":
        for pb in PLAYBOOKS.values():
            ins = ", ".join(f"{i.name}={i.default!r}" for i in pb.inputs)
            print(f"{pb.key:24} [{pb.category}] {pb.description}" + (f"\n{'':24} inputs: {ins}" if ins else ""))
        return 0

    eng = _engine()
    try:
        if a.cmd == "workspaces":
            for ws in eng.store.list_workspaces():
                print(f"{ws.id:4}  {ws.brief.company_name}  ({ws.brief.business_model})")
        elif a.cmd == "new":
            with open(a.brief_file) as f:
                ws = eng.store.create_workspace(BrandBrief.model_validate(json.load(f)))
            print(f"Created workspace {ws.id}: {ws.brief.company_name}")
        elif a.cmd == "run":
            inputs = dict(kv.split("=", 1) for kv in a.input)
            print(f"Running {a.playbook} with {eng.provider.name}...", file=sys.stderr)
            print(asset_markdown(eng.run(a.workspace_id, a.playbook, inputs)))
        elif a.cmd == "launch-kit":
            eng.run_launch_kit(
                a.workspace_id, on_step=lambda k, _: print(f"  done: {k}", file=sys.stderr)
            )
            ws = eng.store.get_workspace(a.workspace_id)
            print(workspace_markdown(ws, eng.store.list_assets(a.workspace_id)))
        elif a.cmd == "note":
            content = a.content
            if content.startswith("@"):
                with open(content[1:]) as f:
                    content = f.read()
            n = eng.store.add_note(a.workspace_id, Note(category=a.category, title=a.title, content=content))
            print(f"Saved note {n.id}")
        elif a.cmd == "kpi-defaults":
            existing = {k.name for k in eng.store.list_kpis(a.workspace_id)}
            added = [eng.store.add_kpi(a.workspace_id, k) for k in DEFAULT_KPIS if k.name not in existing]
            print(f"Added {len(added)} KPIs")
        elif a.cmd == "kpi-log":
            kpis = eng.store.list_kpis(a.workspace_id)
            match = [k for k in kpis if str(k.id) == a.kpi or k.name.lower() == a.kpi.lower()]
            if not match:
                print(f"KPI not found. Options: {', '.join(k.name for k in kpis)}", file=sys.stderr)
                return 1
            eng.store.log_kpi_value(match[0].id, KPIValue(period=a.period, value=a.value))
            print(f"Logged {match[0].name} {a.period} = {a.value:g}")
        elif a.cmd == "gaps":
            ws = eng.store.get_workspace(a.workspace_id)
            if ws is None:
                print("workspace not found", file=sys.stderr)
                return 1
            kpis = eng.store.list_kpis(a.workspace_id)
            with_values = {v.kpi_id for v in eng.store.list_kpi_values(a.workspace_id)}
            for g in data_gaps(ws.brief, eng.store.list_notes(a.workspace_id), len(with_values), len(kpis)):
                print(f"- [{g['area']}] {g['question']}")
        elif a.cmd == "export":
            ws = eng.store.get_workspace(a.workspace_id)
            if ws is None:
                print("workspace not found", file=sys.stderr)
                return 1
            print(workspace_markdown(ws, eng.store.list_assets(a.workspace_id)))
    except (LLMError, LookupError) as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
