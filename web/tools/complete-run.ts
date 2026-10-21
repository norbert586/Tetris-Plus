// Generates the complete-run movie (Phase 9's exit criterion, docs/re/shell.md): power-on, the
// story, the title, the mode select, Puzzle Mode's 100 stages, the ending, name entry, the save
// to the card, the rankings and back to the story. The port plays it with a simple policy and
// the inputs and pokes it used are written as a movie the original then plays (scripts/run-movie.sh).
//
//   npx tsx tools/complete-run.ts [OUT.tpm] [--log] [--shots DIR T,T,...]
//
// --shots also draws the run and writes the frames of those ticks (counted from power-on) as PNG.
//
// The policy: Start on the story and the title; Right, Cross, Cross on the mode select (Puzzle);
// in Puzzle Mode Cross every 40 ticks (menus, pages, letters), and once play of each stage has
// started a poke puts the professor on row 15, the goal (the stage then clears as if he had
// climbed there). After the ending, the save screen saves to the card in port 1, then quits.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { readPack } from '../src/assets/pack';
import { PROGRAM_ART } from '../src/render/programs';
import { Renderer } from '../src/render/renderer';
import { encodePng, toRgba } from '../src/render/present';
import { join } from 'node:path';
import * as A from '../src/core/addr';
import { CardSlots, MemoryCard } from '../src/core/card';
import { Machine } from '../src/core/machine';
import { BUTTONS, CROSS, DOWN, RIGHT, START } from '../src/core/pad';
import { PROF_ROW } from '../src/core/vars';

const out = process.argv[2] && !process.argv[2].startsWith('--')
  ? process.argv[2] : join(import.meta.dirname, '..', '..', 're/movies/complete-run.tpm');
const verbose = process.argv.includes('--log');
const shotsAt = process.argv.indexOf('--shots');
const shotDir = shotsAt > 0 ? process.argv[shotsAt + 1] : undefined;
const shots = new Set(shotsAt > 0 ? process.argv[shotsAt + 2].split(',').map(Number) : []);
const renderers: Record<string, Renderer> = {};
if (shotDir) {
  mkdirSync(shotDir, { recursive: true });
  for (const [name, art] of Object.entries(PROGRAM_ART)) {
    const pack = readPack(new Uint8Array(readFileSync(join(import.meta.dirname, '..', 'public/assets', art.pack))));
    renderers[name] = new Renderer(pack, art.style);
  }
  renderers.PAZLE.hidePlayer2 = true;
}

interface Seg {
  program: string;
  inputs: Map<number, number>;
  pokes: [number, number, number][];
  last?: number;
}

const ZONE = 0x800eebb0;
const STAGE = 0x800eeb04;
const SAVE_SUBSTEP = A.SUBSTEP;

const machine = new Machine({
  counter: 0, seed: 0x57729884, first: 1, cards: new CardSlots([new MemoryCard(MemoryCard.blank()), new MemoryCard(MemoryCard.blank())]),
});
const segs: Seg[] = [];
let seg: Seg | undefined;
const startSeg = () => {
  seg = { program: machine.program.name, inputs: new Map(), pokes: [] };
  segs.push(seg);
};
startSeg();

let total = 0;
let pokedFor = -1;
let endingSeen = false;
let saved = false;
let quitAt = -1;
let lastScreen = -1;
let titlesAfterRanking = 0;
const cardVersion = () => machine.ctx.cards.cards[0]?.version ?? 0;
const v0 = cardVersion();

for (;;) {
  const p = machine.program;
  const t = p.tick + 1; // the tick this step runs
  const m = machine.m;
  let pad = 0;
  switch (p.name) {
    case 'TIT_DEMO':
    case 'TITLE':
      if (t === 100) pad = START;
      break;
    case 'SELECT':
      if (t === 290) pad = RIGHT;
      else if (t === 390 || t === 590) pad = CROSS;
      break;
    case 'PAZLE': {
      const screen = m.s32(A.SCREEN);
      if (screen === 11) endingSeen = true;
      if (screen === 13 && endingSeen && saved && quitAt < 0) quitAt = t + 40;
      if (quitAt > 0) {
        if (t === quitAt) pad = DOWN;
        else if (t === quitAt + 4) pad = DOWN;
        else if (t === quitAt + 10) pad = CROSS;
      } else if (t >= 100 && t % 40 === 0) {
        pad = CROSS;
      }
      break;
    }
  }
  if (pad) seg!.inputs.set(t, pad);
  p.step(pad);
  total++;
  if (shotDir) {
    const r = renderers[p.name];
    const frame = r.frame(p);
    if (shots.has(total)) {
      const file = join(shotDir, `run_${String(total).padStart(5, '0')}_${p.name}.png`);
      writeFileSync(file, encodePng(toRgba(r.pixels(frame.buffer)), 320, 240, 2));
    }
  }
  if (p.name === 'PAZLE') {
    const screen = m.s32(A.SCREEN);
    const stageId = m.s32(ZONE) * 20 + m.s32(STAGE);
    // Play has started: the professor goes to the goal (the poke lands right after this tick).
    if (screen === 5 && pokedFor !== stageId && m.s32(PROF_ROW) !== 15) {
      seg!.pokes.push([t, PROF_ROW, 15]);
      m.w32(PROF_ROW, 15);
      pokedFor = stageId;
      if (verbose) console.log(`tick ${total}: PAZLE ${t}: zone ${m.s32(ZONE)} stage ${m.s32(STAGE)}: professor to the goal`);
    }
    if (!saved && endingSeen && cardVersion() !== v0) saved = true;
    if (verbose && screen !== lastScreen) console.log(`tick ${total}: PAZLE ${t}: screen ${screen} substep ${m.s32(SAVE_SUBSTEP)}`);
    lastScreen = screen;
  }
  if (p.name === 'TITLE' && titlesAfterRanking > 0 && t === 2) {
    seg!.last = 2;
    break;
  }
  if (p.exited) {
    if (verbose) console.log(`tick ${total}: ${p.name} exits after ${p.tick} ticks`);
    if (p.name === 'RANKING') titlesAfterRanking++;
    machine.next();
    startSeg();
  }
  if (total > 2_000_000) throw new Error('the run did not finish');
}

const names = Object.fromEntries(Object.entries(BUTTONS).map(([n, b]) => [b, n]));
const lines = [
  'tpm 1',
  'boot power',
  '# complete-run: generated by web/tools/complete-run.ts (do not edit). Power-on with blank cards;',
  '# Start skips the story and the title; Puzzle on the mode select; in Puzzle Mode Cross every 40',
  '# ticks, and a poke puts the professor on row 15 (the goal) once each stage\'s play starts, so all',
  '# 100 stages clear; the ending, name entry, the save to the card in port 1, Quit; RANKING; the',
  '# story; it ends as TITLE starts.',
];
for (const s of segs) {
  lines.push(`program ${s.program}`);
  if (s.last !== undefined) lines.push(`end ${s.last}`);
  const events: [number, string][] = [];
  for (const [t, pad] of s.inputs) {
    for (let b = 1; b <= 0x8000; b <<= 1) if (pad & b) events.push([t, `${t} 1 ${names[b]}`]);
  }
  for (const [t, a, v] of s.pokes) events.push([t, `poke ${t} 0x${a.toString(16)} ${v}`]);
  events.sort((x, y) => x[0] - y[0]);
  lines.push(...events.map((e) => e[1]));
}
writeFileSync(out, `${lines.join('\n')}\n`);
console.log(`${out}: ${segs.map((s) => s.program).join(' > ')}; ${total} ticks; card saved: ${saved}`);
