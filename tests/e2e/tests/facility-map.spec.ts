import { test, expect } from '@playwright/test';
import { seedProfile } from './helpers';

/**
 * Wave3 施設地図(/facilities)。地理院タイルの地図コンテナと出典表示を検証する。
 * タイルの実読込はネットワーク/WebGL依存のためアサートしない(コンテナ・出典・縮退のみ検証)。
 */

test('施設地図: 地図コンテナと「地理院タイル」出典を表示する(世田谷)', async ({ page }) => {
  // localStorage を触るため、まずオリジンを確立してから seed する。
  await page.goto('/');
  await seedProfile(page, '13112');
  await page.goto('/facilities');

  await expect(page.getByRole('heading', { name: '窓口一覧' })).toBeVisible();

  // 地図コンテナ(aria-labelで命名した region)が表示される。
  const map = page.getByRole('region', { name: /地図/ });
  await expect(map).toBeVisible();

  // 出典「地理院タイル」を地図隅に明記(タイル利用条件)。WebGLの成否に依存しない静的表示。
  const attribution = map.getByRole('link', { name: '地理院タイル' });
  await expect(attribution).toBeVisible();
  await expect(attribution).toHaveAttribute('href', /maps\.gsi\.go\.jp/);
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
