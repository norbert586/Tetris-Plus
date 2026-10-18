// TIT_DEMO.EXE's port for the whole-game runtime (src/flow/registry.ts).
import type { ProgramModule } from '../../flow/program';
import { TitDemo } from './logic';
import { TitDemoRenderer } from './renderer';

export const TIT_DEMO_MODULE: ProgramModule = {
  create: (shared) => new TitDemo(shared),
  pack: 'tdemoe.pack',
  renderer: (items) => new TitDemoRenderer(items),
};
