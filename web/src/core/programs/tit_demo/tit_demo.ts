// TIT_DEMO.EXE: the story intro before the title (docs/re/shell.md §7).
// Not ported yet: the machine stops here with NotPorted.
import * as A from '../../addr';
import { NotPorted } from '../../game';
import { Program, type ProgramContext } from '../../program';
import { commonFields, readFields, type Field } from '../../trace';
import { ROM } from './rom';

const BSS_END = 0x800b8bb4;
const PAD = 0x800b8ba2; // P1 held; pressed +2; P2 +6

const FIELDS: Field[] = [...commonFields(PAD)];

export class TitDemo extends Program {
  readonly name = 'TIT_DEMO';

  constructor(ctx: ProgramContext) {
    super(ctx, ROM, BSS_END);
    this.m.w32(A.EXIT_FLAG, 0);
  }

  step(_pad: number): void {
    throw new NotPorted('TIT_DEMO');
  }

  traceRow() {
    return readFields(this, FIELDS);
  }
}
