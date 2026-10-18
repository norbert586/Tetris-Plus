// The ported programs, by name (src/flow/program.ts). Each mode program's port registers its
// module here.
import { Game } from '../core/game';
import { Renderer } from '../render/renderer';
import { SW_ON } from '../programs/sw_on';
import { TIT_DEMO_MODULE } from '../programs/tit_demo';
import { TITLE_MODULE } from '../programs/title';
import { RANKING_MODULE } from '../programs/ranking';
import type { ProgramFactory, ProgramModule, ProgramName } from './program';

export const PROGRAMS: Partial<Record<ProgramName, ProgramModule>> = {
  SW_ON,
  TIT_DEMO: TIT_DEMO_MODULE,
  TITLE: TITLE_MODULE,
  RANKING: RANKING_MODULE,
  PAZLE: {
    create: (shared) => new Game({ counter: 0, seed: 0, shared }),
    pack: 'pazlee.pack',
    renderer: (items) => {
      const r = new Renderer(items);
      // Player 2's side stays hidden until two-player mode exists (an approved deviation;
      // verification draws it).
      r.hidePlayer2 = true;
      return { frame: (p) => r.frame(p as Game), pixels: (b) => r.pixels(b) };
    },
  },
};

export const FACTORIES: Partial<Record<ProgramName, ProgramFactory>> = Object.fromEntries(
  Object.entries(PROGRAMS).map(([name, mod]) => [name, mod.create]),
);
