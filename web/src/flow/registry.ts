// The ported programs, by name (src/flow/program.ts). Each mode program's port registers its
// factory here.
import { Game } from '../core/game';
import type { ProgramFactory, ProgramName } from './program';

export const FACTORIES: Partial<Record<ProgramName, ProgramFactory>> = {
  PAZLE: (shared) => new Game({ counter: 0, seed: 0, shared }),
};
