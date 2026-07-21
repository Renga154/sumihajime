import { defineConfig } from 'vitest/config';

/**
 * なぜ: API統合テストは Node 環境で実行し、Miniflare(test/d1-harness.ts)から取り出した
 * 本物のD1バインディングを Hono app へ注入する。Miniflare(workerd)の起動に時間がかかるため
 * hook/test のタイムアウトを広げる。
 */
export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 30000,
    hookTimeout: 60000,
  },
});
