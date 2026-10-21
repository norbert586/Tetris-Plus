// Each program's images (its data file, extracted by tools/extract-assets.ts) and how it sorts
// its sprite objects (docs/re/shell.md §6).
import type { DrawStyle } from './renderer';

export const PROGRAM_ART: Record<string, { pack: string; style: DrawStyle }> = {
  PAZLE: { pack: 'pazlee.pack', style: { kind: 'pazle' } },
  RANKING: { pack: 'rankinge.pack', style: { kind: 'shell', yBias: 0x74, bucket: 0 } },
};
