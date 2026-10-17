"""egypt1-climb: Egypt stage 1 solved by climbing. The first piece is dropped into the
professor's pocket (columns 0-1), into his cells; he climbs on top of it, walks right over the
step and drops to the floor, row 15: the goal. Later pieces fall at normal speed (he climbs a
row in about 70 ticks) and are stacked in columns 7-9, out of his way. Then the stage advance
and stage 2's intro."""
from common import choose_by, current_movie, route_egypt1, tpplan

movie = route_egypt1()
current_movie[0] = movie


def rule(kind, cells, board, lines, row):
    cols = {c for _, c in cells}
    if row['pieces'] == 1:
        if not cols <= {0, 1}:
            return None
        return sum(1 for r, c in cells if r in (13, 14))   # overlap with his cells
    if not cols <= {7, 8, 9} or any(r < 3 for r, _ in cells):
        return None
    return sum(r for r, _ in cells)


tpplan.plan('egypt1-climb', __doc__, movie, choose_by(rule, down=lambda row: row['pieces'] == 1), after=1500)
