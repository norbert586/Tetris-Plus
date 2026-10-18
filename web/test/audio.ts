// The audio model as the tests and tools build it, from the committed assets.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AudioModel } from '../src/audio/model';
import { Vab } from '../src/audio/vab';
import type { Game } from '../src/core/game';

const ASSETS = join(import.meta.dirname, '..', 'public', 'assets');

export function audioModel(game: Game): AudioModel {
  const read = (name: string) => new Uint8Array(readFileSync(join(ASSETS, name)));
  const vab = new Vab(read('EF.VH'), read('EF.VB'));
  const disc = JSON.parse(readFileSync(join(ASSETS, 'disc.json'), 'utf8'));
  return new AudioModel(vab, game.m, disc);
}
