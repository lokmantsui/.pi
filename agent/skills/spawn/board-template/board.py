#!/usr/bin/env python3
"""Shared message board for pi subagents and their host.

Identity: --as NAME, or env SUBAGENT_NAME, else "host". Data dir: env SUBAGENT_BOARD (default ~/.pi/agent/subagents).
Delivery is done by the pi `board` extension (~/.pi/agent/extensions/board.ts): messages are pushed into the
recipient's conversation. Nobody needs to read or poll.

  board post [--urgent] <to|all> <text...>   post a message ("-" as text = read stdin)
  board log [n=20]                           show the last n messages (everyone's)
  board who                                  list names seen on the board
"""
import fcntl, json, os, sys
from datetime import datetime

# Board data dir: $SUBAGENT_BOARD, default ~/.pi/agent/subagents (never next to this script,
# so running the skill's template copy doesn't write messages into the skill dir).
ROOT = os.path.expanduser(os.environ.get("SUBAGENT_BOARD") or "~/.pi/agent/subagents")
BOARD = os.path.join(ROOT, "board.jsonl")
os.makedirs(ROOT, exist_ok=True)
open(BOARD, "a").close()

def die(msg): print(msg, file=sys.stderr); sys.exit(1)

args = sys.argv[1:]
me = os.environ.get("SUBAGENT_NAME") or "host"
if len(args) >= 2 and args[0] == "--as": me, args = args[1], args[2:]
if not args or args[0] in ("-h", "--help"): print(__doc__); sys.exit(0)
cmd, rest = args[0], args[1:]

def load():
    with open(BOARD) as f:
        fcntl.flock(f, fcntl.LOCK_SH)
        return [json.loads(l) for l in f if l.strip()]

def fmt(m):
    return f"[#{m['id']} {m['ts']}] {m['from']} -> {m['to']}{', urgent' if m.get('urgent') else ''}:\n{m['text']}\n"

if cmd == "post":
    urgent = False
    while rest and rest[0].startswith("--"):
        o = rest.pop(0)
        if o == "--urgent": urgent = True
        else: die(f"unknown option {o}")
    if len(rest) < 2: die("usage: board post [--urgent] <to|all> <text...>")
    to, text = rest[0], " ".join(rest[1:])
    if text == "-": text = sys.stdin.read()
    with open(BOARD, "a+") as f:
        fcntl.flock(f, fcntl.LOCK_EX)
        f.seek(0); n = sum(1 for l in f if l.strip())
        m = {"id": n + 1, "ts": datetime.now().strftime("%H:%M:%S"), "from": me, "to": to, "text": text.rstrip(),
             **({"urgent": True} if urgent else {})}
        f.write(json.dumps(m) + "\n")
    print(f"posted #{m['id']} to {to}")
elif cmd == "log":
    n = int(rest[0]) if rest else 20
    for m in load()[-n:]: print(fmt(m))
elif cmd == "who":
    msgs = load()
    print(" ".join(sorted({m["from"] for m in msgs} | {m["to"] for m in msgs} - {"all"})))
else:
    die(__doc__)
