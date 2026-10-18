// libsnd's voice manager as every program links it (docs/re/audio.md §3; PAZLE.EXE's addresses): SsVoKeyOn, the voice
// allocator and the per-vblank flush that writes the SPU's voice registers. Sound effects are
// the only libsnd users in Puzzle Mode (no sequences), so only the sound-effect path is ported.
//
// The flush (SpuVmFlush) runs in the VSync interrupt (SsSetTickMode(1)), at the end of every
// tick: it reads each voice's envelope level (ENVX), frees voices whose level has been 0 long
// enough, then writes the registers changed since the last flush and the KOFF, KON and EON
// masks. Its reads of ENVX are what makes voice allocation depend on time, so the manager asks
// an `EnvelopeClock` (spu.ts) for them.
import type { Mem } from '../core/mem';
import type { Vab } from './vab';

/** Voices libsnd manages (SsUtSetVVol's _svm_vcf range; 0x800EEACC). */
export const VOICES = 24;
/** libsnd's note-to-pitch table in PAZLE.EXE: 12 semitones x 16 fine steps (programs.ts has each program's). */
const PITCH_TABLE = 0x800ec94c;

/** One SPU register write: offset from 0x1F801C00, 16-bit value. */
export type RegWrite = [number, number];

/** What the flush asks of the SPU: the voice's envelope level now (ENVX). */
export interface EnvelopeClock {
  envx(voice: number): number;
}

interface VoiceState {
  /** _svm_voice[v]: +0x02 age, +0x06 last ENVX, +0x18 priority, +0x1B key status. */
  age: number;
  env: number;
  prior: number;
  status: number;
}

const sdiv = (a: number, b: number) => Math.trunc(a / b);

export class Libsnd {
  readonly voices: VoiceState[] = [];
  /** Register shadow (0x800ED530 + 16 v): volume L, R, pitch, start address, ADSR1, ADSR2. */
  private readonly shadow: Uint16Array = new Uint16Array(VOICES * 8);
  /** Which shadow registers changed (0x800ED6B0): 1 volume, 4 pitch, 8 address, 0x10 ADSR. */
  private readonly dirty: Uint8Array = new Uint8Array(VOICES);
  /** Masks the flush writes (voices 0-23): key on, key off, reverb on. */
  private kon = 0;
  private koff = 0;
  private eon = 0;
  /** Which voices read ENVX = 0, for the last 16 flushes (0x800EDBAC), and the ring index
   * (0x800EDBA8). Only entries 0-14 decide whether a voice is free, so the index's phase matters. */
  private readonly zeroHistory = new Uint32Array(16);
  historyIndex = 0;

  constructor(
    private readonly vab: Vab,
    private readonly rom: Mem,
    /** SsSetMono (0x800EE714): set at start-up from the sound setting; both sides get the louder. */
    private readonly mono = false,
    /** Where the running program keeps the note-to-pitch table. */
    private readonly pitchTable = PITCH_TABLE,
  ) {
    for (let v = 0; v < VOICES; v++) this.voices.push({ age: 0, env: 0, prior: 0, status: 0 });
  }

  /** note2pitch2: the pitch register for a note on a tone (fine = 0, as SsVoKeyOn passes). */
  noteToPitch(tone: { center: number; shift: number }, note: number): number {
    const fine = tone.shift; // (fine + shift) with fine 0
    let f = fine >= 0 ? fine : fine + 7;
    f >>= 3;
    let step = f;
    let carry = 0;
    if (f >= 16) {
      carry = 1;
      step = f - 16;
    }
    const x = (((note + 60 - tone.center + carry) << 16) >> 16);
    const octave = sdiv(x, 12);
    const semitone = ((x - octave * 12) << 16) >> 16;
    let pitch = this.rom.u16(this.pitchTable + 2 * (semitone * 16 + step));
    const shift = octave - 5;
    if (shift > 0) pitch <<= shift;
    else if (shift < 0) pitch = (pitch & 0xffff) >> -shift;
    return pitch & 0xffff;
  }

  /**
   * SsVoKeyOn(vab_pro, pitch, voll, volr) with voll = volr, as se_play calls it: SpuVmSeKeyOn
   * passes pan 64 and drops the fine pitch; SpuVmKeyOn plays every tone of the program whose
   * key range holds the note. Returns the voices used.
   */
  keyOn(prog: number, note: number, vol: number): number[] {
    const program = this.vab.programs[prog];
    const used: number[] = [];
    if (!program) return used;
    const tones = program.tones.filter((t) => t.min <= note && note <= t.max);
    for (const tone of tones) {
      const v = this.alloc(tone.prior);
      if (v >= VOICES) continue;
      const vs = this.voices[v];
      vs.status = 1;
      vs.age = 0;
      this.doAllocate(v, tone);
      const pitch = this.noteToPitch(tone, note);
      this.keyOnNow(v, tone, program, vol, pitch);
      used.push(v);
    }
    return used;
  }

  /** SpuVmAlloc: a free voice, else the lowest-priority, quietest, oldest one. */
  private alloc(prior: number): number {
    let selected = 99;
    let lowest = prior;
    let minEnv = 0xffff;
    let maxAge = 0;
    let candidate = 99;
    let count = 0;
    for (let v = 0; v < VOICES; v++) {
      const vs = this.voices[v];
      if (vs.status === 0 && vs.env === 0) {
        selected = v;
        break;
      }
      if (vs.prior < lowest) {
        lowest = vs.prior;
        candidate = v;
        minEnv = vs.env;
        maxAge = vs.age;
        count = 1;
      } else if (vs.prior === lowest) {
        count++;
        if (vs.env < minEnv) {
          maxAge = vs.age;
          minEnv = vs.env;
          candidate = v;
        } else if (vs.env === minEnv && maxAge < vs.age) {
          maxAge = vs.age;
          candidate = v;
        }
      }
    }
    if (selected === 99) selected = count !== 0 ? candidate : VOICES;
    if (selected < VOICES) {
      for (const vs of this.voices) vs.age = (vs.age + 1) & 0xffff;
      this.voices[selected].age = 0;
      this.voices[selected].prior = prior;
    }
    return selected;
  }

  /** SpuVmDoAllocate: start address and ADSR into the shadow; the voice counts as sounding. */
  private doAllocate(v: number, tone: { vag: number; adsr1: number; adsr2: number }): void {
    this.voices[v].env = 0x7fff;
    for (let i = 0; i < 16; i++) this.zeroHistory[i] &= ~(1 << v);
    this.shadow[v * 8 + 3] = this.vab.vagAddr[tone.vag] >> 3;
    this.shadow[v * 8 + 4] = tone.adsr1;
    this.shadow[v * 8 + 5] = tone.adsr2; // + 0x800EE65C, which stays 0
    this.dirty[v] |= 0x8 | 0x30;
  }

  /** SpuVmKeyOnNow for a sound effect: volume, pan, pitch and the key-on bit. */
  private keyOnNow(v: number, tone: { vol: number; pan: number; mode: number }, program: { vol: number; pan: number },
    vol: number, pitch: number): void {
    const base = sdiv(vol * (this.vab.mvol * 0x3fff), 0x3f01);
    let right = Math.floor((base * program.vol * tone.vol) / 0x3f01);
    let left = right;
    for (const pan of [tone.pan, program.pan, 64]) {
      if (pan < 0x40) right = Math.floor((right * pan) / 0x3f);
      else left = Math.floor((left * (0x7f - pan)) / 0x3f);
    }
    if (this.mono) left = right = Math.max(left, right);
    this.shadow[v * 8 + 0] = Math.floor((left * left) / 0x3fff);
    this.shadow[v * 8 + 1] = Math.floor((right * right) / 0x3fff);
    this.shadow[v * 8 + 2] = pitch;
    this.dirty[v] |= 7;
    const bit = 1 << v;
    if (tone.mode & 4) this.eon |= bit;
    else this.eon &= ~bit;
    this.kon |= bit;
    this.koff &= ~bit;
  }

  /** SpuVmFlush. Returns the register writes in the order it makes them. */
  flush(clock: EnvelopeClock): RegWrite[] {
    this.historyIndex = (this.historyIndex + 1) & 15;
    let zero = 0;
    for (let v = 0; v < VOICES; v++) {
      const env = clock.envx(v);
      this.voices[v].env = env;
      if (env === 0) zero |= 1 << v;
    }
    this.zeroHistory[this.historyIndex] = zero;
    let free = 0xffffffff;
    for (let i = 0; i < 15; i++) free &= this.zeroHistory[i];
    for (let v = 0; v < VOICES; v++) if (free & (1 << v)) this.voices[v].status = 0;
    this.kon &= ~this.koff;
    const out: RegWrite[] = [];
    for (let v = 0; v < VOICES; v++) {
      const d = this.dirty[v];
      const o = v * 16;
      const s = v * 8;
      if (d & 1) out.push([o, this.shadow[s]], [o + 2, this.shadow[s + 1]]);
      if (d & 4) out.push([o + 4, this.shadow[s + 2]]);
      if (d & 8) out.push([o + 6, this.shadow[s + 3]]);
      if (d & 0x10) out.push([o + 8, this.shadow[s + 4]], [o + 10, this.shadow[s + 5]]);
      this.dirty[v] = 0;
    }
    out.push([0x18c, this.koff & 0xffff], [0x18e, this.koff >>> 16], [0x188, this.kon & 0xffff],
      [0x18a, this.kon >>> 16], [0x198, this.eon & 0xffff], [0x19a, this.eon >>> 16]);
    this.kon = 0;
    this.koff = 0;
    return out;
  }
}
