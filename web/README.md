# web

The TypeScript version of Tetris Plus's Puzzle Mode.

- `src/core/`: the game logic, ported from PAZLE.EXE and checked against the original tick for
  tick (`docs/re/core-port.md`). No DOM; `new Game({ counter, seed })`, then
  `game.step(padWord)` once per frame.
- `test/`: golden-trace equality over the movie corpus (`re/movies/`, `re/traces/`) and
  function-level equality with the original routines (`test/fixtures/unicorn/`).
- `tools/`: movie and trace readers, `trace-check.ts` (compare with the original's traces) and
  `simulate.ts` (play a movie on the core and print what happens).

```
npm install
npm test             # golden traces + Unicorn fixtures
npm run trace        # per-movie report, first difference with context
npm run typecheck
```

Rendering, audio and the shell (Phases 7-9) come next.
