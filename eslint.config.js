// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/.wrangler/**',
      '**/node_modules/**',
      '**/playwright-report/**',
      '**/test-results/**',
      // 提出スライドの生成スクリプト(スタンドアロンCJS。アプリのlint規約対象外)
      'docs/submission/slides/**',
      // エージェント用の一時 git worktree。リポジトリの複製であり、本体を lint すれば足りる
      // (複製側は ignores のパスが1階層ずれるため、除外しないと同じ違反を二重報告する)。
      '**/.claude/worktrees/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
);
