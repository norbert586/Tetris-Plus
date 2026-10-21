// Pad 1 from the keyboard and gamepads (docs/re/shell.md §3): the PadRead word the core reads,
// in libetc's bit layout (src/core/pad.ts). Keys are remappable; gamepads use the browser's
// standard mapping (Cross on the bottom face button, Circle on the right).
import { BUTTONS } from '../core/pad';

export type Button =
  | 'UP' | 'DOWN' | 'LEFT' | 'RIGHT' | 'CROSS' | 'CIRCLE' | 'SQUARE' | 'TRIANGLE'
  | 'START' | 'SELECT' | 'L1' | 'R1' | 'L2' | 'R2';

/** The order buttons are listed in the settings. */
export const BUTTON_ORDER: Button[] = [
  'UP', 'DOWN', 'LEFT', 'RIGHT', 'CROSS', 'CIRCLE', 'SQUARE', 'TRIANGLE', 'START', 'SELECT', 'L1', 'R1', 'L2', 'R2',
];

export const DEFAULT_KEYS: Record<string, Button> = {
  ArrowUp: 'UP',
  ArrowDown: 'DOWN',
  ArrowLeft: 'LEFT',
  ArrowRight: 'RIGHT',
  KeyX: 'CROSS',
  KeyZ: 'CIRCLE',
  KeyA: 'SQUARE',
  KeyS: 'TRIANGLE',
  Enter: 'START',
  ShiftRight: 'SELECT',
  KeyQ: 'L1',
  KeyW: 'R1',
  Digit1: 'L2',
  Digit2: 'R2',
};

/** Standard-mapping gamepad buttons (https://w3c.github.io/gamepad/#remapping). */
const PAD_BUTTONS: [number, Button][] = [
  [0, 'CROSS'], [1, 'CIRCLE'], [2, 'SQUARE'], [3, 'TRIANGLE'], [4, 'L1'], [5, 'R1'], [6, 'L2'], [7, 'R2'],
  [8, 'SELECT'], [9, 'START'], [12, 'UP'], [13, 'DOWN'], [14, 'LEFT'], [15, 'RIGHT'],
];
const STICK = 0.5;

export class Input {
  keys: Record<string, Button>;
  private held = new Set<string>();

  constructor(keys: Record<string, Button>) {
    this.keys = { ...keys };
  }

  /** Handles a key event; true if the key is mapped (the page should not act on it). */
  key(code: string, down: boolean): boolean {
    if (!(code in this.keys)) return false;
    if (down) this.held.add(code);
    else this.held.delete(code);
    return true;
  }

  /** Releases everything (focus lost: keyups would never arrive). */
  clear(): void {
    this.held.clear();
  }

  /** The pad word now: keys held plus every connected gamepad. Read just before each tick. */
  word(): number {
    let w = 0;
    for (const code of this.held) w |= BUTTONS[this.keys[code]];
    for (const pad of navigator.getGamepads?.() ?? []) {
      if (!pad || !pad.connected) continue;
      for (const [i, b] of PAD_BUTTONS) if (pad.buttons[i]?.pressed) w |= BUTTONS[b];
      const [x = 0, y = 0] = pad.axes;
      if (x < -STICK) w |= BUTTONS.LEFT;
      if (x > STICK) w |= BUTTONS.RIGHT;
      if (y < -STICK) w |= BUTTONS.UP;
      if (y > STICK) w |= BUTTONS.DOWN;
    }
    return w & 0xffff;
  }

  /** Binds a key to a button, replacing the button's other keys. */
  bind(code: string, button: Button): void {
    for (const k of Object.keys(this.keys)) if (this.keys[k] === button) delete this.keys[k];
    this.keys[code] = button;
  }

  keysFor(button: Button): string[] {
    return Object.keys(this.keys).filter((k) => this.keys[k] === button);
  }
}
