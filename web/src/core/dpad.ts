// menu_dpad_repeat (0x800B552C): D-pad auto-repeat for menus, stepping on the first held frame,
// then every 4th frame once a direction has been held 20 frames (docs/spec/password.md §3).
import type { Game } from './game';

const HOLD = 0x800eea10; // [2] frames held, up to 20
const RELEASE = 0x800eea20; // [2]
const REPEAT = 0x800eea38; // [2] shared by both axes
export const DPAD_DY = 0x800eea34; // -1 Up, +1 Down, 0
export const DPAD_DX = 0x800eea30; // -1 Left, +1 Right, 0

export function menuDpadRepeat(g: Game): void {
  const m = g.m;
  m.w32(DPAD_DY, 0);
  m.w32(DPAD_DX, 0);
  const held = g.held();
  if ((held & 0xf000) === 0) {
    if (m.s32(g.pv(HOLD)) === 0x14) {
      if (m.add32(g.pv(RELEASE), 1) === 8) {
        m.w32(g.pv(RELEASE), 0);
        m.w32(g.pv(HOLD), 0);
      }
    } else {
      m.w32(g.pv(RELEASE), 0);
      m.w32(g.pv(HOLD), 0);
    }
  } else if (m.add32(g.pv(HOLD), 1) > 0x14) {
    m.w32(g.pv(HOLD), 0x14);
    m.w32(g.pv(RELEASE), 0);
  }
  // Returns the step for one axis: the direction on the first held frame or every 4th frame
  // after 20, else 0. The repeat counter is shared, so both axes count it.
  const axis = (dir: number): number => {
    const hold = m.s32(g.pv(HOLD));
    if (hold === 1) return dir;
    if (hold === 0x14 && m.add32(g.pv(REPEAT), 1) > 3) {
      m.w32(g.pv(REPEAT), 0);
      return dir;
    }
    return 0;
  };
  if (held & 0x5000) m.w32(DPAD_DY, axis(held & 0x1000 ? -1 : 1));
  if (g.held() & 0xa000) m.w32(DPAD_DX, axis(g.held() & 0x8000 ? -1 : 1));
}
