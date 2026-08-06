import { test, expect } from '@playwright/test';

/**
 * Wave2/Step5/Batch6-A/Batch7: 東京都62市区町村の誠実リスト化。対応中13件(千代田/新宿/江東/品川/
 * 大田/世田谷/中野/杉並/豊島/北/荒川/板橋/練馬)を主役に、未対応は「23区/市部/町村部」の
 * 折りたたみグループに収め、各自治体は選択不可で公式サイト導線のみ(CLAUDE.md原則9)。
 */
test('62リスト: 対応13件+未対応グループの展開と公式リンク', async ({ page }) => {
  await page.goto('/');

  // 対応している自治体は13件(=「この自治体で始める」ボタンは13だけ。Batch7で中野・豊島・北・荒川を追加)。
  await expect(page.getByRole('button', { name: 'この自治体で始める' })).toHaveCount(13);

  // 既定では未対応グループは折りたたまれ、市部の自治体は見えない。
  const hachiojiInitial = page.getByRole('listitem').filter({ hasText: '八王子市' });
  await expect(hachiojiInitial).toHaveCount(0);

  // 「市部」を開く → 八王子市が公式サイト導線つきで現れる(開始ボタンは無い)。
  await page.locator('summary').filter({ hasText: '市部' }).click();
  const hachioji = page.getByRole('listitem').filter({ hasText: '八王子市' });
  await expect(hachioji).toBeVisible();
  await expect(hachioji.getByRole('button', { name: 'この自治体で始める' })).toHaveCount(0);
  await expect(hachioji.getByRole('link', { name: '公式サイトを見る' })).toHaveAttribute(
    'href',
    /city\.hachioji\.tokyo\.jp/,
  );

  // 「町村部」を開く → 島しょ部(小笠原村)も公式リンクで到達できる。
  await page.locator('summary').filter({ hasText: '町村部' }).click();
  const ogasawara = page.getByRole('listitem').filter({ hasText: '小笠原村' });
  await expect(ogasawara).toBeVisible();
  await expect(ogasawara.getByRole('link', { name: '公式サイトを見る' })).toHaveAttribute(
    'href',
    /vill\.ogasawara\.tokyo\.jp/,
  );
});
