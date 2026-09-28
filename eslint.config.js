// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';

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
  {
    // React Hooks のルールは React を使う apps/web のみに絞る(apps/api 等 React 非依存の
    // コードへ無関係なルールを適用しない)。
    //
    // なぜ react-hooks/recommended(-latest) をそのまま使わないか: v7 の recommended には
    // React Compiler 前提の新ルール(immutability・purity・set-state-in-render 等)が多数
    // 含まれ、このタスクの依頼(rules-of-hooks を error、exhaustive-deps を warn にする)を
    // 超えて無関係な指摘を大量に生む。ここでは依頼された2つのルールだけを明示的に指定する。
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      // exhaustive-deps は全指摘を修正・整理済み(1件は useAsync.ts の意図的な省略として
      // 理由コメント付きで無効化を明示)なので error に上げ、新規の見落としを再発させない。
      'react-hooks/exhaustive-deps': 'error',
    },
  },
);
