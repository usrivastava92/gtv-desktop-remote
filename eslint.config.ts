// @ts-check
import js from '@eslint/js';
import prettierConfig from 'eslint-config-prettier';
import importPlugin from 'eslint-plugin-import-x';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
// PR-boundaries (Wave 14): hard layer boundary enforcement via
// no-restricted-imports rules scoped per layer. The eslint-plugin-boundaries
// package is not actually used at runtime (we use no-restricted-imports
// directly which is simpler and type-safe), but it's kept as a devDependency
// as a signal of intent and for future graph-based rules.
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // ── Ignored paths ─────────────────────────────────────────────────────────
  {
    ignores: [
      'dist/**',
      'dist-electron/**',
      'release/**',
      'node_modules/**',
      'build/**',
      'public/**',
    ],
  },

  // ── Base JS recommended ───────────────────────────────────────────────────
  js.configs.recommended,

  // ── TypeScript recommended (no type-aware rules yet — applied below) ──────
  ...tseslint.configs.recommended,

  // ── React ─────────────────────────────────────────────────────────────────
  {
    plugins: {
      'react-hooks': reactHooksPlugin,
    },
    rules: {
      ...reactHooksPlugin.configs.recommended.rules,
    },
  },

  // ── Import ordering ───────────────────────────────────────────────────────
  {
    plugins: { 'import-x': importPlugin },
    rules: {
      'import-x/order': [
        'error',
        {
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],
      'import-x/no-duplicates': 'error',
    },
  },

  // ── Type-aware rules for renderer + shared (tsconfig.json) ───────────────
  {
    files: ['src/renderer/**/*.{ts,tsx}', 'src/shared/**/*.ts', 'vite.config.ts'],
    extends: [...tseslint.configs.strictTypeChecked, ...tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // ── Type-aware rules for Electron main process (tsconfig.electron.json) ──
  {
    files: ['src/main/**/*.ts'],
    extends: [...tseslint.configs.strictTypeChecked, ...tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.electron.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // ── Custom rule overrides ─────────────────────────────────────────────────
  {
    rules: {
      // Void operator is used intentionally for floating promise suppression
      'no-void': ['error', { allowAsStatement: true }],

      // TypeScript equivalents replace these
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],

      // Allow non-null assertions only when necessary
      '@typescript-eslint/no-non-null-assertion': 'warn',

      // Consistent type imports
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],

      // require() is used for CJS interop with androidtv-remote
      '@typescript-eslint/no-require-imports': 'warn',

      // Disable overly noisy rules for this codebase
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },

  // ── Scripts (plain JS/MJS — Node globals, no type-checking) ──────────────
  {
    files: ['scripts/**/*.{mjs,js,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
      },
    },
  },

  // ── Type-aware rules for backend (tsconfig.backend.json) ─────────────────
  {
    files: ['src/backend/**/*.ts'],
    extends: [...tseslint.configs.strictTypeChecked, ...tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.backend.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // ── Layer boundary enforcement ────────────────────────────────────────────
  // src/backend/** must NOT import from electron, react, src/main, src/renderer
  {
    files: ['src/backend/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['electron', 'electron/*'],
              message:
                'src/backend must not import from electron. Use an injected port (IPathProvider, IDialogPresenter, etc.) instead.',
            },
            {
              group: ['react', 'react-dom', 'react/*', 'react-dom/*'],
              message: 'src/backend must not import from React.',
            },
            {
              group: ['*/src/main/*', '../main/*', '../../main/*'],
              message:
                'src/backend must not import from src/main. Dependency flows main → backend, not the other way.',
            },
            {
              group: ['*/src/renderer/*', '../renderer/*', '../../renderer/*'],
              message: 'src/backend must not import from src/renderer.',
            },
          ],
        },
      ],
    },
  },

  // ── src/renderer must NOT import from src/backend directly ───────────────
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['*/src/backend/*', '../backend/*', '../../backend/*'],
              message:
                'src/renderer must not import from src/backend directly. Use the typed gtvRemote RPC client in src/renderer/api/ instead.',
            },
            {
              group: ['electron', 'electron/*'],
              message: 'src/renderer must not import from electron.',
            },
          ],
        },
      ],
    },
  },

  // ── Root config files (type-checking not needed) ──────────────────────────
  {
    files: [
      '*.config.{ts,mjs,js}',
      'vitest.config.ts',
      'commitlint.config.ts',
      'tailwind.config.ts',
    ],
    extends: [tseslint.configs.disableTypeChecked],
  },

  // ── Backend layer boundary (PR-boundaries, Wave 14) ──────────────────────
  // src/backend/** must NEVER import from electron, react, renderer, or main.
  // Violations are reported as errors so they block CI.
  {
    files: ['src/backend/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['electron', 'electron/*'],
              message:
                'src/backend/ must not import from electron. Use a port interface (IFileSystem, ILogger, etc.) instead.',
            },
            {
              group: ['react', 'react/*', 'react-dom', 'react-dom/*'],
              message: 'src/backend/ must not import from React.',
            },
            {
              group: ['**/renderer/**', '../renderer/**', '../../renderer/**'],
              message: 'src/backend/ must not import from the renderer layer.',
            },
            {
              group: ['**/main/**', '../main/**', '../../main/**'],
              message:
                'src/backend/ must not import from src/main/. If you need something from main, expose it via a port interface.',
            },
          ],
        },
      ],
    },
  },

  // ── Renderer layer boundary (PR-boundaries, Wave 14) ─────────────────────
  // src/renderer/** must NEVER import from src/backend/ or src/main/.
  // Renderer talks to main ONLY through window.gtvRemote (the IPC surface
  // defined in shared/ipcContract.ts + preload.ts).
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/backend/**', '../backend/**', '../../backend/**'],
              message:
                'src/renderer/ must not import from src/backend/. Use the IPC bridge (window.gtvRemote) instead.',
            },
            {
              group: ['**/main/**', '../main/**', '../../main/**'],
              message:
                'src/renderer/ must not import from src/main/. Use the IPC bridge (window.gtvRemote) instead.',
            },
            {
              group: ['electron', 'electron/*'],
              message: 'src/renderer/ must not import from electron directly.',
            },
          ],
        },
      ],
    },
  },

  // ── Prettier must be last to disable formatting rules ─────────────────────
  prettierConfig
);
