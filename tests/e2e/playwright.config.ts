import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/**
 * なぜ: T-017 のE2E/a11y/性能計測基盤。ブラウザ依存のためCIには組み込まず、ローカル/手動実行。
 *
 * テスト対象サーバー: ポート8788で `wrangler dev`(--local)。8787は別プロセスが使う可能性が
 * あるため使わない。webServer.command が「ローカルD1シード(3自治体)→ web build → wrangler dev」を
 * 一括で行い、Playwrightが起動待ち・自動終了まで面倒を見る(reuseExistingServer で二重起動を回避)。
 *
 * ビューポート: モバイル(375x812)を主線、デスクトップ(1280x800)は主要導線1本のみ。
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');

export const BASE_URL = 'http://localhost:8788';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: false,
  retries: 0,
  workers: 4,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  timeout: 30_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
  },

  projects: [
    {
      // 主線: モバイル幅で全スペックを実行(§8 モバイル主要導線)。
      name: 'mobile',
      use: { ...devices['Desktop Chrome'], viewport: { width: 375, height: 812 } },
    },
    {
      // デスクトップは主要導線1本のみ(要件の「デスクトップ1本」)。
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
      testMatch: /main-flow\.spec\.ts/,
    },
  ],

  webServer: {
    command:
      'pnpm --filter @tmn/publish exec tsx src/publish.ts && pnpm --filter web build && pnpm --filter api exec wrangler dev --port 8788 --local',
    cwd: repoRoot,
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: true,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
