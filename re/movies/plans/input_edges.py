"""input-edges: input edge cases on Egypt stage 1, one piece each (ticks from the piece's spawn).
  1. Cross at +3 and Circle at +5, before the first drop: ignored. Cross+Circle together at +9:
     Circle wins. Right held 40 ticks from +11: moves at once, then after 24 ticks, then every 5.
  2. Left and Right held together for 30 ticks (shared auto-repeat counters), Cross on the same
     tick as the first move (move, then rotate).
  3. Left tapped 7 times (into the wall, the extra taps do nothing), then Cross 4 times on
     separate ticks: turns that would overlap the wall are refused.
  4. No input: normal gravity and the full lock delay.
  5. Down held from the spawn (no effect before the first drop), Up, Square, Triangle, L1, R1,
     L2, R2 and Select tapped (no effect in play).
  6. Down held until the piece has landed and 3 blocked gravity steps, then released: the lock
     delay continues at normal gravity.
  7. Down tapped on and off every other tick.
  8-9. Right held 60 ticks, then Left held 60 ticks; Circle tapped every 6 ticks meanwhile.
Then the professor carries on, unwatched, until the movie ends."""
from common import current_movie, route_egypt1, tpplan

movie = route_egypt1()
current_movie[0] = movie


def p1(m, s):
    m.press(s + 3, 'CROSS')
    m.press(s + 5, 'CIRCLE')
    m.press(s + 9, 'CROSS+CIRCLE')
    m.press(s + 11, 'RIGHT', 40)
    m.press(s + 60, 'DOWN', 100)


def p2(m, s):
    m.press(s + 12, 'LEFT+RIGHT', 30)
    m.press(s + 12, 'CROSS')
    m.press(s + 50, 'DOWN', 100)


def p3(m, s):
    for i in range(7):
        m.press(s + 12 + 2 * i, 'LEFT')
    for i in range(4):
        m.press(s + 30 + 2 * i, 'CROSS')
    m.press(s + 40, 'DOWN', 100)


def p4(m, s):
    pass


def p5(m, s):
    m.press(s + 1, 'DOWN', 100)
    for i, b in enumerate(('UP', 'SQUARE', 'TRIANGLE', 'L1', 'R1', 'L2', 'R2', 'SELECT')):
        m.press(s + 10 + 2 * i, b)


def p7(m, s):
    for i in range(0, 120, 2):
        m.press(s + 9 + i, 'DOWN')


def p8(m, s):
    m.press(s + 9, 'RIGHT', 60)
    for i in range(0, 60, 6):
        m.press(s + 12 + i, 'CIRCLE')
    m.press(s + 70, 'DOWN', 100)


def p9(m, s):
    m.press(s + 9, 'LEFT', 60)
    for i in range(0, 60, 6):
        m.press(s + 12 + i, 'CIRCLE')
    m.press(s + 70, 'DOWN', 100)


def landing_release(board, kind):
    """Piece 6: hold Down from +9 until 3 blocked gravity steps after landing, then release."""
    def script(m, s):
        trial = tpplan.Movie()
        trial.masks = dict(m.masks)
        trial.press(s + 9, 'DOWN', 300)
        # With Down held, a landed piece locks 9 ticks after its first blocked gravity step.
        first_blocked = tpplan.simulate(board, kind, s, trial)[0] - 9
        m.press(s + 9, 'DOWN', first_blocked + 3 - (s + 9))
    return script


scripts = [p1, p2, p3, p4, p5, None, p7, p8, p9]


def choose(board, kind, next1, next2, row):
    n = row['pieces']
    if n > len(scripts):
        return None
    if n == 6:
        return landing_release(board, kind)
    return scripts[n - 1]


tpplan.plan('input-edges', __doc__, movie, choose, after=600)
