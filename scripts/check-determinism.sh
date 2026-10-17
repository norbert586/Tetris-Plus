#!/usr/bin/env bash
# Phase 5 exit check: plays a movie twice on the original game and requires identical traces
# and identical main RAM at the last tick. With SAVE_AT=TICK it also checks save states: a
# third run starts from the save state written at TICK by the first, and must match the first
# run from the tick after it on.
#
# Usage: scripts/check-determinism.sh MOVIE.tpm OUT_DIR
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
movie="$1"
out="$2"
mkdir -p "$out"

TP_SAVE_AT="${SAVE_AT:-}" "$REPO_ROOT/scripts/run-movie.sh" "$movie" "$out/a" >/dev/null
"$REPO_ROOT/scripts/run-movie.sh" "$movie" "$out/b" >/dev/null
status=0
python3 "$REPO_ROOT/re/tools/tptrace.py" diff "$out/a/trace.jsonl" "$out/b/trace.jsonl" || status=1
cmp -s "$out/a/ram_end.bin" "$out/b/ram_end.bin" && echo "RAM at the last tick: identical" ||
  { echo "RAM at the last tick: differs"; status=1; }

if [ -n "${SAVE_AT:-}" ]; then
  state="$(printf '%s/a/state_%05d.sstate' "$out" "$SAVE_AT")"
  TP_LOAD="$state" "$REPO_ROOT/scripts/run-movie.sh" "$movie" "$out/c" >/dev/null
  python3 "$REPO_ROOT/re/tools/tptrace.py" diff "$out/a/trace.jsonl" "$out/c/trace.jsonl" || status=1
  # Main RAM from 0x80010000 up: the game's. One byte of OpenBIOS's kernel area (0x80004AB8)
  # differs after a save state load and is not game state.
  cmp -s -i 65536 "$out/a/ram_end.bin" "$out/c/ram_end.bin" &&
    echo "RAM (0x80010000 up) after loading the save state: identical" ||
    { echo "RAM after loading the save state: differs"; status=1; }
  echo "kernel-area bytes that differ: $(cmp -l -n 65536 "$out/a/ram_end.bin" "$out/c/ram_end.bin" | wc -l)"
fi
exit $status
