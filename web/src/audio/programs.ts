// Where each program keeps what its sound driver reads (docs/re/audio.md §11). Every mode program
// links the same sound code (PsyQ's libsnd and the game's own se_play, bgm_play_track and CD
// callback) and the same tables, at its own addresses; the sound set-up each runs before its main
// loop is the same too. So the audio layer follows a program change by reading these addresses
// in the shared RAM, where the boot program has just loaded the new program.
//
// The audio layer keeps its own copy of the tables at each program's addresses (`soundTables`),
// so a port need not load them with its data: the bytes are the same in every EXE.
//
// A program port's sound plugs in with an entry here: the table addresses (found by their
// contents: `python3 re/tools/find_sound_tables.py <files> web/src/audio/sound-tables.ts`),
// where the loader leaves the CD head, the phase of libsnd's history index and, measured with
// TP_AUDIO_LOG, when its first tick sends its first CD command and when its exit stops the CD.
// The port itself records its sound calls in `Program.sound` (src/core/sound.ts's SoundCall).
import { decodeBase64, Mem } from '../core/mem';
import type { ProgramName } from '../flow/program';
import { SOUND_TABLES } from './sound-tables';

export interface ProgramAudio {
  /** libsnd's note-to-pitch table (12 semitones x 16 fine steps, u16). */
  pitchTable: number;
  /** The per-track table from track 2 (12 bytes: end offset in sectors, loop mode, priority). */
  trackTable: number;
  /** The CD volume by the music volume setting (s16[8]: 0, 16, ..., 112). */
  musicVolume: number;
  /**
   * Where the CD head rests when the program starts (MSF sectors): the end of the files the
   * boot program loaded for it (its data file, then its EXE, next to each other on the disc).
   */
  loadEnd: number;
  /**
   * libsnd's flush history index (SpuVmFlush's ring index) at the trace sample of the program's
   * first tick, read from RAM dumps (`history` is its address). Undefined where unmeasured:
   * then 2 at the start of the first tick, as in Puzzle Mode on the "puzzle" route.
   */
  historyAtSample?: number;
  history: number;
  /**
   * When its first tick's logic sends its first CD command, in cycles before that tick's sample
   * (a tick that loads the program runs over many vblanks). Measured with TP_AUDIO_LOG.
   */
  firstCd?: number;
  /**
   * From its last sample to the moment the loader stops the CD for the next program (its exit:
   * FUN_80096604's VSync(60) and clean-up, then the loader's first read), in cycles: fitted
   * between the last report the loading tick holds and the next one the drive would have made.
   */
  exitCdStop?: number;
}

/** Every program's addresses (the ones without a port are listed for when they get one). */
export const PROGRAM_AUDIO: Partial<Record<ProgramName, ProgramAudio>> = {
  SW_ON: {
    pitchTable: 0x800b52bc, trackTable: 0x800af25c, musicVolume: 0x800af0a8, history: 0x800b6514,
    loadEnd: 1256,
  },
  TIT_DEMO: {
    pitchTable: 0x800b5338, trackTable: 0x800aee8c, musicVolume: 0x800aecdc, history: 0x800b66b4,
    loadEnd: 1366, historyAtSample: 15, firstCd: 206_989, exitCdStop: 36_000_000,
  },
  TITLE: {
    pitchTable: 0x800b38a0, trackTable: 0x800ada18, musicVolume: 0x800ad868, history: 0x800b4b78,
    loadEnd: 1625, historyAtSample: 15, exitCdStop: 36_000_000,
  },
  HOW_N: {
    pitchTable: 0x800ca488, trackTable: 0x800bba78, musicVolume: 0x800bb8c8, history: 0x800cce30,
    loadEnd: 1766,
  },
  HOW_P: {
    pitchTable: 0x800d2da8, trackTable: 0x800bf350, musicVolume: 0x800bf1a0, history: 0x800d560c,
    loadEnd: 1993,
  },
  HOW_VS: {
    pitchTable: 0x800ce428, trackTable: 0x800be7bc, musicVolume: 0x800be60c, history: 0x800d01f4,
    loadEnd: 2242,
  },
  RANKING: {
    pitchTable: 0x800b1b60, trackTable: 0x800abe40, musicVolume: 0x800abc90, history: 0x800b2e00,
    loadEnd: 2336, historyAtSample: 8,
  },
  SELECT: {
    pitchTable: 0x800b86b4, trackTable: 0x800b2168, musicVolume: 0x800b1fb4, history: 0x800b994c,
    loadEnd: 2479, historyAtSample: 8, firstCd: 683_699, exitCdStop: 64_500_000,
  },
  PAZLE: {
    pitchTable: 0x800ec94c, trackTable: 0x800dc610, musicVolume: 0x800dc45c, history: 0x800edba8,
    loadEnd: 3506, historyAtSample: 13, exitCdStop: 63_000_000,
  },
};

/**
 * Puzzle Mode as the "puzzle" boot route traces start it (docs/re/audio.md §3, §6): the head at
 * the start of the disc (fitted to the first Play's timing), the history index 2 when tick 1
 * starts.
 */
export const PAZLE_PUZZLE_ROUTE: ProgramAudio = { ...PROGRAM_AUDIO.PAZLE!, loadEnd: 150, historyAtSample: undefined };

/** Every program's sound tables at its own addresses, as the audio layer reads them. */
export function soundTables(): Mem {
  const m = new Mem(new Uint8Array(0x200000));
  const ranges: { address: number; bytes: Uint8Array }[] = [];
  for (const p of Object.values(PROGRAM_AUDIO)) {
    for (const k of ['pitchTable', 'trackTable', 'musicVolume'] as const) {
      ranges.push({ address: p![k], bytes: decodeBase64(SOUND_TABLES[k]) });
    }
  }
  m.loadImage(ranges);
  return m;
}
