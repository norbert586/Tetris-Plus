// What TIT_DEMO.EXE and TITLE.EXE share (docs/re/title.md): both are the same design as the
// other mode programs, recompiled at other addresses. Their main loop:
//
//   counter++; GsGetActiveBuff; GsClearOt; logic (phase dispatch); objects_draw; DrawSync;
//   VSync; ResetGraph(1); GsSwapDispBuff; GsSortClear(0, 0, 0); GsDrawOt; pad_read; CD poll;
//   rand()
//
// The tracer samples right after PadRead (re/lua/programs.lua `padread`), so one `step` runs
// the previous iteration's tail (pad_read, rand) and then this iteration's logic and drawing,
// as Puzzle Mode's Game.step does.
import * as A from '../../core/addr';
import type { Mem } from '../../core/mem';
import type { Rng } from '../../core/rng';
import type { SoundCall } from '../../core/sound';
import type { Program, ProgramName, Shared } from '../../flow/program';

export const S = A.S;

/** Address of sprite object n (1,050 of 0x7C bytes at state+0x5C). */
export const obj = (n: number): number => A.OBJECTS + n * A.OBJ_SIZE;

export type Field = [name: string, address: number, type: 's32' | 'u32' | 's16' | 'u16' | 'u8', count?: number, stride?: number];

const SIZE = { s32: 4, u32: 4, s16: 2, u16: 2, u8: 1 } as const;

/** The trace fields every program shares (re/lua/fields/common.lua). */
export const COMMON_FIELDS: Field[] = [
  ['ctr', S + 0x40, 'u32'],
  ['seed', 0x800083a4, 'u32'],
  ['next', S + 0x48, 'u32'],
  ['param', S + 0x4c, 'u32'],
  ['phase', S + 0x50, 'u32'],
  ['subphase', S + 0x54, 'u32'],
  ['exit', S + 0x1fcf4, 'u32'],
  ['scr', S + 0x4b508, 'u32', 2],
  ['step', S + 0x4b510, 'u32', 2],
];

/** The program's addresses that differ between TIT_DEMO and TITLE. */
export interface Layout {
  name: ProgramName;
  /** The program's data ranges (rom.ts), loaded as the boot program's loader does. */
  rom: { address: number; base64: string }[];
  /** BSS, cleared by `start`. */
  bss: [number, number];
  /** Pad 1 held (u16; pressed at +2, pad 2 held at +6, pressed at +8). */
  pad: number;
  /** GsGetActiveBuff's result, kept by the main loop (the ordering table in use). */
  activeBuff: number;
  /** Its trace fields after the common ones (re/lua/fields/<NAME>.lua). */
  fields: Field[];
  /** se_play's tables: volume by setting (s16[8]), then per effect { program, pitch }. */
  seVolume: number;
  seTable: number;
  /** bgm_request's tables and state (see bgmRequest). */
  bgm: {
    volume: number; // s16[8] by the music volume setting
    track: number; // per CD track from track 2, stride 12: { start offset, loop mode, priority }
    zoneTracks: number; // u16 by zone for request 0x23, then (+10) 0x24
    zone: number; // the program's zone per player (s32[2])
    player: number; // the current player (s32)
    state: number; // current player, current id, wanted by player 1, by player 2 (s32 each)
    join: number; // the two players' join bonus (s32[2]: player 2's, then player 1's)
  };
}

function decodeBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** The parts of a mode program's main loop TIT_DEMO and TITLE share. */
export abstract class ModeProgram implements Program {
  readonly m: Mem;
  readonly rng: Rng;
  tick = 0;
  uploads: number[] = [];
  sound: SoundCall[] = [];
  /** se_play / bgm_request arguments this tick (the trace's `se` and `bgm`). */
  se: number[] = [];
  bgm: number[] = [];
  /** The rand() colours objects_draw gave this tick's box-fill objects (r, g, b each). */
  boxColors: number[] = [];

  constructor(
    shared: Shared,
    readonly layout: Layout,
  ) {
    this.m = shared.m;
    this.rng = shared.rng;
    const m = this.m;
    m.loadImage(layout.rom.map((r) => ({ address: r.address, bytes: decodeBase64(r.base64) })));
    m.fill(layout.bss[0], layout.bss[1] - layout.bss[0]);
  }

  get name(): ProgramName {
    return this.layout.name;
  }

  get exited(): boolean {
    return this.m.s32(A.EXIT_FLAG) !== 0;
  }

  /** Pad 1 held / newly pressed. */
  held(): number {
    return this.m.u16(this.layout.pad);
  }
  pressed(): number {
    return this.m.u16(this.layout.pad + 2);
  }

  rand(): number {
    return this.rng.next();
  }

  step(pad: number): void {
    this.uploads = [];
    this.sound = [];
    this.se = [];
    this.bgm = [];
    this.boxColors = [];
    if (this.tick > 0) {
      this.rng.calls = 0;
      this.padRead(pad);
      // The CD poll (FUN_80094FBC / inlined in TITLE) only acts after a CD error.
      this.rand();
    } else {
      // The previous program's last iteration called rand() after the tracer's last sample of
      // it; the injected seed (the trace's mainseed) already includes that call.
      this.rng.calls = 1;
      this.startup();
    }
    this.tick++;
    this.m.add32(A.COUNTER, 1);
    // GsInitGraph starts at buffer 0; GsSwapDispBuff alternates it every iteration.
    this.m.w32(this.layout.activeBuff, (this.tick - 1) & 1);
    this.logic();
    this.drawState();
  }

  /** pad_read: held and newly pressed, pad 1 then pad 2. */
  private padRead(word: number): void {
    const m = this.m;
    for (let p = 0; p < 2; p++) {
      const now = (word >>> (16 * p)) & 0xffff;
      const a = this.layout.pad + 6 * p;
      m.w16(a + 2, (m.u16(a) ^ now) & now);
      m.w16(a, now);
    }
  }

  /** main before its loop (after the BSS is cleared). */
  protected abstract startup(): void;
  /** The logic of one iteration (the phase dispatch). */
  protected abstract logic(): void;
  /** objects_draw, for what it does to game state (rand() for box-fill objects). */
  protected drawState(): void {}

  /** Ends the program and names the next one for the boot loader. */
  exitTo(program: number, param: number, phase: number): void {
    const m = this.m;
    m.w32(A.EXIT_FLAG, 1);
    m.w32(S + 0x48, program);
    m.w32(S + 0x4c, param);
    m.w32(S + 0x50, phase);
    m.w32(S + 0x54, 0);
  }

  /** object_clear: zeroes all 31 words of object n. */
  objectClear(n: number): void {
    this.m.fill(obj(n), A.OBJ_SIZE);
  }

  // ---- sound (docs/re/audio.md §1; the same code as PAZLE.EXE's, at other addresses) ----

  /** se_play(id). The current player is always 0 here. */
  sePlay(id: number): void {
    const m = this.m;
    const L = this.layout;
    this.se.push(id);
    const vol = m.s16(L.seVolume + 2 * m.u8(A.SE_VOLUME));
    if (vol === 0) return;
    let prog = m.s32(L.seTable + 8 * id);
    if (m.s32(A.TWO_PLAYER) >= 1 && (m.u8(A.SETTING_4FC) & 1) === 0) {
      const p = m.s32(L.bgm.player);
      if (p === 0) prog += 5;
      else if (p === 1) prog += 10;
      else return;
    }
    const pitch = m.s32(L.seTable + 8 * id + 4);
    this.sound.push({ kind: 'key', prog: prog & 0xff, note: (pitch >> 8) & 0xff, vol: vol & 0xffff });
  }

  /** bgm_request(id). */
  bgmRequest(id: number): void {
    const m = this.m;
    const B = this.layout.bgm;
    this.bgm.push(id);
    if (m.s16(B.volume + 2 * m.u8(A.MUSIC_VOLUME)) === 0) return;
    const curPlayer = B.state;
    const curId = B.state + 4;
    const want1 = B.state + 8;
    const want2 = B.state + 12;
    const p = m.s32(B.player);
    if (p === 0) m.w32(want1, id);
    else m.w32(want2, id);
    let player = p;
    if (m.s32(A.TWO_PLAYER) !== 0) {
      let j1 = 0;
      let j2 = 0;
      if ((id - 0x23) >>> 0 < 2) {
        j1 = m.s32(B.join + 4);
        j2 = m.s32(B.join);
      }
      const w1 = m.s32(want1);
      const w2 = m.s32(want2);
      const pr1 = j2 + m.s32(B.track + 8 + (w1 - 2) * 12);
      const pr2 = j1 + m.s32(B.track + 8 + (w2 - 2) * 12);
      if (pr2 < pr1) {
        player = 0;
        id = w1;
      }
      if (pr1 < pr2) {
        player = 1;
        id = w2;
      }
    }
    if (player === m.s32(curPlayer) && m.s32(curId) === id) return;
    const track = this.trackFor(id, player);
    m.w32(curPlayer, player);
    m.w32(curId, id);
    let vol = 0;
    if (track !== 0x34) {
      // bgm_play_track: only a track the disc has (state+0x206E0) or 99.
      if (track === 99 || (track > 0 && track <= m.s32(S + 0x206e0))) {
        this.sound.push({ kind: 'play', track, mode: m.s32(B.track + 4 + (track - 2) * 12) });
      }
      vol = m.s16(B.volume + 2 * m.u8(A.MUSIC_VOLUME));
    }
    this.sound.push({ kind: 'cdvol', vol });
  }

  private trackFor(id: number, player: number): number {
    const m = this.m;
    const B = this.layout.bgm;
    if (m.u8(A.SETTING_4FD) !== 0) return id;
    switch (id) {
      case 0x22: return 3;
      case 0x23: return m.u16(B.zoneTracks + 2 * m.s32(B.zone + 4 * player));
      case 0x24: return m.u16(B.zoneTracks + 10 + 2 * m.s32(B.zone + 4 * player));
      case 0x25: return 0x0e;
      case 0x26: return 0x0f;
      case 0x32: return m.s32(B.zone + 4 * m.s32(B.player)) === 4 ? 0x20 : 0x1e;
      case 0x33: return m.s32(B.zone + 4 * m.s32(B.player)) === 4 ? 0x21 : 0x1f;
      default:
        if (id >= 0x27 && id <= 0x2b) return id - 0x27 + 0x12;
        if (id >= 0x2c && id <= 0x31) return id - 0x2c + 0x18;
        return id;
    }
  }

  /** The trace row (re/lua/fields/<NAME>.lua's fields, then rand and the sound calls). */
  traceRow(): Record<string, number | number[]> {
    const m = this.m;
    const row: Record<string, number | number[]> = {};
    for (const [name, address, type, count, stride] of [...COMMON_FIELDS, ...this.layout.fields]) {
      if (name === 'seed') {
        row.seed = this.rng.seed;
      } else if (count === undefined) {
        row[name] = m[type](address);
      } else {
        const v: number[] = [];
        for (let i = 0; i < count; i++) v.push(m[type](address + i * (stride ?? SIZE[type])));
        row[name] = v;
      }
    }
    row.rand = this.rng.calls;
    row.se = this.se.slice();
    row.bgm = this.bgm.slice();
    return row;
  }
}
