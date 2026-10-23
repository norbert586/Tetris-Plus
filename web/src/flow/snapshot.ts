// Saved games: the browser's "pause and save" (docs/re/shell.md). A save is taken on Puzzle
// Mode's pause screen, where the game has stopped its music and drawn nothing that moves, and
// holds everything the port needs to carry on exactly: the RAM (Puzzle Mode keeps all its state
// at the original's addresses), the BIOS rand() seed, the program's tick count and the VRAM its
// renderer has built up. Resuming starts the Console on that RAM (ConsoleOptions.resume) and
// the renderer on that VRAM; unpausing then restarts the stage's music, as the game always does.
// The memory card is not part of a save: it stays as it is.
import * as A from '../core/addr';
import * as V from '../core/vars';
import type { Console } from './console';

/** Bumped when a save's contents change meaning (older saves are then not offered). */
export const SNAPSHOT_VERSION = 1;

export interface Snapshot {
  version: number;
  program: 'PAZLE';
  /** The program's tick count (Program.tick). */
  tick: number;
  /** The BIOS rand() seed. */
  seed: number;
  /** The 2 MB of RAM. */
  ram: Uint8Array;
  /** The renderer's VRAM, 1024 x 512 pixels. */
  vram: Uint16Array;
  /** When it was saved (ms since 1970), and where the game was, for the shell to show. */
  savedAt: number;
  zone: number;
  stage: number;
  hundred: boolean;
}

const PAUSE_SCREEN = 12;
const ZONE_NAMES = ['Egypt', 'Angkor Wat', 'Maya', 'Knossos', 'Atlantis'];

/**
 * Whether the game can be saved now: Puzzle Mode with player 1 on the pause screen's "PAUSE"
 * (step 0; not its menu or the 100-stage mode's stage select).
 */
export function canSave(c: Console): boolean {
  const p = c.program;
  if (p.name !== 'PAZLE' || p.exited || p.tick === 0) return false;
  const m = c.m;
  return m.s32(A.SCREEN) === PAUSE_SCREEN && m.s32(A.STEP) === 0 && m.s32(V.HUNDRED_AUTO) === 0 && m.s32(A.TWO_PLAYER) === 0;
}

/** A save of the game now (call between ticks, when `canSave`), with the renderer's VRAM. */
export function takeSnapshot(c: Console, vram: Uint16Array, savedAt = Date.now()): Snapshot {
  if (!canSave(c)) throw new Error('the game can be saved only on the pause screen');
  const m = c.m;
  return {
    version: SNAPSHOT_VERSION,
    program: 'PAZLE',
    tick: c.program.tick,
    seed: c.shared.rng.seed,
    ram: m.bytes.slice(),
    vram: vram.slice(),
    savedAt,
    zone: m.s32(V.ZONE),
    stage: m.s32(V.STAGE),
    hundred: m.s32(V.ZONES_CLEARED) === 0x1f,
  };
}

/** Whether a stored value is a save this version can resume. */
export function isSnapshot(s: unknown): s is Snapshot {
  const x = s as Partial<Snapshot> | undefined;
  return (
    !!x && x.version === SNAPSHOT_VERSION && x.program === 'PAZLE' && typeof x.tick === 'number' && x.tick > 0 &&
    typeof x.seed === 'number' && x.ram instanceof Uint8Array && x.ram.length === 0x200000 &&
    x.vram instanceof Uint16Array && x.vram.length === 1024 * 512
  );
}

/** Where a save was made, e.g. "Egypt, stage 3" or "Stage 41 of 100". */
export function describeSnapshot(s: Snapshot): string {
  if (s.hundred) return `Stage ${s.zone * 20 + s.stage + 1} of 100`;
  return `${ZONE_NAMES[s.zone] ?? `Zone ${s.zone + 1}`}, stage ${s.stage + 1}`;
}
