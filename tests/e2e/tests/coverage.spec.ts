import { test, expect } from '@playwright/test';

/**
 * 計画§12 導線④ / §9 VS1-1 / FR-021: 未対応自治体は選択不可(開始ボタンなし)で、
 * 「未対応」表示と公式サイトへの導線のみを出す(未対応を対応済みに見せない=CLAUDE.md原則9)。
 */
test('未対応自治体: 八王子市は選択不可で公式リンクのみ表示', async ({ page }) => {
  // なぜ: 杉並区・千代田区(Step4)・品川区・大田区(Step5)は対応(supported=true)になったため、未対応の対比例として
  // 未整備の八王子市(市部)を用いる(未対応を対応済みに見せない=CLAUDE.md原則9)。
  await page.goto('/');

  // 未対応の市は「市部」グループに折りたたまれているため、まず展開する(キーボード操作可)。
  await page.locator('summary').filter({ hasText: '市部' }).click();

  const hachioji = page.getByRole('listitem').filter({ hasText: '八王子市' });
  await expect(hachioji).toBeVisible();
  await expect(hachioji.getByText('未対応')).toBeVisible();

  // 開始ボタンは無い(選択不可)。
  await expect(hachioji.getByRole('button', { name: /この自治体で始める/ })).toHaveCount(0);

  // 公式サイトへの導線のみ。
  const link = hachioji.getByRole('link', { name: /公式サイトを見る/ });
  await expect(link).toHaveAttribute('href', /city\.hachioji\.tokyo\.jp/);

  // 対応自治体(Step4の杉並・千代田、Step5の品川・大田を含む)には開始ボタンがある(対比)。
  // 既定では先頭8件しか並ばないため、先に全件を出してから確かめる(2026-08-09)。
  await page.getByRole('button', { name: /すべて表示/ }).click();
  for (const name of ['世田谷区', '江東区', '新宿区', '杉並区', '千代田区', '品川区', '大田区']) {
    const card = page.getByRole('listitem').filter({ hasText: name });
    await expect(card.getByRole('button', { name: /この自治体で始める/ })).toBeVisible();
  }
});
