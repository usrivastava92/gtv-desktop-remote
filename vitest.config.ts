import { defineConfig } from 'vitest/config';

/**
 * Vitest configuration. Originally backend-only; PR-renderer-infra
 * (Wave 11) introduces a second test project for the renderer that uses
 * jsdom + @testing-library/react. The two projects share one runner so a
 * single `npm test` invocation covers both halves.
 *
 * Backend project (`src/backend/`):
 *   - Node environment, deterministic, no DOM.
 *   - Coverage thresholds ratchet per wave per REFACTOR_PLAN.md §4.
 *
 * Renderer project (`src/renderer/`):
 *   - jsdom environment, React 18 concurrent runtime, no Electron.
 *   - PR-renderer-infra ships the harness only; the smoke test exercises
 *     a tiny inline hook to prove `renderHook` + cleanup work end-to-end.
 *   - Real hook tests land in subsequent PRs as `App.tsx` (2,079 LOC)
 *     decomposes into `src/renderer/hooks/` and `src/renderer/features/`.
 */
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/backend/**/*.ts', 'src/renderer/**/*.{ts,tsx}'],
      exclude: [
        'src/backend/**/__tests__/**',
        'src/backend/**/*.{test,spec}.ts',
        'src/backend/**/index.ts',
        'src/renderer/**/__tests__/**',
        'src/renderer/**/*.{test,spec}.{ts,tsx}',
        'src/renderer/main.tsx',
        'src/renderer/vite-env.d.ts',
      ],
      thresholds: {
        lines: 0,
        functions: 0,
        branches: 0,
        statements: 0,
      },
    },
    projects: [
      {
        test: {
          name: 'backend',
          include: ['src/backend/**/*.{test,spec}.ts'],
          environment: 'node',
          globals: false,
          clearMocks: true,
          restoreMocks: true,
        },
      },
      {
        test: {
          name: 'renderer',
          include: ['src/renderer/**/*.{test,spec}.{ts,tsx}'],
          environment: 'jsdom',
          globals: false,
          clearMocks: true,
          restoreMocks: true,
          setupFiles: ['./src/renderer/__tests__/setup.ts'],
        },
      },
    ],
  },
});
