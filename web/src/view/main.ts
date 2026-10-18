// A preview of the port in the browser: the core and the renderer at the original's frame
// rate, with keyboard input on pad 1. The real shell (menus, settings, gamepad, persistence,
// audio) is Phase 9; this page is for looking at the renderer.
import { readPack } from '../assets/pack';
import { Game } from '../core/game';
import { Renderer } from '../render/renderer';
import { toRgba } from '../render/present';

/** NTSC progressive refresh (docs/RESEARCH_AND_PLAN.md §6). */
const TICK_MS = 1000 / 59.826;

const KEYS: Record<string, number> = {
  ArrowUp: 0x1000,
  ArrowRight: 0x2000,
  ArrowDown: 0x4000,
  ArrowLeft: 0x8000,
  KeyX: 0x0040, // Cross
  KeyZ: 0x0020, // Circle
  KeyA: 0x0080, // Square
  KeyS: 0x0010, // Triangle
  Enter: 0x0800, // Start
  ShiftLeft: 0x0100, // Select
  ShiftRight: 0x0100,
};

async function main() {
  const canvas = document.getElementById('screen') as HTMLCanvasElement;
  const status = document.getElementById('status') as HTMLElement;
  const ctx = canvas.getContext('2d')!;
  const pack = new Uint8Array(await (await fetch('assets/pazlee.pack')).arrayBuffer());
  const renderer = new Renderer(readPack(pack));
  renderer.hidePlayer2 = true;
  // The frame counter and BIOS seed the corpus runs start with (docs/re/oracle-harness.md §2).
  const game = new Game({ counter: 1000, seed: 0x4327d505 });
  const image = ctx.createImageData(320, 240);

  let pad = 0;
  addEventListener('keydown', (e) => {
    if (e.code in KEYS) {
      pad |= KEYS[e.code];
      e.preventDefault();
    }
  });
  addEventListener('keyup', (e) => {
    if (e.code in KEYS) pad &= ~KEYS[e.code];
  });

  let last = performance.now();
  let acc = 0;
  let buffer = -1;
  const frame = (now: number) => {
    acc = Math.min(acc + now - last, 250);
    last = now;
    while (acc >= TICK_MS && !game.exited) {
      game.step(pad & 0xffff); // pad 2 stays released until two-player mode exists
      buffer = renderer.frame(game).buffer;
      acc -= TICK_MS;
    }
    if (buffer >= 0) {
      image.data.set(toRgba(renderer.pixels(buffer)));
      ctx.putImageData(image, 0, 0);
    }
    if (game.exited) status.textContent = 'Puzzle Mode has exited (reload to start again).';
    else requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

main().catch((e) => {
  document.getElementById('status')!.textContent = String(e);
  throw e;
});
