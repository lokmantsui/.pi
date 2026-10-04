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
| `scripts/wait.sh [-t 90] <name...>` | Wait for several agents **in parallel**, printing each final answer (or `ERROR(...)`) as soon as it settles. On timeout it prints the stragglers' status and exits 2. The agents keep running. |
| `scripts/status.sh [name...]` | Non-blocking snapshot: idle/BUSY, seconds since the last event, and the current tool call. |
| `scripts/abort.sh <name...>` | Abort an agent's current run. It stays alive and keeps its context. |
| `scripts/view.py` | Transcript renderer. Can also be used offline: `python3 scripts/view.py < out.jsonl`. |

## Workflow

```bash
S=<skill dir>/scripts
$S/spawn.sh a1; $S/spawn.sh a2
sleep 2                                  # let pi boot (commands sent earlier are still queued and work)
$S/send.sh a1 "Compute 1+1. Reply with only the number."
$S/send.sh a2 "Compute 2*2. Reply with only the number."
$S/wait.sh a1 a2                         # collects answers as each finishes (default 90s)
```

Then report each subagent's answer to the user.

- **Follow-ups:** `send.sh` again. The agent keeps its context until its window is restarted or killed.
- **Command responses** (e.g. `get_state`): look for `{"type":"response","id":...}` in `out.jsonl`.
- **Tell the user:** `tmux attach -t subagents` to watch (`Ctrl-b n`/`p` to switch windows).
- **Cleanup:** `tmux kill-window -t subagents:<name>`, or `tmux kill-session -t subagents` for all. Only do this when the user asks or the task is clearly finished.

## Don't get stuck

- Keep each `wait.sh` short (≤90s, or ≤120s for heavy tasks). On exit 2, run `status.sh`. If an agent is busy doing useful work, wait again. If it's looping or blocked (for example a long `board wait` or `sleep`), run `abort.sh` and re-prompt it with clearer limits.
- Never wait on agents one at a time. Pass all names to one `wait.sh` call.
- In prompts that involve coordinating with other agents, say "don't wait more than 60s total; if the other side hasn't replied, end your turn and say so". Then wake the agents up again with `send.sh`.
- Report progress to the user between waits rather than going silent.

## Message board

If `~/.pi/agent/subagents/README.md` exists, `spawn.sh` appends it to the agent's system prompt and sets `SUBAGENT_NAME`. Agents can then talk directly using `~/.pi/agent/subagents/board` (`post`, `read`, `wait`, `log`). Read the board yourself with `board log`.

## Notes

- Prompts must be written to `cmd.jsonl` while the agent is running. `tail -n +1` replays the whole file on restart, so `spawn.sh` truncates it.
- `--no-session` means nothing is persisted. To keep a session that can be resumed interactively, pass `--session-dir <dir>` instead (edit `spawn.sh`).
- Protocol reference: pi docs `docs/rpc.md`, `docs/rpc-commands.md`, `docs/json.md`.
