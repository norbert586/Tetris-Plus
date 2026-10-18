#!/usr/bin/env bash
# Plays an input movie on the original game (re/lua/movie.lua) and writes its trace.
# See docs/re/oracle-harness.md.
#
# Usage: scripts/run-movie.sh MOVIE.tpm OUT_DIR
#   Optional: TP_SHOTS, TP_SAVE_AT, TP_LOAD, TP_RAM_AT, TP_UNTIL, TP_SAVE_UNTIL, TP_SPEED,
#   TP_REALTIME, TP_PADLOG, TP_MAIN_RAM (see re/lua/movie.lua), TP_TIMEOUT, TP_MEMCARD1/2 (below).
#   Example: scripts/run-movie.sh re/movies/egypt1-idle.tpm ../tp-private/runs/idle
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TP_PRIVATE="${TP_PRIVATE:-$(dirname "$REPO_ROOT")/tp-private}"
export TP_MOVIE TP_REPO="$REPO_ROOT"
TP_MOVIE="$(realpath "$1")"
out_dir="$2"

# shellcheck source=/dev/null
source "${TP_TOOLS:-/opt/tp-tools}/env.sh"

mkdir -p "$out_dir"
export TP_OUT
TP_OUT="$(realpath "$out_dir")"
rm -f "$TP_OUT"/trace.jsonl "$TP_OUT"/ram_*.bin "$TP_OUT"/shot_*.raw
# A fresh HOME per run: Redux keeps its settings and memory cards under ~/.config/pcsx-redux,
# and a card written by an earlier run would change what the game does.
rm -rf "$TP_OUT/home" && mkdir -p "$TP_OUT/home"
# TP_MEMCARD1 / TP_MEMCARD2: start with this card image (128 KB .mcd) in the slot instead of
# the empty formatted card Redux creates. The card as the run left it stays in
# $TP_OUT/home/.config/pcsx-redux/memcard1.mcd.
for n in 1 2; do
  var="TP_MEMCARD$n"
  if [ -n "${!var:-}" ]; then
    mkdir -p "$TP_OUT/home/.config/pcsx-redux"
    cp "${!var}" "$TP_OUT/home/.config/pcsx-redux/memcard$n.mcd"
  fi
done
# The emulator occasionally hangs in the host (parked on a lock, using no CPU); TP_TIMEOUT
# (seconds, default 1800) turns that into a failure instead of a wait.
status=0
HOME="$TP_OUT/home" timeout "${TP_TIMEOUT:-1800}" "$TP_REDUX" -cli -interpreter -debugger -fastboot -iso "$TP_PRIVATE/disc/Tetris Plus.cue" -run \
  -dofile "$REPO_ROOT/re/lua/movie.lua" -lua_stdout -stdout > "$TP_OUT/run.log" 2>&1 || status=$?
grep -a -E '^(tick|frame) |^error' "$TP_OUT/run.log" || true
grep -a -q 'tick [0-9]*: done\|has exited\|: until ' "$TP_OUT/run.log" || { echo "movie did not finish (exit $status)" >&2; exit 1; }
