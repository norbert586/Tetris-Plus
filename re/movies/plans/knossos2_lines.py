"""knossos2-lines: password 1 6 5 7 1 2 (Knossos stage 2, stage 62), then a 3-line clear.
Rows 13-15 are full except columns 0 and 9: a vertical I goes down each; every other piece is
stacked low in columns 1-3 and 6-8, away from the professor. The clear drops him to row 15,
the goal."""
from common import choose_by, current_movie, professor_cells, route_password, tpplan

movie, _ = route_password([1, 6, 5, 7, 1, 2])
current_movie[0] = movie


def rule(kind, cells, board, lines, row):
    cols = {c for _, c in cells}
    if kind == 1 and len(cols) == 1 and cols <= {0, 9}:
        return 1000 + lines * 1000
    if cols & {0, 4, 5, 9} or any(r < 3 for r, _ in cells) or set(cells) & professor_cells(row, 1):
        return None
    return sum(r for r, _ in cells)


tpplan.plan('knossos2-lines', __doc__, movie, choose_by(rule), after=900)
