// libetc PadRead button bits (docs/re/static-bootstrap.md §3.1). Pad 1 is the low half of a
// PadRead word, pad 2 the high half.
export const L2 = 0x0001;
export const R2 = 0x0002;
export const L1 = 0x0004;
export const R1 = 0x0008;
export const TRIANGLE = 0x0010;
export const CIRCLE = 0x0020;
export const CROSS = 0x0040;
export const SQUARE = 0x0080;
export const SELECT = 0x0100;
export const START = 0x0800;
export const UP = 0x1000;
export const RIGHT = 0x2000;
export const DOWN = 0x4000;
export const LEFT = 0x8000;

export const BUTTONS: Record<string, number> = {
  L2, R2, L1, R1, TRIANGLE, CIRCLE, CROSS, SQUARE, SELECT, START, UP, RIGHT, DOWN, LEFT,
};
