// The Stats page (docs/re/shell.md): what the mode select's Stats tile opens. Plain HTML over the
// game, like the settings: progress (stages with a best time), every stage's best time, the
// Puzzle ranking and the time played. The records come from memory card 1 (flow/records.ts);
// the time played is the browser's own count, kept in localStorage.
import { NO_TIME, STAGES, type Records } from '../flow/records';

const ZONES = ['Egypt', 'Angkor Wat', 'Maya', 'Knossos', 'Atlantis'];
const PER_ZONE = 20;
const KEY = 'tetris-plus.playtime.v1';
/** Ticks a second (NTSC progressive, as the shell runs the game). */
const TICKS_PER_SECOND = 59.826;

/** Ticks played, in all and in Puzzle Mode, counted by the shell and kept between visits. */
export class PlayTime {
  total = 0;
  puzzle = 0;
  private unsaved = 0;

  constructor(private readonly storage: Storage | undefined = globalThis.localStorage) {
    try {
      const v = JSON.parse(storage?.getItem(KEY) ?? '{}') as { total?: unknown; puzzle?: unknown };
      if (typeof v.total === 'number' && v.total >= 0) this.total = v.total;
      if (typeof v.puzzle === 'number' && v.puzzle >= 0) this.puzzle = v.puzzle;
    } catch {
      // Unreadable: start from zero.
    }
  }

  /** One tick of `program`; saved every ten seconds or so (and on `save`). */
  tick(program: string): void {
    this.total++;
    if (program === 'PAZLE') this.puzzle++;
    if (++this.unsaved >= 600) this.save();
  }

  save(): void {
    this.unsaved = 0;
    try {
      this.storage?.setItem(KEY, JSON.stringify({ total: this.total, puzzle: this.puzzle }));
    } catch {
      // Storage full or blocked: the count is kept for this visit only.
    }
  }
}

/** "3 h 05 min", "12 min", "0 min" */
export function duration(ticks: number): string {
  const minutes = Math.floor(ticks / TICKS_PER_SECOND / 60);
  const h = Math.floor(minutes / 60);
  return h > 0 ? `${h} h ${String(minutes % 60).padStart(2, '0')} min` : `${minutes} min`;
}

/** A best time in tenths as the game shows it ("123.4"), or a dash. */
export function bestTime(t: number): string {
  return t >= NO_TIME ? '—' : `${Math.floor(t / 10)}.${t % 10}`;
}

/** Where a Puzzle ranking entry got to: "Maya 6", or "100 stages" (zone 5). */
function reached(zone: number, stage: number): string {
  if (zone === 5) return '100 stages';
  return `${ZONES[zone] ?? `Zone ${zone + 1}`} ${(stage % PER_ZONE) + 1}`;
}

export class StatsPanel {
  readonly el: HTMLElement;

  constructor(private readonly close: () => void) {
    this.el = document.createElement('div');
    this.el.className = 'panel stats';
    this.el.hidden = true;
    document.body.append(this.el);
  }

  get open(): boolean {
    return !this.el.hidden;
  }

  /** `card`: a memory card is in slot 1 (the records are kept on it). */
  show(records: Records, play: PlayTime, card: boolean): void {
    this.render(records, play, card);
    this.el.hidden = false;
    this.el.scrollTop = 0;
  }

  hide(): void {
    this.el.hidden = true;
  }

  /** Pad buttons newly pressed while open: Up/Down scroll, Cross, Circle or Start close. */
  pad(pressed: number): void {
    if (pressed & 0x1000) this.el.scrollBy({ top: -60 });
    if (pressed & 0x4000) this.el.scrollBy({ top: 60 });
    if (pressed & (0x40 | 0x20 | 0x800)) this.close();
  }

  private render(r: Records, play: PlayTime, card: boolean): void {
    const el = this.el;
    el.replaceChildren();
    const h = (tag: string, text?: string, cls?: string) => {
      const e = document.createElement(tag);
      if (text !== undefined) e.textContent = text;
      if (cls) e.className = cls;
      return e;
    };
    el.append(h('h2', 'Stats'));

    const cleared = r.best.slice(0, STAGES).filter((t) => t < NO_TIME).length;
    el.append(h('h3', 'Progress'), h('p', `Stages cleared: ${cleared} of ${STAGES}`));
    const zones = h('div', undefined, 'row');
    ZONES.forEach((name, z) => {
      const n = r.best.slice(z * PER_ZONE, (z + 1) * PER_ZONE).filter((t) => t < NO_TIME).length;
      zones.append(h('span', `${name} ${n}/${PER_ZONE}`, n === PER_ZONE ? 'done' : ''));
    });
    el.append(zones);

    el.append(h('h3', 'Time played'), h('p', `${duration(play.total)} in all, ${duration(play.puzzle)} in Puzzle Mode`));

    el.append(h('h3', 'High scores (Puzzle Mode)'));
    const ranks = h('table');
    r.puzzle.forEach((e, i) => {
      const row = h('tr');
      row.append(h('td', `${i + 1}.`), h('td', e.name || '—'), h('td', e.score.toLocaleString(), 'num'), h('td', reached(e.a, e.b)));
      ranks.append(row);
    });
    el.append(ranks);

    el.append(h('h3', 'Best times (as the stage clock shows them)'));
    const times = h('table', undefined, 'times');
    const head = h('tr');
    head.append(h('th', 'Stage'), ...ZONES.map((z) => h('th', z)));
    times.append(head);
    for (let s = 0; s < PER_ZONE; s++) {
      const row = h('tr');
      row.append(h('td', String(s + 1)));
      for (let z = 0; z < ZONES.length; z++) row.append(h('td', bestTime(r.best[z * PER_ZONE + s]), 'num'));
      times.append(row);
    }
    el.append(times);

    el.append(h('p', card ? 'Records are kept on memory card 1.' : 'No memory card: these records are lost when the page closes.', 'note'));
    const foot = h('div', undefined, 'row');
    const b = h('button', 'Back (Esc, Cross or Circle)', 'primary');
    b.addEventListener('click', () => this.close());
    foot.append(b);
    el.append(foot);
  }
}
