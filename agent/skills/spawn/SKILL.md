---
name: spawn
description: Spawn pi subagents in tmux windows running in RPC mode, give them tasks over a shared message board, and get their answers pushed back automatically, with a readable live transcript in each tmux pane. Use when asked to spawn/run subagents, delegate tasks to parallel pi agents, or run pi workers in tmux.
---

# Spawn pi subagents in tmux (RPC mode)

The host (you) and all subagents share **one channel: the message board**. Everyone posts to it, and the `board` extension (`~/.pi/agent/extensions/board.ts`, loaded by every pi) pushes each message into its recipient's conversation.

- **Idle recipient:** the message starts a turn.
- **Busy recipient:** the message is queued as a follow-up. Urgent messages arrive as a steer.
- **Nobody waits or polls**, the host included.

Each subagent runs in its own tmux window:

```
tail -f cmd.jsonl | pi --mode rpc --no-session | tee out.jsonl | view.py
```

The pane shows a readable transcript: incoming board messages, streamed replies, thinking, tool calls and results, errors, and `── idle ──`. `out.jsonl` is the raw RPC event stream, and `cmd.jsonl` takes raw RPC commands (for example `abort`). Per-agent files are in `$SPAWN_DIR/<name>/` (default `/tmp/pi-subagents/<name>/`). The tmux session is `$SPAWN_SESSION` (default `subagents`).

## Scripts

Paths are relative to this skill directory. `B=~/.pi/agent/subagents/board.py`.

| Command | Purpose |
|---|---|
| `scripts/spawn.sh <name> [pi args...]` | Start (or restart) a subagent. Extra args go to pi, e.g. `--model x`, `--tools read,bash`. `SPAWN_CWD` sets its working dir (default: current dir). |
| `$B post <name\|all> "task"` | Give a task (you are `host`). `--urgent` interrupts the agent's current work. |
| `$B log [n]` | The whole conversation (everyone's messages). |
| `scripts/status.sh [name...]` | Non-blocking snapshot: idle/BUSY, seconds since the last event, and the current tool call. |
| `scripts/abort.sh <name...>` | Abort an agent's current run. It stays alive and keeps its context. |
| `scripts/view.py` | Transcript renderer. Can also be used offline: `python3 scripts/view.py < out.jsonl`. |

## Workflow

```bash
S=<skill dir>/scripts; B=~/.pi/agent/subagents/board.py
$S/spawn.sh a1; $S/spawn.sh a2
$B post a1 "Compute 1+1. Reply with only the number."   # safe right away: messages posted while pi boots are delivered
$B post a2 "Compute 2*2. Reply with only the number."
```

Then **end your turn.** Tell the user what's running and that answers will come in. Each agent posts its final answer to `host`, and the answer arrives in your conversation as `📨 board message(s)`. Report each answer to the user as it arrives.

- **Follow-ups:** post again. An agent keeps its context until its window is restarted or killed.
- **Tell the user:** `tmux attach -t subagents` to watch (`Ctrl-b n`/`p` to switch windows).
- **Cleanup:** `tmux kill-window -t subagents:<name>`, or `tmux kill-session -t subagents` for all. Only do this when the user asks or the task is clearly finished.

## How replies work

Every subagent has its own copy of the `board` extension doing this bookkeeping:

- **Every message is explicit and addressed, for everyone.** Agents reply with `board_post` to whoever asked, whether host or agent. Plain text replies go nowhere, so you hear conclusions, not chatter.
- **Requests vs replies:**
  - A message from someone the agent is waiting on is their reply.
  - Any other direct message, and anything from host, is a request: the agent owes the sender a reply.
  - The agent's own post to someone it owes is its reply. A post to anyone else is a new request, and the agent now waits on them.
- **Safety net:** an agent might finish (settle) owing replies while not waiting on anyone, apart from agents that are waiting on it. The extension then sends that agent one reminder per request, telling it to reply or say what's blocking it. Nobody else is bothered. No reminder after `abort.sh`.
- **Polling is blocked:** bash commands that loop, sleep or tail on the board are blocked with a reminder that messages are pushed.

**Host side:**
- The host listens once this session runs `spawn.sh` or `board.py`, or after `/board on`. `/board off` and `/board status` are also available.
- Only one host session listens. Its pid is in `$SUBAGENT_BOARD/host.owner`, and the latest session to activate wins.
- Messages already on the board before activation are skipped.

## Don't get stuck

- **Nothing arrives for a long time:** run `status.sh`. If an agent is busy doing useful work, end your turn again. If it's looping or blocked, run `abort.sh`, which stops the run without killing the agent. Then post the task again with clearer limits.
- **Multi-agent conversations:** an agent may finish and resume several times as messages bounce back and forth. Use `board.py log` to see the whole conversation.
- **Keep the user informed:** report progress as messages arrive instead of going silent.

## Board files

- **Location:** `$SUBAGENT_BOARD` (default `~/.pi/agent/subagents/`). It holds `board.jsonl` (messages), `board.py`, `README.md` and `host.owner`.
- **Installed by `spawn.sh`:**
  - It always syncs `board.py` from this skill's `board-template/`, because `board.py` is code.
  - It installs `README.md` only if missing, since the user may have edited it.
  - It never touches `board.jsonl`.
- **What each subagent gets:** `README.md` is appended to its system prompt, and `spawn.sh` sets `SUBAGENT_NAME` and `SUBAGENT_BOARD_FROM`. `SUBAGENT_BOARD_FROM` is the board position at spawn time, which is where its delivery starts.

## Notes

- `tail -n +1` replays `cmd.jsonl` on restart, so `spawn.sh` truncates it.
- `--no-session` means nothing is persisted. To keep a session that can be resumed interactively, pass `--session-dir <dir>` instead (edit `spawn.sh`).
- Protocol reference: pi docs `docs/rpc.md`, `docs/rpc-commands.md`, `docs/json.md`.
