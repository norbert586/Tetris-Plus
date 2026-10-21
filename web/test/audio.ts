// The audio model as the tests and tools build it, from the committed assets.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AudioModel } from '../src/audio/model';
import { Vab } from '../src/audio/vab';
import type { Mem } from '../src/core/mem';

const ASSETS = join(import.meta.dirname, '..', 'public', 'assets');

/** A model on the machine's memory (the running program's tables and settings). */
export function audioModel(m: Mem): AudioModel {
  const read = (name: string) => new Uint8Array(readFileSync(join(ASSETS, name)));
  const vab = new Vab(read('EF.VH'), read('EF.VB'));
  const disc = JSON.parse(readFileSync(join(ASSETS, 'disc.json'), 'utf8'));
  return new AudioModel(vab, m, disc);
}
