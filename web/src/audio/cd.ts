// The CD drive playing the music tracks, and the program's CD callback (docs/re/audio.md §6).
//
// bgm_play_track sends Setmode (CD-DA + report), Setloc (the track's TOC entry: its start rounded
// down to the second) and Play. While a track plays, the drive reports its position every 10
// sectors, alternating absolute and track-relative; the callback (0x80095C5C) keeps the absolute
// second and, once it passes the track's end, either starts the track again (looping tracks) or
// turns the CD volume off and lets the disc run on. The timing is the oracle's (PCSX-Redux):
// a seek costs 20 ms + 3 us per sector of distance + 1 ms, a sector 13.333 ms, and reports start
// 750 ms after playing does. Commands the program sends from its logic are exact; when they
// happen inside a tick is not modelled, so reports and the loops they trigger can land a tick
// early or late.
import type { Mem } from '../core/mem';

export const CPU_HZ = 33_868_800;
const ms = (t: number) => Math.trunc((t * CPU_HZ) / 1000);
const SECTOR = 451_582; // 13.333 ms, plus the scheduler's average lateness (measured)
const SETTLE = ms(750);
const SEEK_START = ms(20);
const seekTime = (distance: number) => Math.trunc(((distance * 3 + 1000) * CPU_HZ) / 1e6);

/** PAZLE.EXE's per-track table (0x800DC610, from track 2, 12 bytes): end offset, loop mode. */
const TRACK_TABLE = 0x800dc610;

/** The disc as the drive sees it: each track's index 01 and pregap, in sectors from 00:00:00. */
export interface Disc {
  /** By track number (1-52): where index 01 starts (MSF sectors, 2 s lead-in included). */
  start: number[];
  pregap: number[];
  /** The end of the last track. */
  end: number;
}

const bcd = (n: number) => ((n / 10) | 0) * 16 + (n % 10);
const fromBcd = (b: number) => (b >> 4) * 10 + (b & 15);

/** CdPosToInt for an MSF sector count: LBA = MSF - 150. */
const toInt = (msf: number) => msf - 150;
/** The TOC entry the program reads for a track: index 01's minute and second, sector 0. */
export const tocSector = (disc: Disc, track: number) => disc.start[track] - (disc.start[track] % 75);

/** A position report as the callback receives it: interrupt type, then the result bytes. */
export type Report = number[];

/** What happened during a stretch of time, for the trace and the player. */
export interface CdEvent {
  cycle: number;
  /** cd: a command (number, then Setloc's or Setmode's bytes); cdr: a report; vol: CD volume. */
  kind: 'cd' | 'cdr' | 'vol' | 'sector' | 'error';
  data: number[];
}

const IDLE = 0;
const SEEKING = 1;
const READING = 2;
const PLAYING = 3;

export class CdDrive {
  /** The head's position (MSF sectors) and where the next seek goes. */
  private position: number;
  private seekTarget = 0;
  private report = false;
  private state = IDLE;
  /** When the drive's next scheduled step happens (cycles). */
  private next = Infinity;
  private playStart = 0;

  // The program's own state (0x800ED36C-0x800ED37C): track, loop mode, start, end, last second.
  private track = 0;
  private loop = 0;
  private startInt = 0;
  private endInt = 0;
  private posInt = 0;

  readonly events: CdEvent[] = [];
  /** Where the running program keeps its track table (programs.ts). */
  trackTable = TRACK_TABLE;

  constructor(
    private readonly disc: Disc,
    private readonly rom: Mem,
    /** Where the head is when Puzzle Mode starts (after loading the program's files). */
    bootPosition: number,
    /** CPU cycles from a report's interrupt to the callback, and per blocking CdControlB call. */
    private readonly callbackDelay = 60_500,
    private readonly commandTime = 31_700,
  ) {
    this.position = bootPosition;
  }

  /** bgm_play_track(track, mode) at `cycle`: Setmode, Setloc, Play. */
  play(track: number, mode: number, cycle: number): void {
    this.run(cycle);
    this.track = track;
    this.loop = mode;
    const toc = tocSector(this.disc, track);
    this.startInt = toInt(toc);
    this.endInt = toInt(toc) + this.rom.s32(this.trackTable + (track - 2) * 12);
    this.posInt = this.startInt;
    this.command(cycle, [0x0e, 5]);
    this.report = true;
    this.seekPlay(cycle + this.commandTime);
  }

  /** FUN_80095D28: Setloc to the track's start, then Play. */
  private seekPlay(cycle: number): void {
    const msf = this.startInt + 150;
    this.command(cycle, [2, bcd(Math.floor(msf / 4500)), bcd(Math.floor(msf / 75) % 60), bcd(msf % 75)]);
    this.seekTarget = msf;
    const play = cycle + this.commandTime;
    // The drive plays on (and reports) until the Play command replaces what it was doing.
    this.run(play - 1);
    this.command(play, [3]);
    this.posInt = this.startInt;
    // Play with a Setloc pending: seek, then play.
    this.state = SEEKING;
    this.next = play + SEEK_START;
  }

  private command(cycle: number, data: number[]): void {
    this.events.push({ cycle, kind: 'cd', data });
  }

  /** Runs the drive up to `cycle`. */
  run(cycle: number): void {
    while (this.next <= cycle) {
      const at = this.next;
      switch (this.state) {
        case SEEKING: {
          const delay = seekTime(Math.abs(this.seekTarget - this.position));
          this.position = this.seekTarget;
          this.state = READING;
          this.next = at + delay + SECTOR;
          break;
        }
        case READING:
          this.state = PLAYING;
          this.playStart = at;
          this.sector(at);
          break;
        case PLAYING:
          this.sector(at);
          break;
        default:
          this.next = Infinity;
      }
    }
  }

  /** One sector of CD-DA: its audio, and a report on every tenth absolute sector. */
  private sector(at: number): void {
    const pos = this.position;
    if (pos >= this.disc.end) {
      // Playing past the last sector: the drive stops with an error, which the program's
      // callback turns into its CD error flag (model.ts resets the CD on the next tick). Measured
      // in sw_on-unformatted: SW_ON's Setloc to 63:46:00 plays the disc's last 53 sectors, and
      // each reset follows the previous Play by 53.79-54.36 M cycles; the model gives 53.9 M.
      this.state = IDLE;
      this.next = Infinity;
      this.events.push({ cycle: at + this.callbackDelay, kind: 'error', data: [] });
      return;
    }
    this.events.push({ cycle: at, kind: 'sector', data: [pos] });
    this.position++;
    this.next = at + SECTOR;
    const frame = pos % 75;
    if (this.report && at - this.playStart >= SETTLE && frame % 10 === 0) {
      const loc = this.locP(pos);
      const absolute = ((frame / 10) & 1) === 0;
      const result = absolute ? [0x82, loc[0], loc[1], loc[5], loc[6], loc[7]]
        : [0x82, loc[0], loc[1], loc[2], loc[3] | 0x80, loc[4]];
      this.callback(at + this.callbackDelay, result);
    }
  }

  /**
   * A program change at `cycle` (docs/re/audio.md §11): the boot program's loader reads the next
   * program's files, which ends CD-DA play and its reports and leaves the head at `position`;
   * the new program starts with its own callback state (its BSS is cleared).
   */
  load(cycle: number, position: number, trackTable: number): void {
    this.run(cycle);
    this.events.splice(0, this.events.length, ...this.events.filter((e) => e.cycle < cycle));
    this.state = IDLE;
    this.next = Infinity;
    this.report = false;
    this.position = position;
    this.track = this.loop = this.startInt = this.endInt = this.posInt = 0;
    this.trackTable = trackTable;
  }

  /**
   * CdReset at `cycle` (a program's CD error recovery): the drive stops playing and reporting,
   * and its Init command leaves the head at the start of the disc (00:02:00; the next Play's
   * seek, 44,302,037 cycles from Setmode to the first report in select-format, says so).
   */
  reset(cycle: number): void {
    this.run(cycle);
    this.position = 150;
    this.events.splice(0, this.events.length, ...this.events.filter((e) => e.cycle < cycle));
    this.state = IDLE;
    this.next = Infinity;
    this.report = false;
  }

  /**
   * Setmode, Setloc to a CdlLOC as the program read it (minute, second, sector, in BCD: SW_ON's
   * is the TOC's entry 0, 63:46:00, the disc's last 53 sectors) and Play, without the program's
   * track bookkeeping: SW_ON's restart after a format (docs/re/sw_on.md §5).
   */
  playLoc(cycle: number, loc: number[]): void {
    this.run(cycle);
    this.command(cycle, [0x0e, 5]);
    this.report = true;
    const at = cycle + this.commandTime;
    this.command(at, [2, ...loc]);
    this.seekTarget = (fromBcd(loc[0]) * 60 + fromBcd(loc[1])) * 75 + fromBcd(loc[2]);
    const play = at + this.commandTime;
    this.run(play - 1);
    this.command(play, [3]);
    this.state = SEEKING;
    this.next = play + SEEK_START;
  }

  /** The callback (0x80095C5C) for a DataReady report. */
  private callback(cycle: number, result: number[]): void {
    this.events.push({ cycle, kind: 'cdr', data: [1, ...result] });
    if ((result[4] & 0x80) === 0) {
      this.posInt = (fromBcd(result[3]) * 60 + fromBcd(result[4])) * 75 - 150;
    }
    if (this.endInt < this.posInt) {
      if (this.loop === 1) this.seekPlay(cycle + this.commandTime);
      else this.events.push({ cycle, kind: 'vol', data: [0] });
    }
  }

  /** The Q subchannel's position: track, index, relative MSF, absolute MSF (BCD). */
  private locP(pos: number): number[] {
    const d = this.disc;
    let track = d.start.length - 1;
    while (track > 1 && d.start[track] > pos) track--;
    let pregap = false;
    if (pos < d.start[track]) pregap = true;
    else if (track < d.start.length - 1 && pos >= d.start[track + 1] - d.pregap[track + 1]) {
      track++;
      pregap = true;
    }
    const rel = pregap ? d.start[track] - pos : pos - d.start[track];
    const msf = (n: number) => [bcd(Math.floor(n / 4500)), bcd(Math.floor(n / 75) % 60), bcd(n % 75)];
    return [bcd(track), pregap ? 0 : 1, ...msf(rel), ...msf(pos)];
  }

  /** The track the program last asked for, and whether the drive is playing. */
  get playing(): number {
    return this.state === PLAYING ? this.track : 0;
  }
}
