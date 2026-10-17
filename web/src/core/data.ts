// Gameplay tables extracted from PAZLE.EXE by re/tools/extract_spec.py (docs/spec/data/).
import piecesJson from '../../../docs/spec/data/pieces.json';
import rulesJson from '../../../docs/spec/data/rules.json';
import stagesJson from '../../../docs/spec/data/stages.json';
import professorJson from '../../../docs/spec/data/professor.json';

/** SHAPES[kind][rot][row * 5 + col] = 1 when solid (0x800D5544). */
export const SHAPES: number[][][] = piecesJson.kinds.map((k) =>
  k.rotations.map((rows) => rows.join('').split('').map((c) => (c === '#' ? 1 : 0))),
);

export const LEVELS = rulesJson.levels;
export const QUEUE_TABLE: number[] = rulesJson.queue_table;
export const NEXT_POSITIONS = rulesJson.next_positions_px;
export const CEILING_INTERVALS: number[][] = rulesJson.ceiling_intervals;
export const CEILING_SHAKE_PX: number[] = rulesJson.ceiling_shake_px;
/** PUSHBACK_PX[lines] for 0-4 lines (0x8009438C, indexed by lines_cleared). */
export const PUSHBACK_PX: number[] = [0, 1, 2, 3, 4].map(
  (n) => (rulesJson.pushback_px_by_lines as Record<string, number>)[String(n)] ?? 0,
);
export const SETTINGS_DEFAULT = rulesJson.settings_default;

export interface StageRecord {
  profCol: number;
  profRow: number;
  /** 0 right, 1 left */
  facing: number;
  /** board rows 1..15, 10 cells each */
  layout: number[];
}

export const STAGES: StageRecord[] = stagesJson.stages.map((s) => ({
  profCol: s.professor.col,
  profRow: s.professor.row,
  facing: s.professor.facing === 'left' ? 1 : 0,
  layout: s.rows.join('').split('').map((c) => (c === '.' ? 0 : Number(c))),
}));

export const SENSORS: { right: number[][]; left: number[][] } = professorJson.sensors;

export type ProfOp =
  | { op: 'end' }
  | { op: 'image'; image: number; flip: number; second_sprite: number }
  | { op: 'wait'; frames: number }
  | { op: 'move_cell'; dcol: number; drow: number }
  | { op: 'jump'; words: number }
  | { op: 'sound'; se: number }
  | { op: 'nudge_px'; dx: number; dy: number }
  | { op: 'hide'; keep_main: number };

const OP_SIZE: Record<string, number> = {
  end: 4, image: 24, wait: 8, move_cell: 12, jump: 8, sound: 8, nudge_px: 12, hide: 12,
};

/** ACTION_ADDR[action] = RAM address of the action's script (pointer table 0x800E0738). */
export const ACTION_ADDR: number[] = professorJson.actions.map((a) => Number(a.address));

/** Every script opcode by its RAM address, so script pointers match the original's. */
export const PROF_OPS = new Map<number, ProfOp & { size: number }>();
for (const a of professorJson.actions) {
  let addr = Number(a.address);
  for (const o of a.ops as unknown as ProfOp[]) {
    const size = OP_SIZE[o.op];
    if (size === undefined) throw new Error(`unknown professor op ${o.op}`);
    PROF_OPS.set(addr, { ...o, size });
    addr += size;
  }
}
