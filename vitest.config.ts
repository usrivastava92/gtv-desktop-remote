import { defineConfig } from 'vitest/config';

/**
 * Vitest is scoped to `src/backend/` for the duration of the refactor. The
 * renderer (`src/renderer/`) and Electron shell (`src/main/`) are tested via
 * separate harnesses introduced in later PRs (React Testing Library +
 * Playwright smoke respectively).
 *
 * Coverage thresholds are intentionally zero in PR-1 and ratcheted up per
 * wave as the targeted modules land — see REFACTOR_PLAN.md §4.
 */
export default defineConfig({
  test: {
    include: ['src/backend/**/*.{test,spec}.ts'],
    environment: 'node',
    globals: false,
    clearMocks: true,
    restoreMocks: true,
    reporters: ['default'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/backend/**/*.ts'],
      exclude: [
        'src/backend/**/__tests__/**',
        'src/backend/**/*.{test,spec}.ts',
        'src/backend/**/index.ts',
      ],
      thresholds: {
        lines: 0,
        functions: 0,
        branches: 0,
        statements: 0,
      },
    },
  },
});
