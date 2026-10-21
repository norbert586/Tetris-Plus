// SW_ON.EXE: the memory-card check and the copyright screen (power-on, after JLOGO) (docs/re/shell.md §7).
// Not ported yet: the machine stops here with NotPorted.
import * as A from '../../addr';
import { NotPorted } from '../../game';
import { Program, type ProgramContext } from '../../program';
import { commonFields, readFields, type Field } from '../../trace';
import { ROM } from './rom';

const BSS_END = 0x800bacd4;
const PAD = 0x800bacc2; // P1 held; pressed +2; P2 +6

const FIELDS: Field[] = [...commonFields(PAD)];

export class SwOn extends Program {
  readonly name = 'SW_ON';

  constructor(ctx: ProgramContext) {
    super(ctx, ROM, BSS_END);
    this.m.w32(A.EXIT_FLAG, 0);
  }

  step(_pad: number): void {
    throw new NotPorted('SW_ON');
  }

  traceRow() {
    return readFields(this, FIELDS);
  }
}
