#!/usr/bin/env python3
"""Builds corpus movies that place pieces on purpose, by planning against the original game.

Future pieces depend on timing (every frame calls rand()), so placements can't be planned ahead.
The planner works piece by piece, in a closed loop with the emulator:

  1. Run the movie so far from a save state taken at the current piece's spawn, until the
     next piece spawns (or play ends), saving a state there (re/lua/movie.lua TP_UNTIL).
  2. Read the board, the piece and the previews from the trace; choose a placement; turn it into
     inputs (rotate, tap Left/Right, hold Down) and simulate the fall tick by tick with the
     rules in docs/spec/piece.md to predict where and when it locks.
  3. Append the inputs and repeat. Each step checks that the original locked the piece where and
     when the simulation said, so the planner doubles as a first check of the piece spec.

Scenarios are Python files in re/movies/plans/ that call plan() (docs/re/oracle-harness.md).
  tpplan.py SCENARIO.py           writes re/movies/<name>.tpm
"""
import json
import os
import runpy
import subprocess
import sys

sys.path.insert(0, os.path.dirname(__file__))
import tptrace  # noqa: E402

REPO = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..'))
PRIVATE = os.environ.get('TP_PRIVATE', os.path.join(os.path.dirname(REPO), 'tp-private'))
BITS = {'L2': 0x1, 'R2': 0x2, 'L1': 0x4, 'R1': 0x8, 'TRIANGLE': 0x10, 'CIRCLE': 0x20, 'CROSS': 0x40,
        'SQUARE': 0x80, 'SELECT': 0x100, 'START': 0x800, 'UP': 0x1000, 'RIGHT': 0x2000, 'DOWN': 0x4000,
        'LEFT': 0x8000}
NAMES = sorted(BITS, key=lambda n: BITS[n])

with open(os.path.join(REPO, 'docs', 'spec', 'data', 'pieces.json')) as f:
    _kinds = json.load(f)['kinds']
SHAPES = {int(k['kind']): [[(r, c) for r, line in enumerate(rot) for c, ch in enumerate(line) if ch == '#']
                           for rot in k['rotations']] for k in _kinds if k['rotations']}


# ----------------------------------------------------------------------------- movies

class Movie:
    """Per-tick pad words (player 1 low 16 bits, player 2 high)."""

    def __init__(self, header=''):
        self.masks = {}
        self.header = header

    def press(self, tick, buttons, hold=1, pad=1):
        mask = 0
        for name in buttons.split('+'):
            mask |= BITS[name]
        mask <<= 16 * (pad - 1)
        for t in range(tick, tick + hold):
            self.masks[t] = self.masks.get(t, 0) | mask

    def mask(self, tick):
        return self.masks.get(tick, 0)

    def text(self, end):
        """Canonical form: one line per run of identical non-zero pad words."""
        lines = ['tpm 1', 'boot puzzle', f'end {end}'] + [f'# {h}' for h in self.header.splitlines()]
        ticks = sorted(t for t, m in self.masks.items() if m)
        i = 0
        while i < len(ticks):
            t, m = ticks[i], self.masks[ticks[i]]
            j = i
            while j + 1 < len(ticks) and ticks[j + 1] == ticks[j] + 1 and self.masks[ticks[j + 1]] == m:
                j += 1
            lines.append(f'{t} {j - i + 1} {words(m)}')
            i = j + 1
        return '\n'.join(lines) + '\n'


def words(mask):
    parts = []
    for pad in (1, 2):
        m = (mask >> (16 * (pad - 1))) & 0xFFFF
        if m:
            names = '+'.join(n for n in NAMES if m & BITS[n])
            parts.append(names if pad == 1 else f'2:{names}')
    if len(parts) == 2:
        raise ValueError('one line can only press one pad')  # the format takes one pad per line
    return parts[0]


# ----------------------------------------------------------------------------- piece simulation

def collides(board, kind, rot, x, y):
    """docs/spec/piece.md §6. board: 16 strings of 10 cells, '.' empty."""
    for r, c in SHAPES[kind][rot]:
        col, row = x + c, y + r
        if col < 0 or col > 9 or row >= 16:
            return True
        if row >= 0 and board[row][col] != '.':
            return True
    return False


def simulate(board, kind, spawn, movie, limit=2000):
    """Falls a piece spawned at tick `spawn` under the movie's inputs (docs/spec/piece.md §4-§5).
    Returns (lock tick, rot, x, y) in cells, or None if it hasn't locked within `limit` ticks."""
    x, y, rot = 3, -2, 0
    dropped, gc, lc, dd, dr = False, 0, 0, 0, 0
    for t in range(spawn + 1, spawn + limit):
        held, prev = movie.mask(t) & 0xFFFF, movie.mask(t - 1) & 0xFFFF
        pressed = (prev ^ held) & held
        if dropped:
            dx, rin = 0, 0
            for b, step in ((BITS['RIGHT'], 1), (BITS['LEFT'], -1)):
                if pressed & b:
                    dx, dd, dr = step, 20, 4
                if held & b:
                    if dd:
                        dd -= 1
                    elif dr:
                        dr -= 1
                    else:
                        dx, dr = step, 4
            if pressed & (BITS['CROSS'] | BITS['CIRCLE']):
                rin = 1 if pressed & BITS['CIRCLE'] else -1
            x += dx
            if collides(board, kind, rot, x, y):
                x -= dx
            rot = (rot - rin) & 3
            if collides(board, kind, rot, x, y):
                rot = (rot + rin) & 3
        gc += 1
        threshold = 8 if not dropped else (3 if held & BITS['DOWN'] else 50)
        if gc >= threshold:
            y += 1
            if collides(board, kind, rot, x, y):
                y -= 1
                lc += 1
                if lc >= 10:
                    return t, rot, x, y
            else:
                dropped, gc, lc = True, 0, 0
    return None


def place(board, kind, rot, x, y):
    rows = [list(r) for r in board]
    for r, c in SHAPES[kind][rot]:
        if 0 <= y + r < 16:
            rows[y + r][x + c] = str(kind)
    return [''.join(r) for r in rows]


def clear_full(board):
    """Rows 1-15 that are full are removed (enough for scoring placements; lines.md has the
    exact rules)."""
    keep = [r for i, r in enumerate(board) if i == 0 or '.' in r]
    removed = 16 - len(keep)
    return [board[0]] + ['.' * 10] * removed + keep[1:], removed


def inputs_for(movie, spawn, rot, dx, down=True):
    """The standard input pattern: rotate on ticks spawn+9 and +11 (the piece can't turn before
    its first drop at spawn+8), then tap Left/Right every other tick once every cell is below
    row 0's wall. With `down`, Down is held from spawn+9 (one drop per 3 ticks) and the taps
    start at spawn+12; without it the piece falls at normal gravity (one row per 50 ticks) and
    the taps start at spawn+60."""
    turns = {0: [], 1: ['CROSS'], 2: ['CROSS', 'CROSS'], 3: ['CIRCLE']}[rot]
    for i, b in enumerate(turns):
        movie.press(spawn + 9 + 2 * i, b)
    first = spawn + (12 if down else 60)
    for i in range(abs(dx)):
        movie.press(first + 2 * i, 'RIGHT' if dx > 0 else 'LEFT')
    if down:
        movie.press(spawn + 9, 'DOWN', 100)


def candidates(board, kind, spawn, base, down=True):
    """Every placement the standard pattern reaches: (rot, dx, lock tick, final rot, x, y)."""
    seen, out = set(), []
    for rot in range(4):
        for dx in range(-6, 7):
            m = Movie()
            m.masks = {t: v for t, v in base.masks.items() if t <= spawn}
            inputs_for(m, spawn, rot, dx, down)
            result = simulate(board, kind, spawn, m)
            if not result:
                continue
            t, r, x, y = result
            cells = frozenset((y + a, x + b) for a, b in SHAPES[kind][r])
            if cells in seen or r != rot or x != 3 + dx:
                continue
            seen.add(cells)
            out.append((rot, dx, t, r, x, y))
    return out


# ----------------------------------------------------------------------------- emulator loop

def run(movie_text, out_dir, load=None, until=None, end=None):
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, 'movie.tpm')
    if end is not None:
        movie_text = '\n'.join(f'end {end}' if l.startswith('end ') else l for l in movie_text.splitlines()) + '\n'
    with open(path, 'w') as f:
        f.write(movie_text)
    env = dict(os.environ)
    for k in ('TP_LOAD', 'TP_UNTIL', 'TP_SAVE_UNTIL'):
        env.pop(k, None)
    if load:
        env['TP_LOAD'] = load
    if until:
        env['TP_UNTIL'] = until
        env['TP_SAVE_UNTIL'] = '1'
    subprocess.run(['bash', os.path.join(REPO, 'scripts', 'run-movie.sh'), path, out_dir], env=env, check=True,
                   stdout=subprocess.DEVNULL)
    _, rows = tptrace.read(os.path.join(out_dir, 'trace.jsonl'))
    state = None
    if until:
        last = rows[-1]['t']
        state = os.path.join(out_dir, f'state_{last:05d}.sstate')
    return rows, state


def board_of(row):
    return [row['board'][r * 10:r * 10 + 10] for r in range(16)]


def plan(name, header, prefix, choose, after=600, max_pieces=60, work=None):
    """Plays `prefix` (a Movie ending before play starts) and then places pieces with
    `choose(board, kind, next1, next2, row) -> (rot, dx[, down])`, a function(movie, spawn) that
    writes the piece's inputs itself, or None (stop placing). Runs until
    play ends (screen 5 left) and `after` ticks more. Writes re/movies/NAME.tpm."""
    work = work or os.path.join(PRIVATE, 'plan', name)
    movie = prefix
    movie.header = header
    print(f'[{name}] to the first spawn')
    rows, state = run(movie.text(10 ** 6), os.path.join(work, 'step000'), until='pieces>=1')
    placed = 0
    while True:
        row = rows[-1]
        if row['scr'][0] != 5:
            print(f'[{name}] play ended at tick {row["t"]} (screen {row["scr"][0]})')
            break
        spawn, kind = row['t'], row['piece']
        board = board_of(row)
        choice = choose(board, kind, row['next1'], row['next2'], row) if placed < max_pieces else None
        if choice is None:
            print(f'[{name}] no more placements; idling from tick {spawn}')
            break
        if callable(choice):          # a scripted piece: choice(movie, spawn) writes its inputs
            choice(movie, spawn)
            rot, dx = '-', 0
        else:
            rot, dx, down = (tuple(choice) + (True,))[:3]
            inputs_for(movie, spawn, rot, dx, down)
        predicted = simulate(board, kind, spawn, movie)
        if predicted is None:
            raise SystemExit(f'[{name}] the simulation says piece {placed + 1} never locks')
        for t in range(predicted[0] + 1, spawn + 109):   # release Down once the piece locks
            if t in movie.masks:
                movie.masks[t] &= ~BITS['DOWN']
        placed += 1
        print(f'[{name}] piece {placed} {tptrace.PIECES[kind]} at tick {spawn}: rot {rot} dx {dx:+d}, '
              f'predicted lock tick {predicted[0]} at col {predicted[2]} row {predicted[3]}')
        rows, state = run(movie.text(10 ** 6), os.path.join(work, f'step{placed:03d}'), load=state,
                          until=f'pieces>={row["pieces"] + 1},scr!=5')
        lock = next((r for r in rows if r['piece'] == 0), None)
        if lock is None and rows[-1]['scr'][0] != 5:
            print(f'[{name}] play ended at tick {rows[-1]["t"]} (screen {rows[-1]["scr"][0]}) before the lock')
            break
        before = rows[rows.index(lock) - 1] if lock and rows.index(lock) > 0 else None
        if not before or (before['t'] + 1, before['rot'], (before['px'] >> 16) // 10, (before['py'] >> 16) // 10) \
                != predicted:
            got = before and (before['t'] + 1, before['rot'], (before['px'] >> 16) // 10, (before['py'] >> 16) // 10)
            raise SystemExit(f'[{name}] the original locked at {got}, the simulation predicted {predicted}')
    end = rows[-1]['t'] + after
    text = movie.text(end)
    out = os.path.join(REPO, 're', 'movies', f'{name}.tpm')
    with open(out, 'w') as f:
        f.write(text)
    print(f'[{name}] wrote {out} (end tick {end})')
    return out


def main():
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    sys.path.insert(0, os.path.dirname(os.path.abspath(sys.argv[1])))
    runpy.run_path(sys.argv[1], run_name='__main__')


if __name__ == '__main__':
    main()
