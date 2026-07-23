import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import {
  fillWizardStep1,
  generateChecklist,
  mockChat,
  seedProfile,
  startWithWard,
} from './helpers';

/**
 * 計画§12 / REQUIREMENTS §15.3: 主要5画面(ランディング/ウィザード/チェックリスト/詳細/ごみ)で
 * axe-core を実行し、重大(critical/serious)違反0件を担保する。軽微(minor/moderate)は対象外。
 */

interface AxeViolation {
  id: string;
  impact?: string | null;
  help: string;
  nodes: { target: unknown[] }[];
}

function format(vios: AxeViolation[]): string {
  if (vios.length === 0) return 'no critical/serious violations';
  return vios
    .map((v) => `- [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} node(s))`)
    .join('\n');
}

async function assertNoSerious(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const serious = results.violations.filter(
    (v) => v.impact === 'critical' || v.impact === 'serious',
  ) as unknown as AxeViolation[];
  expect(serious, format(serious)).toEqual([]);
}

test('a11y: ランディング(自治体選択)に重大違反なし', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '自治体を選ぶ' })).toBeVisible();
  await assertNoSerious(page);
});

test('a11y: ウィザードStep1に重大違反なし', async ({ page }) => {
  await page.goto('/');
  await startWithWard(page, '世田谷区');
  await expect(page.getByLabel(/引越し日または転入予定日/)).toBeVisible();
  await assertNoSerious(page);
});

test('a11y: チェックリスト(チャットパネル込み)に重大違反なし', async ({ page }) => {
  await mockChat(page, 'normal');
  await page.goto('/');
  await startWithWard(page, '世田谷区');
  await fillWizardStep1(page, { moveDate: '2026-08-15', origin: '東京都外' });
  await generateChecklist(page);
  await expect(page.getByRole('heading', { name: 'AIに質問する' })).toBeVisible();
  await assertNoSerious(page);
});

test('a11y: 手続き詳細(根拠カード込み)に重大違反なし', async ({ page }) => {
  await mockChat(page, 'normal');
  await page.goto('/');
  await seedProfile(page, '13112');
  await page.goto('/procedures/procedure_resident_registration');
  await expect(page.getByRole('heading', { name: '公式の根拠' })).toBeVisible();
  await assertNoSerious(page);
});

test('a11y: ごみ収集(地区選択・収集曜日込み)に重大違反なし', async ({ page }) => {
  await page.goto('/');
  await seedProfile(page, '13104');
  await page.goto('/waste');
  await expect(page.getByLabel('地区を選ぶ')).toBeVisible();
  await page.getByLabel('地区を選ぶ').selectOption({ label: '愛住町' });
  await expect(page.getByRole('heading', { name: '収集曜日' })).toBeVisible();
  await assertNoSerious(page);
});

test('a11y: 窓口一覧(施設地図込み)に重大違反なし', async ({ page }) => {
  await page.goto('/');
  await seedProfile(page, '13112');
  await page.goto('/facilities');
  await expect(page.getByRole('heading', { name: '窓口一覧' })).toBeVisible();
  // 地図コンテナ(aria-label付きregion)が描画されてから検査する。
  await expect(page.getByRole('region', { name: /地図/ })).toBeVisible();
  await assertNoSerious(page);
});

test('a11y: 対応状況・データの来歴ダッシュボードに重大違反なし', async ({ page }) => {
  await page.goto('/coverage');
  await expect(page.getByRole('heading', { name: '対応状況・データの来歴' })).toBeVisible();
  // 台帳テーブルの描画完了(非同期ロード)を待ってから検査する。
  await expect(page.getByRole('heading', { name: 'データソース台帳' })).toBeVisible();
  await assertNoSerious(page);
});
