import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  fillWizardStep1,
  generateChecklist,
  moveOutScheduledDateInput,
  startWithWard,
} from './helpers';

/**
 * 「前住所地の転出予定日（任意）を入れると期限を日付で出せます」の案内を、通しで検証する。
 *
 * なぜ要るか(ADR-013): この欄は任意なので多くの人が空欄のまま進む。すると区が
 * 「前住所地の転出予定日の翌日から15日以内」と明記している児童手当のような手続きでも
 * 画面には「期限は要確認」としか出ず、**入れれば日付が出せると知らないまま**期限を逃しうる。
 *
 * 同時に、関係の無い人へ出さないことも検証する。案内は出しすぎると読まれなくなり、
 * 本当に効く場面での価値が下がる。
 */

const NOTICE = '前住所地の転出予定日を入れると、期限を日付で出せます';

/**
 * 案内カードの有無は、見出しの言い回し(自治体によって2通りある)に依存しない導線で数える。
 * このリンクは案内カードの中にしか無い。
 */
const enterDateLink = (page: Page) => page.getByRole('link', { name: '転出予定日を入力する' });

/** ステップ2で年齢帯、ステップ3でマイナンバーカードを選ぶ(転出予定日が効く条件を揃える)。 */
async function fillChildAndCardConditions(page: Page): Promise<void> {
  await page.getByRole('button', { name: /次へ（世帯の入力）/ }).click();
  await page.getByRole('checkbox', { name: '0〜2歳' }).check();
  await page.getByRole('button', { name: /次へ（条件チェック）/ }).click();
  await page.getByRole('checkbox', { name: 'マイナンバーカードを持っている' }).check();
}

test('転出予定日が空欄なら、日付を出せる手続き名つきで案内し、入力すると期限が日付になる', async ({
  page,
}) => {
  await page.goto('/');
  await startWithWard(page, '練馬区');
  await fillWizardStep1(page, { moveDate: '2026-09-01', origin: '東京都外' });
  await fillChildAndCardConditions(page);
  await generateChecklist(page);

  // 児童手当は、この時点では日付が出ない(練馬区は転出予定日が起算日)。
  const childCard = page.getByRole('listitem').filter({ hasText: '児童手当の認定請求' }).first();
  await expect(childCard).toContainText('期限は要確認');

  // 案内カード。何が得られるか(日付が出る手続き名)と、次にどうするかが書いてある。
  const notice = page.getByRole('region', { name: NOTICE });
  await expect(notice).toBeVisible();
  await expect(notice).toContainText('いま「期限は要確認」と表示している');
  await expect(notice).toContainText('児童手当');
  await expect(notice).toContainText('マイナンバーカードの継続利用');
  await expect(notice).toContainText('空欄のままで構いません');

  // 入力画面へ戻る導線(ステップ1)。
  await notice.getByRole('link', { name: '転出予定日を入力する' }).click();
  await expect(page).toHaveURL(/\/wizard\?step=1$/);

  // 入力して再生成すると、案内は消え、児童手当に日付が出る(2026-08-25 + 15日 = 2026-09-09)。
  const dateInput = moveOutScheduledDateInput(page);
  await expect(dateInput).toBeVisible();
  await dateInput.fill('2026-08-25');
  await generateChecklist(page);
  await expect(enterDateLink(page)).toHaveCount(0);
  await expect(
    page.getByRole('listitem').filter({ hasText: '児童手当の認定請求' }).first(),
  ).toContainText('2026年9月9日');
});

/**
 * なぜ見出しを分けるか: 新宿区のマイナンバーカードは「住み始めた日から14日以内 または
 * 転出予定日から30日以内のどちらか早い期日」なので、未入力でも引越し日側の日付は出ている。
 * ここで「期限を日付で出せます」と書くと、入力しても新しい日付は出ず、約束を破ることになる。
 */
test('日付が新たに出るものが無い区(新宿区)では、より早くなりうることだけを伝える', async ({
  page,
}) => {
  await page.goto('/');
  await startWithWard(page, '新宿区');
  await fillWizardStep1(page, { moveDate: '2026-09-01', origin: '東京都外' });
  await fillChildAndCardConditions(page);
  await generateChecklist(page);

  const notice = page.getByRole('region', {
    name: '前住所地の転出予定日を入れると、期限がより早い日になることがあります',
  });
  await expect(notice).toBeVisible();
  // 手続き名は区ごとの公開データそのまま(新宿区は「マイナンバーカードを利用した転入届…」)。
  // 名前を出していること自体を確かめ、区ごとの文言をテストへ書き写さない。
  await expect(notice).toContainText('マイナンバーカード');
  await expect(notice).toContainText('より早い期限に変わることがあります');
  await expect(notice).not.toContainText('いま「期限は要確認」と表示している');
  await expect(enterDateLink(page)).toHaveCount(1);
});

test('転出予定日を起算日とするルールが無い区(千代田区)では案内を出さない', async ({ page }) => {
  await page.goto('/');
  await startWithWard(page, '千代田区');
  await fillWizardStep1(page, { moveDate: '2026-09-01', origin: '東京都外' });
  await fillChildAndCardConditions(page);
  await generateChecklist(page);

  // 同じ条件・同じ空欄でも、この区では入力しても期日が変わらないので案内しない。
  await expect(enterDateLink(page)).toHaveCount(0);
});

test('海外からの転入では案内を出さない(前住所地の転出予定日が存在しない)', async ({ page }) => {
  await page.goto('/');
  await startWithWard(page, '練馬区');
  await fillWizardStep1(page, { moveDate: '2026-09-01', origin: '海外' });
  await fillChildAndCardConditions(page);
  await generateChecklist(page);

  await expect(enterDateLink(page)).toHaveCount(0);
});

test('条件が該当しない利用者(単身の成人)には案内を出さない', async ({ page }) => {
  await page.goto('/');
  await startWithWard(page, '練馬区');
  await fillWizardStep1(page, { moveDate: '2026-09-01', origin: '東京都外' });
  await generateChecklist(page);

  // 児童手当もマイナンバーカードも該当しないため、転出予定日を入れても何も変わらない。
  await expect(enterDateLink(page)).toHaveCount(0);
});
