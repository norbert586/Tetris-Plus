// 16.16 fixed point, as the original keeps positions (docs/spec/README.md, Conventions).
export const FX = 0x10000;
/** n pixels as 16.16. */
export const px = (n: number): number => (n * FX) | 0;
/** A 16.16 position's cell: (value >> 16) / 10 with C division (truncates toward zero). */
export const cell = (v: number): number => Math.trunc((v >> 16) / 10);
/** C signed division. */
export const cdiv = (a: number, b: number): number => Math.trunc(a / b);
