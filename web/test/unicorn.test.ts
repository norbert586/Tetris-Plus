// Function-level verification (docs/RESEARCH_AND_PLAN.md §8, layer 1). The fixtures were made
// by re/tools/unicorn_fixtures.py, which ran the original PAZLE.EXE routines in Unicorn on
// generated game states. Each case is replayed here on the core from the same memory: the
// words the routine changes, its return value, its rand() calls and its sound effects must
// all be the same.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import * as A from '../src/core/addr';
import { BOOT_STATE_BASE64, BOOT_STATE_OFFSET } from '../src/core/boot-state';
import { menuDpadRepeat } from '../src/core/dpad';
import { Game } from '../src/core/game';
import { decodeBase64, Mem } from '../src/core/mem';
import { ceilingCrush, ceilingTick, debrisUpdate } from '../src/core/play/ceiling';
import { numberDraw, stageTimerTick } from '../src/core/play/hud';
import { linesFindFull, linesRemove, scoreAddLines } from '../src/core/play/lines';
import { pieceCollides, pieceInput, playFall, queueAdvance } from '../src/core/play/piece';
import { profAnimTick, profFallDistance, profSense, profThink } from '../src/core/professor';
import { passwordDecode, passwordEncodeValue } from '../src/core/screens/password';

const DIR = join(import.meta.dirname, 'fixtures', 'unicorn');
const WATCH: [number, number][] = [
  [0x800d4fb0, 0x800f3704],
  [A.S, A.S + 0x4b540],
];
/** bgm_request's bookkeeping: the fixtures replace bgm_request with a recorder. */
const IGNORED = new Set([0x800ed338, 0x800ed33c, 0x800ed340, 0x800ed344]);

type Routine = (g: Game, args: number[], stack: number[]) => number | boolean | void;

const ROUTINES: Record<string, Routine> = {
  piece_collides: (g) => pieceCollides(g),
  play_fall: (g) => playFall(g),
  lines_find_full: (g) => linesFindFull(g),
  lines_remove: (g) => linesRemove(g),
  score_add_lines: (g) => scoreAddLines(g),
  queue_advance: (g) => queueAdvance(g),
  piece_input: (g) => pieceInput(g),
  ceiling_tick: (g) => ceilingTick(g),
  ceiling_crush: (g) => ceilingCrush(g),
  debris_update: (g) => debrisUpdate(g),
  prof_sense: (g) => profSense(g),
  prof_fall_distance: (g) => profFallDistance(g),
  prof_think: (g) => profThink(g),
  prof_anim_tick: (g) => profAnimTick(g),
  password_decode: (g) => passwordDecode(g),
  password_encode: (g) => passwordEncodeValue(g),
  menu_dpad_repeat: (g) => menuDpadRepeat(g),
  stage_timer_tick: (g) => stageTimerTick(g),
  number_draw: (g, a, s) => numberDraw(g, a[0], a[1], a[2], a[3], s[0], s[1], s[2]),
};
/** Routines whose return value is part of their contract. */
const RETURNS = new Set(['piece_collides', 'lines_find_full', 'prof_fall_distance', 'prof_anim_tick']);

interface Case {
  writes: [number, number, number][];
  args: number[];
  stack: number[];
  seed: number;
  v0: number;
  changed: [number, number][];
  rand: number;
  seedAfter: number;
  se: number[];
  bgm: number[];
}

let base: Uint8Array | null = null;
/** The memory the fixtures start from: the program's data, the boot defaults, BSS zero. */
function baseMemory(): Uint8Array {
  if (!base) {
    const m = new Mem();
    m.bytes.set(decodeBase64(BOOT_STATE_BASE64), (A.S + BOOT_STATE_OFFSET) & 0x1fffff);
    base = m.bytes;
  }
  return base;
}

function snapshot(m: Mem): Uint8Array[] {
  return WATCH.map(([a, b]) => m.bytes.slice(a & 0x1fffff, (a & 0x1fffff) + b - a));
}

function changed(before: Uint8Array[], m: Mem): [number, number][] {
  const out: [number, number][] = [];
  WATCH.forEach(([a, b], k) => {
    const x = before[k];
    const view = new DataView(x.buffer);
    for (let i = 0; i < b - a; i += 4) {
      const now = m.s32(a + i);
      if (view.getInt32(i, true) !== now && !IGNORED.has(a + i)) out.push([a + i, now]);
    }
  });
  return out;
}

function runCase(name: string, c: Case): string | null {
  const g = new Game({ counter: 0, seed: c.seed, ram: baseMemory() });
  for (const [addr, size, value] of c.writes) {
    if (size === 4) g.m.w32(addr, value);
    else if (size === 2) g.m.w16(addr, value);
    else g.m.w8(addr, value);
  }
  const before = snapshot(g.m);
  const ret = ROUTINES[name](g, c.args, c.stack);
  const got = changed(before, g.m);
  const want = c.changed.filter(([a]) => !IGNORED.has(a));
  const problems: string[] = [];
  const key = (l: [number, number][]) => l.map(([a, v]) => `${a.toString(16)}=${v}`).join(' ');
  if (key(got) !== key(want)) {
    const w = new Map(want);
    const gm = new Map(got);
    const diffs = [...new Set([...w.keys(), ...gm.keys()])]
      .filter((a) => w.get(a) !== gm.get(a))
      .slice(0, 6)
      .map((a) => `${a.toString(16)}: original ${w.get(a) ?? '(unchanged)'}, port ${gm.get(a) ?? '(unchanged)'}`);
    problems.push(`memory differs: ${diffs.join('; ')}`);
  }
  if (RETURNS.has(name)) {
    const r = typeof ret === 'boolean' ? (ret ? 1 : 0) : ret;
    if (r !== c.v0) problems.push(`returned ${r}, original ${c.v0}`);
  }
  if (g.rng.calls !== c.rand || g.rng.seed !== c.seedAfter) problems.push(`rand() calls ${g.rng.calls}, original ${c.rand}`);
  if (g.se.join() !== c.se.join()) problems.push(`se [${g.se}], original [${c.se}]`);
  if (g.bgm.join() !== c.bgm.join()) problems.push(`bgm [${g.bgm}], original [${c.bgm}]`);
  return problems.length ? problems.join('\n') : null;
}

describe('original routines (Unicorn fixtures)', () => {
  for (const name of Object.keys(ROUTINES)) {
    const path = join(DIR, `${name}.json.gz`);
    it.skipIf(!existsSync(path))(name, () => {
      const { cases } = JSON.parse(gunzipSync(readFileSync(path)).toString('utf8')) as { cases: Case[] };
      expect(cases.length).toBeGreaterThan(0);
      const failures: string[] = [];
      cases.forEach((c, i) => {
        const problem = runCase(name, c);
        if (problem && failures.length < 3) failures.push(`case ${i}: ${problem}`);
      });
      expect(failures.join('\n\n')).toBe('');
    });
  }
});
