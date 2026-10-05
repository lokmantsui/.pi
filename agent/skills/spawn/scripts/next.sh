#!/usr/bin/env bash
# Usage: next.sh [-t timeout_s=90] [name...]   (default: every spawned agent)
# Event loop for the host: blocks until the NEXT event, prints every event pending at that moment, exits 0.
# Events: an agent settled (prints its final answer), or a board message to host/all.
# Each event is printed once (consumed). Prints "--- all idle" when every watched agent is idle.
# On timeout prints status and exits 2 (agents keep running) - just call again.
T=90; [ "${1:-}" = "-t" ] && { T=$2; shift 2; }
ROOT=${SPAWN_DIR:-/tmp/pi-subagents}; HERE=$(cd "$(dirname "$0")" && pwd)
BOARD_DIR=${SUBAGENT_BOARD:-$HOME/.pi/agent/subagents}; BOARD=$BOARD_DIR/board.jsonl; CUR=$BOARD_DIR/host.cursor
names=("$@"); [ ${#names[@]} -eq 0 ] && names=($(cd "$ROOT" 2>/dev/null && ls -d */ 2>/dev/null | tr -d /))
[ ${#names[@]} -gt 0 ] || { echo "no agents in $ROOT" >&2; exit 1; }
answer() { jq -rs '[.[] | select(.type=="message_end" and .message.role=="assistant")] | last | .message
  | if .stopReason=="error" or .stopReason=="aborted" then "ERROR(\(.stopReason)): \(.errorMessage // "")"
    else ([.content[] | select(.type=="text") | .text] | join("")) end' "$ROOT/$1/out.jsonl"; }
state() { jq -rs 'map(select(.type=="agent_start" or .type=="agent_settled")) | last | .type // ""' "$ROOT/$1/out.jsonl"; }
for ((i=0; i<=T*2; i++)); do
  got=0
  for n in "${names[@]}"; do
    f=$ROOT/$n/out.jsonl; [ -f "$f" ] || continue
    N=$(grep -c '"type":"agent_settled"' "$f"); B=$(cat "$ROOT/$n/settled.base" 2>/dev/null || echo 0)
    [ "$N" -gt "$B" ] || continue
    echo "=== $n settled:"; answer "$n"; echo; echo "$N" > "$ROOT/$n/settled.base"; got=1
  done
  if [ -s "$BOARD" ]; then
    c=$(cat "$CUR" 2>/dev/null || echo 0)
    msgs=$(jq -r --argjson c "$c" 'select(.id > $c and .from != "host" and (.to == "host" or .to == "all"))
      | "=== board #\(.id) \(.ts) \(.from) -> \(.to):\n\(.text)\n"' "$BOARD")
    tail -n1 "$BOARD" | jq -r .id > "$CUR"
    [ -n "$msgs" ] && { echo "$msgs"; got=1; }
  fi
  if [ $got = 1 ]; then
    # ponytail: "idle" can be momentarily wrong while the router (0.5s poll) is about to deliver a message
    for n in "${names[@]}"; do [ "$(state "$n")" = agent_start ] && exit 0; done
    echo "--- all idle"; exit 0
  fi
  sleep 0.5
done
echo "--- no event after ${T}s:" >&2; "$HERE/status.sh" "${names[@]}" >&2; exit 2
