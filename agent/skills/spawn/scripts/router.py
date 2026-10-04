#!/usr/bin/env python3
"""Board -> RPC router: pushes message-board posts into recipients' conversations.

Watches $SUBAGENT_BOARD/board.jsonl. For each new message, appends to every recipient's
$SPAWN_DIR/<name>/cmd.jsonl:
    {"type":"prompt","message":"📨 ...","streamingBehavior":"followUp"|"steer"}
Idle agents start a turn immediately. Busy agents get it queued (followUp = after the current run,
steer = before the next LLM call, for messages posted with --urgent). Messages that arrive in the same
poll are batched per recipient. Recipients are tmux windows in $SPAWN_SESSION that have a spawn dir.
Anything else (e.g. "host") stays on the board only.

Loop guard: every message carries a hop count = 1 + the highest hop count delivered to its sender
since the host last prompted it (send.sh resets <name>/hops to 0). Messages over $ROUTER_MAX_HOPS
(default 30) are not delivered. A note is posted to "host" instead.

Single instance (flock on $SUBAGENT_BOARD/router.lock). Starts from the end of the board on first run.
Its cursor is kept in router.cursor.
"""
import fcntl, json, os, subprocess, sys, time
from datetime import datetime

BOARD_DIR = os.path.expanduser(os.environ.get("SUBAGENT_BOARD") or "~/.pi/agent/subagents")
SPAWN_DIR = os.environ.get("SPAWN_DIR", "/tmp/pi-subagents")
SESSION = os.environ.get("SPAWN_SESSION", "subagents")
MAX_HOPS = int(os.environ.get("ROUTER_MAX_HOPS", "30"))
BOARD = os.path.join(BOARD_DIR, "board.jsonl")
CURSOR = os.path.join(BOARD_DIR, "router.cursor")

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

def hops_of(name):
    try: return int(open(os.path.join(SPAWN_DIR, name, "hops")).read())
    except Exception: return 0
def set_hops(name, h):
    try: open(os.path.join(SPAWN_DIR, name, "hops"), "w").write(str(h))
    except Exception: pass

def post_host(text):
    with open(BOARD, "a+") as f:
        fcntl.flock(f, fcntl.LOCK_EX)
        f.seek(0); n = sum(1 for l in f if l.strip())
        f.write(json.dumps({"id": n + 1, "ts": datetime.now().strftime("%H:%M:%S"),
                            "from": "router", "to": "host", "text": text}) + "\n")

if os.path.exists(CURSOR): cursor = int(open(CURSOR).read() or 0)
else: cursor = max((m["id"] for m in load()), default=0)
log(f"router up: board={BOARD} spawn_dir={SPAWN_DIR} session={SESSION} from #{cursor} max_hops={MAX_HOPS}")

while True:
    msgs = [m for m in load() if m["id"] > cursor]
    if msgs:
        live = agents()
        batches = {}  # recipient -> [msgs]
        for m in msgs:
            if m["from"] == "router": continue
            h = hops_of(m["from"]) + 1 if m["from"] in live else 0
            m["hops"] = h
            targets = (live - {m["from"]}) if m["to"] == "all" else ({m["to"]} & live)
            if not targets:
                log(f"#{m['id']} {m['from']}->{m['to']}: no live recipient (board only)"); continue
            if h > MAX_HOPS:
                log(f"#{m['id']} {m['from']}->{m['to']}: DROPPED, hop limit {MAX_HOPS}")
                post_host(f"Hop limit reached: #{m['id']} from {m['from']} to {m['to']} was not delivered. "
                          "Agents may be in a reply loop. Prompt them via send.sh to reset.")
                continue
            for t in targets: batches.setdefault(t, []).append(m)
        for t, ms in batches.items():
            urgent = any(m.get("urgent") for m in ms)
            body = "\n\n".join(f"[#{m['id']} from {m['from']} to {m['to']}]\n{m['text']}" for m in ms)
            text = (f"📨 {len(ms)} board message(s):\n\n{body}\n\n"
                    "(Reply with board.py post <name> \"...\" only if a reply is needed. "
                    "Don't wait for answers: end your turn, and replies will be delivered to you.)")
            cmd = {"type": "prompt", "message": text,
                   "streamingBehavior": "steer" if urgent else "followUp"}
            with open(os.path.join(SPAWN_DIR, t, "cmd.jsonl"), "a") as f:
                f.write(json.dumps(cmd) + "\n")
            set_hops(t, max(hops_of(t), max(m["hops"] for m in ms)))
            log(f"-> {t}: " + ", ".join(f"#{m['id']} from {m['from']}" for m in ms)
                + (" [steer]" if urgent else "") + f" (hops {max(m['hops'] for m in ms)})")
        cursor = msgs[-1]["id"]
        open(CURSOR, "w").write(str(cursor))
    time.sleep(0.5)
