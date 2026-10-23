// The settings panel (Escape): the saved game, controls for keyboard and gamepad, display, volume,
// the memory card. Plain HTML over the paused game; every change is saved at once.
import { formattedCard, parseCardFile } from '../flow/memcard';
import { describeSnapshot, type Snapshot } from '../flow/snapshot';
import { Input } from './input';
import { savedWhen } from './saves';
import { BINDABLE, DEFAULTS, saveSettings, type Button, type Settings } from './settings';

const LABELS: Record<Button, string> = {
  UP: 'Up', DOWN: 'Down', LEFT: 'Left', RIGHT: 'Right', CROSS: 'Cross', CIRCLE: 'Circle', SQUARE: 'Square',
  TRIANGLE: 'Triangle', START: 'Start', SELECT: 'Select', L1: 'L1', R1: 'R1', L2: 'L2', R2: 'R2',
};

export const keyName = (code: string) =>
  code.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Arrow/, '').replace(/^Numpad/, 'Num ').replace(/(Left|Right)$/, ' $1').trim();

export interface PanelHost {
  settings: Settings;
  input: Input;
  apply(settings: Settings): void;
  toggleFullscreen(): void;
  close(): void;
  /** The card in slot 1 (a copy), and putting another in its place (docs/re/shell.md). */
  card(): Uint8Array | null;
  setCard(image: Uint8Array): void;
  /** The saved game (src/flow/snapshot.ts), whether the game can be saved now, and the actions. */
  saved(): Snapshot | undefined;
  canSave(): boolean;
  saveGame(): void;
  loadGame(): void;
  deleteGame(): void;
}

export class SettingsPanel {
  readonly el: HTMLElement;
  /** A binding in progress: the button and whether a key or a gamepad button is awaited. */
  private binding?: { button: Button; kind: 'key' | 'pad'; poll?: number };
  /** The outcome of the last card import or erase, shown under the card buttons. */
  private cardNote = '';

  constructor(private readonly host: PanelHost) {
    this.el = document.createElement('div');
    this.el.className = 'panel';
    this.el.hidden = true;
    document.body.append(this.el);
  }

  get open(): boolean {
    return !this.el.hidden;
  }

  show(): void {
    this.el.hidden = false;
    this.cardNote = '';
    this.render();
  }

  /** Draws the panel again if it is open (the saved game changed). */
  refresh(): void {
    if (this.open) this.render();
  }

  hide(): void {
    this.cancelBinding();
    this.el.hidden = true;
  }

  /** Handles a key press while the panel is open; true when the panel used it. */
  key(code: string): boolean {
    if (!this.open) return false;
    if (this.binding?.kind === 'key') {
      if (code !== 'Escape') this.bindKey(this.binding.button, code);
      this.cancelBinding();
      this.render();
      return true;
    }
    if (code === 'Escape') {
      this.host.close();
      return true;
    }
    return false;
  }

  private change(fn: (s: Settings) => void): void {
    const s = structuredClone(this.host.settings);
    fn(s);
    saveSettings(s);
    this.host.apply(s);
    this.render();
  }

  private bindKey(button: Button, code: string): void {
    this.change((s) => {
      // A key drives one button only.
      for (const b of BINDABLE) s.keys[b] = s.keys[b].filter((k) => k !== code);
      s.keys[button] = [code];
    });
  }

  private bindPad(button: Button, index: number): void {
    this.change((s) => {
      for (const b of BINDABLE) s.pad[b] = s.pad[b].filter((k) => k !== index);
      s.pad[button] = [index];
    });
  }

  private cancelBinding(): void {
    if (this.binding?.poll) clearInterval(this.binding.poll);
    this.binding = undefined;
  }

  private startBinding(button: Button, kind: 'key' | 'pad'): void {
    this.cancelBinding();
    this.binding = { button, kind };
    if (kind === 'pad') {
      // Wait for every button to be released first, then take the next one pressed.
      let released = Input.padButton() === undefined;
      this.binding.poll = window.setInterval(() => {
        const i = Input.padButton();
        if (i === undefined) released = true;
        else if (released) {
          this.bindPad(button, i);
          this.cancelBinding();
          this.render();
        }
      }, 16);
    }
    this.render();
  }

  private render(): void {
    const s = this.host.settings;
    const el = this.el;
    el.replaceChildren();
    const h = (tag: string, text?: string, cls?: string) => {
      const e = document.createElement(tag);
      if (text !== undefined) e.textContent = text;
      if (cls) e.className = cls;
      return e;
    };
    const button = (text: string, fn: () => void, cls?: string) => {
      const b = h('button', text, cls) as HTMLButtonElement;
      b.addEventListener('click', fn);
      return b;
    };
    el.append(h('h2', 'Settings'));

    const saved = this.host.saved();
    const game = h('div', undefined, 'row');
    if (saved) game.append(h('span', `${describeSnapshot(saved)} (saved ${savedWhen(saved)})`));
    else game.append(h('span', 'No saved game.'));
    const saveNow = button('Save now', () => this.host.saveGame(), 'primary') as HTMLButtonElement;
    saveNow.disabled = !this.host.canSave();
    game.append(saveNow);
    if (saved) {
      game.append(
        button('Load', () => {
          if (confirm(`Load your saved game (${describeSnapshot(saved)})? Play since then is lost.`)) this.host.loadGame();
        }),
        button('Delete', () => {
          if (confirm('Delete your saved game?')) this.host.deleteGame();
        }),
      );
    }
    el.append(h('h3', 'Saved game'), game);
    const triangle = s.keys.TRIANGLE[0];
    el.append(h('p', `To save: pause Puzzle Mode (Start), then press △${triangle ? ` (${keyName(triangle)})` : ''}. One save; saving again replaces it.`, 'note'));

    const controls = h('table', undefined, 'controls');
    const head = h('tr');
    head.append(h('th', 'Button'), h('th', 'Keyboard'), h('th', 'Gamepad'));
    controls.append(head);
    for (const b of BINDABLE) {
      const row = h('tr');
      const waiting = (kind: 'key' | 'pad') => this.binding?.button === b && this.binding.kind === kind;
      const keyText = waiting('key') ? 'press a key…' : s.keys[b].map(keyName).join(', ') || '—';
      const padText = waiting('pad') ? 'press a button…' : s.pad[b].map((i) => `#${i}`).join(', ') || '—';
      const kc = h('td');
      kc.append(button(keyText, () => this.startBinding(b, 'key'), waiting('key') ? 'wait' : ''));
      const pc = h('td');
      pc.append(button(padText, () => this.startBinding(b, 'pad'), waiting('pad') ? 'wait' : ''));
      row.append(h('td', LABELS[b]), kc, pc);
      controls.append(row);
    }
    el.append(h('h3', 'Controls'), controls);

    const display = h('div', undefined, 'row');
    display.append(
      button(s.scale === 'integer' ? 'Scale: whole pixels' : 'Scale: fill window', () =>
        this.change((x) => (x.scale = x.scale === 'integer' ? 'fit' : 'integer'))),
      button(s.scanlines ? 'Scanlines: on' : 'Scanlines: off', () => this.change((x) => (x.scanlines = !x.scanlines))),
      button('Fullscreen (Alt+Enter)', () => this.host.toggleFullscreen()),
    );
    el.append(h('h3', 'Display'), display);

    const sound = h('div', undefined, 'row');
    const vol = h('input') as HTMLInputElement;
    vol.type = 'range';
    vol.min = '0';
    vol.max = '100';
    vol.value = String(s.volume);
    vol.addEventListener('input', () => this.change((x) => (x.volume = Number(vol.value))));
    const volLabel = h('label', `Volume ${s.volume}%`);
    volLabel.prepend(vol);
    sound.append(volLabel);
    el.append(h('h3', 'Sound'), sound);

    const card = h('div', undefined, 'row');
    const file = h('input') as HTMLInputElement;
    file.type = 'file';
    file.accept = '.mcd,.mcr,.gme';
    file.hidden = true;
    file.addEventListener('change', async () => {
      const f = file.files?.[0];
      if (!f) return;
      try {
        this.host.setCard(parseCardFile(new Uint8Array(await f.arrayBuffer())));
        this.cardNote = `Card 1 replaced by ${f.name}.`;
      } catch (e) {
        this.cardNote = `${f.name}: ${e instanceof Error ? e.message : String(e)}`;
      }
      this.render();
    });
    card.append(
      button('Export (.mcd)', () => {
        const image = this.host.card();
        if (!image) return;
        const a = h('a') as HTMLAnchorElement;
        a.href = URL.createObjectURL(new Blob([new Uint8Array(image)], { type: 'application/octet-stream' }));
        a.download = 'tetris-plus-card1.mcd';
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      }),
      button('Import…', () => file.click()),
      button('Erase', () => {
        if (!confirm('Erase memory card 1? Saved progress, records and options are lost.')) return;
        this.host.setCard(formattedCard());
        this.cardNote = 'Card 1 erased.';
        this.render();
      }),
      file,
    );
    el.append(h('h3', 'Memory card 1'), card);
    if (this.cardNote) el.append(h('p', this.cardNote, 'note'));

    const other = h('div', undefined, 'row');
    other.append(
      button(s.pauseOnBlur ? 'Pause when in background: on' : 'Pause when in background: off', () =>
        this.change((x) => (x.pauseOnBlur = !x.pauseOnBlur))),
      button(s.logo ? 'Logo video at start: on' : 'Logo video at start: off', () => this.change((x) => (x.logo = !x.logo))),
    );
    el.append(h('h3', 'Other'), other);

    const foot = h('div', undefined, 'row');
    foot.append(
      button('Reset to defaults', () => this.change((x) => Object.assign(x, structuredClone(DEFAULTS)))),
      button('Back to the game (Esc)', () => this.host.close(), 'primary'),
    );
    el.append(foot);
    el.append(h('p', 'The game\'s own settings (turn buttons, sound, music) are in its Option mode.', 'note'));
  }
}
