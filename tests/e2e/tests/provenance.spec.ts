import { test, expect } from '@playwright/test';

/**
 * 透明性ページ「このサービスのデータについて」(/about-data)。
 * 本プロダクトの核である「公式根拠と来歴の徹底」の可視化を検証する:
 *  - 鮮度サマリー(ソース総数・年度データの残日数)
 *  - データソース台帳テーブル(公式リンク・CC BY バッジ・帰属表示)
 *  - オープンデータ品質レポート(2事例)
 * 実API(/api/sources, /api/municipalities)を用いる(モックしない)。
 */
test('透明性ページ: 鮮度サマリー・台帳テーブル・CC BYバッジ・品質レポート2件', async ({ page }) => {
  await page.goto('/about-data');

  // 見出し。
  await expect(page.getByRole('heading', { name: 'このサービスのデータについて' })).toBeVisible();

  // 1. 鮮度サマリー: ソース総数タイルと、年度データの残日数カウントダウン。
  await expect(page.getByText('公式ソース総数')).toBeVisible();
  // Step5統合後、承認済み公式ソースは98件(Step4時点の72 + 品川12 + 大田14)。
  // 2026-08-07 人手レビュー承認(ADR-009)でライフライン等4手続きの出典5件が追加approved化(98→103)、
  // 同日さらに練馬(13120)の11ソース+板橋(13119)の12ソースが人手レビュー承認(103→126)。
  await expect(page.getByText('公式ソース総数').locator('..')).toContainText('126');
  await expect(page.getByRole('heading', { name: 'データの新しさ' })).toBeVisible();
  await expect(page.getByText(/残り\s*\d+日/).first()).toBeVisible();

  // 2. データソース台帳テーブル: セクション見出し + 公式リンク + CC BY バッジ。
  await expect(page.getByRole('heading', { name: 'データソース台帳' })).toBeVisible();
  // CC BY ライセンスのバッジが少なくとも1つ表示される(帰属表示の対象)。
  await expect(page.getByText(/CC BY/).first()).toBeVisible();
  // 台帳は table 要素で描画され、タイトル列に公式ページへの外部リンクを持つ。
  const ledgerTables = page.getByRole('table');
  expect(await ledgerTables.count()).toBeGreaterThan(0);

  // 3. オープンデータ品質レポート: 2事例(新宿の施設欠落・世田谷の列スワップ)。
  await expect(page.getByRole('heading', { name: 'オープンデータ品質レポート' })).toBeVisible();
  await expect(page.getByText('公共施設一覧CSVに特別出張所が1か所欠落していた')).toBeVisible();
  await expect(page.getByText('ごみ分別CSVで列見出しと中身が入れ替わっていた')).toBeVisible();
  // 出典(md)を明記している。
  await expect(page.getByText('docs/research/opendata-gaps.md')).toBeVisible();
});

/**
 * 旧URL /coverage は透明性ページ /about-data へリダイレクトされる(直リンク互換 / Step2)。
 */
test('/coverage は /about-data へリダイレクトされる', async ({ page }) => {
  await page.goto('/coverage');
  await expect(page).toHaveURL(/\/about-data$/);
  await expect(page.getByRole('heading', { name: 'このサービスのデータについて' })).toBeVisible();
});
