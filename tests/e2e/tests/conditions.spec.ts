import { test, expect } from '@playwright/test';
import { fillWizardStep1, generateChecklist, startWithWard, toggleAgeBand } from './helpers';

/**
 * 計画§12 導線② / §9 VS1-5: 条件変更でタスクが決定論的に増減する。
 * 子育て条件(0〜2歳)を足すと児童手当・子ども医療が出現し、外すと消える。
 */
test('条件変更: 子育て条件の追加で児童手当・子ども医療が増減する', async ({ page }) => {
  const childAllowance = page.getByRole('listitem').filter({ hasText: '児童手当' });
  const childMedical = page.getByRole('listitem').filter({ hasText: /子ども.*医療/ });

  // ベースライン(単身・成人): 子育てタスクは無い。
  await page.goto('/');
  await startWithWard(page, '世田谷区');
  await fillWizardStep1(page, { moveDate: '2026-08-15', origin: '東京都外' });
  await generateChecklist(page);
  await expect(childAllowance).toHaveCount(0);
  await expect(childMedical).toHaveCount(0);

  // 条件を修正 → Step2で「0〜2歳」を追加 → 再生成。
  await page.getByRole('link', { name: '条件を修正する' }).click();
  await expect(page).toHaveURL(/\/wizard$/);
  await page.getByRole('button', { name: '世帯（任意）' }).click();
  await toggleAgeBand(page, '0〜2歳', true);
  await generateChecklist(page);
  await expect(childAllowance).toBeVisible();
  await expect(childMedical).toBeVisible();

  // 0〜2歳を外す → 再生成 → 消える。
  await page.getByRole('link', { name: '条件を修正する' }).click();
  await page.getByRole('button', { name: '世帯（任意）' }).click();
  await toggleAgeBand(page, '0〜2歳', false);
  await generateChecklist(page);
  await expect(childAllowance).toHaveCount(0);
  await expect(childMedical).toHaveCount(0);
});
