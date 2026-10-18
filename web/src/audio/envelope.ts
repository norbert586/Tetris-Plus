// The SPU's voice envelopes as the CPU sees them through ENVX (docs/re/audio.md §4). libsnd's
// flush reads ENVX each vblank to learn which voices have gone quiet, so voice allocation, and
// with it every later key-on, depends on these levels. The model is the oracle's (PCSX-Redux's
// read-time reconstruction): the level at a cycle is found by stepping the ADSR envelope from the
// key-on, one step per sample, and the voice ends when its sample's ADPCM stream passes an end
// block without repeat.

/** The SPU's sample clock: 33.8688 MHz / 44100 Hz. */
export const CYCLES_PER_SAMPLE = 768;
/** Samples the oracle holds a voice silent after key-on (Redux's KeyOnDelay setting). */
const KEY_ON_DELAY = 6;
/** Where the pitch counter starts at key-on with gaussian interpolation (Interpolator::keyOn). */
const PITCH_START = 0x30000;

const ATTACK = 0;
const DECAY = 1;
const SUSTAIN = 2;
const RELEASE = 3;
const STOPPED = 4;

// The rate tables: a phase counts samples up to denominator[rate], then steps the level.
const denominator = (rate: number) => (rate < 48 ? 1 : 1 << (Math.min(rate >> 2, 26) - 11));
const increase = (rate: number) => (rate < 48 ? (7 - (rate & 3)) << (11 - (rate >> 2)) : 7 - (rate & 3));
const decrease = (rate: number) => (rate < 48 ? (-8 + (rate & 3)) << (11 - (rate >> 2)) : -8 + (rate & 3));

/** The ADSR settings of the two ADSR registers. */
export interface AdsrConfig {
  attackExp: boolean;
  attackRate: number;
  decayRate: number;
  sustainLevel: number;
  sustainExp: boolean;
  sustainIncrease: boolean;
  sustainRate: number;
  releaseExp: boolean;
  releaseRate: number;
}

export function decodeAdsr(lo: number, hi: number): AdsrConfig {
  return {
    attackExp: (lo & 0x8000) !== 0,
    attackRate: (lo & 0x7f00) >> 8,
    decayRate: (lo & 0xf0) >> 4,
    sustainLevel: lo & 0xf,
    sustainExp: (hi & 0x8000) !== 0,
    sustainIncrease: (hi & 0x4000) === 0,
    sustainRate: (hi & 0x1fc0) >> 6,
    releaseExp: (hi & 0x20) !== 0,
    releaseRate: hi & 0x1f,
  };
}

/** One voice's envelope: state, 15-bit level and the step counter within the current rate. */
export class Adsr {
  state = ATTACK;
  level = 0;
  fraction = 0;

  keyOn(): void {
    this.state = ATTACK;
    this.level = 0;
    this.fraction = 0;
  }

  /** One sample. Returns false once the release has run the level down to 0. */
  step(c: AdsrConfig, release: boolean): boolean {
    if (release) this.state = RELEASE;
    let level = this.level;
    switch (this.state) {
      case ATTACK: {
        if (c.attackRate === 0x7f) return true;
        const rate = c.attackExp && level >= 0x6000 ? Math.min(c.attackRate + 8, 127) : c.attackRate;
        if (++this.fraction >= denominator(rate)) {
          this.fraction = 0;
          level += increase(rate);
        }
        if (level >= 0x7fff) {
          level = 0x7fff;
          this.state = DECAY;
        }
        break;
      }
      case DECAY: {
        const rate = c.decayRate * 4;
        if (++this.fraction >= denominator(rate)) {
          this.fraction = 0;
          level += (decrease(rate) * level) >> 15;
        }
        level = Math.max(level, 0);
        if (((level >> 11) & 0xf) <= c.sustainLevel) this.state = SUSTAIN;
        break;
      }
      case SUSTAIN: {
        let rate = c.sustainRate;
        if (rate === 0x7f) return true;
        if (c.sustainIncrease) {
          if (c.sustainExp && level >= 0x6000) rate = Math.min(rate + 8, 127);
          if (++this.fraction >= denominator(rate)) {
            this.fraction = 0;
            level += increase(rate);
          }
          level = Math.min(level, 0x7fff);
        } else {
          if (++this.fraction >= denominator(rate)) {
            this.fraction = 0;
            level += c.sustainExp ? (decrease(rate) * level) >> 15 : decrease(rate);
          }
          level = Math.max(level, 0);
        }
        break;
      }
      case RELEASE: {
        if (c.releaseRate === 0x1f) return true;
        const rate = c.releaseRate * 4;
        if (++this.fraction >= denominator(rate)) {
          this.fraction = 0;
          level += c.releaseExp ? (decrease(rate) * level) >> 15 : decrease(rate);
        }
        if (level < 0) {
          this.state = STOPPED;
          this.level = 0;
          return false;
        }
        break;
      }
      default:
        return true;
    }
    this.level = level;
    return true;
  }
}

const NO_LOOP = -1;
const ENDED = -2;

/** A voice as the ENVX reconstruction follows it, from its last key-on. */
class VoiceWalk {
  keyedOn = false;
  keyOnCycle = 0;
  keyOffCycle = 0;
  /** Samples stepped so far (after the key-on delay), and whether the voice has ended. */
  steps = 0;
  ended = false;
  readonly adsr = new Adsr();
  /** The ADPCM cursor: current block (byte address), loop block, samples left in it, pitch counter. */
  block = 0;
  loop = NO_LOOP;
  left = 0;
  pos = PITCH_START;
  pitchStep = 0x10;
}

/**
 * The SPU's voices as far as ENVX goes. Register writes and reads carry the CPU cycle they
 * happen at; only differences between cycles matter.
 */
export class Envelopes {
  private readonly walks: VoiceWalk[] = [];
  private readonly config: AdsrConfig[] = [];
  private readonly adsrRegs = new Uint16Array(48);
  private readonly pitch = new Uint16Array(24);
  private readonly start = new Uint32Array(24);

  /** `ram` is SPU RAM (512 KB): only the ADPCM flag bytes are read. */
  constructor(private readonly ram: Uint8Array) {
    for (let v = 0; v < 24; v++) {
      this.walks.push(new VoiceWalk());
      this.config.push(decodeAdsr(0, 0));
    }
  }

  /** A write to a voice register (offset 0-0x17F from 0x1F801C00) or a key-on/off mask. */
  write(offset: number, value: number, cycle: number): void {
    if (offset < 0x180) {
      const v = offset >> 4;
      switch (offset & 0xf) {
        case 4: {
          if (this.walks[v].keyedOn) this.envx(v, cycle);
          const p = Math.min(value, 0x3fff);
          this.pitch[v] = p;
          this.walks[v].pitchStep = Math.max(1, p << 4);
          break;
        }
        case 6:
          this.start[v] = value * 8;
          break;
        case 8:
        case 10:
          this.adsrRegs[v * 2 + ((offset & 0xf) - 8) / 2] = value;
          this.config[v] = decodeAdsr(this.adsrRegs[v * 2], this.adsrRegs[v * 2 + 1]);
          break;
      }
      return;
    }
    if (offset === 0x188 || offset === 0x18a) this.keyOn(offset === 0x188 ? 0 : 16, value, cycle);
    else if (offset === 0x18c || offset === 0x18e) this.keyOff(offset === 0x18c ? 0 : 16, value, cycle);
  }

  private keyOn(first: number, mask: number, cycle: number): void {
    for (let v = first; v < first + 16 && v < 24; v++, mask >>= 1) {
      if (!(mask & 1) || this.start[v] === 0) continue;
      const w = this.walks[v];
      w.keyedOn = true;
      w.keyOnCycle = cycle;
      w.keyOffCycle = 0;
      w.steps = 0;
      w.ended = false;
      w.adsr.keyOn();
      w.block = this.start[v];
      w.loop = NO_LOOP;
      w.left = 0;
      w.pos = PITCH_START;
      w.pitchStep = Math.max(1, this.pitch[v] << 4);
    }
  }

  private keyOff(first: number, mask: number, cycle: number): void {
    for (let v = first; v < first + 16 && v < 24; v++, mask >>= 1) {
      const w = this.walks[v];
      if (mask & 1 && w.keyedOn && w.keyOffCycle === 0) w.keyOffCycle = cycle;
    }
  }

  /** ENVX: voice v's envelope level read at `cycle`. */
  envx(v: number, cycle: number): number {
    const w = this.walks[v];
    if (!w.keyedOn || cycle < w.keyOnCycle) return 0;
    const target = Math.floor((cycle - w.keyOnCycle) / CYCLES_PER_SAMPLE);
    const steps = Math.max(0, target - KEY_ON_DELAY);
    if (w.ended) return 0;
    let releaseAt = Infinity;
    if (w.keyOffCycle > w.keyOnCycle) {
      releaseAt = Math.max(0, Math.floor((w.keyOffCycle - w.keyOnCycle) / CYCLES_PER_SAMPLE) - KEY_ON_DELAY);
    }
    const c = this.config[v];
    for (let s = w.steps; s < steps; s++) {
      if (this.reachedStop(w)) {
        w.ended = true;
        w.steps = steps;
        return 0;
      }
      w.adsr.step(c, s >= releaseAt);
      w.pos += w.pitchStep;
    }
    w.steps = Math.max(w.steps, steps);
    return w.adsr.level;
  }

  /** Consumes the samples the pitch counter owes; true past an end block without repeat. */
  private reachedStop(w: VoiceWalk): boolean {
    while (w.pos >= 0x10000) {
      if (w.left === 0) {
        if (w.block === ENDED) return true;
        const flags = this.ram[w.block + 1];
        let next = w.block + 16;
        if (flags & 4) w.loop = w.block;
        if (flags & 1) next = flags === 3 && w.loop !== NO_LOOP ? w.loop : ENDED;
        if (next !== ENDED && next >= this.ram.length) next -= this.ram.length;
        w.block = next;
        w.left = 28;
      }
      w.left--;
      w.pos -= 0x10000;
    }
    return false;
  }
}
