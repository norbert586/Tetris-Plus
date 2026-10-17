#!/usr/bin/env bash
# Records the trace corpus: every movie in re/movies/ is played twice on the original
# (scripts/check-determinism.sh). If both runs agree, the trace is stored as
# re/traces/NAME.jsonl.gz. Runs up to 3 movies at once.
#
# Usage: scripts/record-corpus.sh [MOVIE.tpm ...]   (default: all of re/movies/*.tpm)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TP_PRIVATE="${TP_PRIVATE:-$(dirname "$REPO_ROOT")/tp-private}"
runs="$TP_PRIVATE/runs/corpus"
mkdir -p "$runs" "$REPO_ROOT/re/traces"
[ $# -gt 0 ] || set -- "$REPO_ROOT"/re/movies/*.tpm

record() {
  local name
  name="$(basename "$1" .tpm)"
  if "$REPO_ROOT/scripts/check-determinism.sh" "$1" "$runs/$name" > "$runs/$name.log" 2>&1; then
    gzip -9 -n -c "$runs/$name/a/trace.jsonl" > "$REPO_ROOT/re/traces/$name.jsonl.gz"
    echo "$name: deterministic; $(head -1 "$runs/$name.log")"
  else
    echo "$name: FAILED (see $runs/$name.log)"
    return 1
  fi
}

status=0
pids=()
for movie in "$@"; do
  record "$movie" & pids+=($!)
  if [ ${#pids[@]} -ge 3 ]; then wait "${pids[0]}" || status=1; pids=("${pids[@]:1}"); fi
done
for pid in "${pids[@]}"; do wait "$pid" || status=1; done
exit $status
