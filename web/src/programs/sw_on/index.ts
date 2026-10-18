// SW_ON.EXE's port as a ProgramModule (src/flow/program.ts, registered in src/flow/registry.ts).
import type { ProgramModule } from '../../flow/program';
import { SwOnRenderer } from './renderer';
import { SwOn } from './sw_on';

export const SW_ON: ProgramModule = {
  create: (shared) => new SwOn(shared),
  pack: 'sw_one.pack',
  renderer: (items) => {
    const r = new SwOnRenderer(items);
    return { frame: (p) => r.frame(p as SwOn), pixels: (b) => r.pixels(b) };
  },
};
