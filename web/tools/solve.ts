// The 100-stage solver (docs/re/stages.md): for each stage, finds inputs that clear it on the
// core and writes them as a movie, re/movies/stages/stage-NNN.tpm, for the original to replay.
//
//   npx tsx tools/solve.ts [STAGES] [--beam N,...] [--variants W;...] [--max-pieces N] [--out DIR]
//                          [--force] [--quiet] [--show]
//
// STAGES: "1-100" (default), "7" or "3,8,20-25". The route is the main menu's password entry
// (no pokes): the password for (zone, stage) puts the game on that stage's setup screen. The
// search is a beam search over piece placements: each placement is a small controller (target
// rotation and column, and when to start holding Down) run tick by tick on a copy of the game,
// so rand(), the professor and the ceiling are the original's (the core is exact, golden traces).
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Game } from '../src/core/game';
import { Rng } from '../src/core/rng';
import { BUTTONS, CIRCLE, CROSS, DOWN, LEFT, RIGHT, UP } from '../src/core/pad';
import * as V from '../src/core/vars';
import * as A from '../src/core/addr';

const ROOT = join(import.meta.dirname, '..', '..');

// ---- the game and copies of it ----

/** The game as the `puzzle` boot route hands it over (as tools/simulate.ts). */
export function bootGame(): Game {
  return new Game({ counter: 1001, seed: 0x4327d505, difficulty: 1 });
}

export function cloneGame(g: Game): Game {
  const c = Object.create(Object.getPrototypeOf(g)) as Game;
  Object.assign(c, g);
  c.m = g.m.clone();
  c.rng = Object.assign(new Rng(), g.rng);
  return c;
}

const s32 = (g: Game, a: number) => g.m.s32(a);

// ---- the route: the password for a stage ----

/** docs/spec/password.md §2. */
export function password(zonesCleared: number, zone: number, stage: number): number[] {
  let v = zonesCleared;
  if (zonesCleared !== 0x1f) v |= (zone << 5) | (stage << 8);
  let bits = 0;
  for (let x = v & 0x3fff; x; x >>= 1) bits += x & 1;
  v |= bits << 14;
  v ^= 0x2aaa;
  return [0, 1, 2, 3, 4, 5].map((k) => (v >> (3 * (5 - k))) & 7);
}

/** Pad words per tick (index = tick). */
type Inputs = number[];

function press(inputs: Inputs, t: number, mask: number, hold = 1): void {
  for (let k = t; k < t + hold; k++) inputs[k] = (inputs[k] ?? 0) | mask;
}

/**
 * Main menu → Password (Down, Down, Cross), the six symbols (Up/Down change one, Right moves on),
 * Cross submits: re/movies/plans/common.py route_password. Returns the inputs and the submit tick.
 */
function routePassword(symbols: number[], start = 100): { inputs: Inputs; submit: number } {
  const inputs: Inputs = [];
  let t = start;
  for (const b of [DOWN, DOWN, CROSS]) {
    press(inputs, t, b);
    t += 4;
  }
  t += 20;
  symbols.forEach((s, i) => {
    const presses = s <= 4 ? Array(s).fill(DOWN) : Array(8 - s).fill(UP);
    for (const b of presses) {
      press(inputs, t, b);
      t += 4;
    }
    if (i < 5) {
      press(inputs, t, RIGHT);
      t += 4;
    }
  });
  press(inputs, t, CROSS);
  return { inputs, submit: t };
}

const screen = (g: Game) => s32(g, A.SCREEN);
const step = (g: Game) => s32(g, A.STEP);

/**
 * Plays the route to the first spawn of stage n (1-100). On a new game's first stage of a zone
 * the rules panels wait for Cross (stages.md §2 steps 3 and 5): Cross every 40 ticks there.
 */
export function route(n: number): { game: Game; inputs: Inputs; symbols: number[] } {
  const zone = Math.floor((n - 1) / 20);
  const stage = (n - 1) % 20;
  const symbols = password(0, zone, stage);
  const { inputs, submit } = routePassword(symbols);
  const g = bootGame();
  let panelSince = -1;
  for (let t = 1; t < 20000; t++) {
    if (t > submit && screen(g) === 4 && (step(g) === 3 || step(g) === 5)) {
      if (panelSince < 0) panelSince = t;
      if ((t - panelSince) % 40 === 39) press(inputs, t, CROSS);
    } else panelSince = -1;
    g.step(inputs[t] ?? 0);
    if (screen(g) === 5 && s32(g, V.PIECES_SPAWNED) > 0) {
      if (s32(g, V.ZONE) !== zone || s32(g, V.STAGE) !== stage) throw new Error(`route to stage ${n} went wrong`);
      inputs.length = t + 1;
      return { game: g, inputs, symbols };
    }
  }
  throw new Error(`route to stage ${n}: play never started`);
}


// ---- reading the state ----

const SHAPES = 0x800d5544; // int[8 kind][4 rot][5][5]

function solidCell(g: Game, kind: number, rot: number, r: number, c: number): boolean {
  return s32(g, SHAPES + 4 * ((kind * 4 + rot) * 25 + r * 5 + c)) !== 0;
}

/** The leftmost and rightmost solid grid columns of a piece. */
function colSpan(g: Game, kind: number, rot: number): [number, number] {
  let lo = 5;
  let hi = -1;
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      if (solidCell(g, kind, rot, r, c)) {
        lo = Math.min(lo, c);
        hi = Math.max(hi, c);
      }
    }
  }
  return [lo, hi];
}

/** Distinct rotations of a kind (O 1, I/S/Z 2, others 4). */
function rotations(g: Game, kind: number): number[] {
  const seen = new Set<string>();
  const out: number[] = [];
  for (let rot = 0; rot < 4; rot++) {
    let key = '';
    for (let i = 0; i < 25; i++) key += solidCell(g, kind, rot, Math.floor(i / 5), i % 5) ? '#' : '.';
    if (!seen.has(key)) {
      seen.add(key);
      out.push(rot);
    }
  }
  return out;
}

const ceilRow = (g: Game) => Math.floor((s32(g, V.CEILING_Y) >> 16) / 10);
const won = (g: Game) => s32(g, V.CLEAR_FLAGS) !== 0;
const lost = (g: Game) => s32(g, V.LOSE_FLAGS) !== 0;

// ---- one placement ----

/**
 * A placement: turn to `rot`, move to `x` (piece_x in px), and hold Down from tick
 * spawn + `wait` (sooner if 0: from the first drop). Rotations and moves are presses on every
 * other tick once the piece has dropped (piece.md §4).
 */
export interface Placement {
  rot: number;
  x: number;
  wait: number;
  /** Columns to slide once the piece has landed (a tuck under an overhang). */
  slide: number;
}

export interface Node {
  game: Game;
  parent?: Node;
  /** Inputs from parent.game.tick + 1 to game.tick. */
  seg: number[];
  pieces: number;
  score: number;
  desc: string;
}

/** Inputs for ticks 1..node.game.tick. */
export function inputsOf(node: Node): number[] {
  const segs: number[][] = [];
  for (let n: Node | undefined = node; n; n = n.parent) segs.push(n.seg);
  return segs.reverse().flat();
}

const LIMIT = 2500;

/**
 * Runs a placement from a spawn (the node's game has just spawned the piece) up to the next
 * spawn, a goal or a loss. Returns the new game and its inputs, or null if the piece locked
 * somewhere else than asked.
 */
function play(from: Game, p: Placement): { game: Game; seg: number[]; lockAt: string } | null {
  const g = cloneGame(from);
  const spawn = g.tick;
  const pieces = s32(g, V.PIECES_SPAWNED);
  const seg: number[] = [];
  let last = 0;
  let locked = false;
  let lockAt = '';
  let landed = false;
  for (let k = 0; k < LIMIT; k++) {
    let pad = 0;
    const falling = !locked && step(g) === 1 && s32(g, V.PIECE_KIND) !== 0;
    if (falling && s32(g, V.PIECE_HAS_DROPPED)) {
      const rot = s32(g, V.PIECE_ROT);
      const x = s32(g, V.PIECE_X) >> 16;
      if (s32(g, V.LOCK_COUNT) > 0 && x === p.x && rot === p.rot) landed = true;
      const tx = landed ? p.x + 10 * p.slide : p.x;
      const d = (p.rot - rot) & 3;
      if (d !== 0 && !(last & (CROSS | CIRCLE))) pad |= d === 3 ? CIRCLE : CROSS;
      if (x !== tx && !(last & (LEFT | RIGHT))) pad |= x < tx ? RIGHT : LEFT;
      if (g.tick + 1 >= spawn + p.wait) pad |= DOWN;
    }
    g.step(pad);
    seg.push(pad);
    last = pad;
    if (won(g) || lost(g)) return { game: g, seg, lockAt };
    if (!locked && (step(g) !== 1 || s32(g, V.PIECE_KIND) === 0)) {
      locked = true;
      const rot = s32(g, 0x800f35dc);
      lockAt = `${rot}@${s32(g, V.PIECE_X) >> 16},${s32(g, V.LOCK_TOP_ROW)}`;
    }
    if (s32(g, V.PIECES_SPAWNED) !== pieces) return { game: g, seg, lockAt };
  }
  return { game: g, seg, lockAt };
}

// ---- evaluation ----

/** A board as 16 rows of 10 solid/empty cells (row 0 included). */
type Board = Uint8Array;

function boardOf(g: Game): Board {
  const b = new Uint8Array(160);
  for (let i = 0; i < 160; i++) b[i] = s32(g, V.BOARD + 4 * i) !== 0 ? 1 : 0;
  return b;
}

const at = (b: Board, c: number, r: number) => (c < 0 || c > 9 || r < 0 || r > 15 ? 1 : b[r * 10 + c]);

interface Prof {
  col: number;
  row: number;
  dir: number;
}

/**
 * Where the professor ends up if the board stays as it is: he falls through gaps, climbs out
 * of blocks in his cells, walks and turns at anything ahead (professor.md §5). Returns his
 * lowest row on the way (and where he is then) and the walk it takes; row -5 if he climbs out
 * at the top.
 */
function staticPath(b: Board, from: Prof): Prof & { steps: number } {
  let { col, row, dir } = from;
  let best = { col, row, dir, steps: 0 };
  const seen = new Set<number>();
  for (let n = 0; n < 200; n++) {
    if (row < 1) return { col, row: -5, dir, steps: n };
    if (!at(b, col, row + 1) && !at(b, col + 1, row + 1)) {
      while (!at(b, col, row + 1) && !at(b, col + 1, row + 1)) row++;
      if (row > best.row) best = { col, row, dir, steps: n };
      continue;
    }
    if (at(b, col, row - 1) || at(b, col + 1, row - 1)) {
      row -= 2;
      continue;
    }
    if (at(b, col, row) || at(b, col + 1, row)) {
      row -= 1;
      continue;
    }
    if (n === 0 || row < best.row) best = { col, row, dir, steps: n };
    const key = (col + 4) * 1000 + (row + 4) * 10 + (dir + 1);
    if (seen.has(key)) break;
    seen.add(key);
    const ahead = dir > 0 ? col + 2 : col - 1;
    if (at(b, ahead, row) || at(b, ahead, row - 1)) {
      dir = -dir;
      continue;
    }
    col += dir;
  }
  return best;
}

function clearRow(b: Board, k: number): Board {
  const n = new Uint8Array(160);
  n.set(b.subarray(0, 10), 0); // row 0 (the wall) stays
  n.set(b.subarray(10, k * 10), 20);
  n.set(b.subarray((k + 1) * 10), (k + 1) * 10);
  return n;
}

/** Cost of filling row k's empty cells: 1 if open from above, more if under him or covered. */
function rowCost(b: Board, k: number, p: Prof, top: number): number {
  let cost = 0;
  for (let c = 0; c < 10; c++) {
    if (at(b, c, k)) continue;
    if (k === p.row && (c === p.col || c === p.col + 1)) {
      cost += W.pocket;
      continue;
    }
    // A covered cell: the rows covering it have to be cleared first.
    let cover = 0;
    for (let r = top; r < k; r++) {
      if (!at(b, c, r)) continue;
      let e = 0;
      for (let cc = 0; cc < 10; cc++) if (!at(b, cc, r)) e++;
      cover += W.cover * e;
    }
    let empty = 0;
    while (k + empty < 15 && !at(b, c, k + empty + 1)) empty++;
    cost += cover ? Math.min(W.covered + cover, 40) : (c === p.col || c === p.col + 1 ? W.under : 1) + W.support * Math.min(empty, 4);
  }
  return cost;
}

/**
 * The cheapest way down by line clears: cells to fill, over sequences of up to `depth` rows
 * cleared below him, each clear followed by his static path. Rows still to go after that cost
 * W.perRow each.
 */
function goalCost(b: Board, p: Prof, top: number, depth: number): number {
  const q = staticPath(b, p);
  if (q.row >= 15) return 0;
  if (q.row < 0) return 1e6;
  let best = W.perRow * (15 - q.row);
  if (depth === 0) return best;
  const costs: [number, number][] = [];
  for (let k = q.row; k <= 15; k++) costs.push([rowCost(b, k, q, top), k]);
  costs.sort((x, y) => x[0] - y[0]);
  for (const [c, k] of costs.slice(0, 4)) {
    if (c >= best) break;
    const nb = clearRow(b, k);
    if (k === q.row) {
      // He was in that row: the piece that filled his cells leaves its upper part in them.
      nb[k * 10 + q.col] = 1;
      nb[k * 10 + q.col + 1] = 1;
    }
    best = Math.min(best, c + goalCost(nb, q, top, depth - 1));
  }
  return best;
}

/** Evaluation weights (tunable from the command line: --w name=value,...). */
export const W: Record<string, number> = {
  cost: 100, // per cell still to fill on the cheapest way down (goalCost)
  row: 10, // per row of his static path's lowest point
  covered: 2, // cost of a covered cell, plus W.cover per empty cell of each row covering it
  cover: 0.5,
  under: 3, // cost of a cell he stands over
  pocket: 4, // cost of one of his own cells (a clear of his row: he climbs and is carried down)
  support: 0.4, // per empty cell under an open cell (up to 4): filled first
  perRow: 12, // cost of a row beyond the search depth
  depth: 3,
  holes: 2, // per covered empty cell anywhere
  agg: 0, // per cell of column height (sum over columns)
  lines: 0, // per line cleared so far
  et: 0, // weight of El-Tetris's features (elTetris)
  height: 150, // per row of stack above 11
  danger: 800, // per row of headroom under 7
  tick: 0.05,
  now: 50, // per row of his current row
  inside: 300, // blocks in his cells (he climbs)
  look: 150, // ticks run with no input before evaluating (he settles)
};

/**
 * Evaluates a state after `W.look` ticks with no input (the next piece only falls a few rows),
 * so that the professor's falls and climbs after a placement show. A goal in that time counts
 * almost as one.
 */
function lookahead(g: Game): number {
  if (won(g) || lost(g) || !W.look) return evaluate(g);
  const c = cloneGame(g);
  for (let k = 0; k < W.look; k++) {
    c.step(0);
    if (won(c)) return 1e8 - c.tick;
    if (lost(c)) return -1e9;
  }
  return evaluate(c);
}

/**
 * El-Tetris's board features (row and column transitions, holes, well depths), weighted as
 * there: a line-clearing player digs the stage's structure from the top.
 */
function elTetris(b: Board, top: number): number {
  const s = (c: number, r: number) => (c < 0 || c > 9 || r > 15 ? 1 : r < top ? 0 : b[r * 10 + c]);
  let rowT = 0;
  let colT = 0;
  let holes = 0;
  let wells = 0;
  for (let r = top; r <= 15; r++) {
    for (let c = 0; c <= 10; c++) if (s(c - 1, r) !== s(c, r)) rowT++;
  }
  for (let c = 0; c < 10; c++) {
    let covered = false;
    let well = 0;
    for (let r = top; r <= 16; r++) {
      if (s(c, r) !== s(c, r - 1) && r > top) colT++;
      if (r > 15) break;
      if (s(c, r)) covered = true;
      else if (covered) holes++;
      if (!s(c, r) && s(c - 1, r) && s(c + 1, r)) {
        well++;
        wells += well;
      } else well = 0;
    }
  }
  return -3.22 * rowT - 9.35 * colT - 7.9 * holes - 3.39 * wells;
}

export function evaluate(g: Game): number {
  if (won(g)) return 1e9 - g.tick;
  if (lost(g)) return -1e9;
  const b = boardOf(g);
  const top = Math.max(ceilRow(g) + 2, 1);
  const p: Prof = { col: s32(g, V.PROF_COL), row: s32(g, V.PROF_ROW), dir: s32(g, V.PROF_FACING) === 0 ? 1 : -1 };
  const q = staticPath(b, p);
  let score = -W.cost * goalCost(b, p, top, W.depth) + W.row * q.row + W.now * p.row;
  if (at(b, p.col, p.row) || at(b, p.col + 1, p.row) || at(b, p.col, p.row - 1) || at(b, p.col + 1, p.row - 1)) {
    score -= W.inside;
  }
  let holes = 0;
  let height = 0;
  for (let c = 0; c < 10; c++) {
    let covered = false;
    for (let r = top; r <= 15; r++) {
      if (at(b, c, r)) {
        covered = true;
        height = Math.max(height, 16 - r);
      } else if (covered) holes++;
    }
  }
  let agg = 0;
  for (let c = 0; c < 10; c++) {
    let r = top;
    while (r <= 15 && !at(b, c, r)) r++;
    agg += 16 - r;
  }
  score -= W.holes * holes + W.agg * agg;
  score += W.lines * s32(g, V.LINES_CLEARED);
  if (W.et) score += W.et * elTetris(b, top) + W.et * 3.42 * s32(g, V.LINES_CLEARED);
  if (height > 11) score -= W.height * (height - 11);
  const headroom = s32(g, V.PROF_ROW) - ceilRow(g);
  if (headroom < 7) score -= W.danger * (7 - headroom);
  return score - g.tick * W.tick;
}

// ---- the search ----

function children(node: Node, waits: number[]): Node[] {
  const g = node.game;
  const kind = s32(g, V.PIECE_KIND);
  const out: Node[] = [];
  const seen = new Set<string>();
  const moves: [number, number][] = [...waits.map((w): [number, number] => [w, 0]), [0, -1], [0, 1], [0, -2], [0, 2]];
  for (const rot of rotations(g, kind)) {
    const [lo, hi] = colSpan(g, kind, rot);
    for (let left = -lo; left + hi <= 9; left++) {
      for (const [wait, slide] of moves) {
        const r = play(g, { rot, x: left * 10, wait, slide });
        if (!r) continue;
        const key = `${r.lockAt}/${r.game.tick}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const score = lookahead(r.game);
        out.push({
          game: r.game, parent: node, seg: r.seg, pieces: node.pieces + 1, score,
          desc: `${'?IOTJLZS'[kind]} ${r.lockAt} w${wait}${slide ? ` s${slide}` : ''}`,
        });
      }
    }
  }
  return out;
}

function stateKey(g: Game): string {
  let b = '';
  for (let i = 0; i < 160; i++) b += s32(g, V.BOARD + 4 * i) ? '#' : '.';
  return `${b}/${s32(g, V.PROF_COL)},${s32(g, V.PROF_ROW)},${s32(g, V.PROF_FACING)}`;
}

/** The board with the professor (P) and the ceiling's row, for --show. */
export function show(g: Game): string {
  const col = s32(g, V.PROF_COL);
  const row = s32(g, V.PROF_ROW);
  const lines: string[] = [];
  for (let r = 0; r < 16; r++) {
    let l = '';
    for (let c = 0; c < 10; c++) {
      const v = s32(g, V.BOARD + 4 * (r * 10 + c));
      const me = (c === col || c === col + 1) && (r === row || r === row - 1);
      l += v ? (me ? '@' : v === 0xffff ? '=' : '#') : me ? 'P' : '.';
    }
    lines.push(`    ${String(r).padStart(2)} ${l}${r === ceilRow(g) ? '  <- ceiling' : ''}`);
  }
  return lines.join('\n');
}

export interface Solution {
  node: Node;
  clearTick: number;
}

export function solve(start: Game, opts: { beam: number; maxPieces: number; waits: number[]; show?: boolean; log?: (s: string) => void }): Solution | null {
  let beam: Node[] = [{ game: start, seg: [], pieces: 0, score: evaluate(start), desc: 'start' }];
  for (let depth = 0; depth < opts.maxPieces; depth++) {
    const all: Node[] = [];
    for (const node of beam) {
      for (const child of children(node, opts.waits)) {
        if (won(child.game)) {
          return { node: child, clearTick: child.game.tick };
        }
        if (!lost(child.game)) all.push(child);
      }
    }
    all.sort((a, b) => b.score - a.score);
    const next: Node[] = [];
    const keys = new Set<string>();
    for (const c of all) {
      const k = stateKey(c.game);
      if (keys.has(k)) continue;
      keys.add(k);
      next.push(c);
      if (next.length >= opts.beam) break;
    }
    if (!next.length) return null;
    beam = next;
    const b = beam[0].game;
    if (opts.show) opts.log?.(show(b));
    opts.log?.(`  depth ${depth + 1}: ${all.length} children, best ${beam[0].score.toFixed(0)} (${beam[0].desc}) prof (${s32(b, V.PROF_COL)}, ${s32(b, V.PROF_ROW)}) tick ${b.tick}`);
  }
  return null;
}

// ---- movies ----

const NAMES = Object.entries(BUTTONS);

function buttonWords(mask: number): string {
  const pads: string[] = [];
  for (let p = 0; p < 2; p++) {
    const m = (mask >>> (16 * p)) & 0xffff;
    if (!m) continue;
    const names = NAMES.filter(([, bit]) => m & bit).map(([n]) => n).join('+');
    pads.push(p ? `2:${names}` : names);
  }
  return pads.join(' ');
}

export function movieText(inputs: number[], end: number, header: string[]): string {
  const lines = ['tpm 1', 'boot puzzle', `end ${end}`, ...header.map((h) => `# ${h}`)];
  for (let t = 1; t < inputs.length; t++) {
    const w = inputs[t] ?? 0;
    if (!w || (inputs[t - 1] ?? 0) === w) continue;
    let hold = 1;
    while ((inputs[t + hold] ?? 0) === w) hold++;
    lines.push(`${t} ${hold} ${buttonWords(w)}`);
  }
  return `${lines.join('\n')}\n`;
}

/** Ticks the movie runs on after the goal: the stage-clear screen starts on the next tick. */
const AFTER = 60;

function parseWeights(spec: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const kv of spec.split(',').filter(Boolean)) {
    const [k, v] = kv.split('=');
    if (!(k in W)) throw new Error(`unknown weight ${k}`);
    out[k] = Number(v);
  }
  return out;
}

/** The weight sets tried for each beam width, in order. */
const VARIANTS = ['et=10,cost=20', '', 'et=20,cost=0,row=300,now=100'];

function parseStages(spec: string): number[] {
  const out: number[] = [];
  for (const part of spec.split(',')) {
    const [a, b] = part.split('-').map(Number);
    for (let n = a; n <= (b ?? a); n++) out.push(n);
  }
  return out;
}

function main(): void {
  const args = process.argv.slice(2);
  const opt = (name: string, def: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : def);
  const stages = parseStages(args.find((a, i) => /^[\d,-]+$/.test(a) && !args[i - 1]?.startsWith('--')) ?? '1-100');
  const beams = opt('--beam', '6').split(',').map(Number);
  const maxPieces = Number(opt('--max-pieces', '50'));
  const out = opt('--out', join(ROOT, 're/movies/stages'));
  const waits = opt('--waits', '0,60,120,200,300,450').split(',').map(Number);
  const quiet = args.includes('--quiet');
  Object.assign(W, parseWeights(opt('--w', '')));
  const base = { ...W };
  // Weight sets tried in turn (--variants 'a=1,b=2;c=3'); '' is the defaults.
  const variants = opt('--variants', VARIANTS.join(';')).split(';');
  mkdirSync(out, { recursive: true });
  for (const n of stages) {
    if (!args.includes('--force') && existsSync(join(out, `stage-${String(n).padStart(3, '0')}.tpm`))) continue;
    const t0 = performance.now();
    const r = route(n);
    const play0 = r.game.tick;
    let sol: Solution | null = null;
    let used = '';
    attempts: for (const b of beams) {
      for (const v of variants) {
        Object.assign(W, base, parseWeights(v));
        used = `beam ${b}${v ? `, ${v}` : ''}`;
        sol = solve(r.game, { beam: b, maxPieces, waits, show: args.includes('--show'), log: quiet ? undefined : (s) => console.log(s) });
        if (sol) break attempts;
        console.log(`stage ${n}: ${used} failed`);
      }
    }
    const secs = ((performance.now() - t0) / 1000).toFixed(1);
    if (!sol) {
      console.log(`stage ${n}: no solution (${secs} s)`);
      continue;
    }
    // Index = tick: the route's inputs to the first spawn, then the placements'.
    const inputs = [...Array.from({ length: play0 + 1 }, (_, t) => r.inputs[t] ?? 0), ...inputsOf(sol.node)];
    const end = sol.clearTick + AFTER;
    const zone = Math.floor((n - 1) / 20);
    const name = `stage-${String(n).padStart(3, '0')}`;
    const header = [
      `${name}: stage ${n} (zone ${zone + 1}, stage ${((n - 1) % 20) + 1}), found by web/tools/solve.ts (docs/re/stages.md).`,
      `Password ${r.symbols.join(' ')} from the main menu; play starts at tick ${play0}.`,
      `${sol.node.pieces} pieces; the professor reaches row 15 (goal) at tick ${sol.clearTick}. Search: ${used}, waits ${waits.join(',')}.`,
    ];
    writeFileSync(join(out, `${name}.tpm`), movieText(inputs, end, header));
    console.log(`stage ${n}: cleared at tick ${sol.clearTick}, ${sol.node.pieces} pieces, ${used} (${secs} s)`);
  }
}

if (process.argv[1]?.endsWith('solve.ts')) main();
