#!/usr/bin/env bash
# Runs a command once one of TP_EMU_SLOTS (default 3) emulator slots is free, so parallel work
# never runs more than that many emulators at once:
#   bash scripts/emu-slot.sh bash scripts/run-movie.sh <movie> <out>
set -euo pipefail
slots=${TP_EMU_SLOTS:-3}
dir=${TMPDIR:-/tmp}/tp-emu-slots
mkdir -p "$dir"
while true; do
  for i in $(seq 1 "$slots"); do
    exec {fd}>"$dir/slot$i"
    if flock -n "$fd"; then
      "$@"
      exit $?
    fi
    exec {fd}>&-
  done
  sleep 2
done
