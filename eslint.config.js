// Flat config, scoped to Track B's directories so it cannot reformat or fail teammates' code.
// The starter kit ships no linter; D can widen `files` during root integration.
import tseslint from 'typescript-eslint';

const TRACK_B = ['packages/*/src/**/*.ts', 'apps/api/src/**/*.ts', 'apps/api/scripts/**/*.ts'];

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', '**/coverage/**', 'packages/contracts/src/types.ts'] },
  {
    files: TRACK_B,
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // Real-bug rules: this codebase is almost entirely async scheduling.
      // node:test's `test()` returns a promise the runner owns; flagging it is noise, not a finding.
      '@typescript-eslint/no-floating-promises': [
        'error',
        {
          allowForKnownSafeCalls: [
            { from: 'package', name: 'test', package: 'node:test' },
            { from: 'package', name: 'it', package: 'node:test' },
          ],
        },
      ],
      // Implementing a Promise-returning interface method without awaiting inside it is correct.
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-unnecessary-condition': 'warn',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      // The house style: no `any`, narrow `unknown` instead.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'off', // too noisy against zod inference
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': 'error',
      eqeqeq: ['error', 'always'],
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },
  {
    // The logger is the one place allowed to touch the console, and scripts are CLIs.
    files: ['packages/orchestrator/src/logger.ts', 'apps/api/scripts/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
  {
    // Tests assert on loose fixtures and deliberately forge invalid shapes.
    files: ['**/*.test.ts', '**/src/testing/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unnecessary-condition': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
    },
  },
);
