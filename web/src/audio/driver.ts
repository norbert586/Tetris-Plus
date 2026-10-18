// The sound side of a tick (docs/re/audio.md §5): runs libsnd's per-vblank flush and the
// program's sound calls against a model of the SPU's registers, and reports the register writes
// the original makes, in the trace's terms (kon, koff, spu). The browser player feeds the same
// writes to its SPU; the tests compare them with the original's traces.
import type { Mem } from '../core/mem';
import { CYCLES_PER_SAMPLE, Envelopes } from './envelope';
import { Libsnd, type RegWrite } from './libsnd';
import { VAB_SPU_BASE, type Vab } from './vab';

/** CPU cycles per vblank on the oracle (NTSC: 33.8688 MHz / ~60.01 Hz). */
export const CYCLES_PER_VBLANK = 564_400;
/** When in a vblank libsnd's flush reads ENVX, and when it writes KON (measured: ~18,000-18,230). */
const FLUSH_READ = 16_000;
const FLUSH_WRITE = 18_100;
/** The flush's history index when tick 1 starts (measured: 14 at tick 2's sample, after 332 flushes). */
const BOOT_HISTORY_INDEX = 2;

/** The SPU state right after Puzzle Mode's sound setup (trace tick 1): `spu` and `rev` fields. */
const BOOT_KOFF = [0xffff, 0xffff * 65536, 0xff * 65536];
const BOOT_GLOBALS: [number, number][] = [
  [0x180, 16383], [0x182, 16383], [0x184, 8256], [0x186, 8256], [0x1aa, 49281], [0x1a2, 64296],
];
const BOOT_REVERB = [125, 91, 28032, 21688, 48848, 0, 0, 47744, 22528, 21248, 1238, 819, 1008, 551, 884, 495, 820,
  437, 0, 0, 0, 0, 0, 0, 0, 0, 436, 310, 184, 92, 32768, 32768];

/** What one tick did to the SPU, as the trace records it. */
export interface TickAudio {
  /** Key-ons: voice, volume L, R, pitch, start address, ADSR1, ADSR2, repeat address. */
  kon: number[][];
  /** Non-zero KOFF writes: voices 0-15 as is, 16-23 times 65536. */
  koff: number[];
  /** Every register write in order, with its cycle, for the player. */
  writes: { cycle: number; offset: number; value: number }[];
}

export class SoundDriver {
  readonly libsnd: Libsnd;
  readonly envelopes: Envelopes;
  /** The register file as the program has written it (0x1F801C00-0x1F801DFF, by halfword). */
  readonly regs = new Uint16Array(0x100);
  /** SPU RAM with the sound bank in it. */
  readonly ram = new Uint8Array(512 * 1024);
  private vblank = 0;

  constructor(
    vab: Vab,
    rom: Mem,
    mono = false,
  ) {
    this.ram.set(vab.body, VAB_SPU_BASE);
    this.libsnd = new Libsnd(vab, rom, mono);
    this.envelopes = new Envelopes(this.ram);
  }

  /** The writes Puzzle Mode's sound setup leaves behind, reported on its first tick. */
  boot(cdVolume: number): TickAudio {
    const out: TickAudio = { kon: [], koff: [...BOOT_KOFF], writes: [] };
    this.libsnd.historyIndex = BOOT_HISTORY_INDEX;
    for (const [o, v] of BOOT_GLOBALS) this.write(out, o, v, 0);
    this.setCdVolume(out, cdVolume, 0);
    BOOT_REVERB.forEach((v, i) => this.write(out, 0x1c0 + 2 * i, v, 0));
    return out;
  }

  /** SsVoKeyOn: takes effect at the next flush. */
  keyOn(prog: number, note: number, vol: number): void {
    this.libsnd.keyOn(prog, note, vol);
  }

  /** libsnd's flush in the next vblank's interrupt. */
  vblankFlush(out: TickAudio): void {
    this.vblank++;
    const base = this.vblank * CYCLES_PER_VBLANK;
    const read = base + FLUSH_READ;
    const writes = this.libsnd.flush({ envx: (v) => this.envelopes.envx(v, read) });
    for (const [o, v] of writes) this.write(out, o, v, base + FLUSH_WRITE);
  }

  /** SsSetSerialVol(SS_SERIAL_A, v, v). */
  setCdVolume(out: TickAudio, vol: number, cycle: number): void {
    const v = Math.min(vol, 127) * 0x102;
    this.write(out, 0x1b0, v, cycle);
    this.write(out, 0x1b2, v, cycle);
  }

  /** The trace's `spu` field: the mix registers. */
  globals(): number[] {
    const r = (o: number) => this.regs[o >> 1];
    return [r(0x180), r(0x182), r(0x184), r(0x186), r(0x1b0), r(0x1b2), r(0x1b4), r(0x1b6), r(0x1aa),
      r(0x198) + r(0x19a) * 65536, r(0x190) + r(0x192) * 65536, r(0x194) + r(0x196) * 65536, r(0x1a2)];
  }

  /** The trace's `rev` field: the reverb registers. */
  reverb(): number[] {
    return Array.from(this.regs.subarray(0x1c0 >> 1, 0x200 >> 1));
  }

  private write(out: TickAudio, offset: number, value: number, cycle: number): void {
    this.regs[offset >> 1] = value;
    out.writes.push({ cycle, offset, value });
    this.envelopes.write(offset, value, cycle);
    if ((offset === 0x188 || offset === 0x18a) && value) {
      const first = offset === 0x188 ? 0 : 16;
      for (let b = 0; b < 16; b++) {
        if (!(value & (1 << b))) continue;
        const o = (first + b) * 8;
        out.kon.push([first + b, ...Array.from(this.regs.subarray(o, o + 6)), this.regs[o + 7]]);
      }
    } else if ((offset === 0x18c || offset === 0x18e) && value) {
      out.koff.push(offset === 0x18c ? value : value * 65536);
    }
  }
}

export { CYCLES_PER_SAMPLE };
export type { RegWrite };
