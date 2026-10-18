// SELECT.EXE's port as a ProgramModule (src/flow/program.ts).
import type { ProgramModule } from '../../flow/program';
import { SelectRenderer } from './render';
import { Select } from './select';

export const SELECT_MODULE: ProgramModule = {
  create: (shared) => new Select(shared),
  pack: 'selecte.pack',
  renderer: (items) => {
    const r = new SelectRenderer(items);
    return { frame: (p) => r.frame(p as Select), pixels: (b) => r.pixels(b) };
  },
};
