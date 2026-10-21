#!/usr/bin/env bash
# Plays an input movie on the original game (re/lua/movie.lua) and writes its trace.
# See docs/re/oracle-harness.md.
#
# Usage: scripts/run-movie.sh MOVIE.tpm OUT_DIR
#   Optional: TP_SHOTS, TP_SAVE_AT, TP_LOAD, TP_RAM_AT, TP_UNTIL, TP_SAVE_UNTIL, TP_SPEED,
#   TP_REALTIME, TP_PADLOG (see re/lua/movie.lua), TP_TIMEOUT (below).
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
rm -rf "$TP_OUT/home" && mkdir -p "$TP_OUT/home/.config/pcsx-redux"
# The movie's "card PORT FILE" lines put a card image (.mcd or .mcd.gz, repo-relative) in a
# port; "none" (handled by movie.lua) leaves the port empty; the default is a blank card.
while read -r _ port spec _; do
  case "$spec" in
    blank|none|'') ;;
    *.gz) gunzip -c "$REPO_ROOT/$spec" > "$TP_OUT/home/.config/pcsx-redux/memcard$port.mcd" ;;
    *) cp "$REPO_ROOT/$spec" "$TP_OUT/home/.config/pcsx-redux/memcard$port.mcd" ;;
  esac
done < <(grep -E '^card[[:space:]]' "$TP_MOVIE" || true)
# The emulator occasionally hangs in the host (parked on a lock, using no CPU); TP_TIMEOUT
# (seconds, default 1800) turns that into a failure instead of a wait.
status=0
HOME="$TP_OUT/home" timeout "${TP_TIMEOUT:-1800}" "$TP_REDUX" -cli -interpreter -debugger -fastboot -iso "$TP_PRIVATE/disc/Tetris Plus.cue" -run \
  -dofile "$REPO_ROOT/re/lua/movie.lua" -lua_stdout -stdout > "$TP_OUT/run.log" 2>&1 || status=$?
grep -a -E '^(tick|frame) |^error' "$TP_OUT/run.log" || true
grep -a -q 'tick [0-9]*: done\|has exited\|: until ' "$TP_OUT/run.log" || { echo "movie did not finish (exit $status)" >&2; exit 1; }
# The cards as the run left them.
for port in 1 2; do
  [ -f "$TP_OUT/home/.config/pcsx-redux/memcard$port.mcd" ] && cp "$TP_OUT/home/.config/pcsx-redux/memcard$port.mcd" "$TP_OUT/card$port.mcd"
done
true
