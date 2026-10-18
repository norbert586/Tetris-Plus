// The game is a chain of programs (docs/re/flow.md): the boot program (SLUS_003.38) loads one
// mode program at 0x80094000, runs it until it sets the exit flag and names the next one, and
// loads that. All of them share the boot program's state block (state = 0x8003E668: the frame
// counter, settings, best times, rankings, the screen words) and the BIOS rand().
//
// A port of a mode program implements `Program`: one main-loop iteration per `step`, state in
// the shared RAM at the original's addresses, and the same presentation outputs as Puzzle
// Mode's core (src/core/game.ts) so the renderer and the sound can follow it.
import type { Mem } from '../core/mem';
import type { Rng } from '../core/rng';
import type { SoundCall } from '../core/sound';
import type { Frame } from '../render/renderer';

/** The boot program's program numbers (state+0x48; table at 0x80039A74). */
export const PROGRAM_NAMES = [
  'JLOGO', 'SW_ON', 'TIT_DEMO', 'TITLE', 'HOW_N', 'HOW_P', 'HOW_VS', 'RANKING', 'SELECT', 'NOMAL', 'PAZLE', 'VSPUZ', 'EDIT',
] as const;
export type ProgramName = (typeof PROGRAM_NAMES)[number];

/** What a program shares with the others. */
export interface Shared {
  m: Mem;
  rng: Rng;
}

export interface Program {
  readonly name: ProgramName;
  readonly m: Mem;
  readonly rng: Rng;
  /** Main-loop iterations run so far. */
  tick: number;
  /** One main-loop iteration with this pad word (pad 1 low, pad 2 high), as Game.step. */
  step(pad: number): void;
  /** The exit flag (state+0x1FCF4) is set: the boot program loads the next program. */
  readonly exited: boolean;
  /** Image uploads this tick (item + 0x10000 * player, + 0x100000 if queued), for the renderer. */
  uploads: number[];
  /** Sound library and CD calls this tick, for the audio layer. */
  sound: SoundCall[];
}

/** Makes a program, running on the shared RAM (its image loaded, its BSS cleared). */
export type ProgramFactory = (shared: Shared) => Program;

/** Draws a program's frames (made anew for each run of the program: its VRAM starts cleared). */
export interface ProgramRenderer {
  /** Renders the frame of the program's last tick (uploads first), with the oracle's hashes. */
  frame(p: Program): Frame;
  /** The 320x240 frame in display buffer `buffer`, as 15-bit pixels. */
  pixels(buffer: number): Uint16Array;
}

/** A ported program: how to run it and how to draw it. */
export interface ProgramModule {
  create: ProgramFactory;
  /** Its asset pack in public/assets (tools/extract-assets.ts: its data file's decoded items). */
  pack: string;
  renderer(items: Uint8Array[]): ProgramRenderer;
}
