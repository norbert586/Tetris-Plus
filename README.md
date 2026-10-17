```
          ________
         /       /|
        /_______/ |
  ______|       | |_______
 /      |       | /      /|
/_______|_______|/______/ |
|       |       |       | |
|       |       |       | /
|_______|_______|_______|/

        T E T R I S   P L U S
          puzzle mode, on the web
```

# Tetris Plus

A browser version of the Puzzle Mode from **Tetris Plus** on the PlayStation (US release,
SLUS-00338, 1996). That's the mode where you guide the professor down through the ruins by
clearing lines, while a spiked ceiling slowly comes down on him.

The goal isn't a "Tetris with a professor" remake. It's a faithful copy: same rules, same
timing, same art and music, taken from the original disc and checked against the real game
running in an emulator.

## Status

The game logic runs in TypeScript and matches the original tick for tick; there's no playable
build yet (no graphics, sound or controls).

| Phase | What | State |
|---|---|---|
| 0 | Toolchain, first look at the game | done |
| 1 | What's on the disc (files, art, music, sound) | done |
| 2 | Map the program: main loop, controls, screens | done |
| 3 | Find where the game keeps its state in memory | done |
| 4 | Write down the rules and pull out the stage data | done |
| 5 | Test harness: input movies and traces from the original | done |
| 6 | The game logic in TypeScript, checked against the original | done |
| 7–9 | Graphics, audio, menus and controls | next |
| 10 | Prove it matches, polish, put it online (private) | |

## How it works

1. Pull the files, art and music off the original disc.
2. Decompile the game's code (Ghidra, with a PS1 plugin) to read the actual rules.
3. Run the original in an emulator (PCSX-Redux) to watch what it does frame by frame.
4. Rebuild it in TypeScript, then compare the two: same inputs should give the same game.

## Where things are

- `docs/RESEARCH_AND_PLAN.md`: the full plan and what "faithful" means here
- `docs/re/`: what each phase found; `docs/spec/`: the rules, written down
- `web/`: the TypeScript game (`web/src/core/`: the logic) and its tests
- `re/`: reverse-engineering tools, symbol names and emulator scripts
- `scripts/`: setup (toolchain, fetching the disc, running the emulator)

## Notes

This repo is private. It doesn't contain the disc image, and the game's art, music and stages
belong to their owners. Tetris is a trademark of The Tetris Company.
