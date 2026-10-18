# The memory card (Phase 9)

How the programs use the PlayStation memory card, and the browser's replacement for it:
`web/src/flow/memcard.ts` (the card), `web/src/core/card.ts` (Puzzle Mode's card routines),
the save screen in `web/src/core/screens/after.ts` (screen 13) and the menu's Continue in
`web/src/core/screens/menu.ts` (step 2). SW_ON's boot card check: [sw_on.md](sw_on.md).

## 1. The port's card (`src/flow/memcard.ts`)

The port keeps each card as the raw 128 KB image Redux and real cards use (a `.mcd`), so a card
is the same bytes whichever wrote it and can be imported or exported. The programs reach it
through the calls they make on the original, at BIOS-file level:

- libcard checks, answered with the event their TestEvent loops return (the index: IOE 0,
  ERROR 1, TIMEOUT 2, NEWCARD 3): `info(chan)`, `clear(chan)`, `load(chan)`. `chan` is 0x00 or 0x10.
- BIOS files on `bu00:` / `bu10:`: `open(path, mode)` (FREAD 1, FWRITE 2, FCREAT 0x200, blocks
  << 16; a descriptor ≥ 2 or −1), `read`, `write`, `close`, `delete`, `firstfile`/`nextfile`
  (`bu00:*`; a `DirEntry` with the size in bytes), `format`.
- `MemoryCards(backend)`: a backend loads and saves each slot's image. `MemoryBackend` (tests,
  default `[formattedCard(), null]`) and `LocalStorageBackend(storage, prefix, inserted)` (base64
  per slot; an inserted slot with nothing stored gets a formatted empty card).
- The default configuration: slot 1 = the browser's card (formatted, empty on the first run),
  slot 2 empty. The corpus movies are recorded the same way (`card 2 none`).
- `image(slot)`, `insert(slot, image)` (marks the card new), `freeBlocks(slot)`: for the shell.

Game wiring: `Shared.cards` (flow/program.ts) is created by `Console` (`ConsoleOptions.cards`,
default `new MemoryCards()`); SW_ON uses `shared.cards`; Puzzle Mode's `Game.cards` is
`shared.cards`, or `GameOptions.cards`, or a default `MemoryCards`.

### 1.1 Behaviour measured on PCSX-Redux

- A formatted card answers the first `_card_info` with IOE; an unformatted one with NEWCARD
  (the check is repeated a tick later, after `_card_clear`), and `_card_load` then answers NEWCARD.
- No card: TIMEOUT.
- `formattedCard()` is byte-identical to Redux's fresh card. The BIOS's `format` writes the same
  block 0 except frame 63: zeros with `[0x60] = 0x02`, `[0x68] = 0xFF` (checked against SW_ON's
  format in `sw_on-unformatted`).
- **The programs' card set-up rewrites frame 63.** SW_ON, SELECT and PAZLE (not TIT_DEMO, TITLE,
  RANKING or the how-to programs) run InitCARD, StartCARD and `_bu_init` when they start
  (`card_init`: SW_ON 0x800973EC, SELECT 0x8009AF68, PAZLE 0x800B5C94). On the emulator's BIOS
  (OpenBIOS) every inserted card's frame 63 then becomes a copy of frame 0 when frame 0 starts with
  "MC" (a bad checksum is copied as is), else the frame a format leaves (zeros, `[0x60] = 0x02`,
  `[0x68] = 0xFF`). Slot 2 too, though SW_ON never reads it. Measured with cards whose frame 63
  differed (a marker byte in frame 0; a broken checksum; an unformatted card), each through SW_ON
  alone (to tick 372). It shows only on a card the game formatted. Sony's BIOS was not checked
  (the documentation calls frame 63 the "write test" frame, normally a copy of frame 0).
  `MemoryCards.init()` models it; `SwOn`, `Select` and `Game` call it in their constructors.
- `.mcd` layout: frame 0 "MC" (XOR checksum at 0x7F); directory frames 1-15 (state 0xA0 free,
  0x51 first, 0x52 middle, 0x53 last block; size at +4, next block at +8, 0xFFFF none; name at
  +0x0A; XOR checksum at 0x7F); frames 16-35 the broken-sector list (FFFFFFFF, next FFFF).

### 1.2 Timing

Every card call completes inside the main-loop iteration that makes it (the programs spin on
TestEvent, the BIOS calls block): the programs only see the result and which tick it came on. The
vblanks a call costs (the trace's `vs`) are added to `MemoryCards.vblanks` for the audio and the
shell (`CARD_VBLANKS`), from the card movies' traces:

| Tick | vs |
|---|---|
| card status (VSync(90) + `_card_info` + `_card_load`) | 165 (75 without the VSync) |
| status with no card (VSync(90) + timeout) | 93 |
| `save_read` without a file (4 failed opens) | 8 |
| `save_read` with the file (open, read 8 KB, close) | 130 |
| used blocks (firstfile/nextfile) | 2-3 |
| create (FCREAT open, close, open, write 8 KB) | 140 |
| write (open, write 8 KB, close) | 132-133 |

The core's Puzzle Mode does not add its own VSync(90) calls to anything; the traces' `vs` drives
the audio in tests. **For the lead:** a live run should feed these waits to the audio (the music
keeps playing for ~2.5 s while the original saves).

## 2. The save file

`bu00:baslus-00338` (`bu10:` in slot 2), one block of 0x2000 bytes:

| Offset | Contents |
|---|---|
| 0x000 | header: magic, icon flag 0x13, block count 1; title (0x40 bytes SJIS) at +4; +0x44..0x5F zero; icon palette at +0x60, three 16×16 frames at +0x80 |
| 0x200 | copy A's checksum (XOR of its bytes) |
| 0x201 | copy A: the saved block (0x780 bytes) |
| 0x981 | copy B's checksum |
| 0x982 | copy B |

The magic should be "SC"; both programs store the low bytes of two string addresses instead:
SW_ON writes `C8 CC`, Puzzle Mode `10 14`. Reading uses copy A if its checksum holds, else copy B
(copied over A).

The saved block is `state+0x4AD84` (0x780 bytes):

| Range | Contents |
|---|---|
| [0, 0xDC) | best times, 110 shorts (9999: none) |
| [0xDC, 0x118), [0x118, 0x154) | two 0x3C tables |
| [0x154, 0x15A) | three save slots: (stage = zone × 20 + stage, 0xFF empty; zones cleared) = `state+0x4AED8` |
| [0x15A, 0x768) | 0x60E bytes |
| [0x768, 0x780) | 0x18 bytes (`state+0x4B4EC`) |

## 3. Puzzle Mode's card routines (`src/core/card.ts`)

| Address | Port | What |
|---|---|---|
| 0x800B709C / 0x800B7118 | `cardLock` / `cardUnlock` | the lock 0x800F2AC8 (bit 0x10: the file is new) |
| 0x800B6074 | `cardStatus` | 1 usable, 0 none, −1 error, 2 new card (cleared; check again), 3 unformatted |
| 0x800B61B4 | `saveRead` | 4 tries; the same `$s2` quirk as SW_ON (harmless) |
| 0x800B62E8 | `saveCreate` | FCREAT, then the header and the state block into both copies, write; 4 tries |
| 0x800B6638 | `saveWrite` | header, copy A also as B, sums, write; 4 tries |
| 0x800B6C08 | `usedBlocks` | blocks in use, rounded up |
| 0x800B6174 | `cardFormat` | `format("buX0:*")` |
| 0x800B3184 | `saveDefaults` | copy A = 9999 times, tables 0x800E2F8C, 0x800E300C, 0x800E361C |
| 0x800B7128(k) | `saveToState` | copy A → state block, section k |
| 0x800B7714(k) | `stateToSave` | state block → copy A, **not the mirror**: see below |

The two copy routines were measured in Unicorn (random memory, every k). Sections of the block:

| k | 0x800B7128 (A → state) | 0x800B7714 (state → A) |
|---|---|---|
| 0 | all | all |
| 1 | [0, 0xDC) | [0, 0x154) |
| 2 | [0xDC, 0x118) | [0xDC, 0x118) |
| 3 | [0x118, 0x154) | [0x118, 0x154) |
| 4 | [0x154, 0x15A) (the slots) | [0xDC, 0x15A) |
| 5-7 | slot k−5's 2 bytes | [0xDC, 0x154) and slot k−5's 2 bytes |
| 8 | [0x15A, 0x768) | [0xDC, 0x154) and [0x15A, 0x768) |
| 9 | [0x768, 0x780) | [0xDC, 0x154) and [0x768, 0x780) |

## 4. The save screen (screen 13, substeps of table 0x800941A8)

The option cursor 0x800F2D1C is also the card slot: 0 slot 1, 1 slot 2, 2 quit.

| Substep | What |
|---|---|
| 3 | 0/1 → 4; 2 → screen 8 |
| 4 | lock; held: "busy" (0x4D3) 120 ticks (33, 34) → 1 |
| 5 | VSync(90), status: 1 → 8; 3 → 28; 2 → again; 0/−1 → message 0x440/0x444, 120 ticks (6) → 7 |
| 7 | unlock → 1 |
| 8 | read: ok → slots into the state (k = 4) → 9; no file → 26 |
| 9 | the three save slots (`slotList`) |
| 10 | Up/Down; Circle → 7; Cross: a used slot asks to overwrite (11); a new file → 24; else "saving" → 12 |
| 11 | overwrite yes/no (cursor on no): yes → 37; no → 10 |
| 12-13 | the game into the slot, copies k = slot + 5 and 1, write; failure "error" (0x44B) → 6 |
| 14-15 | unlock, screen 8 |
| 24-25 | status again, "saving", 3 ticks, create → 13 (failure → 26) |
| 26 | used blocks < 15 → 32; else "card full" (0x448) → 6 |
| 28-31 | "format?" yes/no; yes and still unformatted: "formatting" (0x446), format → 32 |
| 32 | a new file: defaults into copy A, slots into the state (k = 4), lock bit 0x10 → 9 |
| 37 | after 2 ticks, status: "saving" → 12 |
| 16, 20-23, 35 | no path leads here (20-23 repeat 28-31) |

## 5. Continue (menu step 2, table 0x8009417C)

| Substep | What |
|---|---|
| 0 | the screen; card slot chooser (FUN_800B6DD4) on slot 1, pick −1 |
| 1 | Left/Right switch the slot, Cross → 2, Circle → the menu |
| 2 | lock (held: "busy" 120 ticks, 10 → 0) |
| 3 | VSync(90), status: 1 → 4; else message 0x440 (none) / 0x441 (unformatted) / 0x442, 120 ticks (8 → 0) |
| 4 | read: ok → slots into the state (k = 4); no file → message 0x441 (8) |
| 5-6 | the slots; Up/Down; Cross loads the slot's stage and zones; Circle copies the card's best times into the state (k = 1), unlock, menu |
| 7 | unlock; an empty slot → step 5 (new game), else step 6 (the saved stage) |

## 6. Verification

Movies (top level of `re/movies/`, so `npm test` replays them in `traces.test.ts`, with sound,
and the card-image check in `memcard.test.ts`):

| Movie | Cards | Path |
|---|---|---|
| `card-save` | blank, none | no file: defaults, slot list (Up/Down, Circle back), slot 2 with no card (message), save in slot 2: create + write |
| `card-full` | blank, `cards/full.mcd` | slot 2 full ("card full"), then save in slot 1 |
| `card-continue` | `cards/saved.mcd`, none | Continue: chooser, Circle out, in again, load slot 2; the game retired; save: overwrite yes/no |

All three are identical to the original's traces (every field, `card_*` and `save_slots`
included) with `--audio` and `--render`, and the card the port leaves equals Redux's
`memcard1.mcd` byte for byte. `re/movies/cards/` holds the cards: `saved.mcd` is the card
`card-save` left on the original; `full.mcd` comes from `web/tools/mcd.ts full`.

Replays start from the boot state of a run whose card had no save, so `test/cards.ts`
(`bootSave`) puts a movie's saved block into the state as SW_ON would have.

**Not verified on the original:** the format path (28-32) and the busy and error messages: the
puzzle boot route goes through SW_ON's card check, which stops on an unformatted card. They are
ported from the decompiled code.

**The renderer:** the slot list puts image 0 on objects (image field 0x10000). `objects_draw`
then reads the template before the first, zeros in RAM (`state+0x3F050`): a 0×0 sprite, which
still goes into the ordering table. `src/render/renderer.ts` does the same (`ZERO_TEMPLATE`).
