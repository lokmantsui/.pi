#!/usr/bin/env bash
# Usage: abort.sh <name...>   -> abort the current run of each agent (agent stays alive, keeps context)
HERE=$(cd "$(dirname "$0")" && pwd)
for n in "$@"; do "$HERE/send.sh" "$n" --raw '{"type":"abort"}'; echo "aborted $n"; done
