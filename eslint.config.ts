// @ts-check
import js from '@eslint/js';
import prettierConfig from 'eslint-config-prettier';
import importPlugin from 'eslint-plugin-import-x';
import reactPlugin from 'eslint-plugin-react';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
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
      react: reactPlugin,
      'react-hooks': reactHooksPlugin,
    },
    settings: {
      react: { version: 'detect' },
    },
    rules: {
      ...reactPlugin.configs.recommended.rules,
      ...reactHooksPlugin.configs.recommended.rules,
      // JSX transform (React 17+) — no need to import React in scope
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
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

  // ── Root config files (type-checking not needed) ──────────────────────────
  {
    files: ['*.config.{ts,mjs,js}', 'commitlint.config.ts', 'tailwind.config.ts'],
    extends: [tseslint.configs.disableTypeChecked],
  },

  // ── Prettier must be last to disable formatting rules ─────────────────────
  prettierConfig
);
