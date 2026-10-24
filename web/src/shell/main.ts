// The shell (docs/re/shell.md): the whole game from power-on in the browser. A click or key
// starts it (browsers allow sound and fullscreen only after a gesture), the Jaleco logo plays as
// video (the original's JLOGO.EXE plays it with the MDEC), then the Console runs the programs
// from SW_ON on at the original's frame rate, one tick per 1/59.826 s whatever the display's
// refresh rate. Escape opens the settings; the game pauses when the window loses focus.
// Saving (src/flow/snapshot.ts): on Puzzle Mode's pause screen, Triangle saves the game; the
// start screen offers to carry on from the save, and the settings panel loads or deletes it.
// The records (best times, rankings) go to memory card 1 whenever they change (flow/records.ts),
// and the mode select's Stats tile opens the Stats page (stats.ts).
import { readPack } from '../assets/pack';
import { AudioPlayer } from '../audio/player';
import { Console } from '../flow/console';
import { LocalStorageBackend, MemoryCards } from '../flow/memcard';
import type { Program, ProgramName, ProgramRenderer } from '../flow/program';
import { FACTORIES, PROGRAMS } from '../flow/registry';
import { cardRecords, mergeRecords, ramRecords, readRecords, RECORDS, sameRecords, storeRecords } from '../flow/records';
import { canSave, describeSnapshot, takeSnapshot, type Snapshot } from '../flow/snapshot';
import { toRgba } from '../render/present';
import { Input } from './input';
import { keyName, SettingsPanel } from './panel';
import { deleteSave, loadSave, savedWhen, storeSave } from './saves';
import { BUTTON_BITS, loadSettings, type Settings } from './settings';
import { PlayTime, StatsPanel } from './stats';

/** NTSC progressive refresh (docs/RESEARCH_AND_PLAN.md §6). */
const TICK_MS = 1000 / 59.826;
/** At most this much catch-up after a stall (a background tab, a slow frame). */
const MAX_BEHIND_MS = 250;
/** How long a note ("Game saved") stays up. */
const NOTE_MS = 2500;

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
  private readonly gate = document.getElementById('gate') as HTMLElement;
  private readonly hint = document.getElementById('hint') as HTMLElement;
  private hintText = '';
  private note?: { text: string; until: number };
  /** The saved game, if any (saves.ts). */
  private saved?: Snapshot;
  /** A gamepad button pressed on the start screen, acted on when it is released. */
  private gateButton?: number;
  /** The last tick's pad word (for fresh presses: Triangle, the Stats page). */
  private lastPad = 0;
  private readonly stats = new StatsPanel(() => this.closeStats());
  private readonly playTime = new PlayTime();
  /** The records in RAM as last seen (written to the card when they change); none during SW_ON. */
  private recordsSeen?: Uint8Array;
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
      card: () => this.console?.shared.cards?.image(0) ?? new LocalStorageBackend().load(0),
      setCard: (image) => this.setCard(image),
      saved: () => this.saved,
      canSave: () => this.console !== undefined && canSave(this.console),
      saveGame: () => this.save(),
      loadGame: () => {
        if (!this.saved) return;
        // From the panel over a paused game, or over one that stopped on an error.
        this.resumeGame(this.saved);
        this.panel.hide();
        this.say('');
        this.run();
      },
      deleteGame: () => this.deleteSaved(),
    });
    this.input.onKey = (code, e) => this.hotkey(code, e);
    this.apply(this.settings);
    addEventListener('resize', () => this.layout());
    document.addEventListener('fullscreenchange', () => this.layout());
    const background = () => {
      if (this.settings.pauseOnBlur && this.mode === 'run') this.pause();
    };
    addEventListener('blur', background);
    addEventListener('pagehide', () => this.playTime.save());
    document.addEventListener('visibilitychange', () => document.hidden && background());
    this.screen.addEventListener('dblclick', () => this.toggleFullscreen());
    // With a save, the start screen's buttons choose (a click elsewhere doesn't start).
    addEventListener('pointerdown', () => {
      if (!(this.mode === 'gate' && this.saved)) this.gesture();
    });
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
    this.saved = await loadSave().catch((e) => {
      console.warn('no saved game:', e);
      return undefined;
    });
    this.showGate();
    // Gamepads can't start the game by themselves (no user gesture for sound), but a press
    // while the page has focus counts once a key or click has been seen; poll for it here.
    // With a save, the button decides when it is released (so the game doesn't see it held):
    // Start or Cross carries on, Select starts a new game.
    const poll = () => {
      if (this.mode !== 'gate') return;
      const i = Input.padButton();
      if (!this.saved) {
        if (i !== undefined) this.gesture();
      } else if (i !== undefined) {
        this.gateButton ??= i;
      } else if (this.gateButton !== undefined) {
        const b = this.gateButton;
        this.gateButton = undefined;
        const pad = this.settings.pad;
        if (pad.START.includes(b) || pad.CROSS.includes(b)) this.gesture('continue');
        else if (pad.SELECT.includes(b)) this.gesture('new');
      }
      requestAnimationFrame(poll);
    };
    requestAnimationFrame(poll);
  }

  /** The start screen: "click to start", or a choice between the saved game and a new one. */
  private showGate(): void {
    const s = this.saved;
    this.gate.replaceChildren();
    if (!s) {
      this.gate.hidden = true;
      this.say('Click or press any key to start.');
      return;
    }
    this.say('');
    const h = (tag: string, text: string, cls?: string) => {
      const e = document.createElement(tag);
      e.textContent = text;
      if (cls) e.className = cls;
      return e;
    };
    const button = (text: string, fn: () => void, cls?: string) => {
      const b = h('button', text, cls);
      b.addEventListener('click', fn);
      return b;
    };
    const row = h('div', '', 'row');
    row.append(button('Continue', () => this.gesture('continue'), 'primary'), button('New game', () => this.gesture('new')));
    this.gate.append(
      h('div', `Saved game: ${describeSnapshot(s)}`, 'title'),
      h('div', `Saved ${savedWhen(s)}`, 'note'),
      row,
      h('div', 'Enter or Start: continue · N or Select: new game', 'note'),
    );
    this.gate.hidden = false;
  }

  /**
   * Replaces the card in slot 1. While the game runs it is a card swap (the programs see a new
   * card at their next check, as on the console); before power-on it is just what is stored.
   */
  private setCard(image: Uint8Array): void {
    const cards = this.console?.shared.cards;
    if (cards) cards.insert(0, image);
    else new LocalStorageBackend().save(0, image);
  }

  private say(text: string): void {
    this.message.textContent = text;
    this.message.hidden = text === '';
  }

  /**
   * The first click or key: start sound, then the logo or the game; or, from the start screen's
   * choice, the saved game.
   */
  private gesture(choice: 'new' | 'continue' = 'new'): void {
    if (this.mode !== 'gate') {
      if (this.mode === 'paused') this.resume();
      return;
    }
    this.mode = 'logo';
    this.say('');
    this.gate.hidden = true;
    void this.startAudio();
    if (choice === 'continue' && this.saved) {
      this.resumeGame(this.saved);
      this.run();
    } else if (this.settings.logo) this.playLogo();
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
    this.console = new Console(FACTORIES, {
      first: first && PROGRAMS[first] ? first : undefined,
      // The memory card in slot 1 is kept in the browser (docs/re/memcard.md); slot 2 is empty.
      cards: new MemoryCards(new LocalStorageBackend()),
      // The mode select shows Puzzle, Option and Stats; games are saved on the pause screen.
      browserMenu: true,
      browserSaving: true,
    });
    this.recordsSeen = undefined;
    this.run();
  }

  /** Starts the frame loop (none runs while not in 'run'). */
  private run(): void {
    this.audio?.resume();
    this.mode = 'run';
    this.last = performance.now();
    this.acc = 0;
    this.lastPad = 0;
    requestAnimationFrame((t) => this.frame(t));
  }

  /** Carries on from a saved game: the game as it was on its pause screen, and that frame shown. */
  private resumeGame(s: Snapshot): void {
    this.console = new Console(FACTORIES, {
      ram: s.ram,
      seed: s.seed,
      resume: { program: s.program, tick: s.tick },
      cards: new MemoryCards(new LocalStorageBackend()),
      browserMenu: true,
      browserSaving: true,
    });
    // The save's RAM has the records of its moment: the card's may be better since.
    const c = this.console;
    const card = cardRecords(c.shared.cards!);
    if (card) c.m.bytes.set(mergeRecords(card, ramRecords(c.m)), RECORDS & 0x1fffff);
    this.recordsSeen = ramRecords(c.m);
    this.stats.hide();
    this.newRenderer(this.console.program);
    this.renderer!.vram!.set(s.vram);
    // The frame on screen when it was saved (Puzzle Mode draws tick t into buffer t & 1).
    this.buffer = s.tick & 1;
    this.showFrame();
    // The game's music stopped when it paused; unpausing starts it again.
    this.audio?.reset();
    this.lastPad = 0;
    this.notify(`Loaded: ${describeSnapshot(s)}`);
  }

  /** Saves the game (on Puzzle Mode's pause screen), in place of the last save. */
  private save(): void {
    const c = this.console;
    if (!c || !canSave(c) || !this.renderer?.vram) return;
    const s = takeSnapshot(c, this.renderer.vram);
    this.notify('Saving…');
    storeSave(s).then(
      () => {
        this.saved = s;
        this.notify(`Game saved: ${describeSnapshot(s)}`);
        this.panel.refresh();
      },
      (e) => this.notify(`Could not save: ${e instanceof Error ? e.message : String(e)}`, 6000),
    );
  }

  private deleteSaved(): void {
    deleteSave().then(
      () => {
        this.saved = undefined;
        this.panel.refresh();
      },
      (e) => console.warn('could not delete the save:', e),
    );
  }

  /** A short note over the game ("Game saved"). */
  private notify(text: string, ms = NOTE_MS): void {
    this.note = { text, until: performance.now() + ms };
    this.updateHint();
    setTimeout(() => this.updateHint(), ms + 50);
  }

  /** The note, or on Puzzle Mode's pause screen how to save. */
  private updateHint(): void {
    let text = '';
    if (this.note && performance.now() < this.note.until) text = this.note.text;
    else if (this.mode === 'run' && this.console && canSave(this.console)) {
      const key = this.settings.keys.TRIANGLE[0];
      text = `Press △${key ? ` (${keyName(key)})` : ''} to save your game`;
    }
    if (text === this.hintText) return;
    this.hintText = text;
    this.hint.textContent = text;
    this.hint.hidden = text === '';
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
        const read = this.input.read();
        const pressed = read & ~this.lastPad;
        this.lastPad = read;
        // While the Stats page is open the game sees no buttons (the mode select waits for it).
        if (this.stats.open) this.stats.pad(pressed);
        const pad = this.stats.open ? 0 : read;
        // Triangle on Puzzle Mode's pause screen saves (the game itself ignores it there).
        if (pad & pressed & BUTTON_BITS.TRIANGLE && canSave(c)) this.save();
        c.step(pad);
        const p = c.program;
        this.playTime.tick(p.name);
        this.watchRecords(c);
        if (c.shared.statsOpen && !this.stats.open) this.openStats(c);
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
    this.showFrame();
    this.updateHint();
    requestAnimationFrame((t) => this.frame(t));
  }

  /** Writes the records to card 1 when they change (not during SW_ON, which loads them). */
  private watchRecords(c: Console): void {
    if (c.program.name === 'SW_ON') {
      this.recordsSeen = undefined;
      return;
    }
    if (!this.recordsSeen) {
      this.recordsSeen = ramRecords(c.m);
      return;
    }
    if (sameRecords(c.m, this.recordsSeen)) return;
    this.recordsSeen = ramRecords(c.m);
    const r = storeRecords(c.shared.cards!, c.m);
    if (r === 'failed' || r === 'damaged') console.warn(`records not written to card 1: ${r}`);
  }

  /** The Stats page: the card's records with the game's, and the time played. */
  private openStats(c: Console): void {
    const cards = c.shared.cards!;
    const card = cardRecords(cards);
    this.playTime.save();
    this.stats.show(readRecords(card ? mergeRecords(card, ramRecords(c.m)) : ramRecords(c.m)), this.playTime, cards.image(0) !== null);
  }

  private closeStats(): void {
    this.stats.hide();
    if (this.console) this.console.shared.statsOpen = false;
  }

  private showFrame(): void {
    if (this.buffer < 0 || !this.renderer) return;
    this.image.data.set(toRgba(this.renderer.pixels(this.buffer)));
    this.ctx.putImageData(this.image, 0, 0);
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
    this.updateHint();
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
    this.updateHint();
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
    if (code === 'Escape' && this.stats.open) {
      this.closeStats();
      return true;
    }
    if (code === 'Escape' && this.mode !== 'gate' && this.mode !== 'logo') {
      this.openSettings();
      return true;
    }
    if (this.mode === 'gate' && this.saved) {
      if (code === 'Enter' || code === 'NumpadEnter') this.gesture('continue');
      else if (code === 'KeyN') this.gesture('new');
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
