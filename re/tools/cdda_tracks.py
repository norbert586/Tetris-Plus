#!/usr/bin/env python3
"""List the disc's CD audio tracks: length, peak/RMS level and which tracks share audio.

Reads the per-track BIN files named by the CUE sheet. Each audio file starts with its 2-second
pregap (INDEX 00), which is skipped so lengths and hashes cover only the playable audio.
Two tracks are reported as "same audio" when their PCM is byte-identical, and as "near" when the
first differing sample is far in (they share an opening) or when their lengths match.

Usage: cdda_tracks.py DISC.cue            (prints a Markdown table)
"""

import array
import hashlib
import math
import os
import re
import sys

SECTOR = 2352
FRAMES_PER_SECOND = 75


def parse_cue(path):
    tracks, current_file = [], None
    for line in open(path, encoding="utf-8", errors="replace"):
        if m := re.match(r'\s*FILE "(.+)" BINARY', line):
            current_file = os.path.join(os.path.dirname(path), m[1])
        elif m := re.match(r"\s*TRACK (\d+) (\S+)", line):
            tracks.append({"number": int(m[1]), "mode": m[2], "file": current_file, "index": {}})
        elif m := re.match(r"\s*INDEX (\d+) (\d+):(\d+):(\d+)", line):
            mm, ss, ff = int(m[2]), int(m[3]), int(m[4])
            tracks[-1]["index"][int(m[1])] = (mm * 60 + ss) * FRAMES_PER_SECOND + ff
    return tracks


def msf(sectors):
    return f"{sectors // (60 * FRAMES_PER_SECOND)}:{sectors // FRAMES_PER_SECOND % 60:02d}.{sectors % FRAMES_PER_SECOND:02d}"


def main():
    tracks = [t for t in parse_cue(sys.argv[1]) if t["mode"] == "AUDIO"]
    for track in tracks:
        data = open(track["file"], "rb").read()[track["index"][1] * SECTOR:]
        samples = array.array("h", data)
        track["sectors"] = len(data) // SECTOR
        track["md5"] = hashlib.md5(data).hexdigest()
        track["data"] = data
        peak = max(abs(min(samples)), max(samples)) if samples else 0
        rms = math.sqrt(sum(s * s for s in samples[::64]) / max(1, len(samples[::64])))
        track["peak_db"] = 20 * math.log10(max(peak, 1) / 32768)
        track["rms_db"] = 20 * math.log10(max(rms, 1) / 32768)
        nonzero = next((i for i, s in enumerate(samples) if abs(s) > 64), len(samples))
        track["lead_ms"] = nonzero // 2 * 1000 // 44100

    print("| Track | Length (m:ss.ff) | Sectors | Peak dBFS | RMS dBFS | Lead-in silence | Relation |")
    print("|---|---|---|---|---|---|---|")
    for track in tracks:
        relations = []
        for other in tracks:
            if other is track:
                continue
            if other["md5"] == track["md5"]:
                relations.append(f"identical to {other['number']:02d}")
            elif other["sectors"] == track["sectors"]:
                a, b = track["data"], other["data"]
                first_diff = next((i for i in range(0, len(a), SECTOR) if a[i:i + SECTOR] != b[i:i + SECTOR]), None)
                relations.append(f"same length as {other['number']:02d}, differs from {msf(first_diff // SECTOR)}")
        print(f"| {track['number']:02d} | {msf(track['sectors'])} | {track['sectors']} | {track['peak_db']:.1f} | "
              f"{track['rms_db']:.1f} | {track['lead_ms']} ms | {'; '.join(relations)} |")


if __name__ == "__main__":
    main()
