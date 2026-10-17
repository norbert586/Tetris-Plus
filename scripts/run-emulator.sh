#!/usr/bin/env bash
# Runs the original game headless in PCSX-Redux (interpreter with the debugger on, so Lua
# breakpoints fire; OpenBIOS; fast boot) under a Lua control script. Inputs and outputs are
# passed to the Lua script through TP_* variables (see re/lua/smoke.lua).
#
# Usage: scripts/run-emulator.sh LUA_SCRIPT OUT_DIR
#   Example: TP_FRAMES=600 scripts/run-emulator.sh re/lua/smoke.lua ../tp-private/runs/test
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TP_PRIVATE="${TP_PRIVATE:-$(dirname "$REPO_ROOT")/tp-private}"
lua_script="$(realpath "$1")"
out_dir="$2"

# shellcheck source=/dev/null
source "${TP_TOOLS:-/opt/tp-tools}/env.sh"

mkdir -p "$out_dir"
export TP_OUT
TP_OUT="$(realpath "$out_dir")"
"$TP_REDUX" -cli -interpreter -debugger -fastboot -iso "$TP_PRIVATE/disc/Tetris Plus.cue" -run \
  -dofile "$lua_script" -lua_stdout -stdout > "$TP_OUT/run.log" 2>&1
grep -E '^frame ' "$TP_OUT/run.log" || true
