#!/usr/bin/env bash
# Usage: abort.sh <name...>   -> abort the current run of each agent (agent stays alive, keeps context)
ROOT=${SPAWN_DIR:-/tmp/pi-subagents}
for n in "$@"; do
  [ -d "$ROOT/$n" ] || { echo "no subagent $n" >&2; continue; }
  echo '{"type":"abort"}' >> "$ROOT/$n/cmd.jsonl"; echo "aborted $n"
done
