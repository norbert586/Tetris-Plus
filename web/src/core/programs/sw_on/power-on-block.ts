// What SW_ON.EXE leaves in the persistent block (state+0x4AD84, 0x780 bytes) for a set of cards:
// the program run headless from power-on, Circle on any message screen (on without saving).
// For runs that start after SW_ON (Puzzle Mode first): the replacement of card.ts's
// powerOnLoad() stand-in.
import * as A from '../../addr';
import type { CardSlots } from '../../card';
import { Machine } from '../../machine';

const MESSAGE_STEPS = new Set([9, 13, 21, 25, 33]);

export function powerOnBlock(cards: CardSlots): Uint8Array {
  const machine = new Machine({ counter: 0, seed: 0, cards, first: 1 });
  const m = machine.m;
  for (let t = 0; !machine.program.exited; t++) {
    if (t > 100000) throw new Error('SW_ON did not exit');
    const circle = MESSAGE_STEPS.has(m.s32(A.NEXT_PARAM)) && t % 2 === 0 ? 0x20 : 0;
    machine.program.step(circle);
  }
  const at = (A.S + 0x4ad84) & 0x1fffff;
  return m.bytes.slice(at, at + 0x780);
}
