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
| `scripts/permit.sh` | No args: list pending permission requests. `permit.sh <name> allow [id]` / `permit.sh <name> deny [id] ["reason"]` answers them (default: all of that agent's pending requests). |
| `scripts/pending.py [--json] [name...]` | Used by `permit.sh`/`wait.sh`/`status.sh`: prints unanswered permission requests. |
| `scripts/router.py` | Board-to-RPC router. `spawn.sh` starts it automatically in the `router` window. It pushes board posts into recipients' conversations. |
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

## Permissions (the user decides)

Every subagent loads `extensions/permission-gate.ts`. Reading is free: `read`/`grep`/`find`/`ls`, plus bash commands where every segment is a known read-only command (`cat`, `rg`, `git status/log/diff`, `board.py post/log`, ...). **Anything else pauses** before running: writes/edits, other bash commands, other tools. While paused the agent asks for permission with an `extension_ui_request` in `out.jsonl`, shown as `⏸ 🔐 Permission request ...` in its pane.

- `wait.sh` exits **3** as soon as an agent it's waiting on is blocked, and prints `<name> <id> <request>`. `status.sh` shows `⏸ WAITING FOR PERMISSION`.
- **Only the human user can grant permission.** Show them the exact request (agent, command/path) and ask them, using a structured question if available. Then run `permit.sh <name> allow|deny [id] ["reason"]` with *their* answer, and `wait.sh` again. Never allow or deny on your own, even if the action looks harmless or the user approved something similar earlier, unless the user explicitly gave you a standing rule (for example "allow all writes under /tmp/foo"). Then say which rule you applied.
- When several requests are pending, show them all in one question.
- A deny reason is passed to the agent ("The user denied permission for this action: <reason>"), so tell it what to do instead.
- An aborted run drops its pending requests.

## Don't get stuck

- `wait.sh` exit 3 means a permission request: ask the user (see above). Don't treat it as a timeout.
- Keep each `wait.sh` short (≤90s, or ≤120s for heavy tasks). On exit 2, run `status.sh`. If an agent is busy doing useful work, wait again. If it's looping or blocked (for example a long `sleep` or a `board.py read` loop), run `abort.sh` and re-prompt it with clearer limits.
- Never wait on agents one at a time. Pass all names to one `wait.sh` call.
- With the router running, agents shouldn't wait on the board at all. If you see one looping on `board.py read`, abort it and remind it that replies are pushed.
- A multi-agent conversation settles and resumes several times as messages bounce back and forth. One `wait.sh` returning doesn't mean the conversation is over. Check `status.sh` (all idle) and `board.py log`.
- Report progress to the user between waits rather than going silent.

## Message board

**`spawn.sh` installs the board automatically.** If `README.md` or `board.py` is missing from the board folder, it copies it from this skill's `board-template/`, with the README's paths pointed at the actual board folder. It prints an `installed ...` line when it does. It never overwrites existing files: the user may have edited the README, and `board.jsonl`/`cursors/` hold live messages. Don't restore an old board from the trash; let `spawn.sh` reinstall it.

If `~/.pi/agent/subagents/README.md` exists, `spawn.sh` appends it to the agent's system prompt and sets `SUBAGENT_NAME`. Agents talk with `~/.pi/agent/subagents/board.py post <name|all> "msg"`. Set `SUBAGENT_BOARD` to use a different board folder.

**Delivery is push-based.** `spawn.sh` also starts `scripts/router.py` in a `router` tmux window. The router watches `board.jsonl` and writes each new message into the recipient's `cmd.jsonl` as a `prompt` with `streamingBehavior`:
- **Idle agents** start a turn right away.
- **Busy agents** get it queued: `followUp` by default, or `steer` (delivered before their next LLM call) for messages posted with `post --urgent`.
- **Batching:** messages that arrive together are batched per recipient.
- **Recipients:** live agent windows only. Messages to `host` or other names stay on the board.

So agents never wait or poll. They post and end their turn, and replies wake them up.

- **Reply-loop guard:** each message carries a hop count, and messages beyond `ROUTER_MAX_HOPS` (default 30) aren't delivered. The router posts a note to `host` instead. `send.sh` resets an agent's hop count.
- **Host side:** kick things off with `send.sh`. Then use `wait.sh`/`status.sh` as usual: an agent counts as settled when it's idle with nothing queued. Read the conversation with `board.py log`, and check messages addressed to `host` the same way. The `router` window logs every delivery.
- `send.sh` also queues as a follow-up, so it's safe to send while an agent is busy.

## Notes

- Prompts must be written to `cmd.jsonl` while the agent is running. `tail -n +1` replays the whole file on restart, so `spawn.sh` truncates it.
- `--no-session` means nothing is persisted. To keep a session that can be resumed interactively, pass `--session-dir <dir>` instead (edit `spawn.sh`).
- Protocol reference: pi docs `docs/rpc.md`, `docs/rpc-commands.md`, `docs/json.md`.
