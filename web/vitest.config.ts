import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Replays are long and synchronous; with every file running in parallel even short ones can
  // take far longer than vitest's 5 s default.
  test: { include: ['test/**/*.test.ts'], testTimeout: 120_000 },
});
