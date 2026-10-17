# Password codec

Evidence: S (encode `0x800B401C` and display `0x800B3F28`; entry `0x800B362C`/`0x800B37C4`,
decode `0x800B3AD8`, scramble `0x800B41E0`). The reference implementation is
`re/tools/tp_password.py`; `selftest` round-trips every state and lists every accepted password
(`docs/spec/data/passwords.json`, 1,601 of them).

## 1. What a password holds

| Bits | Field |
|---|---|
| 0–4 | `zones_cleared` (bit z = zone z cleared) |
| 5–7 | `zone` (0–4) |
| 8–13 | `stage % 20` |
| 14–17 | checksum: the number of 1 bits in bits 0–13 |

Score, best times and continues are not stored. When `zones_cleared == 0x1F`, zone and stage are
left as 0 (the password starts 100-stage mode, [stages.md](stages.md) §5).

## 2. Encoding

```
v = zones_cleared
if zones_cleared != 0x1F: v |= zone << 5 | (stage % 20) << 8
v |= popcount(v & 0x3FFF) << 14
v ^= 0x2AAA                                   # scrambles bits 1, 3, 5, ..., 13
symbols[k] = (v >> (3 * (5 - k))) & 7  for k = 0..5, shown left to right
```

Symbol `s` is drawn with data-file image `0x103C0 + s`, except **7, which is drawn as a blank**.

Example: a new game at Egypt stage 1 (0, 0, 0) is `0 2 5 2 5 2`; stage 2 is `0 6 5 6 5 2`.

## 3. Entry and decoding

The entry screen (menu step 3) starts with six symbols at 0. Up (−1) and Down (+1) change the
selected symbol, wrapping 0 ↔ 7; Left/Right move the cursor, wrapping 0 ↔ 5 (both sound 3).
They step on the first held frame and auto-repeat every 4 frames after 20 frames held
(`0x800B552C`). Cross submits; Circle goes back to the menu.

```
v = symbols[0] << 15 | ... | symbols[5]
v ^= 0x2AAA
reject unless (v >> 14) & 0xF == popcount(v & 0x3FFF)
zones_cleared = v & 0x1F; zone = (v >> 5) & 7; stage = (v >> 8) & 0x3F
reject unless zone < 5 and stage < 20
reject if zones_cleared has bit 4 (the last zone) but isn't 0x1F
reject if zones_cleared == 0x1F and (zone, stage) != (0, 0)
```

On success: `zones_cleared`, `zone` and `stage` are set, `score = 0`, a block of per-game
counters (`0x800EE738`, `0x800EEA4C`…) is cleared, sound 0, and the player goes to screen 3 (stage
setup). With `0x1F`, 100-stage mode is switched on (`0x800EE340 = 0x800EE38C = 1`).

On failure: an error sprite for 120 frames (any face button dismisses it), then back to entry
with the same symbols.

The rule on bit 4 means you can't load a game where the last zone is cleared but others are
not; the game never produces one, since the last zone opens only after zones 0–3.
