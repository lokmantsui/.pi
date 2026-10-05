#!/usr/bin/env bash
# Usage: send.sh <name> <message>          -> sends a prompt (queued as follow-up if the agent is busy)
#        send.sh <name> --raw '<json>'     -> sends any RPC command (e.g. {"type":"abort"})
set -euo pipefail
NAME=${1:?}; shift
D=${SPAWN_DIR:-/tmp/pi-subagents}/$NAME
[ -d "$D" ] || { echo "no subagent $NAME" >&2; exit 1; }
grep -c '"type":"agent_settled"' "$D/out.jsonl" > "$D/settled.base" || true
if [ "${1:-}" = "--raw" ]; then echo "$2" >> "$D/cmd.jsonl"
else jq -cn --arg m "$*" '{type:"prompt",message:$m,streamingBehavior:"followUp"}' >> "$D/cmd.jsonl"; fi
