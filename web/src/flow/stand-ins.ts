// Programs the port doesn't run: the attract loop's Classic, Puzzle and VS how-to-play demos
// (HOW_N.EXE, HOW_P.EXE, HOW_VS.EXE; docs/re/title.md §4, docs/re/flow.md). The port skips
// them (an approved-style deviation: the loop goes from the title's timeout straight on to the
// ranking screen) but leaves the shared state as each demo does when it ends on its own: the
// frame counter advanced by its length, its game's numbers in state+0x18/+0x20/+0x24, and the
// program it names next. The demos are deterministic without input.
import * as A from '../core/addr';
import type { Mem } from '../core/mem';
import type { ProgramName } from './program';

interface StandIn {
  /** Ticks the original runs with no input. */
  ticks: number;
  /** Words it leaves in the state block (offset from state). */
  words: [number, number][];
  next: ProgramName;
}

export const STAND_INS: Partial<Record<ProgramName, StandIn>> = {
  HOW_N: { ticks: 2426, words: [[0x18, 5], [0x20, 9], [0x24, 1]], next: 'HOW_P' },
  HOW_P: { ticks: 4409, words: [[0x18, 0x32], [0x20, 0x13], [0x24, 4]], next: 'RANKING' },
  HOW_VS: { ticks: 2980, words: [[0x20, -11], [0x24, 5], [0x4b53c, 1]], next: 'RANKING' },
};

const PROGRAM_NUMBER: Partial<Record<ProgramName, number>> = { HOW_P: 5, RANKING: 7 };

/** Runs a stand-in to its end: the state as the demo leaves it, naming its next program. */
export function runStandIn(m: Mem, s: StandIn): void {
  m.add32(A.COUNTER, s.ticks);
  for (const [offset, value] of s.words) m.w32(A.S + offset, value);
  m.w32(A.EXIT_FLAG, 1);
  m.w32(A.NEXT_PROGRAM, PROGRAM_NUMBER[s.next]!);
  m.w32(A.NEXT_PARAM, 0);
  m.w32(A.PHASE, 0);
  m.w32(A.SUBPHASE, 0);
}
