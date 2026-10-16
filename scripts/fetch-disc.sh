#!/usr/bin/env bash
# Downloads the disc image archive ("Tetris Plus.7z", shared on Google Drive) into a private
# folder next to the repo, checks it is Tetris Plus (USA) SLUS-00338 and unpacks the data
# track's files. Nothing here is written inside the repo.
#
# Usage: scripts/fetch-disc.sh DRIVE_FILE_ID
#   Find the ID by searching the connected Google Drive for the title "Tetris Plus.7z".
#   TP_PRIVATE overrides the destination (default: ../tp-private relative to the repo).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TP_PRIVATE="${TP_PRIVATE:-$(dirname "$REPO_ROOT")/tp-private}"
TRACK01_SHA1=7a300536e37708b791b72433dcafac8d0e5069eb   # Redump: Tetris Plus (USA), SLUS-00338

drive_id="${1:-${TETRIS_DISC_DRIVE_ID:-}}"
[ -n "$drive_id" ] || { echo "usage: $0 DRIVE_FILE_ID" >&2; exit 2; }

# shellcheck source=/dev/null
source "${TP_TOOLS:-/opt/tp-tools}/env.sh"

archive="$TP_PRIVATE/download/Tetris Plus.7z"
mkdir -p "$TP_PRIVATE/download" "$TP_PRIVATE/disc"
if [ ! -f "$archive" ]; then
  echo "[disc] downloading archive"
  curl -sSL --fail -o "$archive" \
    "https://drive.usercontent.google.com/download?id=${drive_id}&export=download&confirm=t"
fi

echo "[disc] extracting"
7z x -y -o"$TP_PRIVATE/disc" "$archive" -x'!readme.html' >/dev/null
echo "$TRACK01_SHA1  $TP_PRIVATE/disc/Tetris Plus (Track 01).bin" | sha1sum -c --quiet
echo "[disc] data track matches Redump (USA, SLUS-00338)"

if [ ! -f "$TP_PRIVATE/files/PAZLE.EXE" ]; then
  "$TP_DUMPSXISO" -x "$TP_PRIVATE/files" -s "$TP_PRIVATE/layout.xml" "$TP_PRIVATE/disc/Tetris Plus.cue" >/dev/null
fi
echo "[disc] ready: $TP_PRIVATE/disc (image), $TP_PRIVATE/files (data track files)"
