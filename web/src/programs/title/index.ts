// TITLE.EXE's port for the whole-game runtime (src/flow/registry.ts).
import type { ProgramModule } from '../../flow/program';
import { Title } from './logic';
import { TitleRenderer } from './renderer';

export const TITLE_MODULE: ProgramModule = {
  create: (shared) => new Title(shared),
  pack: 'titlee.pack',
  renderer: (items) => new TitleRenderer(items),
};
