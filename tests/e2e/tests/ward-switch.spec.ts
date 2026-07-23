import { test, expect } from '@playwright/test';
import { fillWizardStep1, generateChecklist, startWithWard, toggleAgeBand } from './helpers';

/**
 * 計画§12 導線⑥ / §9 VS1-8 / 原則4(自治体を混ぜない):
 * - 江東区で子育てプロフィール → 学校転入・保育申込タスク(世田谷には無い差分)が出る。
 * - 新宿区でごみ地区(171地区の1つ)を選ぶ → 収集曜日 + 祝日の注意が出る。
 */

test('自治体切替(江東): 子育て条件で学校転入・保育申込タスクが表示される', async ({ page }) => {
  await page.goto('/');
  await startWithWard(page, '江東区');
  await fillWizardStep1(page, { moveDate: '2026-08-15', origin: '東京都外' });

  // Step2: 小学生を追加。
  await page.getByRole('button', { name: '世帯（任意）' }).click();
  await toggleAgeBand(page, '小学生', true);

  // Step3: 学校・保育の手続きが必要にチェック。
  await page.getByRole('button', { name: '条件チェック（任意）' }).click();
  await page.getByRole('checkbox', { name: '子どもの学校・保育関連の手続きが必要' }).check();

  await generateChecklist(page);

  // 江東固有: 学校転入学・保育申込。
  await expect(page.getByRole('listitem').filter({ hasText: '転入学' })).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: '保育園等の申込' })).toBeVisible();
});

test('自治体切替(新宿): ごみ地区を選ぶと収集曜日と祝日の注意が表示される', async ({ page }) => {
  await page.goto('/');
  await startWithWard(page, '新宿区');

  // ヘッダーのナビからごみ収集ページへ。
  await page.getByRole('link', { name: 'ごみ収集' }).click();
  await expect(page).toHaveURL(/\/waste$/);

  // 祝日の注意(C-9: 地区選択の有無にかかわらず常時表示)。
  await expect(page.getByText(/祝日/).first()).toBeVisible();

  // 171地区から1つ(愛住町)を選択。
  await page.getByLabel('地区を選ぶ').selectOption({ label: '愛住町' });

  // 収集曜日が表示される。
  await expect(page.getByRole('heading', { name: '収集曜日' })).toBeVisible();
  await expect(page.getByText('火曜日').first()).toBeVisible();
  await expect(page.getByText('木曜日').first()).toBeVisible();
});
