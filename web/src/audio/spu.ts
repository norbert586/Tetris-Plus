// The SPU's sound output (docs/re/audio.md §8): 24 ADPCM voices with gaussian interpolation,
// ADSR envelopes and fixed volumes, and the reverb unit, one 44.1 kHz sample at a time. A port of
// the oracle's mixer (PCSX-Redux src/spu: adpcm, interpolation, adsr, reverb), driven by the
// register writes the audio model makes (driver.ts); the CD's audio is mixed by the player.
import { Adsr, type AdsrConfig, decodeAdsr } from './envelope';
import { GAUSS } from './gauss';

const VOICES = 24;
const STOPPED = -1;
/** Samples the oracle holds a voice silent after key-on (as envelope.ts). */
const KEY_ON_DELAY = 6;
const FILTERS = [[0, 0], [60, 0], [115, -52], [98, -55], [122, -60]];
const SPUCNT_REVERB = 0x80;

const s16 = (v: number) => (v << 16) >> 16;
const sat16 = (v: number) => (v < -32768 ? -32768 : v > 32767 ? 32767 : v);
/** A fixed-mode volume register: bits 0-14, signed (-0x4000..0x3FFF; 0x4000 = unity). */
const fixedVolume = (raw: number) => {
  const v = raw & 0x7fff;
  return v & 0x4000 ? v - 0x8000 : v;
};

/**
 * Decodes the 16-byte ADPCM block at `at` into 28 samples, carrying the filter history in `h`.
 * Returns the block's flag byte (1 end, 2 repeat, 4 loop start). The hardware's arithmetic
 * (psx-spx: one rounded shift, clamped to 16 bits); the oracle shifts each term separately and
 * doesn't clamp, which drifts by a few LSBs and isn't what a console plays.
 */
export function decodeAdpcmBlock(ram: Uint8Array, at: number, out: Int32Array, h: { s1: number; s2: number }): number {
  const header = ram[at];
  const filter = FILTERS[Math.min(header >> 4, 4)];
  const shift = header & 0xf;
  let h1 = h.s1;
  let h2 = h.s2;
  for (let n = 0, b = at + 2; n < 28; b++) {
    const nibbles = ram[b];
    for (const nib of [s16((nibbles & 0x0f) << 12), s16((nibbles & 0xf0) << 8)]) {
      const sample = sat16((nib >> shift) + ((h1 * filter[0] + h2 * filter[1] + 32) >> 6));
      h2 = h1;
      h1 = sample;
      out[n++] = sample;
    }
  }
  h.s1 = h1;
  h.s2 = h2;
  return ram[at + 1];
}

class Voice {
  on = false;
  pending = false;
  stop = false;
  reverb = false;
  delay = 0;
  start = 0;
  cursor = 0;
  loop = STOPPED;
  s1 = 0;
  s2 = 0;
  readonly samples = new Int32Array(28);
  pos = 28;
  spos = 0;
  step = 0x10;
  readonly window = new Int16Array(4);
  gpos = 0;
  volL = 0;
  volR = 0;
  adsr = new Adsr();
  config: AdsrConfig = decodeAdsr(0, 0);
  adsrLo = 0;
  adsrHi = 0;
}

// The reverb's 39-tap half-band filter, 44.1 kHz <-> 22.05 kHz.
const FIR = [
  -0x0001, 0x0000, 0x0002, 0x0000, -0x000a, 0x0000, 0x0023, 0x0000, -0x0067, 0x0000, 0x010a, 0x0000, -0x0268,
  0x0000, 0x0534, 0x0000, -0x0b90, 0x0000, 0x2806, 0x4000, 0x2806, 0x0000, -0x0b90, 0x0000, 0x0534, 0x0000,
  -0x0268, 0x0000, 0x010a, 0x0000, -0x0067, 0x0000, 0x0023, 0x0000, -0x000a, 0x0000, 0x0002, 0x0000, -0x0001,
];

export class Spu {
  /** Sound RAM. */
  readonly ram = new Uint8Array(512 * 1024);
  private readonly ram16 = new Int16Array(this.ram.buffer);
  private readonly voices: Voice[] = [];
  private readonly regs = new Uint16Array(0x100);
  private control = 0;
  private eon = 0;
  private mainL = 0;
  private mainR = 0;
  // Reverb state (halfword addresses), its registers and its filters.
  private rvbStart = 0;
  private rvbCurr = 0;
  private readonly rv = new Int16Array(32);
  private rvbVolL = 0;
  private rvbVolR = 0;
  private readonly h44L = new Int32Array(39);
  private readonly h44R = new Int32Array(39);
  private readonly h22L = new Int32Array(20);
  private readonly h22R = new Int32Array(20);
  private calls = 0;
  private alt = false;

  constructor() {
    for (let v = 0; v < VOICES; v++) this.voices.push(new Voice());
  }

  write(offset: number, value: number): void {
    this.regs[offset >> 1] = value;
    if (offset < 0x180) {
      const voice = this.voices[offset >> 4];
      switch (offset & 0xf) {
        case 0: voice.volL = fixedVolume(value); break;
        case 2: voice.volR = fixedVolume(value); break;
        case 4: voice.step = Math.max(1, Math.min(value, 0x3fff) << 4); break;
        case 6: voice.start = value * 8; break;
        case 8: voice.adsrLo = value; voice.config = decodeAdsr(voice.adsrLo, voice.adsrHi); break;
        case 10: voice.adsrHi = value; voice.config = decodeAdsr(voice.adsrLo, voice.adsrHi); break;
        case 14: voice.loop = value * 8; break;
      }
      return;
    }
    if (offset >= 0x1c0) {
      this.rv[(offset - 0x1c0) >> 1] = s16(value);
      return;
    }
    switch (offset) {
      case 0x180: this.mainL = fixedVolume(value); break;
      case 0x182: this.mainR = fixedVolume(value); break;
      case 0x184: this.rvbVolL = s16(value); break;
      case 0x186: this.rvbVolR = s16(value); break;
      case 0x188: this.keyOn(0, value); break;
      case 0x18a: this.keyOn(16, value); break;
      case 0x18c: this.keyOff(0, value); break;
      case 0x18e: this.keyOff(16, value); break;
      case 0x198: this.eon = (this.eon & ~0xffff) | value; break;
      case 0x19a: this.eon = (this.eon & 0xffff) | ((value & 0xff) << 16); break;
      case 0x1a2:
        if (value === 0xffff || value <= 0x200) this.rvbStart = this.rvbCurr = 0;
        else if (this.rvbStart !== value << 2) this.rvbStart = this.rvbCurr = value << 2;
        break;
      case 0x1aa: this.control = value; break;
    }
  }

  private keyOn(first: number, mask: number): void {
    for (let v = first; v < first + 16 && v < VOICES; v++, mask >>= 1) if (mask & 1) this.voices[v].pending = true;
  }

  private keyOff(first: number, mask: number): void {
    for (let v = first; v < first + 16 && v < VOICES; v++, mask >>= 1) if (mask & 1) this.voices[v].stop = true;
  }

  /** Whether voice v is sounding (keyed on and not yet past its end or release). */
  sounding(v: number): boolean {
    return this.voices[v].on || this.voices[v].pending;
  }

  /** Mixes `n` samples into `left`/`right` (-1..1) from `at`. */
  render(left: Float32Array, right: Float32Array, at: number, n: number): void {
    const send = [0, 0];
    for (let i = at; i < at + n; i++) {
      let sumL = 0;
      let sumR = 0;
      send[0] = 0;
      send[1] = 0;
      for (let v = 0; v < VOICES; v++) {
        const voice = this.voices[v];
        if (voice.pending) this.startVoice(voice, v);
        if (!voice.on) continue;
        const s = this.voiceSample(voice);
        const l = Math.trunc((s * voice.volL) / 0x4000);
        const r = Math.trunc((s * voice.volR) / 0x4000);
        sumL += l;
        sumR += r;
        if (voice.reverb) {
          send[0] += l;
          send[1] += r;
        }
      }
      sumL += this.reverbLeft(send[0], send[1]);
      sumR += this.reverbRight();
      left[i] = (sat16(sumL) * this.mainL) / 0x4000 / 32768;
      right[i] = (sat16(sumR) * this.mainR) / 0x4000 / 32768;
    }
  }

  private startVoice(voice: Voice, v: number): void {
    voice.pending = false;
    voice.adsr.keyOn();
    voice.reverb = (this.eon & (1 << v)) !== 0 && (this.control & SPUCNT_REVERB) !== 0;
    voice.cursor = voice.start;
    voice.s1 = 0;
    voice.s2 = 0;
    voice.delay = KEY_ON_DELAY;
    voice.pos = 28;
    voice.stop = false;
    voice.on = true;
    voice.window.fill(0);
    voice.gpos = 0;
    voice.spos = 0x30000;
  }

  /** One sample of a playing voice, after its envelope (Redux synthesizeVoice). */
  private voiceSample(voice: Voice): number {
    if (voice.delay > 0) {
      voice.delay--;
      return 0;
    }
    while (voice.spos >= 0x10000) {
      if (voice.pos >= 28 && !this.decodeBlock(voice)) {
        voice.on = false;
        voice.adsr.level = 0;
        return 0;
      }
      voice.window[voice.gpos] = sat16(voice.samples[voice.pos++]);
      voice.gpos = (voice.gpos + 1) & 3;
      voice.spos -= 0x10000;
    }
    const w = voice.window;
    const g = voice.gpos;
    const i = (voice.spos >> 8) & 0xff;
    let out = (GAUSS[0x0ff - i] * w[g]) >> 14;
    out += (GAUSS[0x1ff - i] * w[(g + 1) & 3]) >> 14;
    out += (GAUSS[0x100 + i] * w[(g + 2) & 3]) >> 14;
    out += (GAUSS[i] * w[(g + 3) & 3]) >> 14;
    const raw = out >> 1;
    const on = voice.adsr.step(voice.config, voice.stop);
    const env = voice.adsr.level;
    if (!on) voice.on = false;
    voice.spos += voice.step;
    return (env * raw) >> 15;
  }

  /** Decodes the next 16-byte ADPCM block; false once the voice has passed its end block. */
  private decodeBlock(voice: Voice): boolean {
    let cursor = voice.cursor;
    if (cursor === STOPPED) return false;
    const flags = decodeAdpcmBlock(this.ram, cursor, voice.samples, voice);
    voice.pos = 0;
    if (flags & 4) voice.loop = cursor;
    cursor += 16;
    if (flags & 1) cursor = flags !== 3 || voice.loop === STOPPED ? STOPPED : voice.loop;
    if (cursor !== STOPPED && cursor >= this.ram.length) cursor -= this.ram.length;
    voice.cursor = cursor;
    return true;
  }

  // The reverb unit (psx-spx's formula, as Redux implements it): one channel per 44.1 kHz
  // sample, alternating, on a 22.05 kHz work area in sound RAM.
  private wrap(offset: number, extra = 0): number {
    let o = offset * 4 + this.rvbCurr + extra;
    while (o > 0x3ffff) o = this.rvbStart + (o - 0x40000);
    while (o < this.rvbStart) o = 0x3ffff - (this.rvbStart - o);
    return o;
  }

  private buf(offset: number, extra = 0): number {
    return this.ram16[this.wrap(offset, extra)];
  }

  private setBuf(offset: number, value: number): void {
    this.ram16[this.wrap(offset)] = sat16(value);
  }

  private reverbLeft(inL: number, inR: number): number {
    if (!this.rvbStart) return 0;
    this.calls++;
    const write = (this.control & SPUCNT_REVERB) !== 0;
    for (let i = 38; i > 0; i--) {
      this.h44L[i] = this.h44L[i - 1];
      this.h44R[i] = this.h44R[i - 1];
    }
    this.h44L[0] = inL;
    this.h44R[0] = inR;
    const left = (this.alt = (this.calls & 1) !== 0);
    const h = left ? this.h44L : this.h44R;
    let acc = 0;
    for (let i = 0; i < 39; i++) acc += FIR[i] * h[i];
    const input = sat16(Math.floor(acc / 32768));
    const r = this.rv;
    const d15 = (v: number) => Math.floor(v / 32768);
    // Registers 0x1DC0 + 2k: FB_SRC_A, FB_SRC_B, IIR_ALPHA, ACC_COEF_A-D, IIR_COEF, FB_ALPHA, FB_X,
    // IIR_DEST_A0/1, ACC_SRC_A0/1, ACC_SRC_B0/1, IIR_SRC_A0/1, IIR_DEST_B0/1, ACC_SRC_C0/1,
    // ACC_SRC_D0/1, IIR_SRC_B1/B0 (swapped), MIX_DEST_A0/1, MIX_DEST_B0/1, IN_COEF_L/R.
    const c = left ? 0 : 1;
    const sSame = r[16 + c];
    const dSame = r[10 + c];
    const sDiff = r[24 + (1 - c)];
    const dDiff = r[18 + c];
    const inCoef = r[30 + c];
    const mA = r[26 + c];
    const mB = r[28 + c];
    const iirSame = sat16(d15(this.buf(sSame) * r[7]) + d15(input * inCoef));
    const iirDiff = sat16(d15(this.buf(sDiff) * r[7]) + d15(input * inCoef));
    if (write) {
      this.setBuf(dSame, d15(iirSame * r[2]) + d15(this.buf(dSame, -1) * (32768 - r[2])));
      this.setBuf(dDiff, d15(iirDiff * r[2]) + d15(this.buf(dDiff, -1) * (32768 - r[2])));
    }
    let out = sat16(d15(this.buf(r[12 + c]) * r[3]) + d15(this.buf(r[14 + c]) * r[4])
      + d15(this.buf(r[20 + c]) * r[5]) + d15(this.buf(r[22 + c]) * r[6]));
    const tapA = this.buf(mA - r[0]);
    out = sat16(out - d15(tapA * r[8]));
    if (write) this.setBuf(mA, out);
    out = sat16(d15(out * r[8]) + tapA);
    const tapB = this.buf(mB - r[1]);
    out = sat16(out - d15(tapB * r[9]));
    if (write) this.setBuf(mB, out);
    out = sat16(d15(out * r[9]) + tapB);
    const wet = d15(out * (left ? this.rvbVolL : this.rvbVolR));
    if (left) {
      this.h22L.copyWithin(1, 0, 19);
      this.h22L[0] = wet;
    } else {
      this.h22R.copyWithin(1, 0, 19);
      this.h22R[0] = wet;
      this.rvbCurr++;
      if (this.rvbCurr > 0x3ffff) this.rvbCurr = this.rvbStart;
    }
    return left ? this.interp(this.h22L) : this.h22L[9];
  }

  private reverbRight(): number {
    if (!this.rvbStart) return 0;
    return !this.alt ? this.interp(this.h22R) : this.h22R[9];
  }

  private interp(h: Int32Array): number {
    let acc = 0;
    for (let i = 0; i < 39; i += 2) acc += FIR[i] * h[i / 2];
    return Math.floor(acc / 16384);
  }
}
