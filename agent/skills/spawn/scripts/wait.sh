#!/usr/bin/env bash
# Usage: wait.sh [-t timeout_s=90] <name...>
# Waits for all named agents in parallel; prints each final answer as soon as it settles.
# On timeout, prints status of the stragglers (doesn't kill them) and exits 2 — call again or abort them.
T=90; [ "${1:-}" = "-t" ] && { T=$2; shift 2; }
[ $# -gt 0 ] || { echo "usage: wait.sh [-t s] <name...>" >&2; exit 1; }
ROOT=${SPAWN_DIR:-/tmp/pi-subagents}; HERE=$(cd "$(dirname "$0")" && pwd)
pending=("$@")
answer() { jq -rs '[.[] | select(.type=="message_end" and .message.role=="assistant")] | last | .message
  | if .stopReason=="error" or .stopReason=="aborted" then "ERROR(\(.stopReason)): \(.errorMessage // "")"
    else ([.content[] | select(.type=="text") | .text] | join("")) end' "$ROOT/$1/out.jsonl"; }
for ((i=0; i<T && ${#pending[@]}; i++)); do
  left=()
  for n in "${pending[@]}"; do
    N=$(grep -c '"type":"agent_settled"' "$ROOT/$n/out.jsonl" 2>/dev/null); B=$(cat "$ROOT/$n/settled.base" 2>/dev/null || echo 0)
    if [ "${N:-0}" -gt "$B" ]; then
      if [ $# -gt 1 ]; then echo "=== $n:"; answer "$n"; echo; else answer "$n"; fi
    else left+=("$n"); fi
  done
  pending=("${left[@]}"); [ ${#pending[@]} -gt 0 ] && sleep 1
done
[ ${#pending[@]} -eq 0 ] && exit 0
echo "--- still running after ${T}s:" >&2; "$HERE/status.sh" "${pending[@]}" >&2; exit 2
