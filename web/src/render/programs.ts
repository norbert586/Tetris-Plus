// Each program's images (its data file, extracted by tools/extract-assets.ts) and how it sorts
// its sprite objects (docs/re/shell.md §6).
import type { DrawStyle } from './renderer';

export const PROGRAM_ART: Record<string, { pack: string; style: DrawStyle }> = {
  PAZLE: { pack: 'pazlee.pack', style: { kind: 'pazle' } },
  RANKING: { pack: 'rankinge.pack', style: { kind: 'shell', yBias: 0x74, bucket: 0 } },
  // SELECT's FUN_80096B7C: every object with a non-zero image, semi-transparency for blend kinds.
  SELECT: { pack: 'selecte.pack', style: { kind: 'shell', yBias: 0x78, bucket: 10, live: 'nonzero', semi: true } },
  TITLE: { pack: 'titlee.pack', style: { kind: 'shell', yBias: 0x74, bucket: 10, live: 'nonzero', semi: true } },
  // Not checked yet: from the survey (docs/re/shell.md §5); each port confirms its own.
  SW_ON: { pack: 'swone.pack', style: { kind: 'shell', yBias: 0x78, bucket: 10, live: 'nonzero', semi: true } },
  TIT_DEMO: { pack: 'tdemoe.pack', style: { kind: 'titdemo' } },
};
