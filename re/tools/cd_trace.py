#!/usr/bin/env python3
"""Summarise the CD-ROM commands logged by re/lua/smoke.lua (TP_CD_HOOKS) as file reads and
CD audio plays.

Each Setloc (command 0x02) carries a BCD minute/second/frame position. It is converted to an
LBA and named: a data-track file (with the sector offset into it) or an audio track (with the
time offset into it). The command that follows a Setloc says what was done there:
ReadN/ReadS (0x06/0x1B) read data, Play (0x03) starts CD audio, SeekL/SeekP (0x15/0x16) seek.
Consecutive reads of the same file by the same program are merged into one line.

Usage: cd_trace.py RUN.log DISC.cue TRACK01.bin
"""

import os
import re
import subprocess
import sys

SECTOR = 2352
COMMANDS = {0x03: "play", 0x06: "read", 0x1B: "read", 0x15: "seek", 0x16: "seek"}


def bcd(value):
    return (value >> 4) * 10 + (value & 15)


def audio_tracks(cue_path):
    """[(track number, first LBA of its file (pregap included), LBA of INDEX 01, end LBA)]."""
    tracks, lba = [], 0
    for line in open(cue_path):
        if m := re.match(r'\s*FILE "(.+)" BINARY', line):
            size = os.path.getsize(os.path.join(os.path.dirname(cue_path), m[1])) // SECTOR
        elif m := re.match(r"\s*TRACK (\d+) (\S+)", line):
            pregap = 0 if m[2] != "AUDIO" else 150
            tracks.append((int(m[1]), lba, lba + pregap, lba + size))
            lba += size
    return tracks


def data_files(track01):
    listing = subprocess.run([sys.executable, os.path.join(os.path.dirname(__file__), "iso_listing.py"), track01],
                             capture_output=True, text=True, check=True).stdout
    return [(m[1], int(m[2]), int(m[3])) for m in re.finditer(r"\| `(\S+)` \| (\d+) \| (\d+) \|", listing)]


def name_lba(lba, files, tracks):
    if lba < files[0][1]:
        return "ISO 9660 descriptors/directory", lba
    for name, start, sectors in files:
        if start <= lba < start + sectors:
            return name, lba - start
    # Offsets are from INDEX 01 and are negative in the pregap. The game seeks to TOC positions,
    # which the drive reports to the whole second, so plays often start a little before INDEX 01.
    for number, file_start, index1, end in tracks:
        if file_start <= lba < end:
            return f"track {number:02d}", lba - index1
    return f"LBA {lba}", 0


def main():
    log, cue, track01 = sys.argv[1:4]
    tracks, files = audio_tracks(cue), data_files(track01)
    events, pending = [], None
    for line in open(log):
        m = re.match(r"frame (\d+): cd (\S+) \S+ com=0x(\w+) param=(.*)", line)
        if not m:
            continue
        frame, program, com, param = int(m[1]), m[2], int(m[3], 16), m[4].split()
        if com == 0x02:
            mm, ss, ff = (bcd(int(b, 16)) for b in param[:3])
            pending = (mm * 60 + ss) * 75 + ff - 150
        elif com in COMMANDS and pending is not None:
            name, offset = name_lba(pending, files, tracks)
            last = events[-1] if events else None
            if COMMANDS[com] == "read" and last and last[1:4] == (program, "read", name):
                last[5] = frame
            else:
                events.append([frame, program, COMMANDS[com], name, offset, frame])
            pending = None
    for frame, program, action, name, offset, last_frame in events:
        if action == "read":
            span = f" (frames {frame}-{last_frame})" if last_frame != frame else ""
            print(f"frame {frame:6d}  {program:12s} read  {name} from sector {offset}{span}")
        else:
            print(f"frame {frame:6d}  {program:12s} {action:5s} {name} at {offset / 75:+.2f} s")


if __name__ == "__main__":
    main()
