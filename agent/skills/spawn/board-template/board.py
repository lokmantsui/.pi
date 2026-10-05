#!/usr/bin/env python3
"""Shared message board for pi subagents.

Identity: --as NAME, or env SUBAGENT_NAME. Data dir: env SUBAGENT_BOARD (default ~/.pi/agent/subagents).
  board post <to|all> <text...>   post a message ("-" as text = read stdin). The router delivers it into the
                                  recipient's conversation.
  board read                      print unread messages for me (to me or 'all', not from me) and mark them read
  board log [n=20]                show last n messages on the board (everyone's), doesn't mark read
  board who                       list names seen on the board
"""
import fcntl, json, os, sys
from datetime import datetime

# Board data dir: $SUBAGENT_BOARD, default ~/.pi/agent/subagents (never next to this script,
# so running the skill's template copy doesn't write messages into the skill dir).
ROOT = os.path.expanduser(os.environ.get("SUBAGENT_BOARD") or "~/.pi/agent/subagents")
BOARD = os.path.join(ROOT, "board.jsonl")
CUR = os.path.join(ROOT, "cursors")
os.makedirs(CUR, exist_ok=True)  # also creates ROOT
open(BOARD, "a").close()

def die(msg): print(msg, file=sys.stderr); sys.exit(1)

args = sys.argv[1:]
me = os.environ.get("SUBAGENT_NAME")
if len(args) >= 2 and args[0] == "--as": me, args = args[1], args[2:]
if not args or args[0] in ("-h", "--help"): print(__doc__); sys.exit(0)
cmd, rest = args[0], args[1:]

def load():
    with open(BOARD) as f:
        fcntl.flock(f, fcntl.LOCK_SH)
        return [json.loads(l) for l in f if l.strip()]

def fmt(m):
    return f"[#{m['id']} {m['ts']}] {m['from']} -> {m['to']}:\n{m['text']}\n"

def cursor_path(): return os.path.join(CUR, me)
def get_cursor():
    try: return int(open(cursor_path()).read())
    except Exception: return 0
def mine(msgs, after):
    return [m for m in msgs if m["id"] > after and m["from"] != me and m["to"] in ("all", me)]

def read_unread():
    msgs = load(); new = mine(msgs, get_cursor())
    if msgs: open(cursor_path(), "w").write(str(msgs[-1]["id"]))
    return new

if cmd == "post":
    if not me: die("who are you? use --as NAME or set SUBAGENT_NAME")
    if len(rest) < 2: die("usage: board post <to|all> <text...>")
    to, text = rest[0], " ".join(rest[1:])
    if text == "-": text = sys.stdin.read()
    with open(BOARD, "a+") as f:
        fcntl.flock(f, fcntl.LOCK_EX)
        f.seek(0); n = sum(1 for l in f if l.strip())
        m = {"id": n + 1, "ts": datetime.now().strftime("%H:%M:%S"), "from": me, "to": to, "text": text.rstrip()}
        f.write(json.dumps(m) + "\n")
    print(f"posted #{m['id']} to {to}")
elif cmd == "read":
    if not me: die("who are you? use --as NAME or set SUBAGENT_NAME")
    new = read_unread()
    print("\n".join(fmt(m) for m in new) if new else "(no new messages)")
elif cmd == "log":
    n = int(rest[0]) if rest else 20
    for m in load()[-n:]: print(fmt(m))
elif cmd == "who":
    print(" ".join(sorted({m["from"] for m in load()} | {m["to"] for m in load()} - {"all"})))
else:
    die(__doc__)
