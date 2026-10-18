// The shell (docs/re/shell.md): the whole game from power-on in the browser. A click or key
// starts it (browsers allow sound and fullscreen only after a gesture), the Jaleco logo plays as
// video (the original's JLOGO.EXE plays it with the MDEC), then the Console runs the programs
// from SW_ON on at the original's frame rate, one tick per 1/59.826 s whatever the display's
// refresh rate. Escape opens the settings; the game pauses when the window loses focus.
import { readPack } from '../assets/pack';
import { AudioPlayer } from '../audio/player';
import { Console } from '../flow/console';
import { LocalStorageBackend, MemoryCards } from '../flow/memcard';
import type { Program, ProgramName, ProgramRenderer } from '../flow/program';
import { PROGRAMS } from '../flow/registry';
import { toRgba } from '../render/present';
import { Input } from './input';
import { SettingsPanel } from './panel';
import { loadSettings, type Settings } from './settings';

/** NTSC progressive refresh (docs/RESEARCH_AND_PLAN.md §6). */
const TICK_MS = 1000 / 59.826;
/** At most this much catch-up after a stall (a background tab, a slow frame). */
const MAX_BEHIND_MS = 250;

type Mode = 'gate' | 'logo' | 'run' | 'paused' | 'settings' | 'stopped';

class Shell {
  settings: Settings = loadSettings();
  readonly input = new Input(this.settings);
  private readonly panel: SettingsPanel;
  private readonly screen = document.getElementById('screen') as HTMLElement;
  private readonly canvas = document.getElementById('canvas') as HTMLCanvasElement;
  private readonly ctx = this.canvas.getContext('2d')!;
  private readonly image = this.ctx.createImageData(320, 240);
  private readonly message = document.getElementById('message') as HTMLElement;
  private readonly video = document.getElementById('logo') as HTMLVideoElement;
  private packs = new Map<string, Uint8Array[]>();
  private console?: Console;
  private renderer?: ProgramRenderer;
  private rendererFor?: Program;
  private audio?: AudioPlayer;
  private mode: Mode = 'gate';
  private last = 0;
  private acc = 0;
  private buffer = -1;

  constructor() {
    this.panel = new SettingsPanel({
      settings: this.settings,
      input: this.input,
      apply: (s) => this.apply(s),
      toggleFullscreen: () => this.toggleFullscreen(),
      close: () => this.closeSettings(),
    });
    this.input.onKey = (code, e) => this.hotkey(code, e);
    this.apply(this.settings);
    addEventListener('resize', () => this.layout());
    document.addEventListener('fullscreenchange', () => this.layout());
    const background = () => {
      if (this.settings.pauseOnBlur && this.mode === 'run') this.pause();
    };
    addEventListener('blur', background);
    document.addEventListener('visibilitychange', () => document.hidden && background());
    this.screen.addEventListener('dblclick', () => this.toggleFullscreen());
    addEventListener('pointerdown', () => this.gesture());
    addEventListener('gamepadconnected', () => {
      if (this.mode === 'gate') this.say('Gamepad connected. Press any button to start.');
    });
  }

  async load(): Promise<void> {
    this.say('Loading…');
    const names = [...new Set(Object.values(PROGRAMS).map((p) => p.pack))];
    await Promise.all(
      names.map(async (name) => {
        const res = await fetch(`assets/${name}`);
        if (!res.ok) throw new Error(`assets/${name}: ${res.status}`);
        this.packs.set(name, readPack(new Uint8Array(await res.arrayBuffer())));
      }),
    );
    this.say('Click or press any key to start.');
    // Gamepads can't start the game by themselves (no user gesture for sound), but a press
    // while the page has focus counts once a key or click has been seen; poll for it here.
    const poll = () => {
      if (this.mode !== 'gate') return;
      if (Input.padButton() !== undefined) this.gesture();
      else requestAnimationFrame(poll);
    };
    requestAnimationFrame(poll);
  }

  private say(text: string): void {
    this.message.textContent = text;
    this.message.hidden = text === '';
  }

  /** The first click or key: start sound, then the logo or the game. */
  private gesture(): void {
    if (this.mode !== 'gate') {
      if (this.mode === 'paused') this.resume();
      return;
    }
    this.mode = 'logo';
    this.say('');
    void this.startAudio();
    if (this.settings.logo) this.playLogo();
    else this.powerOn();
  }

  private playLogo(): void {
    const v = this.video;
    v.hidden = false;
    v.volume = this.settings.volume / 100;
    const done = () => {
      v.onended = v.onerror = null;
      v.pause();
      v.hidden = true;
      if (this.mode === 'logo') this.powerOn();
    };
    v.onended = done;
    v.onerror = done;
    v.play().catch(done);
  }

  private powerOn(): void {
    // ?start=NAME starts at another program (development: the state block as at power-on).
    const first = new URLSearchParams(location.search).get('start') as ProgramName | null;
    this.console = new Console(Object.fromEntries(Object.entries(PROGRAMS).map(([n, p]) => [n, p.create])), {
      first: first && PROGRAMS[first] ? first : undefined,
      // The memory card in slot 1 is kept in the browser (docs/re/memcard.md); slot 2 is empty.
      cards: new MemoryCards(new LocalStorageBackend()),
    });
    this.mode = 'run';
    this.last = performance.now();
    this.acc = 0;
    requestAnimationFrame((t) => this.frame(t));
  }

  private async startAudio(): Promise<void> {
    try {
      // The player follows the running program (its sound tables are in the console's RAM).
      this.audio = await AudioPlayer.create('assets/', TICK_MS / 1000);
      this.audio.volume = this.settings.volume / 100;
      this.audio.resume();
    } catch (e) {
      console.warn('no sound:', e);
    }
  }

  private frame(now: number): void {
    if (this.mode !== 'run') return;
    const c = this.console!;
    this.acc = Math.min(this.acc + now - this.last, MAX_BEHIND_MS);
    this.last = now;
    try {
      while (this.acc >= TICK_MS) {
        c.step(this.input.read());
        const p = c.program;
        if (p !== this.rendererFor) this.newRenderer(p);
        this.buffer = this.renderer!.frame(p).buffer;
        // Vblanks the original spent waiting inside this tick (memory card calls, VSync(n)):
        // the picture holds and the sound plays on, so the next tick waits as long.
        const waited = this.waitedVblanks(c, p);
        this.audio?.tick(p, waited);
        this.acc -= TICK_MS * (1 + waited);
      }
    } catch (e) {
      this.stop(e);
      return;
    }
    if (this.buffer >= 0 && this.renderer) {
      this.image.data.set(toRgba(this.renderer.pixels(this.buffer)));
      this.ctx.putImageData(this.image, 0, 0);
    }
    requestAnimationFrame((t) => this.frame(t));
  }

  /**
   * The vblanks the original waited in this tick beyond its own: SW_ON counts its VSync waits
   * and card calls (`vblanks`); the others' card calls add up in the cards' counter.
   */
  private waitedVblanks(c: Console, p: Program): number {
    const cards = c.shared.cards;
    const own = (p as { vblanks?: number }).vblanks;
    const n = own ?? cards?.vblanks ?? 0;
    if (cards) cards.vblanks = 0;
    return n;
  }

  private newRenderer(p: Program): void {
    const mod = PROGRAMS[p.name as ProgramName]!;
    this.renderer = mod.renderer(this.packs.get(mod.pack)!);
    this.rendererFor = p;
  }

  private stop(e: unknown): void {
    this.mode = 'stopped';
    this.audio?.suspend();
    this.say(`The game stopped: ${e instanceof Error ? e.message : String(e)}. Reload to start again.`);
    console.error(e);
  }

  private pause(): void {
    this.mode = 'paused';
    this.audio?.suspend();
    this.input.release();
    this.say('Paused. Click or press any key to continue.');
  }

  private resume(): void {
    if (this.mode !== 'paused' && this.mode !== 'settings') return;
    this.mode = 'run';
    this.say('');
    this.audio?.resume();
    this.last = performance.now();
    this.acc = 0;
    requestAnimationFrame((t) => this.frame(t));
  }

  private openSettings(): void {
    const was = this.mode;
    if (was === 'run') this.audio?.suspend();
    this.mode = was === 'run' || was === 'paused' ? 'settings' : was;
    this.input.release();
    this.panel.show();
  }

  private closeSettings(): void {
    this.panel.hide();
    if (this.mode === 'settings') {
      this.say('');
      this.resume();
    }
  }

  /** Shell keys; true when the key was used (the game doesn't see it). */
  private hotkey(code: string, e: KeyboardEvent): boolean {
    if (this.panel.key(code)) return true;
    if (this.panel.open) return false;
    if (code === 'Enter' && e.altKey) {
      this.toggleFullscreen();
      return true;
    }
    if (code === 'Escape' && this.mode !== 'gate' && this.mode !== 'logo') {
      this.openSettings();
      return true;
    }
    if (this.mode === 'gate' || this.mode === 'paused') {
      this.gesture();
      return true;
    }
    if (this.mode === 'logo') {
      // Any key skips the logo, as the console's would-be wait does nothing interesting.
      this.video.dispatchEvent(new Event('ended'));
      return true;
    }
    return false;
  }

  apply(s: Settings): void {
    this.settings = s;
    this.input.use(s);
    if (this.audio) this.audio.volume = s.volume / 100;
    this.video.volume = s.volume / 100;
    this.screen.classList.toggle('scanlines', s.scanlines);
    this.layout();
  }

  /** Sizes the picture: 4:3, whole multiples of 320x240 pixels unless set to fill. */
  private layout(): void {
    const w = innerWidth;
    const h = innerHeight;
    let width: number;
    let height: number;
    if (this.settings.scale === 'integer' && w >= 320 && h >= 240) {
      // Whole device pixels per game pixel.
      const dev = Math.max(1, Math.floor(Math.min((w * devicePixelRatio) / 320, (h * devicePixelRatio) / 240)));
      width = (320 * dev) / devicePixelRatio;
      height = (240 * dev) / devicePixelRatio;
    } else {
      const k = Math.min(w / 320, h / 240);
      width = 320 * k;
      height = 240 * k;
    }
    this.screen.style.width = `${width}px`;
    this.screen.style.height = `${height}px`;
  }

  toggleFullscreen(): void {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.().catch(() => undefined);
  }
}

const shell = new Shell();
shell.load().catch((e) => {
  document.getElementById('message')!.textContent = `Could not load the game: ${e}`;
  throw e;
});
