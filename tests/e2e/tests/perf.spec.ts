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
