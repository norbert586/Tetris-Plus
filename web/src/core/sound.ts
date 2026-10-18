// Sound and music requests (docs/re/static-bootstrap.md §3.3). The core records each call as an
// event for the audio layer (and the trace) and keeps bgm_request's bookkeeping, which decides
// what plays when two players want different tunes and what pause restores.
import * as A from './addr';
import type { Game } from './game';

export const BGM_STOP = 0x34;

const BGM_CUR_PLAYER = 0x800ed338;
const BGM_CUR_ID = 0x800ed33c;
const BGM_WANT_P1 = 0x800ed340;
const BGM_WANT_P2 = 0x800ed344;
export const BGM_JOIN_P1 = 0x800ed348;
export const BGM_JOIN_P2 = 0x800ed34c;
const MUSIC_VOL_TABLE = 0x800dc45c; // s16[8] by the music volume setting
const BGM_PRIORITY = 0x800dc618; // per track, stride 12, from track 2
const ZONE = 0x800eebb0;
const SE_VOL_TABLE = 0x800dc46c; // s16[8] by the sound effect volume setting
const SE_TABLE = 0x800dc47c; // per effect: program, pitch (note << 8)
const TRACK_MODE = 0x800dc614; // per track from track 2, stride 12: 1 loops, 0 plays once

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
export function sePlay(g: Game, id: number): void {
  const m = g.m;
  g.se.push(id);
  const vol = m.s16(SE_VOL_TABLE + 2 * m.u8(A.SE_VOLUME));
  if (vol === 0) return;
  let prog = m.s32(SE_TABLE + 8 * id);
  if (m.s32(A.TWO_PLAYER) >= 1 && (m.u8(A.SETTING_4FC) & 1) === 0) {
    // Two players in stereo: each player's effects from their side (programs +5 left, +10 right).
    if (g.p === 0) prog += 5;
    else if (g.p === 1) prog += 10;
    else return;
  }
  const pitch = m.s32(SE_TABLE + 8 * id + 4);
  g.sound.push({ kind: 'key', prog: prog & 0xff, note: (pitch >> 8) & 0xff, vol: vol & 0xffff });
}

/** The CD track bgm_request picks for a request (CD audio track numbers 2-33). */
function trackFor(g: Game, id: number, player: number): number {
  const m = g.m;
  if (m.u8(A.SETTING_4FD) !== 0) return id;
  const zone = m.s32(ZONE + 4 * player);
  switch (id) {
    case 0x22: return 3;
    case 0x23: return m.u16(0x800dc880 + 2 * zone);
    case 0x24: return m.u16(0x800dc88a + 2 * zone);
    case 0x25: return 0x0e;
    case 0x26: return 0x0f;
    case 0x32: return m.s32(ZONE + 4 * g.p) === 4 ? 0x20 : 0x1e;
    case 0x33: return m.s32(ZONE + 4 * g.p) === 4 ? 0x21 : 0x1f;
    default:
      if (id >= 0x27 && id <= 0x2b) return id - 0x27 + 0x12;
      if (id >= 0x2c && id <= 0x31) return id - 0x2c + 0x18;
      return id;
  }
}

/** bgm_request(id) */
export function bgmRequest(g: Game, id: number): void {
  const m = g.m;
  g.bgm.push(id);
  if (m.s16(MUSIC_VOL_TABLE + 2 * m.u8(A.MUSIC_VOLUME)) === 0) return;
  if (g.p === 0) m.w32(BGM_WANT_P1, id);
  else m.w32(BGM_WANT_P2, id);
  let player = g.p;
  if (m.s32(A.TWO_PLAYER) !== 0) {
    let j1 = 0;
    let j2 = 0;
    if ((id - 0x23) >>> 0 < 2) {
      j1 = m.s32(BGM_JOIN_P1);
      j2 = m.s32(BGM_JOIN_P2);
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
  const track = trackFor(g, id, player);
  m.w32(BGM_CUR_PLAYER, player);
  m.w32(BGM_CUR_ID, id);
  let vol = 0;
  if (track !== BGM_STOP) {
    g.sound.push({ kind: 'play', track, mode: m.s32(TRACK_MODE + (track - 2) * 12) });
    vol = m.s16(MUSIC_VOL_TABLE + 2 * m.u8(A.MUSIC_VOLUME));
  }
  g.sound.push({ kind: 'cdvol', vol });
}
