import { test, expect } from '@playwright/test';
import { activeElementInfo, fillWizardStep1, generateChecklist, startWithWard } from './helpers';

/**
 * 遷移の基本(監査P1-3 / P1-4)。
 *  - 自治体を選んだ直後にウィザードの最下部へ着地しない(scrollY=0)
 *  - ブラウザバックで元のスクロール位置へ戻る
 *  - 遷移後のフォーカスが body に落ちない(ページ見出しへ移る)
 *  - ページごとに <title> が異なる
 */

test('遷移: 下までスクロールして区を選んでも、次の画面は先頭から始まる', async ({ page }) => {
  await page.goto('/');
  // 自治体リストの下の方まで送る。
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect.poll(async () => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);

  await startWithWard(page, '江東区');

  await expect.poll(async () => page.evaluate(() => window.scrollY)).toBe(0);
  // 最初の必須入力(引越し日)が画面内にある。
  await expect(page.getByLabel(/引越し日または転入予定日/)).toBeInViewport();
});

test('遷移: ブラウザバックでトップのスクロール位置が復元される', async ({ page }) => {
  await page.goto('/');
  // なぜページ丈から決めるのか: 固定値(1200)で下げていたが、トップの構成を変えて丈が縮むと
  // 目標がスクロール可能範囲を超え、テストが「復元の失敗」ではなく「そもそも下げられない」で
  // 落ちる。丈に依存しない形にして、測っているものを復元の精度だけに絞る(2026-08-09)。
  const before = await page.evaluate(() => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    window.scrollTo(0, Math.max(Math.min(600, max - 1), 0));
    return window.scrollY;
  });
  expect(before).toBeGreaterThan(0);

  await startWithWard(page, '江東区');
  await page.goBack();
  await expect(page).toHaveURL(/\/$/);

  await expect.poll(async () => page.evaluate(() => window.scrollY)).toBeGreaterThan(before - 50);
});

test('遷移: フォーカスが body に落ちず、ページ見出しへ移る', async ({ page }) => {
  await page.goto('/');
  await startWithWard(page, '江東区');

  await expect.poll(async () => (await activeElementInfo(page)).tag).toBe('H1');
  expect((await activeElementInfo(page)).text).toContain('条件を入力する');
});

test('遷移: ページごとに <title> が異なる', async ({ page }) => {
  const titles: string[] = [];
  // タイトルは遷移後の effect で書き換わるため、期待値へ落ち着くのを待ってから収集する。
  async function recordTitle(expected: RegExp) {
    await expect(page).toHaveTitle(expected);
    titles.push(await page.title());
  }

  await page.goto('/');
  await recordTitle(/^スミハジメ/);

  await startWithWard(page, '江東区');
  await recordTitle(/^条件を入力する/);

  await fillWizardStep1(page, { moveDate: '2026-08-15', origin: '東京都外' });
  await generateChecklist(page);
  await recordTitle(/^あなたのチェックリスト/);

  await page.getByRole('link', { name: '窓口一覧' }).click();
  await expect(page).toHaveURL(/\/facilities$/);
  await recordTitle(/^窓口一覧/);

  await page.getByRole('link', { name: 'ごみ収集' }).click();
  await expect(page).toHaveURL(/\/waste$/);
  await recordTitle(/^ごみ・資源の収集日/);

  expect(new Set(titles).size).toBe(titles.length);
  for (const t of titles) {
    expect(t).toContain('スミハジメ');
  }
});
