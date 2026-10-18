// The sound (docs/re/audio.md): the sound bank's layout, libsnd's key-on arithmetic against values
// the original wrote, and the SPU mixer against the envelope model the voice allocator relies on.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CYCLES_PER_SAMPLE, Envelopes } from '../src/audio/envelope';
import { Libsnd } from '../src/audio/libsnd';
import { Spu } from '../src/audio/spu';
import { VAB_SPU_BASE, Vab } from '../src/audio/vab';
import { Game } from '../src/core/game';

const ASSETS = join(import.meta.dirname, '..', 'public', 'assets');
const read = (name: string) => new Uint8Array(readFileSync(join(ASSETS, name)));
const vab = new Vab(read('EF.VH'), read('EF.VB'));
const rom = new Game({ counter: 0, seed: 1 }).m;

describe('sound bank', () => {
  it('has 15 programs and 50 samples laid out from 0x1010', () => {
    expect(vab.programs.filter(Boolean).length).toBe(15);
    expect(vab.vagSize.length - 1).toBe(50);
    // Start addresses the original wrote (trace kon field, in 8-byte units).
    expect(vab.vagAddr[1] >> 3).toBe(514);
    expect(vab.vagAddr[4] >> 3).toBe(2936);
  });
});

describe('libsnd', () => {
  it('keys on sound effect 0 as the original does', () => {
    const snd = new Libsnd(vab, rom);
    // se_play(0) with the default effect volume: SsVoKeyOn(0, 36 << 8, 127, 127).
    expect(snd.keyOn(0, 36, 127)).toEqual([0]);
    const writes = snd.flush({ envx: () => 0 });
    const reg = new Map(writes);
    // The original's registers at that key-on (egypt1-climb tick 100).
    expect([reg.get(0), reg.get(2), reg.get(4), reg.get(6), reg.get(8), reg.get(10)])
      .toEqual([11847, 11847, 2048, 514, 33023, 57343]);
    expect(reg.get(0x188)).toBe(1);
  });
});

describe('SPU mixer', () => {
  it('ends every sample where the envelope model says ENVX reaches 0', () => {
    for (let n = 1; n < vab.vagSize.length; n++) {
      for (const pitch of [0x400, 0x800, 0x1000, 0x1555]) {
        const spu = new Spu();
        const env = new Envelopes(spu.ram);
        spu.ram.set(vab.body, VAB_SPU_BASE);
        const writes: [number, number][] = [[4, pitch], [6, vab.vagAddr[n] >> 3], [8, 0x80ff], [10, 0xdfff], [0x188, 1]];
        for (const [o, v] of writes) {
          spu.write(o, v);
          env.write(o, v, 0);
        }
        const l = new Float32Array(1);
        const r = new Float32Array(1);
        let mixer = -1;
        for (let i = 0; i < 400_000 && mixer < 0; i++) {
          spu.render(l, r, 0, 1);
          if (!spu.sounding(0)) mixer = i;
        }
        // The first sample at which ENVX reads 0 (it reads 0 during the key-on delay too).
        let model = -1;
        for (let i = 7; i < 400_000 && model < 0; i++) if (env.envx(0, (i + 1) * CYCLES_PER_SAMPLE) === 0) model = i;
        expect(model, `sample ${n} at pitch ${pitch}`).toBe(mixer);
      }
    }
  });
});
