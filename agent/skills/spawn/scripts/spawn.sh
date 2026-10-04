#!/usr/bin/env bash
# Usage: spawn.sh <name> [extra pi args...]   (env: SPAWN_SESSION, SPAWN_DIR, SPAWN_CWD)
set -euo pipefail
NAME=${1:?usage: spawn.sh <name> [pi args...]}; shift
SESSION=${SPAWN_SESSION:-subagents}
ROOT=${SPAWN_DIR:-/tmp/pi-subagents}
CWD=${SPAWN_CWD:-$PWD}
HERE=$(cd "$(dirname "$0")" && pwd)
D=$ROOT/$NAME
mkdir -p "$D"; : > "$D/cmd.jsonl"; : > "$D/out.jsonl"; echo 0 > "$D/settled.base"
BOARD_DIR=${SUBAGENT_BOARD:-$HOME/.pi/agent/subagents}; BOARD_README=$BOARD_DIR/README.md
# install the message board from the template if it (or part of it) is missing; never overwrite existing files
TPL=$HERE/../board-template; mkdir -p "$BOARD_DIR"
if [ ! -f "$BOARD_README" ]; then
  sed "s#\$HOME/.pi/agent/subagents#$BOARD_DIR#g" "$TPL/README.md" > "$BOARD_README"; echo "installed board README -> $BOARD_README"
fi
if [ ! -f "$BOARD_DIR/board.py" ]; then
  cp "$TPL/board.py" "$BOARD_DIR/board.py" && chmod +x "$BOARD_DIR/board.py"; echo "installed board.py -> $BOARD_DIR/board.py"
fi
EXTRA=(); [ -f "$BOARD_README" ] && EXTRA=(--append-system-prompt "$BOARD_README" --append-system-prompt "Your subagent name is $NAME.")
PIARGS=$(printf '%q ' --mode rpc --no-session "${EXTRA[@]}" "$@")
CMD="cd $(printf %q "$CWD") && export SUBAGENT_NAME=$(printf %q "$NAME") SUBAGENT_BOARD=$(printf %q "$BOARD_DIR") && tail -n +1 -f $(printf %q "$D/cmd.jsonl") | pi $PIARGS | tee $(printf %q "$D/out.jsonl") | python3 -u $(printf %q "$HERE/view.py"); echo '[subagent exited]'; read"
# the board router (pushes board posts into agents' conversations) always lives in the FIRST window
ROUTER_CMD="SUBAGENT_BOARD=$(printf %q "$BOARD_DIR") SPAWN_DIR=$(printf %q "$ROOT") SPAWN_SESSION=$(printf %q "$SESSION") python3 -u $(printf %q "$HERE/router.py"); echo '[router exited]'; read"
if ! tmux has-session -t "$SESSION" 2>/dev/null; then
  tmux new-session -d -s "$SESSION" -n router "$ROUTER_CMD"
elif ! tmux list-windows -t "$SESSION" -F '#W' | grep -qx router; then
  tmux new-window -d -b -t "$SESSION:^" -n router "$ROUTER_CMD"   # insert before the first window
elif [ "$(tmux list-windows -t "$SESSION" -F '#W' | head -1)" != router ]; then
  tmux swap-window -d -s "$SESSION:router" -t "$SESSION:^"
fi
if tmux list-windows -t "$SESSION" -F '#W' | grep -qx "$NAME"; then
  tmux respawn-window -k -t "$SESSION:$NAME" "$CMD"
else
  tmux new-window -d -t "$SESSION:" -n "$NAME" "$CMD"
fi
echo "spawned $SESSION:$NAME  dir=$D"
