// Addresses of the game state the core uses, as in the original (docs/re/ram-map.md,
// re/symbols/PAZLE.vars.tsv). Per-player variables are arrays: player p's word is 4 bytes
// further (Game.pv adds it) unless noted.

/** The boot program's shared state block (docs/re/static-bootstrap.md §1). */
export const S = 0x8003e668;
export const COUNTER = S + 0x40; // u32 global frame counter, never reset between programs
export const NEXT_PROGRAM = S + 0x48;
export const NEXT_PARAM = S + 0x4c;
export const PHASE = S + 0x50;
export const SUBPHASE = S + 0x54;
export const EXIT_FLAG = S + 0x1fcf4;
export const BEST_TIMES = S + 0x4ad84; // u16[100]
export const RANKING = S + 0x4aea0;
export const SETTINGS = S + 0x4b4ec; // 24 bytes: option settings
export const ROT_CCW_MASK = S + 0x4b4ec; // [2] rotation buttons
export const ROT_CW_MASK = S + 0x4b4f4; // [2]
export const SETTING_4FC = S + 0x4b4fc; // u8
export const SETTING_4FD = S + 0x4b4fd; // u8: music arrangement
export const DIFFICULTY = S + 0x4b4fe; // u8
export const MUSIC_VOLUME = S + 0x4b4ff; // u8
export const SE_VOLUME = S + 0x4b500; // u8
export const SCREEN = S + 0x4b508; // [2]
export const STEP = S + 0x4b510; // [2]
export const SUBSTEP = S + 0x4b518; // [2]
export const STEP4 = S + 0x4b520; // [2]
export const TWO_PLAYER = S + 0x4b53c;
export const MENU_ROWS = S + 0x4b538;

/** Sprite objects: 1,050 of 0x7C bytes (docs/re/static-bootstrap.md §3.4). */
export const OBJECTS = S + 0x5c;
export const OBJ_SIZE = 0x7c;
export const OBJ_COUNT = 0x41a;
// Field offsets within an object.
export const O_X = 0x00;
export const O_Y = 0x04;
export const O_SCALE_X = 0x08;
export const O_SCALE_Y = 0x0c;
export const O_ROT = 0x10;
export const O_KIND = 0x14; // -1 box fill (calls rand() 3x when drawn), -2/-3 fades
export const O_18 = 0x18;
export const O_PLAYER = 0x1c;
export const O_20 = 0x20;
export const O_IMAGE = 0x24; // 0x10000 + item + 1; 0 = not drawn
export const O_28 = 0x28;
export const O_ANIM = 0x2c; // animation id (table 0x800E2E6C); 0 = none
export const O_ANIM_TIMER = 0x30;
export const O_ANIM_FRAME = 0x34;
export const O_VX = 0x38;
export const O_VY = 0x3c;
export const O_PRIORITY = 0x40;
export const O_FLIP = 0x44;
export const O_PALETTE = 0x48;
export const O_4C = 0x4c;
export const O_50 = 0x50;

/** Address of object n. */
export const obj = (n: number): number => OBJECTS + n * OBJ_SIZE;

// PAZLE.EXE globals
export const PLAYER = 0x800eead0; // current player index, 0 or 1
export const OBJ_BASE = 0x800ee410; // player * 400: the current player's first sprite object
export const PAD_HELD = 0x800f36f2; // u16, player stride 6
export const PAD_PRESSED = 0x800f36f4; // u16, player stride 6
export const BIOS_SEED = 0x800083a4; // OpenBIOS's rand() seed (not modelled in Mem; see Rng)
