// The BIOS rand() (A0:2Fh) every part of the game shares (docs/spec/frame.md §4). Nothing
// seeds it; the seed is the number of calls since power-on, so traces inject it.
export class Rng {
  /** u32 seed, as OpenBIOS keeps it at 0x800083A4. */
  seed: number;
  /** Calls since the counter was last cleared (the trace's `rand` field). */
  calls = 0;

  constructor(seed = 0) {
    this.seed = seed >>> 0;
  }

  next(): number {
    this.seed = (Math.imul(this.seed, 1103515245) + 12345) >>> 0;
    this.calls++;
    return (this.seed >>> 16) & 0x7fff;
  }
}
