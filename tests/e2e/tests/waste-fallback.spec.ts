import { test, expect } from '@playwright/test';
import { seedProfile } from './helpers';

/**
 * Step4-A: 杉並区(13115)は対応自治体だが、収集曜日は第三者SaaS(コグモ)のJSウィジェット依存で
 * 機械取得不可のため waste.json を作らない(誠実縮退)。この場合、ごみページは曜日を推測表示せず、
 * 「収集曜日は未対応+公式サイト導線」の空状態へフォールバックする(CLAUDE.md原則3/9:
 * 推測しない・未対応を対応済みに見せない)。一方、ごみ分別辞書(waste_sorting)は別データとして
 * 整備済みのため、分別検索UIは引き続き表示される。
 */
test('杉並のごみページ: 収集曜日は誠実フォールバック(未対応+公式リンク)、分別検索は表示', async ({
  page,
}) => {
  await page.goto('/');
  await seedProfile(page, '13115');
  await page.goto('/waste');

  // 収集曜日の空状態(未対応の明示)。曜日は一切推測表示しない。
  await expect(
    page.getByRole('heading', { name: 'この自治体の収集曜日はまだデータ対応していません' }),
  ).toBeVisible();

  // 公式サイトへの導線(杉並区)。
  const officialLink = page.getByRole('link', { name: '杉並区の公式サイトで確認する' });
  await expect(officialLink).toBeVisible();
  await expect(officialLink).toHaveAttribute('href', /city\.suginami\.tokyo\.jp/);

  // 収集曜日テーブル(地区選択)は出さない(データが無いため)。
  await expect(page.getByRole('combobox', { name: '地区を選ぶ' })).toHaveCount(0);

  // 分別辞書(waste_sorting)は別データとして整備済みのため、分別検索UIは表示される。
  const search = page.getByRole('region', { name: '分別を調べる' });
  await expect(search).toBeVisible();
  // q未指定は登録品目件数の案内(分別辞書がシードされている=杉並128品目)。
  await expect(search.getByText(/品目名を入力して検索してください/)).toBeVisible();
  // 実データで検索でき、出典(CC BY 4.0の帰属)が表示される。
  await search.getByLabel('品目名で調べる').fill('電池');
  await expect(search.getByText(/CC BY 4\.0/)).toBeVisible();
});
