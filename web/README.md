# web

The TypeScript version of Tetris Plus's Puzzle Mode.

- `src/core/`: the game logic, ported from PAZLE.EXE and checked against the original tick for
  tick (`docs/re/core-port.md`). No DOM; `new Game({ counter, seed })`, then
  `game.step(padWord)` once per frame.
- `src/render/`: the renderer: a model of the GPU and VRAM, libgs's packet builders and a port
  of `objects_draw`; `new Renderer(items).frame(game)` after each step (`docs/re/renderer.md`).
- `src/assets/`: the data-file and TIM decoders; `public/assets/pazlee.pack` holds Puzzle Mode's
  images (written by `tools/extract-assets.ts`).
- `src/view/`, `index.html`: the browser preview (`npm run dev`).
- `test/`: golden-trace equality over the movie corpus (`re/movies/`, `re/traces/`), frame
  equality (GPU packets and pixels) over the same corpus, and function-level equality with the
  original routines (`test/fixtures/unicorn/`).
- `tools/`: movie and trace readers, `trace-check.ts` (compare with the original's traces) and
  `simulate.ts` (play a movie on the core and print what happens).

```
npm install
npm test             # golden traces, frames, Unicorn fixtures
npm run trace        # per-movie report, first difference with context (--render: frames too)
npm run typecheck
npm run dev          # the browser preview
```

Audio and the shell (Phases 8-9) come next.
