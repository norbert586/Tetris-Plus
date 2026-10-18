// The shell's own settings (docs/re/shell.md): controls, display and sound volume, kept in the
// browser. The game's settings (Option mode: turn buttons, sound mode, music mode, volumes)
// stay where the original keeps them, in its state block and on its memory card.
import * as PAD from '../core/pad';

/** The pad buttons a player can bind, in the order the settings panel lists them. */
export const BINDABLE = ['UP', 'DOWN', 'LEFT', 'RIGHT', 'CROSS', 'CIRCLE', 'SQUARE', 'TRIANGLE', 'START', 'SELECT', 'L1', 'R1', 'L2', 'R2'] as const;
export type Button = (typeof BINDABLE)[number];

export const BUTTON_BITS: Record<Button, number> = {
  UP: PAD.UP, DOWN: PAD.DOWN, LEFT: PAD.LEFT, RIGHT: PAD.RIGHT,
  CROSS: PAD.CROSS, CIRCLE: PAD.CIRCLE, SQUARE: PAD.SQUARE, TRIANGLE: PAD.TRIANGLE,
  START: PAD.START, SELECT: PAD.SELECT, L1: PAD.L1, R1: PAD.R1, L2: PAD.L2, R2: PAD.R2,
};

export interface Settings {
  /** KeyboardEvent.code values per button. */
  keys: Record<Button, string[]>;
  /** Standard-mapping gamepad button indices per button (the d-pad also reads the left stick). */
  pad: Record<Button, number[]>;
  /** 'integer': the largest whole multiple of 320x240 that fits (4:3); 'fit': fill the window at 4:3. */
  scale: 'integer' | 'fit';
  /** Faint scanlines over the picture. */
  scanlines: boolean;
  /** Master volume, 0-100, on top of the game's own volume settings. */
  volume: number;
  /** Pause when the tab or window loses focus. */
  pauseOnBlur: boolean;
  /** Play the Jaleco logo video at power-on. */
  logo: boolean;
}

export const DEFAULTS: Settings = {
  keys: {
    UP: ['ArrowUp'], DOWN: ['ArrowDown'], LEFT: ['ArrowLeft'], RIGHT: ['ArrowRight'],
    CROSS: ['KeyX'], CIRCLE: ['KeyZ'], SQUARE: ['KeyA'], TRIANGLE: ['KeyS'],
    START: ['Enter'], SELECT: ['ShiftRight', 'Backspace'], L1: ['KeyQ'], R1: ['KeyW'], L2: ['Digit1'], R2: ['Digit2'],
  },
  // Standard mapping: 0 bottom, 1 right, 2 left, 3 top, 4/5 bumpers, 6/7 triggers, 8 back,
  // 9 start, 12-15 d-pad. PlayStation layout: Cross bottom, Circle right.
  pad: {
    UP: [12], DOWN: [13], LEFT: [14], RIGHT: [15],
    CROSS: [0], CIRCLE: [1], SQUARE: [2], TRIANGLE: [3],
    START: [9], SELECT: [8], L1: [4], R1: [5], L2: [6], R2: [7],
  },
  scale: 'integer',
  scanlines: false,
  volume: 100,
  pauseOnBlur: true,
  logo: true,
};

const KEY = 'tetris-plus.settings.v1';

/** Reads the settings, falling back to the defaults for anything missing or unreadable. */
export function loadSettings(storage: Storage | undefined = globalThis.localStorage): Settings {
  const s: Settings = structuredClone(DEFAULTS);
  try {
    const saved = JSON.parse(storage?.getItem(KEY) ?? 'null') as Partial<Settings> | null;
    if (!saved) return s;
    for (const b of BINDABLE) {
      if (Array.isArray(saved.keys?.[b])) s.keys[b] = saved.keys[b].filter((k) => typeof k === 'string');
      if (Array.isArray(saved.pad?.[b])) s.pad[b] = saved.pad[b].filter((k) => Number.isInteger(k));
    }
    if (saved.scale === 'integer' || saved.scale === 'fit') s.scale = saved.scale;
    if (typeof saved.scanlines === 'boolean') s.scanlines = saved.scanlines;
    if (typeof saved.volume === 'number') s.volume = Math.max(0, Math.min(100, Math.round(saved.volume)));
    if (typeof saved.pauseOnBlur === 'boolean') s.pauseOnBlur = saved.pauseOnBlur;
    if (typeof saved.logo === 'boolean') s.logo = saved.logo;
  } catch {
    // unreadable or blocked storage: defaults
  }
  return s;
}

export function saveSettings(s: Settings, storage: Storage | undefined = globalThis.localStorage): void {
  try {
    storage?.setItem(KEY, JSON.stringify(s));
  } catch {
    // storage full or blocked: the settings last for this visit only
  }
}
