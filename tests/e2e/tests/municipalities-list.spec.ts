import { test, expect } from '@playwright/test';

/**
 * Wave2: 東京都62市区町村の誠実リスト化。対応中3件を主役に、未対応は「23区/市部/町村部」の
 * 折りたたみグループに収め、各自治体は選択不可で公式サイト導線のみ(CLAUDE.md原則9)。
 */
test('62リスト: 対応3件+未対応グループの展開と公式リンク', async ({ page }) => {
  await page.goto('/');

  // 対応している自治体は3件(=「この自治体で始める」ボタンは3つだけ)。
  await expect(page.getByRole('button', { name: 'この自治体で始める' })).toHaveCount(3);

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
