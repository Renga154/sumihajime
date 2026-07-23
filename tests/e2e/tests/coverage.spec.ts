import { test, expect } from '@playwright/test';

/**
 * 計画§12 導線④ / §9 VS1-1 / FR-021: 未対応自治体は選択不可(開始ボタンなし)で、
 * 「未対応」表示と公式サイトへの導線のみを出す(未対応を対応済みに見せない=CLAUDE.md原則9)。
 */
test('未対応自治体: 杉並区は選択不可で公式リンクのみ表示', async ({ page }) => {
  await page.goto('/');

  const suginami = page.getByRole('listitem').filter({ hasText: '杉並区' });
  await expect(suginami).toBeVisible();
  await expect(suginami.getByText('未対応')).toBeVisible();

  // 開始ボタンは無い(選択不可)。
  await expect(suginami.getByRole('button', { name: 'この自治体で始める' })).toHaveCount(0);

  // 公式サイトへの導線のみ。
  const link = suginami.getByRole('link', { name: '公式サイトを見る' });
  await expect(link).toHaveAttribute('href', /city\.suginami\.tokyo\.jp/);

  // 対応自治体(世田谷・江東・新宿)には開始ボタンがある(対比)。
  for (const name of ['世田谷区', '江東区', '新宿区']) {
    const card = page.getByRole('listitem').filter({ hasText: name });
    await expect(card.getByRole('button', { name: 'この自治体で始める' })).toBeVisible();
  }
});
