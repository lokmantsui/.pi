#!/usr/bin/env python3
"""Usage: pending.py [--json] <name...>
List unanswered permission requests of subagents (the permission-gate extension's ctx.ui.select
dialogs, seen as extension_ui_request in out.jsonl). A request is pending while no
extension_ui_response with its id was sent (cmd.jsonl) and the agent hasn't settled since
(an aborted run settles and drops its dialogs).
Text output: one line per request:  <name> <id> <title>"""
import json, os, sys

ROOT = os.environ.get("SPAWN_DIR", "/tmp/pi-subagents")
args = sys.argv[1:]
as_json = "--json" in args
names = [a for a in args if a != "--json"] or (sorted(os.listdir(ROOT)) if os.path.isdir(ROOT) else [])

def lines(p):
    try:
        with open(p, encoding="utf-8") as f:
            for l in f:
                try: yield json.loads(l)
                except Exception: pass
    except FileNotFoundError: return

for n in names:
    answered = {e.get("id") for e in lines(os.path.join(ROOT, n, "cmd.jsonl")) if e.get("type") == "extension_ui_response"}
    pending = {}
    for e in lines(os.path.join(ROOT, n, "out.jsonl")):
        t = e.get("type")
        if t == "extension_ui_request" and e.get("method") == "select" and str(e.get("title", "")).startswith("🔐"):
            if e["id"] not in answered: pending[e["id"]] = e
        elif t == "agent_settled": pending.clear()
    for e in pending.values():
        print(json.dumps({"name": n, "id": e["id"], "title": e["title"]}) if as_json else f"{n} {e['id']} {e['title']}")
