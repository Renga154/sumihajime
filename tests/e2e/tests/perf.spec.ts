import { test, expect } from '@playwright/test';
import { seedProfile } from './helpers';

/**
 * 計画§12 / REQUIREMENTS §17: 性能計測(ローカル参考値)。
 * - POST /api/checklists を20回叩き p95 を算出(閾値アサートは p95 < 2000ms のみ)。
 * - チェックリスト画面の DOMContentLoaded を参考計測(レポートのみ・アサートなし)。
 */

const PROFILE = {
  destination: { municipalityCode: '13112' },
  moveDate: '2026-08-15',
  originType: 'outside_tokyo',
  household: { memberCount: 3, ageBands: ['adult', 'age0_2', 'elementary'] },
  flags: {
    hasMyNumberCard: true,
    needsNationalHealthInsurance: true,
    needsNationalPension: true,
    hasSchoolOrChildcareNeeds: true,
    hasDog: true,
    dogHasMicrochip: 'unknown',
    needsDisabilityOrCareSupport: false,
    needsForeignResidentGuidance: false,
    needsVehicleGuidance: false,
    isPregnantMember: false,
  },
} as const;

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const idx = Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1);
  return sorted[Math.max(0, idx)]!;
}

test('性能: POST /api/checklists p95 < 2秒(ローカル20回)', async ({ request }, testInfo) => {
  const N = 20;
  const latencies: number[] = [];
  for (let i = 0; i < N; i++) {
    const t0 = performance.now();
    const res = await request.post('/api/checklists', {
      data: PROFILE,
      headers: { 'Content-Type': 'application/json' },
    });
    const dt = performance.now() - t0;
    expect(res.ok()).toBeTruthy();
    latencies.push(dt);
  }
  const sorted = [...latencies].sort((a, b) => a - b);
  const stats = {
    runs: N,
    min: Math.round(sorted[0]!),
    median: Math.round(percentile(sorted, 0.5)),
    p95: Math.round(percentile(sorted, 0.95)),
    max: Math.round(sorted[sorted.length - 1]!),
  };
  // レポートに残す。
  console.log(`[perf] POST /api/checklists (ms): ${JSON.stringify(stats)}`);
  await testInfo.attach('checklist-latency.json', {
    body: JSON.stringify(stats, null, 2),
    contentType: 'application/json',
  });

  expect(stats.p95, `p95=${stats.p95}ms should be < 2000ms`).toBeLessThan(2000);
});

/**
 * 独立点検 P1-7 の回帰固定。修正前のトップ初回表示は約3.23MBで、うち3.09MB(96%)が
 * 日本語Webフォント3ウェイト(1ファイル=約1MB、unicode-range 無しで全ページ必ず取得)だった。
 * 想定利用者は引越し直後の細い回線であり、この構成は主要ターゲットに最も重い負担をかける。
 *
 * 現在は unicode-range で120分割したサブセットを使い、実際に描画する文字を含むスライスだけを
 * 取りに行く。DADS準拠の3ウェイトは維持したまま転送量だけが落ちる。
 * 閾値(800KB)は「1ウェイトぶんの集約サブセット(約1MB)すら下回る」ことを担保する水準に置く。
 */
test('性能: トップのフォント転送量が集約サブセット1本ぶんを下回る', async ({ page }, testInfo) => {
  const fonts = new Map<string, number>();
  page.on('response', async (res) => {
    if (!/\.woff2?(\?|$)/.test(res.url())) return;
    try {
      fonts.set(res.url(), (await res.body()).byteLength);
    } catch {
      // 本文を取れない応答(キャンセル等)は計上しない。
    }
  });

  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

  const totalBytes = [...fonts.values()].reduce((a, b) => a + b, 0);
  const stats = { requests: fonts.size, totalBytes, totalKB: Math.round(totalBytes / 1024) };
  console.log(`[perf] landing font payload: ${JSON.stringify(stats)}`);
  await testInfo.attach('landing-font-payload.json', {
    body: JSON.stringify(stats, null, 2),
    contentType: 'application/json',
  });

  // 分割が効いていれば数百KB以下に収まる。1本1MBの集約サブセットへ戻ると必ず超える。
  expect(totalBytes, `landing font payload = ${stats.totalKB}KB`).toBeLessThan(800 * 1024);
  // 分割されている(=1本あたりが小さい)ことも確認する。
  for (const [url, size] of fonts) {
    expect(size, `${url} = ${Math.round(size / 1024)}KB`).toBeLessThan(200 * 1024);
  }
});

test('性能(参考): チェックリスト画面のDOMContentLoadedを計測', async ({ page }, testInfo) => {
  await page.goto('/');
  await seedProfile(page, '13112');
  await page.goto('/checklist');
  await expect(page.getByText(/件 完了/)).toBeVisible();

  const timing = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0] as
      PerformanceNavigationTiming | undefined;
    if (!nav) return null;
    return {
      domContentLoadedMs: Math.round(nav.domContentLoadedEventEnd - nav.startTime),
      loadMs: Math.round(nav.loadEventEnd - nav.startTime),
    };
  });
  console.log(`[perf] checklist navigation timing (ms): ${JSON.stringify(timing)}`);
  await testInfo.attach('checklist-domcontentloaded.json', {
    body: JSON.stringify(timing, null, 2),
    contentType: 'application/json',
  });
  // 参考計測のため閾値アサートはしない(計測できたことのみ確認)。
  expect(timing).not.toBeNull();
});
