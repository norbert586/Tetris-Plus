// Screen 1: the world map (map_step_dispatch). The assistant speaks, the player picks a zone
// among those not yet cleared, then on to the zone's story scene.
import * as A from '../addr';
import type { Game } from '../game';
import { dialogueRun, dialogueStart } from '../dialogue';
import { animSet, animTick, objectClear, objectsClear } from '../objects';
import { bgmRequest, sePlay } from '../sound';
import * as V from '../vars';

const MAP_X = 0x800945dc; // int[4]: per player, two x positions
const ZONE_BIT = 0x800e1218; // int[5]
const ZONE_POS = 0x800e122c; // (x, y) per zone
const ZONE_NAME = 0x800e1254; // image per zone
const MARKER = 0x29;

export function scr01Map(g: Game): void {
  STEPS[g.m.s32(g.pv(A.STEP))](g);
}

const next = (g: Game, n = 1) => g.m.add32(g.pv(A.STEP), n);

function put(g: Game, n: number, image: number, x: number, y: number, player: number, layer: number) {
  const m = g.m;
  const o = A.obj(g.ob + n);
  m.w32(o + A.O_PLAYER, player);
  m.w32(o + A.O_20, layer);
  m.w32(o + A.O_IMAGE, image);
  m.w32(o + A.O_X, x);
  m.w32(o + A.O_Y, y);
}

const cleared = (g: Game, zone: number) =>
  (g.m.s32(ZONE_BIT + 4 * zone) & g.m.s32(g.pv(V.ZONES_CLEARED))) !== 0;

function markerAtZone(g: Game): void {
  const m = g.m;
  const zone = m.s32(g.pv(V.ZONE));
  const o = A.obj(g.ob + MARKER);
  m.w32(o + A.O_X, m.s32(ZONE_POS + zone * 8));
  m.w32(o + A.O_Y, m.s32(ZONE_POS + zone * 8 + 4));
  m.w32(A.obj(g.ob + 0x22) + A.O_IMAGE, m.s32(ZONE_NAME + zone * 4));
}

const STEPS: ((g: Game) => void)[] = [
  // 0x800A8BA8: the map.
  (g) => {
    const m = g.m;
    objectsClear(g, g.p * 400 + 0x1e, g.p * 400 + 0x1ae);
    bgmRequest(g, 0x2f);
    const p = g.p;
    put(g, 0x1e, 0x1012c, 0, 0x80000, p, 2);
    put(g, 0x1f, 0x10130, 0, 0x250000, p, 2);
    put(g, 0x20, 0x1012d, 0x20000, 0x280000, p, 2);
    put(g, 0x21, 0x1012e, m.s32(MAP_X + 4 * p), 0x110000, 0, 0);
    put(g, 0x22, 0x1012f, m.s32(MAP_X + 4 * (p + 2)), 0x220000, 0, 0);
    next(g);
  },
  // 0x800A8D74: what the assistant says depends on the zones cleared.
  (g) => {
    const m = g.m;
    const zc = m.s32(g.pv(V.ZONES_CLEARED));
    if ((zc & 0xf) === 0) {
      next(g);
    } else if (zc === 0x1f) {
      m.w32(g.pv(A.SCREEN), 8);
      m.w32(g.pv(A.STEP), 0);
      m.w32(g.pv(A.SUBSTEP), 0);
      m.w32(g.pv(A.STEP4), 0);
    } else {
      dialogueStart(g, 0xb);
      next(g, 3);
    }
  },
  // 0x800A8ED0
  (g) => {
    const m = g.m;
    const s4 = m.s32(g.pv(A.STEP4));
    if (s4 === 0) {
      dialogueStart(g, 10);
      m.add32(g.pv(A.STEP4), 1);
    } else if (s4 === 1) {
      next(g);
    }
  },
  (g) => next(g, 3),
  (g) => next(g),
  (g) => next(g),
  // 0x800A9078: zone markers, the cursor on the first zone not cleared.
  (g) => {
    const m = g.m;
    for (let z = 0; z < 4; z++) {
      const o = A.obj(g.ob + 0x24 + z);
      m.w32(o + A.O_PLAYER, g.p);
      m.w32(o + A.O_20, 2);
      m.w32(o + A.O_IMAGE, cleared(g, z) ? 0x10133 : 0x10131);
      m.w32(o + A.O_X, m.s32(ZONE_POS + z * 8));
      m.w32(o + A.O_Y, m.s32(ZONE_POS + z * 8 + 4));
    }
    const o = A.obj(g.ob + MARKER);
    m.w32(o + A.O_PLAYER, g.p);
    m.w32(o + A.O_20, 2);
    animSet(g, g.ob + MARKER, 0x20);
    while (cleared(g, m.s32(g.pv(V.ZONE)))) {
      const z = m.s32(g.pv(V.ZONE));
      m.w32(g.pv(V.ZONE), z < 3 ? z + 1 : 0);
    }
    markerAtZone(g);
    next(g);
  },
  // 0x800A9354: Left/Right pick a zone (skipping cleared ones), Cross confirms.
  (g) => {
    const m = g.m;
    dialogueRun(g);
    const was = m.s32(g.pv(V.ZONE));
    if (g.pressed() & 0x2000) {
      do {
        const z = m.s32(g.pv(V.ZONE)) + 1;
        m.w32(g.pv(V.ZONE), z > 3 ? 0 : z);
      } while (cleared(g, m.s32(g.pv(V.ZONE))));
    } else if (g.pressed() & 0x8000) {
      do {
        const z = m.s32(g.pv(V.ZONE)) - 1;
        m.w32(g.pv(V.ZONE), z < 0 ? 3 : z);
      } while (cleared(g, m.s32(g.pv(V.ZONE))));
    } else if (g.pressed() & 0x40) {
      animSet(g, g.ob + MARKER, 0x21);
      dialogueStart(g, m.s32(g.pv(V.ZONE)) * 2 + 0x72);
      sePlay(g, 0);
      next(g);
      return;
    } else {
      animTick(g, g.ob + MARKER);
      return;
    }
    if (was !== m.s32(g.pv(V.ZONE))) sePlay(g, 3);
    markerAtZone(g);
  },
  // 0x800A9704
  (g) => {
    if (dialogueRun(g)) {
      dialogueStart(g, g.m.s32(g.pv(V.ZONE)) * 2 + 0x73);
      next(g);
    } else {
      animTick(g, g.ob + MARKER);
    }
  },
  // 0x800A97D8
  (g) => {
    if (dialogueRun(g)) {
      objectClear(g, g.ob + MARKER);
      next(g);
    }
    animTick(g, g.ob + MARKER);
  },
  (g) => next(g),
  // 0x800A9894: the story scene.
  (g) => {
    const m = g.m;
    m.w32(g.pv(A.SCREEN), 2);
    m.w32(g.pv(A.STEP), 0);
    m.w32(g.pv(A.SUBSTEP), 0);
    m.w32(g.pv(A.STEP4), 0);
  },
];
