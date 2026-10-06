#!/usr/bin/env python3
"""Board -> RPC router: pushes message-board posts into recipients' conversations.

Watches $SUBAGENT_BOARD/board.jsonl. For each new message, appends to every recipient's
$SPAWN_DIR/<name>/cmd.jsonl:
    {"type":"prompt","message":"📨 ...","streamingBehavior":"followUp"}
Messages for a busy agent are held until its run ends (it can pull them earlier with `board.py read`).
On delivery, messages the agent already read (cursors/<name>) are skipped and its cursor is advanced,
so nothing is seen twice. Pending messages are batched per recipient. Recipients are tmux windows in $SPAWN_SESSION that have a spawn dir.
Anything else (e.g. "host") stays on the board only.

Single instance (flock on $SUBAGENT_BOARD/router.lock). Starts from the end of the board on first run.
Its cursor is kept in router.cursor.
"""
import fcntl, json, os, subprocess, sys, time
from datetime import datetime

BOARD_DIR = os.path.expanduser(os.environ.get("SUBAGENT_BOARD") or "~/.pi/agent/subagents")
SPAWN_DIR = os.environ.get("SPAWN_DIR", "/tmp/pi-subagents")
SESSION = os.environ.get("SPAWN_SESSION", "subagents")
BOARD = os.path.join(BOARD_DIR, "board.jsonl")
CURSOR = os.path.join(BOARD_DIR, "router.cursor")
CUR_DIR = os.path.join(BOARD_DIR, "cursors")
os.makedirs(CUR_DIR, exist_ok=True)

os.makedirs(BOARD_DIR, exist_ok=True)
open(BOARD, "a").close()
lock = open(os.path.join(BOARD_DIR, "router.lock"), "w")
try: fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
except OSError: print("router already running", file=sys.stderr); sys.exit(0)

def log(s): print(f"{datetime.now():%H:%M:%S} {s}", flush=True)

def load():
    with open(BOARD) as f:
        fcntl.flock(f, fcntl.LOCK_SH)
        return [json.loads(l) for l in f if l.strip()]

def agents():
    try:
        out = subprocess.run(["tmux", "list-windows", "-t", SESSION, "-F", "#W"],
                             capture_output=True, text=True).stdout.split()
    except Exception: return set()
    return {w for w in out if os.path.isfile(os.path.join(SPAWN_DIR, w, "cmd.jsonl"))}

def busy(name):
    # same rule as status.sh: last of agent_start / agent_settled in out.jsonl
    try: out = open(os.path.join(SPAWN_DIR, name, "out.jsonl")).read()
    except OSError: return False
    return out.rfind('"type":"agent_start"') > out.rfind('"type":"agent_settled"')

def read_cursor(name):
    try: return int(open(os.path.join(CUR_DIR, name)).read())
    except Exception: return 0

if os.path.exists(CURSOR): cursor = int(open(CURSOR).read() or 0)
else: cursor = max((m["id"] for m in load()), default=0)
log(f"router up: board={BOARD} spawn_dir={SPAWN_DIR} session={SESSION} from #{cursor}")

pending = {}  # recipient -> [msgs] not yet delivered. ponytail: in memory only; a router restart drops held messages (they stay on the board)
while True:
    msgs = [m for m in load() if m["id"] > cursor]
    if msgs:
        live = agents()
        for m in msgs:
            targets = (live - {m["from"]}) if m["to"] == "all" else ({m["to"]} & live)
            if not targets:
                log(f"#{m['id']} {m['from']}->{m['to']}: no live recipient (board only)"); continue
            for t in targets: pending.setdefault(t, []).append(m)
        cursor = msgs[-1]["id"]
        open(CURSOR, "w").write(str(cursor))
    for t in list(pending):
        if busy(t): continue
        seen = read_cursor(t); ms = [m for m in pending.pop(t) if m["id"] > seen]
        if not ms: log(f"-> {t}: nothing new (already read)"); continue
        body = "\n\n".join(f"[#{m['id']} from {m['from']} to {m['to']}]\n{m['text']}" for m in ms)
        text = (f"📨 {len(ms)} board message(s):\n\n{body}\n\n"
                "(Reply with board.py post <name> \"...\" only if a reply is needed. "
                "Don't wait for answers: end your turn, and replies will be delivered to you.)")
        cmd = {"type": "prompt", "message": text, "streamingBehavior": "followUp"}
        with open(os.path.join(SPAWN_DIR, t, "cmd.jsonl"), "a") as f:
            f.write(json.dumps(cmd) + "\n")
        open(os.path.join(CUR_DIR, t), "w").write(str(max(seen, ms[-1]["id"])))
        log(f"-> {t}: " + ", ".join(f"#{m['id']} from {m['from']}" for m in ms))
    time.sleep(0.5)
