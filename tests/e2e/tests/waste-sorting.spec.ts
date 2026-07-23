import { test, expect } from '@playwright/test';
import { seedProfile } from './helpers';

/**
 * Wave2: ごみ分別検索UI(GET /api/waste-sorting)。ローカル実データ(世田谷=13112, 787品目)で、
 * q未指定のカテゴリ件数チップ→品目名入力→結果(分別区分バッジ)+出典(CC BY 4.0)を検証する。
 * 入力欄はテキストのみ(PII欄なし=§13)。
 */
test('分別検索: 品目名を入力すると分別区分と出典(CC BY 4.0)が表示される', async ({ page }) => {
  await page.goto('/');
  await seedProfile(page, '13112');
  await page.goto('/waste');

  const search = page.getByRole('region', { name: '分別を調べる' });
  await expect(search).toBeVisible();

  // q未指定はカテゴリ別件数チップで検索を促す。
  await expect(search.getByText(/品目名を入力して検索してください/)).toBeVisible();

  // 品目名で検索(デバウンス後にAPIが走る)。
  await search.getByLabel('品目名で調べる').fill('ペットボトル');

  // 結果(品目名)+分別区分バッジ+出典(帰属: CC BY 4.0)+公式導線。
  await expect(search.getByText('ペットボトル').first()).toBeVisible();
  await expect(search.getByText(/CC BY 4\.0/)).toBeVisible();
  await expect(
    search.getByRole('link', { name: /公式の分別ページで最新情報を確認する/ }),
  ).toBeVisible();

  // 0件時は「見つかりません」+公式分別ページ導線(推測しない=原則3)。
  await search.getByLabel('品目名で調べる').fill('絶対に存在しない品目名XYZ123');
  await expect(search.getByText(/一致する品目は見つかりませんでした/)).toBeVisible();
  await expect(
    search.getByRole('link', { name: /世田谷区の公式サイトで分別を調べる/ }),
  ).toBeVisible();
});
