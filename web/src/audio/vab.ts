// The sound bank: a PsyQ VAB (EF.VH header + EF.VB body), as libsnd lays it out in SPU RAM
// (docs/re/audio.md §2). Puzzle Mode's only bank holds 15 programs of single-key tones.

/** A tone (VagAtr): one sample over a key range, with its envelope and mix settings. */
export interface Tone {
  prior: number;
  mode: number;
  vol: number;
  pan: number;
  center: number;
  shift: number;
  min: number;
  max: number;
  adsr1: number;
  adsr2: number;
  vag: number;
}

/** A program (ProgAtr): its tones, in header order. */
export interface Program {
  vol: number;
  prior: number;
  mode: number;
  pan: number;
  tones: Tone[];
}

/** Where libsnd's SsVabTransBody puts the first sample: SpuMalloc's first block. */
export const VAB_SPU_BASE = 0x1010;

export class Vab {
  readonly mvol: number;
  readonly pan: number;
  /** By program number (0-127); programs with no tones are absent. */
  readonly programs: (Program | undefined)[] = [];
  /** Sample sizes in bytes, by VAG number (1-based; entry 0 unused). */
  readonly vagSize: number[] = [];
  /** Sample addresses in SPU RAM, in bytes, by VAG number. */
  readonly vagAddr: number[] = [];
  /** The body (all samples, back to back), as uploaded to SPU RAM at VAB_SPU_BASE. */
  readonly body: Uint8Array;

  constructor(vh: Uint8Array, vb: Uint8Array) {
    const v = new DataView(vh.buffer, vh.byteOffset, vh.byteLength);
    if (v.getUint32(0, true) !== 0x56414270) throw new Error('not a VAB header (pBAV)');
    const ps = v.getUint16(0x12, true);
    const vs = v.getUint16(0x16, true);
    this.mvol = vh[0x18];
    this.pan = vh[0x19];
    const tonesAt = 32 + 128 * 16;
    let used = 0;
    for (let p = 0; p < 128; p++) {
      const o = 32 + p * 16;
      const count = vh[o];
      if (count === 0) continue;
      const tones: Tone[] = [];
      for (let t = 0; t < count; t++) {
        const a = tonesAt + (used * 16 + t) * 32;
        tones.push({
          prior: vh[a], mode: vh[a + 1], vol: vh[a + 2], pan: vh[a + 3], center: vh[a + 4],
          shift: vh[a + 5], min: vh[a + 6], max: vh[a + 7],
          adsr1: v.getUint16(a + 16, true), adsr2: v.getUint16(a + 18, true), vag: v.getInt16(a + 22, true),
        });
      }
      this.programs[p] = { vol: vh[o + 1], prior: vh[o + 2], mode: vh[o + 3], pan: vh[o + 4], tones };
      used++;
    }
    if (used !== ps) throw new Error(`VAB: ${used} programs found, header says ${ps}`);
    const sizesAt = tonesAt + ps * 16 * 32;
    let addr = VAB_SPU_BASE;
    this.vagSize[0] = 0;
    this.vagAddr[0] = 0;
    for (let i = 1; i <= vs; i++) {
      const size = v.getUint16(sizesAt + 2 * i, true) * 8;
      this.vagSize[i] = size;
      this.vagAddr[i] = addr;
      addr += size;
    }
    if (addr - VAB_SPU_BASE !== vb.length) throw new Error('VAB: sample sizes do not add up to the body');
    this.body = vb;
  }

  /** The bytes of sample n. */
  sample(n: number): Uint8Array {
    const start = this.vagAddr[n] - VAB_SPU_BASE;
    return this.body.subarray(start, start + this.vagSize[n]);
  }
}
