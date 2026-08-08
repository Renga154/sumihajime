import { test, expect } from '@playwright/test';
import { seedProfile } from './helpers';

/**
 * Wave3 施設地図(/facilities)。地理院タイルの地図コンテナと出典表示を検証する。
 *
 * 監査P0-2の回帰固定: maplibre のワーカーがバンドルされておらず、タイルが1枚も
 * 読み込まれないまま「出典: 地理院タイル」だけが出ていた。タイル画像のリクエストが
 * 実際に発生することと、出典表示がその実態に一致することをここで担保する。
 * ネットワーク依存のテストなので、外部到達不能な環境では失敗する(それが検知したい状態)。
 */

const GSI_TILE = /cyberjapandata\.gsi\.go\.jp\/xyz\/std\//;

test('施設地図: 地理院タイルの画像リクエストが実際に発生する(世田谷)', async ({ page }) => {
  const tileRequests: string[] = [];
  page.on('request', (req) => {
    if (GSI_TILE.test(req.url())) tileRequests.push(req.url());
  });

  await page.goto('/');
  await seedProfile(page, '13112');
  await page.goto('/facilities');
  await expect(page.getByRole('heading', { name: '窓口一覧' })).toBeVisible();

  await expect.poll(() => tileRequests.length, { timeout: 20_000 }).toBeGreaterThan(0);
});

test('施設地図: タイルが読み込めたときだけ「地理院タイル」出典を出す(世田谷)', async ({ page }) => {
  await page.goto('/');
  await seedProfile(page, '13112');
  await page.goto('/facilities');

  await expect(page.getByRole('heading', { name: '窓口一覧' })).toBeVisible();

  // 地図コンテナ(aria-labelで命名した region)が表示される。
  const map = page.getByRole('region', { name: /地図/ });
  await expect(map).toBeVisible();

  // 出典「地理院タイル」はタイル読込成功後に出る(タイル利用条件)。
  const attribution = map.getByRole('link', { name: '地理院タイル' });
  await expect(attribution).toBeVisible({ timeout: 20_000 });
  await expect(attribution).toHaveAttribute('href', /maps\.gsi\.go\.jp/);
});

test('施設地図: タイル配信が届かないときは地図を畳み、出典も出さない(世田谷)', async ({ page }) => {
  // 地理院タイルへの到達を遮断し、「壊れた地図＋出典だけ」が起きないことを確認する。
  await page.route(GSI_TILE, (route) => route.abort());

  await page.goto('/');
  await seedProfile(page, '13112');
  await page.goto('/facilities');
  await expect(page.getByRole('heading', { name: '窓口一覧' })).toBeVisible();

  const map = page.getByRole('region', { name: /地図/ });
  await expect(map.getByText('地図を表示できませんでした', { exact: false })).toBeVisible({
    timeout: 20_000,
  });
  await expect(map.getByRole('link', { name: '地理院タイル' })).toHaveCount(0);

  // 一覧は無傷(縮退のみ)。
  await expect(page.getByRole('listitem').first()).toBeVisible();
});

test('施設地図: 座標が無い施設は「地図未対応(座標データなし)」注記付きで一覧に残る(新宿)', async ({
  page,
}) => {
  await page.goto('/');
  await seedProfile(page, '13104');
  await page.goto('/facilities');

  await expect(page.getByRole('heading', { name: '窓口一覧' })).toBeVisible();
  // 座標を持つ施設があるため地図コンテナは表示される。
  await expect(page.getByRole('region', { name: /地図/ })).toBeVisible();

  // 若松町特別出張所(公式ページに緯度経度が無く座標未整備)は一覧に残り、注記が付く。
  const wakamatsu = page.getByRole('listitem').filter({ hasText: '若松町特別出張所' });
  await expect(wakamatsu).toBeVisible();
  await expect(wakamatsu.getByText('地図未対応（座標データなし）')).toBeVisible();
});
