import { test, expect } from '@playwright/test';
import { fillWizardStep1, generateChecklist, startWithWard } from './helpers';

/**
 * なぜ: 自治体を選び、ステップ1に入力してステップ2へ進んだところでリロードすると、
 * 引越し日と転入元が空に戻っていた(保存は「作成」時だけだった)。下書きを
 * 確定プロフィールとは別のキーへ持ち、復元したことを利用者に伝えることを固定する。
 */
test('入力途中: ステップ2へ進んでリロードしても引越し日と転入元が残る', async ({ page }) => {
  await page.goto('/');
  await startWithWard(page, '世田谷区');
  await fillWizardStep1(page, { moveDate: '2026-08-15', origin: '東京都外' });
  await page.getByRole('button', { name: /次へ（世帯の入力）/ }).click();
  await expect(page.getByRole('button', { name: '世帯（任意）' })).toHaveAttribute(
    'aria-current',
    'step',
  );

  // 確定前なので、チェックリストが読む確定プロフィールはまだ書かれていない。
  expect(await page.evaluate(() => localStorage.getItem('tmn:profile:13112'))).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem('tmn:wizard-draft:13112'))).not.toBeNull();

  await page.reload();

  // 復元したことを伝える(黙って値を入れない)。
  await expect(page.getByText('前回の入力途中の内容を復元しました')).toBeVisible();
  // 中断したステップから再開し、入力値も残っている。
  await expect(page.getByRole('button', { name: '世帯（任意）' })).toHaveAttribute(
    'aria-current',
    'step',
  );
  await page.getByRole('button', { name: '引越し日と転入元（必須）' }).click();
  await expect(page.getByLabel(/引越し日または転入予定日/)).toHaveValue('2026-08-15');
  await expect(page.getByRole('radio', { name: '東京都外' })).toBeChecked();

  // 破棄すると入力は消え、下書きキーも消える。
  await page.getByRole('button', { name: /破棄/ }).click();
  await expect(page.getByLabel(/引越し日または転入予定日/)).toHaveValue('');
  expect(await page.evaluate(() => localStorage.getItem('tmn:wizard-draft:13112'))).toBeNull();
  await expect(page.getByText('入力途中の内容を破棄しました')).toBeVisible();
});

test('入力途中: 作成すると下書きは消え、確定プロフィールだけが残る', async ({ page }) => {
  await page.goto('/');
  await startWithWard(page, '世田谷区');
  await fillWizardStep1(page, { moveDate: '2026-08-15', origin: '東京都外' });
  await generateChecklist(page);

  expect(await page.evaluate(() => localStorage.getItem('tmn:wizard-draft:13112'))).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem('tmn:profile:13112'))).not.toBeNull();

  // 「条件を修正する」で戻っても「復元しました」とは言わない(確定内容が初期値として出るだけ)。
  await page.getByRole('link', { name: '条件を修正する' }).click();
  await expect(page.getByLabel(/引越し日または転入予定日/)).toHaveValue('2026-08-15');
  await expect(page.getByText('前回の入力途中の内容を復元しました')).toHaveCount(0);
});

/**
 * 計画§12 導線③ / §9 VS1-6: 完了チェックがリロード後も保持され、進捗 n/m に反映される。
 */
test('完了状態: チェックはリロード後も保持され進捗n/mに反映される', async ({ page }) => {
  await page.goto('/');
  await startWithWard(page, '世田谷区');
  await fillWizardStep1(page, { moveDate: '2026-08-15', origin: '東京都外' });
  await generateChecklist(page);

  // 2026-08-07 人手レビュー承認(ADR-009)によりライフライン等4件(水道・郵便・電気ガスは
  // 条件なしで全員該当)が追加公開され、単身・都外・車両なしの最小プロフィールでも
  // 転入届+水道+郵便+電気ガス=5件になった(運転免許は needsVehicleGuidance=false のため非該当)。
  const status = page.getByRole('status');
  await expect(status).toContainText('0 / 5');

  // 転入届を完了にする。
  const tenyu = page.getByRole('listitem').filter({ hasText: '転入届' });
  const checkbox = tenyu.getByRole('checkbox');
  await checkbox.check();
  await expect(checkbox).toBeChecked();
  await expect(status).toContainText('1 / 5');

  // リロード後も保持。
  await page.reload();
  await expect(page.getByText(/件 完了/)).toBeVisible();
  const tenyuAfter = page.getByRole('listitem').filter({ hasText: '転入届' });
  await expect(tenyuAfter.getByRole('checkbox')).toBeChecked();
  await expect(page.getByRole('status')).toContainText('1 / 5');
});
