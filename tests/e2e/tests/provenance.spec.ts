import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';

const registryPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../docs/data-sources/registry.csv',
);

/** 台帳(registry.csv)の review_status=approved の行数。公開されるのは承認済みのみ(ADR-007)。 */
function approvedSourceCount(): number {
  const [header, ...rows] = readFileSync(registryPath, 'utf8').split(/\r?\n/).filter(Boolean);
  const statusCol = header!.split(',').indexOf('review_status');
  // 先頭から review_status 列までは引用符を含まない(注記など後ろの列にだけカンマが入る)。
  return rows.filter((r) => r.split(',')[statusCol] === 'approved').length;
}

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
  // 件数は台帳の承認済み行数と一致する(出典を1件承認するたびに手で書き換えずに済むよう、台帳から数える)。
  await expect(page.getByText('公式ソース総数').locator('..')).toContainText(
    String(approvedSourceCount()),
  );
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

  // 要約タイル(対応24自治体=23区+八王子市 / 掲載62件)。「対応している自治体と内容」の節見出しと紛れないよう
  // 要約セクションに限定して照合する。
  const summary = page.getByRole('region', { name: 'このページの要約' });
  await expect(
    summary.getByText('対応している自治体', { exact: true }).locator('..'),
  ).toContainText('24');
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
