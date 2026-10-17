"""Shared pieces of the corpus scenarios (run them with re/tools/tpplan.py)."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'tools'))
import tpplan  # noqa: E402


def route_egypt1():
    """New game, Egypt, through the story and both rules panels: Cross every 120 ticks from
    tick 100 to 2980. Play starts at tick 3061 (the first spawn)."""
    m = tpplan.Movie()
    for k in range(25):
        m.press(100 + 120 * k, 'CROSS', 4)
    return m


# The chooser needs the movie so far, to simulate with the inputs already queued.
current_movie = [None]


def route_password(symbols, start=100):
    """Main menu → Password (Down, Down, Cross), enter six symbols (Up/Down change the symbol,
    wrapping 0 ↔ 7; Right moves on), submit with Cross. A press every 4 ticks. Returns the movie
    and the tick after the submit."""
    m = tpplan.Movie()
    t = start
    for b in ('DOWN', 'DOWN', 'CROSS'):
        m.press(t, b)
        t += 4
    t += 20
    for i, s in enumerate(symbols):
        presses = ['DOWN'] * s if s <= 4 else ['UP'] * (8 - s)
        for b in presses:
            m.press(t, b)
            t += 4
        if i < 5:
            m.press(t, 'RIGHT')
            t += 4
    m.press(t, 'CROSS')
    return m, t + 1


def choose_by(rule, down=lambda row: True):
    """A chooser from a rule(kind, cells, board_after, lines, row) -> score or None (not allowed).
    The highest score wins; None when nothing is allowed. down(row): soft-drop this piece?"""
    def choose(board, kind, next1, next2, row):
        best = None
        soft = down(row)
        for rot, dx, t, r, x, y in tpplan.candidates(board, kind, row['t'], current_movie[0], soft):
            cells = [(y + a, x + b) for a, b in tpplan.SHAPES[kind][r]]
            after = tpplan.place(board, kind, r, x, y)
            _, lines = tpplan.clear_full(after)
            score = rule(kind, cells, after, lines, row)
            if score is not None and (best is None or score > best[0]):
                best = (score, rot, dx, soft)
        return best and best[1:]
    return choose


def professor_cells(row, margin=0):
    c, r = row['prof_col'], row['prof_row']
    return {(rr, cc) for rr in range(r - 1 - margin, r + 1) for cc in range(c - margin, c + 2 + margin)}
