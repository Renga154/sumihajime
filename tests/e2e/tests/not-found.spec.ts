import { test, expect } from '@playwright/test';

/**
 * 未定義URLの受け皿(監査P0-1)。React Router の英語既定エラー画面
 * (「Unexpected Application Error!」「Hey developer 👋」)を利用者に見せない。
 * ヘッダー・フッター・復帰導線が残ることも併せて確認する。
 */

const DEVELOPER_FACING = [
  'Unexpected Application Error',
  'Hey developer',
  'ErrorBoundary',
  'errorElement',
];

test('未定義URL: 日本語の404案内を出し、開発者向けの英語画面を出さない', async ({ page }) => {
  const res = await page.goto('/typo-url');
  // 本文は既知ルートと同じ index.html(クライアントルーティングは無傷)だが、ステータスは 404。
  // 200を返すとクローラ・外形監視には「正常なページ」に見えてしまう(ソフト404)。
  expect(res?.status()).toBe(404);

  await expect(
    page.getByRole('heading', { level: 1, name: 'ページが見つかりません' }),
  ).toBeVisible();

  const body = await page.evaluate(() => document.body.innerText);
  for (const phrase of DEVELOPER_FACING) {
    expect(body).not.toContain(phrase);
  }
});

test('未定義URL: ヘッダー・フッターと復帰導線が残る', async ({ page }) => {
  await page.goto('/checklist2');

  await expect(page.getByRole('navigation', { name: 'メインナビゲーション' })).toBeVisible();
  await expect(page.getByRole('contentinfo')).toBeVisible();

  const recovery = page.getByRole('navigation', { name: '他のページへ移動' });
  await expect(recovery.getByRole('link', { name: 'ホーム（自治体を選ぶ）' })).toBeVisible();

  // 実際にホームへ戻れる。
  await recovery.getByRole('link', { name: 'ホーム（自治体を選ぶ）' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('region', { name: 'ご利用の前に' })).toBeVisible();
});

test('未定義URL: <title> がトップと区別できる', async ({ page }) => {
  await page.goto('/');
  const home = await page.title();

  await page.goto('/typo-url');
  const notFound = await page.title();

  expect(notFound).not.toBe(home);
  expect(notFound).toContain('ページが見つかりません');
});
