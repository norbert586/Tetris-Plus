// Keyboard and gamepad to the PS1 digital pad word PadRead returns (pad 1: low half), sampled
// once per tick right before the tick runs. A real d-pad can't press two opposite directions at
// once; from a keyboard the direction pressed last wins, so the game never sees both.
import { BINDABLE, BUTTON_BITS, type Button, type Settings } from './settings';

const OPPOSITE: Partial<Record<Button, Button>> = { UP: 'DOWN', DOWN: 'UP', LEFT: 'RIGHT', RIGHT: 'LEFT' };
/** Left-stick deflection that counts as a d-pad press. */
const STICK = 0.5;

export class Input {
  private readonly held = new Set<string>();
  /** When each held key went down (for last-direction-wins). */
  private readonly order = new Map<string, number>();
  private serial = 0;
  /** Called with the code of every key press (the shell's own hotkeys and key binding). */
  onKey?: (code: string, e: KeyboardEvent) => boolean | void;

  constructor(private settings: Settings) {
    addEventListener('keydown', (e) => {
      if (this.onKey?.(e.code, e) === true) {
        e.preventDefault();
        return;
      }
      if (!this.bound(e.code)) return;
      e.preventDefault();
      if (!this.held.has(e.code)) this.order.set(e.code, ++this.serial);
      this.held.add(e.code);
    });
    addEventListener('keyup', (e) => {
      this.held.delete(e.code);
      this.order.delete(e.code);
    });
    // Keys held while the window loses focus never send keyup.
    addEventListener('blur', () => this.release());
  }

  use(settings: Settings): void {
    this.settings = settings;
    this.release();
  }

  release(): void {
    this.held.clear();
    this.order.clear();
  }

  private bound(code: string): boolean {
    return BINDABLE.some((b) => this.settings.keys[b].includes(code));
  }

  /** The pad word for this tick. */
  read(): number {
    const s = this.settings;
    const when: Partial<Record<Button, number>> = {};
    for (const b of BINDABLE) {
      for (const code of s.keys[b]) {
        const t = this.order.get(code);
        if (t !== undefined) when[b] = Math.max(when[b] ?? 0, t);
      }
    }
    for (const gp of navigator.getGamepads?.() ?? []) {
      if (!gp || !gp.connected) continue;
      for (const b of BINDABLE) if (s.pad[b].some((i) => gp.buttons[i]?.pressed)) when[b] = Math.max(when[b] ?? 0, 0.5);
      const [x = 0, y = 0] = gp.axes;
      if (x < -STICK) when.LEFT = Math.max(when.LEFT ?? 0, 0.5);
      if (x > STICK) when.RIGHT = Math.max(when.RIGHT ?? 0, 0.5);
      if (y < -STICK) when.UP = Math.max(when.UP ?? 0, 0.5);
      if (y > STICK) when.DOWN = Math.max(when.DOWN ?? 0, 0.5);
    }
    let word = 0;
    for (const b of BINDABLE) {
      const t = when[b];
      if (t === undefined) continue;
      const o = OPPOSITE[b];
      const ot = o ? when[o] : undefined;
      if (ot !== undefined && (ot > t || (ot === t && (b === 'DOWN' || b === 'RIGHT')))) continue;
      word |= BUTTON_BITS[b];
    }
    return word;
  }

  /** The first gamepad button pressed right now (for binding), or undefined. */
  static padButton(): number | undefined {
    for (const gp of navigator.getGamepads?.() ?? []) {
      if (!gp) continue;
      const i = gp.buttons.findIndex((b) => b.pressed);
      if (i >= 0) return i;
    }
    return undefined;
  }
}
