---
name: spawn
description: Spawn pi subagents in tmux windows running in RPC mode, send them prompts, wait for and collect their answers, with a readable live transcript in each tmux pane. Use when asked to spawn/run subagents, delegate tasks to parallel pi agents, or run pi workers in tmux.
---

# Spawn pi subagents in tmux (RPC mode)

Each subagent runs in its own tmux window:

```
tail -f cmd.jsonl | pi --mode rpc --no-session | tee out.jsonl | view.py
```

- **Send:** add one JSON RPC command per line to `cmd.jsonl`.
- **Receive:** read `out.jsonl` (the raw JSONL event stream). A run is done when an `agent_settled` event appears.
- **Watch:** the pane shows a readable transcript (user prompt, streamed reply, thinking, tool calls/results, errors, `── idle ──`).

Per-agent files are in `$SPAWN_DIR/<name>/` (default `/tmp/pi-subagents/<name>/`). The tmux session is `$SPAWN_SESSION` (default `subagents`).

## Scripts (relative to this skill directory)

| Script | Purpose |
|---|---|
| `scripts/spawn.sh <name> [pi args...]` | Start (or restart) a subagent window. Extra args go to pi, e.g. `--model x`, `--tools read,bash`. `SPAWN_CWD` sets its working dir (default: current dir). |
| `scripts/send.sh <name> <message>` | Send a prompt. `send.sh <name> --raw '<json>'` sends any RPC command (e.g. `{"type":"abort"}`, `{"type":"get_state","id":"s1"}`). |
| `scripts/next.sh [-t 90] [name...]` | Host event loop. Blocks until the **next** event (an agent settled, printing its final answer or `ERROR(...)`, or a board message to `host`/`all`), prints every event pending at that moment, and exits 0. Each event is shown once. Adds `--- all idle` when no watched agent is busy. Defaults to every spawned agent. On timeout it prints status and exits 2. The agents keep running. |
| `scripts/status.sh [name...]` | Non-blocking snapshot: idle/BUSY, seconds since the last event, and the current tool call. |
| `scripts/abort.sh <name...>` | Abort an agent's current run. It stays alive and keeps its context. |
| `scripts/router.py` | Board-to-RPC router. `spawn.sh` starts it automatically in the `router` window. It pushes board posts into recipients' conversations. |
| `scripts/view.py` | Transcript renderer. Can also be used offline: `python3 scripts/view.py < out.jsonl`. |

## Workflow

```bash
S=<skill dir>/scripts
$S/spawn.sh a1; $S/spawn.sh a2
sleep 2                                  # let pi boot (commands sent earlier are still queued and work)
$S/send.sh a1 "Compute 1+1. Reply with only the number."
$S/send.sh a2 "Compute 2*2. Reply with only the number."
$S/next.sh                               # returns at the first event; call again until "--- all idle"
```

React to each event as it arrives (follow up, answer a board question, update the user), then call `next.sh` again. Stop when it says `--- all idle` and every agent has answered, then report to the user.

- **Follow-ups:** `send.sh` again. The agent keeps its context until its window is restarted or killed.
- **Command responses** (e.g. `get_state`): look for `{"type":"response","id":...}` in `out.jsonl`.
- **Tell the user:** `tmux attach -t subagents` to watch (`Ctrl-b n`/`p` to switch windows).
- **Cleanup:** `tmux kill-window -t subagents:<name>`, or `tmux kill-session -t subagents` for all. Only do this when the user asks or the task is clearly finished.

## Don't get stuck

- Keep each `next.sh` short (≤90s, or ≤120s for heavy tasks). On exit 2, check the status it printed. If an agent is busy doing useful work, wait again. If it's looping or blocked (for example a long `sleep` or a `board.py read` loop), run `abort.sh` and re-prompt it with clearer limits.
- Never wait on agents one at a time. One `next.sh` watches all of them.
- With the router running, agents shouldn't wait on the board at all. If you see one looping on `board.py read`, abort it and remind it that replies are pushed.
- A multi-agent conversation settles and resumes several times as messages bounce back and forth. A settle event doesn't mean the conversation is over. Only `--- all idle` does (check `board.py log` for the whole thread).
- Report progress to the user between waits rather than going silent.

## Message board

**`spawn.sh` installs the board automatically.** If `README.md` or `board.py` is missing from the board folder, it copies it from this skill's `board-template/`, with the README's paths pointed at the actual board folder. It prints an `installed ...` line when it does. It never overwrites existing files: the user may have edited the README, and `board.jsonl`/`cursors/` hold live messages. Don't restore an old board from the trash; let `spawn.sh` reinstall it.

If `~/.pi/agent/subagents/README.md` exists, `spawn.sh` appends it to the agent's system prompt and sets `SUBAGENT_NAME`. Agents talk with `~/.pi/agent/subagents/board.py post <name|all> "msg"`. Set `SUBAGENT_BOARD` to use a different board folder.

**Delivery is push-based.** `spawn.sh` also starts `scripts/router.py` in a `router` tmux window. The router watches `board.jsonl` and writes each new message into the recipient's `cmd.jsonl` as a `prompt` with `streamingBehavior`:
- **Idle agents** start a turn right away.
- **Busy agents** get it queued as `followUp`, delivered after their current run.
- **Batching:** messages that arrive together are batched per recipient.
- **Recipients:** live agent windows only. Messages to `host` or other names stay on the board.

So agents never wait or poll. They post and end their turn, and replies wake them up.

- **Host side:** kick things off with `send.sh`. Then loop on `next.sh`: it delivers both agent answers and board messages addressed to `host` (its cursor is `host.cursor` in the board folder). An agent counts as settled when it's idle with nothing queued. Read the whole conversation with `board.py log`. The `router` window logs every delivery.
- `send.sh` also queues as a follow-up, so it's safe to send while an agent is busy.

## Notes

- Prompts must be written to `cmd.jsonl` while the agent is running. `tail -n +1` replays the whole file on restart, so `spawn.sh` truncates it.
- `--no-session` means nothing is persisted. To keep a session that can be resumed interactively, pass `--session-dir <dir>` instead (edit `spawn.sh`).
- Protocol reference: pi docs `docs/rpc.md`, `docs/rpc-commands.md`, `docs/json.md`.
