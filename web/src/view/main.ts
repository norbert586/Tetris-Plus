// The shell around the port (docs/re/shell.md): the core, the renderer and the sound at the
// original's frame rate; keyboard and gamepads on pad 1; the memory cards and the shell's
// settings kept in the browser; fullscreen, scaling and an optional CRT look. Esc opens the
// settings and pauses; leaving the tab pauses too. Sound starts with the first key press
// (browsers need a gesture).
import { readPack } from '../assets/pack';
import { AudioPlayer } from '../audio/player';
import * as A from '../core/addr';
import { CardSlots, MemoryCard, powerOnLoad } from '../core/card';
import { Game, NotPorted } from '../core/game';
import { Machine } from '../core/machine';
import { PROGRAM_ART } from '../render/programs';
import { Renderer } from '../render/renderer';
import { toRgba } from '../render/present';
import { BUTTON_ORDER, DEFAULT_KEYS, Input, type Button } from '../shell/input';
import { loadCard, loadSettings, parseCardFile, saveCard, saveSettings, type Settings } from '../shell/storage';

/** NTSC progressive refresh (docs/RESEARCH_AND_PLAN.md §6). */
const TICK_MS = 1000 / 59.826;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

async function main() {
  const canvas = $<HTMLCanvasElement>('screen');
  const status = $('status');
  const ctx = canvas.getContext('2d')!;
  const settings = loadSettings();
  const input = new Input(settings.keys);

  // Every program's images and renderer (src/render/programs.ts).
  const renderers: Record<string, Renderer> = {};
  await Promise.all(Object.entries(PROGRAM_ART).map(async ([name, art]) => {
    const pack = new Uint8Array(await (await fetch(`assets/${art.pack}`)).arrayBuffer());
    renderers[name] = new Renderer(readPack(pack), art.style);
  }));
  renderers.PAZLE.hidePlayer2 = true;
  const cards = new CardSlots([loadCard(0), settings.card2 ? loadCard(1) : null]);
  // The frame counter and BIOS seed of a power-on route into Puzzle Mode (docs/re/oracle-harness.md §2).
  const machine = new Machine({ counter: 1000, seed: 0x4327d505, cards });
  powerOnLoad(machine.program as Game);
  const game = machine.program;
  const image = ctx.createImageData(320, 240);
  const audio = await AudioPlayer.create(game, 'assets/', TICK_MS / 1000).catch((e) => {
    console.warn('no sound:', e);
    return undefined;
  });
  if (audio) audio.volume = settings.volume;

  const stored = [cards.cards[0]?.version ?? 0, cards.cards[1]?.version ?? 0];
  const storeCards = () => {
    cards.cards.forEach((card, port) => {
      if (card && card.version !== stored[port]) {
        saveCard(port, card);
        stored[port] = card.version;
      }
    });
  };

  // ---- pausing: the settings panel, a hidden tab, a lost focus ----
  const panel = $('settings');
  let menuOpen = false;
  let focused = document.hasFocus();
  const paused = () => menuOpen || !focused || document.hidden;
  const updatePause = () => {
    if (paused()) {
      input.clear();
      void audio?.ctx.suspend();
    } else if (started) {
      audio?.resume();
    }
    status.textContent = menuOpen ? '' : paused() ? 'Paused (click to resume)' : HELP;
  };
  let started = false;
  addEventListener('blur', () => {
    focused = false;
    updatePause();
  });
  addEventListener('focus', () => {
    focused = true;
    updatePause();
  });
  document.addEventListener('visibilitychange', updatePause);

  const setMenu = (open: boolean) => {
    menuOpen = open;
    panel.hidden = !open;
    if (open) renderSettings();
    updatePause();
  };

  // ---- keys ----
  let binding: Button | null = null;
  addEventListener('keydown', (e) => {
    if (binding) {
      e.preventDefault();
      if (e.code !== 'Escape') input.bind(e.code, binding);
      binding = null;
      settings.keys = input.keys;
      saveSettings(settings);
      renderSettings();
      return;
    }
    if (e.code === 'Escape') {
      setMenu(!menuOpen);
      e.preventDefault();
      return;
    }
    if (e.code === 'F11' || (e.code === 'KeyF' && !(e.code in input.keys))) {
      toggleFullscreen();
      e.preventDefault();
      return;
    }
    if (!started) {
      started = true;
      updatePause();
    }
    if (!menuOpen && input.key(e.code, true)) e.preventDefault();
  });
  addEventListener('keyup', (e) => {
    input.key(e.code, false);
  });
  addEventListener('pointerdown', () => {
    if (!started) {
      started = true;
      updatePause();
    }
  });
  canvas.addEventListener('dblclick', () => toggleFullscreen());

  function toggleFullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void $('stage').requestFullscreen?.();
  }

  // ---- display ----
  const layout = () => {
    const stage = $('stage');
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    let k = Math.min(w / 320, h / 240);
    if (settings.scale === 'integer' && k >= 1) k = Math.floor(k);
    canvas.style.width = `${Math.round(320 * k)}px`;
    canvas.style.height = `${Math.round(240 * k)}px`;
    $('crt').hidden = !settings.crt;
    $('crt').style.width = canvas.style.width;
    $('crt').style.height = canvas.style.height;
    $('crt').style.backgroundSize = `100% ${Math.max(2, Math.round(k))}px`;
  };
  addEventListener('resize', layout);
  document.addEventListener('fullscreenchange', layout);
  layout();

  // ---- the settings panel ----
  function renderSettings() {
    const rows = BUTTON_ORDER.map((b) => {
      const keys = input.keysFor(b).map((k) => k.replace(/^Key|^Digit/, '')).join(', ') || '—';
      return `<tr><td>${b}</td><td><button data-bind="${b}">${binding === b ? 'press a key…' : keys}</button></td></tr>`;
    }).join('');
    $('keys').innerHTML = rows;
    for (const el of $('keys').querySelectorAll<HTMLButtonElement>('button[data-bind]')) {
      el.onclick = () => {
        binding = el.dataset.bind as Button;
        renderSettings();
      };
    }
    $<HTMLInputElement>('volume').value = String(settings.volume);
    $<HTMLSelectElement>('scale').value = settings.scale;
    $<HTMLInputElement>('crt-on').checked = settings.crt;
    $<HTMLInputElement>('card2').checked = settings.card2;
  }
  const apply = () => {
    settings.volume = Number($<HTMLInputElement>('volume').value);
    settings.scale = $<HTMLSelectElement>('scale').value as Settings['scale'];
    settings.crt = $<HTMLInputElement>('crt-on').checked;
    const card2 = $<HTMLInputElement>('card2').checked;
    if (card2 !== settings.card2) {
      settings.card2 = card2;
      // Plugging a card in raises its new-card flag, as a real card does.
      cards.cards[1] = card2 ? new MemoryCard(loadCard(1).data, true) : null;
      stored[1] = cards.cards[1]?.version ?? 0;
    }
    if (audio) audio.volume = settings.volume;
    saveSettings(settings);
    layout();
  };
  for (const id of ['volume', 'scale', 'crt-on', 'card2']) $(id).addEventListener('input', apply);
  $('close').onclick = () => setMenu(false);
  $('fullscreen').onclick = () => toggleFullscreen();
  $('keys-reset').onclick = () => {
    input.keys = { ...DEFAULT_KEYS };
    settings.keys = input.keys;
    saveSettings(settings);
    renderSettings();
  };
  $('card-export').onclick = () => {
    const card = cards.cards[0];
    if (!card) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([card.data.slice()], { type: 'application/octet-stream' }));
    a.download = 'tetris-plus-card1.mcd';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  $('card-import').onclick = () => $<HTMLInputElement>('card-file').click();
  $<HTMLInputElement>('card-file').onchange = async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      const card = parseCardFile(new Uint8Array(await file.arrayBuffer()));
      card.fresh = true; // a card swapped in
      cards.cards[0] = card;
      saveCard(0, card);
      stored[0] = card.version;
      $('card-msg').textContent = `Loaded ${file.name}. Continue in the menu reads it.`;
    } catch (err) {
      $('card-msg').textContent = String((err as Error).message);
    }
  };
  $('card-format').onclick = () => {
    if (!confirm('Erase the memory card in port 1? Saved games, best times and options on it are lost.')) return;
    const card = new MemoryCard(undefined, true);
    cards.cards[0] = card;
    saveCard(0, card);
    stored[0] = card.version;
    $('card-msg').textContent = 'The card in port 1 is blank.';
  };

  // ---- the loop: fixed steps at 59.826 Hz, input read just before each tick ----
  let last = performance.now();
  let acc = 0;
  let hold = 0; // ms the picture holds after a VSync(n) wait
  let buffer = -1;
  let renderer = renderers.PAZLE;
  // The next program, as the boot program would load it; one not ported yet (the title, the
  // mode select...) gives way to Puzzle Mode for now.
  const toPuzzleMode = () => {
    machine.m.w32(A.NEXT_PROGRAM, 10);
    machine.m.w32(A.PHASE, 0);
    machine.next();
  };
  const advance = () => {
    try {
      machine.next();
    } catch (e) {
      if (!(e instanceof NotPorted)) throw e;
      toPuzzleMode();
    }
  };
  const frame = (now: number) => {
    const dt = now - last;
    last = now;
    if (!paused()) {
      acc = Math.min(acc + dt, 250);
      while (acc >= TICK_MS) {
        acc -= TICK_MS;
        if (hold > 0) {
          hold -= TICK_MS;
          continue;
        }
        if (machine.program.exited) advance();
        let prog = machine.program;
        try {
          prog.step(input.word()); // pad 2 stays released until two-player mode exists
        } catch (e) {
          if (!(e instanceof NotPorted)) throw e;
          toPuzzleMode();
          prog = machine.program;
          prog.step(input.word());
        }
        renderer = renderers[prog.name];
        buffer = renderer.frame(prog).buffer;
        audio?.tick(prog);
        hold = prog.stall * TICK_MS;
        storeCards();
      }
    }
    if (buffer >= 0) {
      image.data.set(toRgba(renderer.pixels(buffer)));
      ctx.putImageData(image, 0, 0);
    }
    requestAnimationFrame(frame);
  };
  updatePause();
  requestAnimationFrame(frame);
}

const HELP = 'Arrows move · X Cross · Z Circle · A Square · S Triangle · Enter Start · Right Shift Select · Esc settings';

main().catch((e) => {
  document.getElementById('status')!.textContent = String(e);
  throw e;
});
