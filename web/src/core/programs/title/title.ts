// TITLE.EXE: the title screen and its logo animation (docs/re/shell.md §7).
// Not ported yet: the machine stops here with NotPorted.
import * as A from '../../addr';
import { NotPorted } from '../../game';
import { Program, type ProgramContext } from '../../program';
import { commonFields, readFields, type Field } from '../../trace';
import { ROM } from './rom';

const BSS_END = 0x800b7078;
const PAD = 0x800b7066; // P1 held; pressed +2; P2 +6

const FIELDS: Field[] = [...commonFields(PAD)];

export class Title extends Program {
  readonly name = 'TITLE';

  constructor(ctx: ProgramContext) {
    super(ctx, ROM, BSS_END);
    this.m.w32(A.EXIT_FLAG, 0);
  }

  step(_pad: number): void {
    throw new NotPorted('TITLE');
  }

  traceRow() {
    return readFields(this, FIELDS);
  }
}
