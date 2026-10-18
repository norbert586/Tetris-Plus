// RANKING.EXE's port for the whole-game runtime (src/flow/registry.ts).
import type { ProgramModule } from '../../flow/program';
import { Ranking } from './ranking';
import { RankingRenderer } from './renderer';

export const RANKING_MODULE: ProgramModule = {
  create: (shared) => new Ranking(shared),
  pack: 'rankinge.pack',
  renderer: (items) => new RankingRenderer(items),
};
