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

/**
 * なぜ画面を出すだけでなく質問を送るか: 回答本文中のURLをリンク化したのはこの経路だけで、
 * 未送信の画面にはそのDOMが存在しない。リンク名・コントラスト等をaxeに見せるには、
 * 実際に回答を描画させる必要がある。
 */
test('a11y: AIの回答(本文中の公式リンク込み)に重大違反なし', async ({ page }) => {
  await mockChat(page, 'link-in-answer');
  await page.goto('/');
  await startWithWard(page, '世田谷区');
  await fillWizardStep1(page, { moveDate: '2026-08-15', origin: '東京都外' });
  await generateChecklist(page);

  await page.getByLabel(/質問を入力/).fill('粗大ごみの出し方は？');
  await page.getByRole('button', { name: '質問する' }).click();

  // 回答本文のURLが <a href> として描画されている(ただの文字列ではない)。
  const link = page.getByRole('link', { name: /www\.town\.hachijo\.tokyo\.jp/ });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('href', 'https://www.town.hachijo.tokyo.jp/');
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

test('a11y: 比較ページ「自治体ごとの期限のちがい」に重大違反なし', async ({ page }) => {
  await page.goto('/differences');
  await expect(page.getByRole('heading', { name: '自治体ごとの期限のちがい' })).toBeVisible();
  // 非同期ロード完了(比較セルの描画)を待ってから検査する。
  // 自治体未選択で到達した場合、左は「基準の区」(既定値を「あなたの区」と断定しない)。
  await expect(page.getByLabel('基準の自治体')).toBeVisible();
  await assertNoSerious(page);
});

test('a11y: 透明性ページ「このサービスのデータについて」に重大違反なし', async ({ page }) => {
  await page.goto('/about-data');
  await expect(page.getByRole('heading', { name: 'このサービスのデータについて' })).toBeVisible();
  // 台帳テーブルの描画完了(非同期ロード)を待ってから検査する。
  await expect(page.getByRole('heading', { name: 'データソース台帳' })).toBeVisible();
  await assertNoSerious(page);
});

test('a11y: 利用規約・プライバシーポリシーに重大違反なし', async ({ page }) => {
  for (const [path, heading] of [
    ['/terms', '利用規約'],
    ['/privacy', 'プライバシーポリシー'],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
    await assertNoSerious(page);
  }
});
