import { test, expect } from '@playwright/test';
import { fillWizardStep1, generateChecklist, startWithWard } from './helpers';

/**
 * 計画§12 導線① / §9 VS1: ランディング(免責5項目)→世田谷選択→Step1入力→暫定生成→
 * 期限順セクション・転入届(8/29)→詳細→公式根拠カード(公式URL・最終確認日)。
 * このスペックのみ desktop プロジェクトでも実行する(要件の「デスクトップ1本」)。
 */
test('主要導線: 免責→世田谷→入力→生成→チェックリスト→詳細→根拠カード', async ({ page }) => {
  await page.goto('/');

  // 免責(§16.2)の5項目が入力導線の前に表示される。
  const disclaimer = page.getByRole('region', { name: 'ご利用の前に' });
  await expect(disclaimer).toBeVisible();
  for (const label of ['入力の目的', '保存範囲', '非公式サービス', '最終確認', '個人情報']) {
    await expect(disclaimer.getByText(label, { exact: false })).toBeVisible();
  }
  await expect(disclaimer.getByRole('listitem')).toHaveCount(5);

  // 世田谷を選択 → ウィザードStep1入力 → 暫定生成。
  await startWithWard(page, '世田谷区');
  await fillWizardStep1(page, { moveDate: '2026-08-15', origin: '東京都外' });
  await generateChecklist(page);

  // ヘッダー: 自治体・引越し日。
  await expect(page.getByRole('heading', { name: 'あなたのチェックリスト' })).toBeVisible();
  await expect(page.getByText('世田谷区').first()).toBeVisible();
  await expect(page.getByText('2026年8月15日')).toBeVisible();

  // 期限順セクション「転入後すぐ」に転入届(urgent, 期限 2026年8月29日)。
  const rightAfter = page.getByRole('region', { name: '転入後すぐ' });
  await expect(rightAfter).toBeVisible();
  const tenyu = page.getByRole('listitem').filter({ hasText: '転入届' });
  await expect(tenyu).toBeVisible();
  await expect(tenyu.getByText('2026年8月29日')).toBeVisible();

  // 詳細へ。
  await tenyu.getByRole('link', { name: /詳細・必要書類・公式根拠を見る/ }).click();
  await expect(page).toHaveURL(/\/procedures\//);
  await expect(page.getByRole('heading', { name: /転入届/ })).toBeVisible();

  // 公式の根拠カード: 公式URL(公式ページを開く)・最終確認日。
  // 詳細画面の Section は accessible name を持たない <section> のため、見出しで束ねる。
  const evidenceHeading = page.getByRole('heading', { name: '公式の根拠' });
  await expect(evidenceHeading).toBeVisible();
  const evidence = page.locator('section').filter({ has: evidenceHeading });
  const officialLink = evidence.getByRole('link', { name: '公式ページを開く' }).first();
  await expect(officialLink).toHaveAttribute('href', /city\.setagaya\.lg\.jp/);
  await expect(evidence.getByText('最終確認日')).toBeVisible();
  await expect(evidence.getByText('2026年7月21日')).toBeVisible();
});
