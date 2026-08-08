import { test, expect } from '@playwright/test';
import { seedProfile, tabUntil } from './helpers';

/**
 * 独立点検 P1-6 の回帰固定。
 *
 * 修正前の実測: /facilities(世田谷)のフォーカス可能要素は105個で、最初の施設リンク
 * 「地図で見る」は57番目だった。内訳は地図canvas1個 + `.maplibregl-marker` 46個
 * (すべて tabindex=0 / aria-label="Map marker")。axeはこれを違反として検出しないため、
 * 「マーカーがタブ順に入っていないこと」「地図を飛ばす導線があること」をここで固定する。
 *
 * 地図のピンが伝える情報(名称・カテゴリ・住所)は下の窓口一覧が完全に代替するため、
 * マーカーをタブ順から外すことで情報は失われない。
 */

test('窓口一覧: 地図マーカーはタブ順に入らず、日本語のラベルを持つ(世田谷)', async ({ page }) => {
  await page.goto('/');
  await seedProfile(page, '13112');
  await page.goto('/facilities');
  await expect(page.getByRole('heading', { name: '窓口一覧' })).toBeVisible();

  // マーカーが描画されるまで待つ(地図が出ない環境ではこのテストはスキップ相当になる)。
  const markers = page.locator('.maplibregl-marker');
  await expect.poll(() => markers.count(), { timeout: 20_000 }).toBeGreaterThan(10);

  const attrs = await markers.evaluateAll((els) =>
    els.map((el) => ({
      tabIndex: (el as HTMLElement).tabIndex,
      label: el.getAttribute('aria-label') ?? '',
    })),
  );
  expect(attrs.length).toBeGreaterThan(10);
  for (const a of attrs) {
    expect(a.tabIndex).toBe(-1);
    // 英語の既定ラベルではなく、施設名を含む日本語ラベルになっている。
    expect(a.label).not.toBe('Map marker');
    expect(a.label).toMatch(/の地図上の位置$/);
  }

  // 地図canvasのアクセシブル名も日本語(既定は "Map")。
  await expect(page.locator('canvas.maplibregl-canvas')).toHaveAttribute('aria-label', /地図/);
});

test('窓口一覧: 数回のTabで窓口一覧の最初のリンクに到達できる(世田谷)', async ({ page }) => {
  await page.goto('/');
  await seedProfile(page, '13112');
  await page.goto('/facilities');
  await expect(page.getByRole('heading', { name: '窓口一覧' })).toBeVisible();
  await expect
    .poll(() => page.locator('.maplibregl-marker').count(), { timeout: 20_000 })
    .toBeGreaterThan(10);

  // フォーカス可能要素の中で、最初の施設リンクが何番目かを数える(点検が使った式と同じ)。
  const indexOfFirstFacilityLink = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('a[href],button,input,select,textarea,[tabindex]')]
      .filter((e) => e.tabIndex >= 0)
      .findIndex((e) => (e.textContent ?? '').includes('地図で見る')),
  );
  // 修正前は57。地図のタブストップはcanvas+ズーム2個の計3個だけになるので大幅に下がる。
  expect(indexOfFirstFacilityLink).toBeGreaterThan(0);
  expect(indexOfFirstFacilityLink).toBeLessThan(20);

  // 「本文へスキップ」→「地図を飛ばして窓口の一覧へ」の2段で、一覧まで到達できる。
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const toSkipMain = await tabUntil(page, (i) => i.text.includes('本文へスキップ'), 5);
  expect(toSkipMain).toBeLessThanOrEqual(3);
  await page.keyboard.press('Enter');

  const toSkipMap = await tabUntil(page, (i) => i.text.includes('地図を飛ばして窓口の一覧へ'), 10);
  expect(toSkipMap).toBeLessThanOrEqual(5);
  await page.keyboard.press('Enter');

  // 一覧の先頭へ着地し、そこからのTabは一覧内のリンクへ進む。
  await expect(page.locator('#facility-list')).toBeFocused();
  await tabUntil(page, (i) => i.text.includes('地図で見る'), 5);
});
