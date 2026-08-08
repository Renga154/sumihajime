import { test, expect } from '@playwright/test';
import { fillWizardStep1, generateChecklist, mockChat, startWithWard } from './helpers';

/**
 * 「区ごとの期限のちがい」(/differences)の受入。
 *
 * 固定すること:
 *  1. チェックリストからリンク1つで到達できる(導線)。
 *  2. 比較ページであることが冒頭で明示され、2区を選ぶと値・公式文言・出典リンク・最終確認日が出る。
 *  3. 全区一覧へ到達できる(情報を隠さない)。
 *  4. 【最重要】チェックリスト側には他区の値・区名が出ない(CLAUDE.md原則4)。
 *     比較機能を足したことで原則4を壊していないことを、実際の画面テキストで確認する。
 */

test('チェックリストからリンク1つで比較ページへ到達し、値と出典が出る', async ({ page }) => {
  await mockChat(page, 'disabled');
  await page.goto('/');
  await startWithWard(page, '世田谷区');
  await fillWizardStep1(page, { moveDate: '2026-09-15', origin: '東京都外' });
  await generateChecklist(page);

  await page.getByRole('link', { name: '区ごとの期限のちがいを見る' }).click();
  await expect(page).toHaveURL(/\/differences$/);

  // 位置づけの明示(原則4)。
  await expect(page.getByText('これは自治体間の比較ページです。')).toBeVisible();
  await expect(
    page.getByText(/あなたのチェックリストには、選んだ自治体の情報だけを表示しています/),
  ).toBeVisible();

  // 選択中の自治体が「あなたの区」の初期値になる。
  await expect(page.getByLabel('あなたの区')).toHaveValue('13112');

  // 子ども医療費助成: 世田谷(3か月)と渋谷(14日)で実際に値が違う。
  await page.getByLabel('くらべる区').selectOption('13113');
  const section = page.locator('section', {
    has: page.getByRole('heading', { name: '子ども医療費助成の申請期限' }),
  });
  await expect(section.getByText('この2区では扱いが違います。')).toBeVisible();
  await expect(section.getByText('3か月以内に申請').first()).toBeVisible();
  await expect(section.getByText('14日以内に申請').first()).toBeVisible();

  // 各セルに公式ソースへのリンクと最終確認日が付く(原則2)。
  const mine = section.locator('div', { hasText: 'あなたの区' }).first();
  await expect(mine.getByRole('link').first()).toHaveAttribute('href', /^https:\/\//);
  await expect(section.getByText(/最終確認 \d{4}年\d{1,2}月\d{1,2}日/).first()).toBeVisible();

  // 全区一覧へ到達できる(折りたたみ。情報は隠さない)。
  const all = section.getByText(/対応している\d+区すべての値を見る/);
  await expect(all).toBeVisible();
  await all.click();
  await expect(
    section.getByText('区の公式ページに申請期限の記載なし（要確認）').first(),
  ).toBeVisible();
});

test('モバイル幅で横スクロールが発生しない', async ({ page }) => {
  await page.goto('/differences');
  await expect(page.getByRole('heading', { name: '区ごとの期限のちがい' })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});

test('原則4: チェックリスト画面に他区の名称・値が出ない', async ({ page }) => {
  await mockChat(page, 'disabled');

  // 区名はAPI(D1の municipalities)から取る。区が増えても検査対象が自動で増える。
  const res = await page.request.get('/api/municipalities');
  const munis = (await res.json()) as { code: string; name: string; supported: boolean }[];
  const wards = munis.filter((m) => m.supported && /^131\d\d$/.test(m.code));
  expect(wards.length).toBeGreaterThanOrEqual(13);

  await page.goto('/');
  await startWithWard(page, '世田谷区');
  await fillWizardStep1(page, { moveDate: '2026-09-15', origin: '東京都外' });
  await generateChecklist(page);

  const text = (await page.locator('main').innerText()) ?? '';
  for (const w of wards) {
    if (w.code === '13112') continue;
    expect(text.includes(w.name), `チェックリストに「${w.name}」が混入`).toBe(false);
  }
  // 比較ページへの導線はあるが、他区の値そのものは出ていない。
  expect(text).toContain('区ごとの期限のちがいを見る');
});
