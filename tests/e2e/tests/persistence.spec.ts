import { test, expect } from '@playwright/test';
import { fillWizardStep1, generateChecklist, startWithWard } from './helpers';

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
