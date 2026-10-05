#!/usr/bin/env bash
# Usage: permit.sh                               -> list all pending permission requests
#        permit.sh <name> allow [id]             -> allow (default: all of <name>'s pending requests)
#        permit.sh <name> deny  [id] ["reason"]  -> deny, optionally telling the agent why
# Only run allow/deny with the human user's explicit decision. Never decide on your own.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd); D=${SPAWN_DIR:-/tmp/pi-subagents}
[ $# -eq 0 ] && { out=$("$HERE/pending.py"); echo "${out:-(no pending permission requests)}"; exit 0; }
NAME=$1; ACT=${2:?allow|deny}; ID=${3:-}; REASON=${4:-}
# allow "deny <reason>" without an id: if the 3rd arg isn't a pending id, treat it as the reason
mapfile -t IDS < <("$HERE/pending.py" --json "$NAME" | jq -r .id)
[ ${#IDS[@]} -gt 0 ] || { echo "$NAME has no pending permission requests" >&2; exit 1; }
if [ -n "$ID" ] && ! printf '%s\n' "${IDS[@]}" | grep -qxF "$ID"; then REASON="$ID${REASON:+ $REASON}"; ID=; fi
[ -n "$ID" ] && IDS=("$ID")
case $ACT in
  allow) VAL=Allow ;;
  deny)  VAL="Deny${REASON:+: $REASON}" ;;
  *) echo "action must be allow or deny" >&2; exit 1 ;;
esac
for i in "${IDS[@]}"; do
  jq -cn --arg id "$i" --arg v "$VAL" '{type:"extension_ui_response",id:$id,value:$v}' >> "$D/$NAME/cmd.jsonl"
  echo "$NAME $i -> $VAL"
done
