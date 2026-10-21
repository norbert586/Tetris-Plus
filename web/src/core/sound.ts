// Sound and music requests (docs/re/static-bootstrap.md §3.3). The core records each call as an
// event for the audio layer (and the trace) and keeps bgm_request's bookkeeping, which decides
// what plays when two players want different tunes and what pause restores.
import * as A from './addr';
import type { Mem } from './mem';

export const BGM_STOP = 0x34;

/**
 * Where a program keeps its copy of the sound code's tables and variables. Every program links
 * its own se_play and bgm_request (the same code, docs/re/shell.md §5) with these at its own
 * addresses.
 */
export interface SoundAddresses {
  /** s16[8] CD volume by the music volume setting */
  musicVol: number;
  /** s16[8] effect volume by the sound effect volume setting */
  seVol: number;
  /** per effect: program, pitch (note << 8) */
  seTable: number;
  /** per CD track from track 2, 12 bytes: end offset, mode (1 loops, 0 plays once), 2P priority */
  tracks: number;
  /** the playing request's player and id */
  curPlayer: number;
  curId: number;
  /** each player's wanted request */
  wantP1: number;
  wantP2: number;
  /** each player's priority bonus (joining in two-player mode) */
  joinP1: number;
  joinP2: number;
  /** each player's zone, and the zone tunes for requests 0x23 and 0x24 */
  zone: number;
  zoneTuneA: number;
  zoneTuneB: number;
}

/** PAZLE.EXE's (docs/re/audio.md §1). */
export const PAZLE_SOUND: SoundAddresses = {
  musicVol: 0x800dc45c,
  seVol: 0x800dc46c,
  seTable: 0x800dc47c,
  tracks: 0x800dc610,
  curPlayer: 0x800ed338,
  curId: 0x800ed33c,
  wantP1: 0x800ed340,
  wantP2: 0x800ed344,
  joinP1: 0x800ed348,
  joinP2: 0x800ed34c,
  zone: 0x800eebb0,
  zoneTuneA: 0x800dc880,
  zoneTuneB: 0x800dc88a,
};

export const BGM_JOIN_P1 = PAZLE_SOUND.joinP1;
export const BGM_JOIN_P2 = PAZLE_SOUND.joinP2;

/** What the sound calls need of a program: its memory, its player and its event lists. */
export interface SoundPlayer {
  m: Mem;
  /** The player the call is for (PAZLE: the current player, 0x800EEAD0). */
  p: number;
  se: number[];
  bgm: number[];
  sound: SoundCall[];
}

/**
 * What the program asks of the sound library and the CD (docs/re/audio.md §1): the audio
 * layer (web/src/audio) plays these. `key` is SsVoKeyOn (program, note, volume), `play` is
 * bgm_play_track (CD track, loop mode), `cdvol` is SsSetSerialVol's CD volume (0-127).
 */
export type SoundCall =
  | { kind: 'key'; prog: number; note: number; vol: number }
  | { kind: 'play'; track: number; mode: number }
  | { kind: 'cdvol'; vol: number };

/** se_play(id) */
export function sePlay(g: SoundPlayer, id: number, t: SoundAddresses = PAZLE_SOUND): void {
  const m = g.m;
  g.se.push(id);
  const vol = m.s16(t.seVol + 2 * m.u8(A.SE_VOLUME));
  if (vol === 0) return;
  let prog = m.s32(t.seTable + 8 * id);
  if (m.s32(A.TWO_PLAYER) >= 1 && (m.u8(A.SETTING_4FC) & 1) === 0) {
    // Two players in stereo: each player's effects from their side (programs +5 left, +10 right).
    if (g.p === 0) prog += 5;
    else if (g.p === 1) prog += 10;
    else return;
  }
  const pitch = m.s32(t.seTable + 8 * id + 4);
  g.sound.push({ kind: 'key', prog: prog & 0xff, note: (pitch >> 8) & 0xff, vol: vol & 0xffff });
}

/** The CD track bgm_request picks for a request (CD audio track numbers 2-33). */
function trackFor(g: SoundPlayer, id: number, player: number, t: SoundAddresses): number {
  const m = g.m;
  if (m.u8(A.SETTING_4FD) !== 0) return id;
  const zone = m.s32(t.zone + 4 * player);
  switch (id) {
    case 0x22: return 3;
    case 0x23: return m.u16(t.zoneTuneA + 2 * zone);
    case 0x24: return m.u16(t.zoneTuneB + 2 * zone);
    case 0x25: return 0x0e;
    case 0x26: return 0x0f;
    case 0x32: return m.s32(t.zone + 4 * g.p) === 4 ? 0x20 : 0x1e;
    case 0x33: return m.s32(t.zone + 4 * g.p) === 4 ? 0x21 : 0x1f;
    default:
      if (id >= 0x27 && id <= 0x2b) return id - 0x27 + 0x12;
      if (id >= 0x2c && id <= 0x31) return id - 0x2c + 0x18;
      return id;
  }
}

/** bgm_request(id) */
export function bgmRequest(g: SoundPlayer, id: number, t: SoundAddresses = PAZLE_SOUND): void {
  const m = g.m;
  g.bgm.push(id);
  if (m.s16(t.musicVol + 2 * m.u8(A.MUSIC_VOLUME)) === 0) return;
  if (g.p === 0) m.w32(t.wantP1, id);
  else m.w32(t.wantP2, id);
  let player = g.p;
  if (m.s32(A.TWO_PLAYER) !== 0) {
    let j1 = 0;
    let j2 = 0;
    if ((id - 0x23) >>> 0 < 2) {
      j1 = m.s32(t.joinP1);
      j2 = m.s32(t.joinP2);
    }
    const w1 = m.s32(t.wantP1);
    const w2 = m.s32(t.wantP2);
    const pr1 = j1 + m.s32(t.tracks + 8 + (w1 - 2) * 12);
    const pr2 = j2 + m.s32(t.tracks + 8 + (w2 - 2) * 12);
    if (pr2 < pr1) {
      player = 0;
      id = w1;
    }
    if (pr1 < pr2) {
      player = 1;
      id = w2;
    }
  }
  if (player === m.s32(t.curPlayer) && m.s32(t.curId) === id) return;
  const track = trackFor(g, id, player, t);
  m.w32(t.curPlayer, player);
  m.w32(t.curId, id);
  let vol = 0;
  if (track !== BGM_STOP) {
    g.sound.push({ kind: 'play', track, mode: m.s32(t.tracks + 4 + (track - 2) * 12) });
    vol = m.s16(t.musicVol + 2 * m.u8(A.MUSIC_VOLUME));
  }
  g.sound.push({ kind: 'cdvol', vol });
}
