#!/usr/bin/env bash
# Usage: status.sh [name...]   -> non-blocking snapshot: idle/busy, how long, what it's doing now
ROOT=${SPAWN_DIR:-/tmp/pi-subagents}
names=("$@"); [ ${#names[@]} -eq 0 ] && names=($(ls "$ROOT" 2>/dev/null))
for n in "${names[@]}"; do
  f=$ROOT/$n/out.jsonl; [ -f "$f" ] || continue
  age=$(( $(date +%s) - $(stat -c %Y "$f") ))
  jq -rs --arg n "$n" --arg age "$age" '
    (map(select(.type=="agent_start" or .type=="agent_settled")) | last | .type) as $s
    | (map(select(.type=="tool_execution_start" or .type=="tool_execution_end" or (.type=="message_update" and .assistantMessageEvent.type=="text_start"))) | last) as $l
    | "\($n): " + (if $s=="agent_start" then "BUSY" elif $s=="agent_settled" then "idle" else "new" end)
      + " (last event \($age)s ago)"
      + (if $s=="agent_start" and $l.type=="tool_execution_start" then " — running \($l.toolName): \($l.args|tostring|.[0:120])"
         elif $s=="agent_start" and $l.type=="message_update" then " — writing reply" else "" end)' "$f"
done
