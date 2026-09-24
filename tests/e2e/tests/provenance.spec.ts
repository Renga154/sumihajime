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
  // 同日さらに練馬(13120)の11ソース+板橋(13119)の12ソースが人手レビュー承認(103→126)、
  // 同日さらにBatch7の4区(中野16=既存13+wagmap由来3 / 豊島11 / 北15 / 荒川14)が承認(126→182)、
  // 同日さらにBatch10の足立(13121)16ソース+江戸川(13123)17ソースが人手レビュー承認(182→215)、
  // 同日さらに残る8区(Batch8=中央12/港14/文京14/台東13/墨田14、Batch9=目黒14/渋谷22/葛飾13)が
  // 人手レビュー承認(215→331)、渋谷区のArcGIS Hub配信の施設CSV1件を新規登録して331→332。
  // 2026-09-25 の再監査で花畑区民事務所の施設ページを出典に追加し 332→333。
  await expect(page.getByText('公式ソース総数').locator('..')).toContainText('333');
  await expect(page.getByRole('heading', { name: 'データの新しさ' })).toBeVisible();
  await expect(page.getByText(/残り\s*\d+日/).first()).toBeVisible();

  // 2. データソース台帳テーブル: セクション見出し + 公式リンク + CC BY バッジ。
  const ledgerHeading = page.getByRole('heading', { name: 'データソース台帳' });
  await expect(ledgerHeading).toBeVisible();
  // 自治体ごとの台帳は既定で折りたたむ(全展開すると12万px超になり、長すぎて誰も辿れない)。
  // 情報は削っていないので、自治体名のサマリーを開けば従来どおりの表に到達できる。
  const ledger = page.locator('section').filter({ has: ledgerHeading });
  await ledger.locator('summary').filter({ hasText: '世田谷区' }).click();
  // 台帳は table 要素で描画され、タイトル列に公式ページへの外部リンクを持つ。
  await expect(ledger.getByRole('table').first()).toBeVisible();
  // CC BY ライセンスのバッジが少なくとも1つ表示される(帰属表示の対象)。
  await expect(ledger.getByText(/CC BY/).first()).toBeVisible();

  // 3. オープンデータ品質レポート: 2事例(新宿の施設欠落・世田谷の列スワップ)。
  await expect(page.getByRole('heading', { name: 'オープンデータ品質レポート' })).toBeVisible();
  await expect(page.getByText('公共施設一覧CSVに特別出張所が1か所欠落していた')).toBeVisible();
  await expect(page.getByText('ごみ分別CSVで列見出しと中身が入れ替わっていた')).toBeVisible();
  // 出典(md)を明記している。
  await expect(page.getByText('docs/research/opendata-gaps.md')).toBeVisible();
});

/**
 * 透明性ページの「辿れること」の担保。情報を削らずに初期表示を短くしたので、
 *  - 冒頭に要約が出る
 *  - 既定では自治体ごとの詳細が閉じている(初期の文書高さがモバイル数画面分に収まる)
 *  - 自治体名で絞り込める(絞り込むと該当分は開く)
 * を検証する。
 */
test('透明性ページ: 要約・既定の折りたたみ・自治体名での絞り込み', async ({ page }) => {
  await page.goto('/about-data');
  await expect(page.getByRole('heading', { name: 'このページの要約' })).toBeVisible();

  // 要約タイル(対応23区 / 掲載62件)。「対応している自治体と内容」の節見出しと紛れないよう
  // 要約セクションに限定して照合する。
  const summary = page.getByRole('region', { name: 'このページの要約' });
  await expect(
    summary.getByText('対応している自治体', { exact: true }).locator('..'),
  ).toContainText('23');
  await expect(
    summary.getByText('掲載している自治体', { exact: true }).locator('..'),
  ).toContainText('62');

  // 既定ではすべての詳細が閉じており、初期の文書高さがモバイル20画面分(16,240px)未満に収まる。
  // 修正前は124,379px(約150画面分)あり、透明性ページとして実質読めなかった。
  const openCount = await page.locator('details[open]').count();
  expect(openCount).toBe(0);
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  expect(height, `初期の文書高さ ${height}px`).toBeLessThan(812 * 20);

  // 自治体名で絞り込むと、対応状況・出典の双方が絞られ、該当分は開いた状態になる。
  await page.getByLabel('自治体名で絞り込む').fill('ねりま');
  await expect(page.getByRole('heading', { name: '練馬区', level: 3 })).toHaveCount(2);
  await expect(page.getByRole('heading', { name: '世田谷区', level: 3 })).toHaveCount(0);
  await expect(page.locator('details[open]')).toHaveCount(2);
});

/**
 * 旧URL /coverage は透明性ページ /about-data へリダイレクトされる(直リンク互換 / Step2)。
 */
test('/coverage は /about-data へリダイレクトされる', async ({ page }) => {
  await page.goto('/coverage');
  await expect(page).toHaveURL(/\/about-data$/);
  await expect(page.getByRole('heading', { name: 'このサービスのデータについて' })).toBeVisible();
});
