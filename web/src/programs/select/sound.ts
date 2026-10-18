// SELECT.EXE's sound calls (docs/re/select.md §5): its se_play (0x80094D2C) and bgm_request
// (0x80095140), the same design as Puzzle Mode's (src/core/sound.ts) with SELECT's own tables,
// and the CD player bookkeeping they share with the sound test (bgm_play_track's start and end
// positions, and the CD commands it sends).
import * as A from '../../core/addr';
import type { Select } from './select';

export const BGM_STOP = 0x34;

const MUSIC_VOL_TABLE = 0x800b1fb4; // s16[8] by the music volume setting
const SE_VOL_TABLE = 0x800b1fc4; // s16[8] by the effect volume setting
const SE_TABLE = 0x800b1fd4; // per effect: program, pitch (note << 8)
const TRACK_LENGTH = 0x800b2168; // per track from track 2, stride 12: length in sectors
const TRACK_MODE = 0x800b216c; // 1 loops, 0 plays once
const BGM_PRIORITY = 0x800b2170;
const ZONE_TRACKS_1 = 0x800b23d8; // u16 by zone (request 0x23)
const ZONE_TRACKS_2 = 0x800b23e2; // u16 by zone (request 0x24)

export const SND_PLAYER = 0x800b90a8; // the player whose sound this is (always 0 here)
const ZONE = 0x800b90ac; // [2]
export const BGM_CUR_PLAYER = 0x800b90c0;
export const BGM_CUR_ID = 0x800b90c4;
export const BGM_WANT_P1 = 0x800b90c8;
export const BGM_WANT_P2 = 0x800b90cc;
const BGM_JOIN_D0 = 0x800b90d0; // added to player 1's priority
const BGM_JOIN_D4 = 0x800b90d4; // added to player 2's priority
// The CD player (bgm_play_track, 0x80094F78)
const CD_MODE_PARAM = 0x800b90e8;
const CD_START = 0x800b90fc;
const CD_END = 0x800b9100;
const CD_POS = 0x800b9104;
const CD_FLAG_108 = 0x800b9108;
export const CD_TRACK = 0x800b90f4;
export const CD_LOOP = 0x800b90f8;
export const CD_TRACK_START = 0x800b9124;
export const CD_TRACK_END = 0x800b9128;
const CD_LAST_COMMAND = 0x800b2164;
/** Set by the CD report callback on an error (and by format's result, card.ts): CdReset next. */
export const CD_ERROR = 0x800b911c;
const CD_RESET_RESULT = 0x800b9120;
/** The disc's TOC (CdlLOC per track) and its track count, in the shared state block. */
const TOC = A.S + 0x20550;
const TRACK_COUNT = A.S + 0x206e0;

const bcd = (v: number) => (v >> 4) * 10 + (v & 15);
const toBcd = (v: number) => ((Math.trunc(v / 10) << 4) | v % 10) & 0xff;

/** CdPosToInt of a CdlLOC in RAM. */
function posToInt(s: Select, loc: number): number {
  const m = s.m;
  return (bcd(m.u8(loc)) * 60 + bcd(m.u8(loc + 1))) * 75 + bcd(m.u8(loc + 2)) - 150;
}

/** CdIntToPos: minute, second, sector in BCD. */
function intToPos(i: number): number[] {
  const n = i + 150;
  const s = Math.trunc(n / 75);
  return [toBcd(Math.trunc(s / 60)), toBcd(s % 60), toBcd(n % 75)];
}

/** The SPU volume of the music at the current music volume setting. */
export function musicVolume(s: Select): number {
  return s.m.s16(MUSIC_VOL_TABLE + 2 * s.m.u8(A.MUSIC_VOLUME));
}

/** SsSetSerialVol(CD, v, v). */
export function cdVolume(s: Select, vol: number): void {
  s.sound.push({ kind: 'cdvol', vol: vol & 0xffff });
}

/** se_play (0x80094D2C) */
export function sePlay(s: Select, id: number): void {
  const m = s.m;
  s.se.push(id);
  const vol = m.u16(SE_VOL_TABLE + 2 * m.u8(A.SE_VOLUME));
  if (vol === 0) return;
  let prog = m.s32(SE_TABLE + 8 * id);
  if (m.s32(A.TWO_PLAYER) >= 1 && (m.u8(A.SETTING_4FC) & 1) === 0) {
    const p = m.s32(SND_PLAYER);
    if (p === 0) prog += 5;
    else if (p === 1) prog += 10;
    else return;
  }
  const pitch = m.s32(SE_TABLE + 8 * id + 4);
  s.sound.push({ kind: 'key', prog: prog & 0xff, note: (pitch >> 8) & 0xff, vol });
}

/**
 * Starts CD track `track` (bgm_request's and the sound test's common part): the end position
 * from the track's length, then bgm_play_track (0x80094F78) and its CD commands.
 */
export function playTrack(s: Select, track: number, loop: number): void {
  const m = s.m;
  m.w32(CD_TRACK, track);
  m.w32(CD_LOOP, loop);
  const start = trackPlay(s, track);
  m.w32(CD_TRACK_START, start);
  m.w32(CD_LAST_COMMAND, 3);
  s.sound.push({ kind: 'play', track, mode: loop });
}

/**
 * The main loop's CD recovery (0x80095800, after PadRead): when the CD error flag is set,
 * CdReset, then the current track again from its start (bgm_play_track).
 */
export function cdRecover(s: Select): void {
  const m = s.m;
  m.w32(CD_ERROR, 0);
  m.w32(CD_RESET_RESULT, 0);
  const track = m.s32(CD_TRACK);
  trackPlay(s, track);
  s.sound.push({ kind: 'play', track, mode: m.s32(CD_LOOP) });
}

/** The end position from the track's length, then bgm_play_track(start, end). Returns start. */
function trackPlay(s: Select, track: number): number {
  const m = s.m;
  const start = posToInt(s, TOC + 4 * track);
  const end = m.s32(TRACK_LENGTH + (track - 2) * 12) + start;
  m.w32(CD_TRACK_END, end);
  // bgm_play_track(start, end): Setmode (CD-DA, report), then FUN_800950C0: Setloc and Play.
  m.w32(CD_FLAG_108, 0);
  m.w8(CD_MODE_PARAM, 5);
  m.w32(CD_START, start);
  m.w32(CD_END, end);
  m.w32(CD_POS, start);
  s.cd.push([0x0e, 5]);
  s.cd.push([0x02, ...intToPos(start)]);
  s.cd.push([0x03]);
  m.w32(CD_POS, start);
  return start;
}

/** Whether the disc has track `track` (bgm_request and the sound test only play those). */
export function trackExists(s: Select, track: number): boolean {
  return track === 99 || (track > 0 && track <= s.m.s32(TRACK_COUNT));
}

/** bgm_request (0x80095140) */
export function bgmRequest(s: Select, id: number): void {
  const m = s.m;
  s.bgm.push(id);
  if (musicVolume(s) === 0) return;
  if (m.s32(SND_PLAYER) === 0) m.w32(BGM_WANT_P1, id);
  else m.w32(BGM_WANT_P2, id);
  let player = m.s32(SND_PLAYER);
  if (m.s32(A.TWO_PLAYER) !== 0) {
    let j1 = 0;
    let j2 = 0;
    if ((id - 0x23) >>> 0 < 2) {
      j1 = m.s32(BGM_JOIN_D0);
      j2 = m.s32(BGM_JOIN_D4);
    }
    const w1 = m.s32(BGM_WANT_P1);
    const w2 = m.s32(BGM_WANT_P2);
    const pr1 = j1 + m.s32(BGM_PRIORITY + (w1 - 2) * 12);
    const pr2 = j2 + m.s32(BGM_PRIORITY + (w2 - 2) * 12);
    if (pr2 < pr1) {
      player = 0;
      id = w1;
    }
    if (pr1 < pr2) {
      player = 1;
      id = w2;
    }
  }
  if (player === m.s32(BGM_CUR_PLAYER) && m.s32(BGM_CUR_ID) === id) return;
  let track = id;
  if (m.u8(A.SETTING_4FD) === 0) {
    const zone = m.s32(ZONE + 4 * player);
    if (id === 0x22) track = 3;
    else if (id === 0x23) track = m.u16(ZONE_TRACKS_1 + 2 * zone);
    else if (id === 0x24) track = m.u16(ZONE_TRACKS_2 + 2 * zone);
    else if (id === 0x25) track = 0x0e;
    else if (id === 0x26) track = 0x0f;
    else if (id >= 0x27 && id <= 0x2b) track = id - 0x27 + 0x12;
    else if (id >= 0x2c && id <= 0x31) track = id - 0x2c + 0x18;
    else if (id === 0x32) track = m.s32(ZONE + 4 * m.s32(SND_PLAYER)) === 4 ? 0x20 : 0x1e;
    else if (id === 0x33) track = m.s32(ZONE + 4 * m.s32(SND_PLAYER)) === 4 ? 0x21 : 0x1f;
  }
  m.w32(BGM_CUR_PLAYER, player);
  m.w32(BGM_CUR_ID, id);
  let vol = 0;
  if (track !== BGM_STOP) {
    if (trackExists(s, track)) playTrack(s, track, m.s32(TRACK_MODE + (track - 2) * 12));
    vol = musicVolume(s);
  }
  cdVolume(s, vol);
}
