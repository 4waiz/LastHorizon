// ESLint 10 flat config. Replaces .eslintrc.cjs, which the eslintrc format
// no longer supports. Rules are carried over unchanged from that file so the
// migration is a format change, not a policy change.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  // Global ignores. A config object holding only `ignores` applies repo-wide,
  // which is the flat-config replacement for `ignorePatterns`.
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'scripts/blender/**',
      '.playwright-mcp/**',
      '**/*.cjs',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
    },
  },

  // Tests may log freely.
  {
    files: ['tests/**/*.ts'],
    languageOptions: { globals: { ...globals.node } },
    rules: { 'no-console': 'off' },
  },

  // Build/CI scripts are plain Node ESM and report through the console.
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: { 'no-console': 'off' },
  },
);
