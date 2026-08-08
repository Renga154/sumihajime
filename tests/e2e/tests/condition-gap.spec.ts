import { test, expect } from '@playwright/test';
import { fillWizardStep1, generateChecklist, startWithWard } from './helpers';

/**
 * 既定の導線(ステップ1だけで生成)が、期限つきの重要手続きを黙って落とす問題への対処を検証する。
 *
 * ステップ2/3は任意なので、ステップ1だけで生成すると条件フラグはすべて false のまま評価され、
 * マイナンバーカードの継続利用・国民健康保険・国民年金は一件も出ない。マイナンバーカードの
 * 継続利用は期限を過ぎるとカードが失効しうるため、これを「n/m件完了」とだけ見せるのは危険。
 * フラグの既定値は推測で変えず(原則3)、「まだ判定していない条件がある」ことを明示して
 * ステップ3へ導く。
 */
test('ステップ1だけで生成すると、未判定の条件を知らせる案内が出てステップ3へ行ける', async ({
  page,
}) => {
  await page.goto('/');
  await startWithWard(page, '練馬区');
  await fillWizardStep1(page, { moveDate: '2026-08-15', origin: '東京都外' });
  await generateChecklist(page);

  // 案内カード(進捗のすぐ下)。
  const notice = page.getByRole('region', { name: 'まだ判定していない条件があります' });
  await expect(notice).toBeVisible();
  await expect(notice).toContainText('条件チェック（ステップ3）が未入力です');
  await expect(notice).toContainText('マイナンバーカード');
  await expect(notice).toContainText('国民健康保険');
  await expect(notice).toContainText('国民年金');
  // 世帯(ステップ2)も初期値のままであることも併せて伝える。
  await expect(notice).toContainText('世帯（ステップ2）も未入力');

  // 「条件を追加する」でウィザードのステップ3へ直接遷移する。
  await notice.getByRole('link', { name: '条件を追加する' }).click();
  await expect(page).toHaveURL(/\/wizard\?step=3$/);
  const myNumber = page.getByRole('checkbox', { name: 'マイナンバーカードを持っている' });
  await expect(myNumber).toBeVisible();

  // 条件を選んで再生成すると、案内は消え、マイナンバーカードの手続きが現れる。
  await myNumber.check();
  await generateChecklist(page);
  await expect(page.getByRole('region', { name: 'まだ判定していない条件があります' })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole('listitem').filter({ hasText: 'マイナンバーカードの継続利用' }).first(),
  ).toBeVisible();
});

/**
 * タスク名が見出し要素(h3)であること。axeは「見出しが無いこと」を違反として検出しないため、
 * スクリーンリーダーの見出しジャンプでタスクを辿れることは明示的に固定する。
 */
test('チェックリストのタスク名は h3 見出しで、セクション h2 の下位になっている', async ({
  page,
}) => {
  await page.goto('/');
  await startWithWard(page, '世田谷区');
  await fillWizardStep1(page, { moveDate: '2026-08-15', origin: '東京都外' });
  await generateChecklist(page);

  await expect(
    page.getByRole('heading', { name: 'あなたのチェックリスト', level: 1 }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: /転入後すぐ/, level: 2 })).toBeVisible();
  await expect(page.getByRole('heading', { name: '転入届', level: 3 })).toBeVisible();

  // 見出しにしてもチェックの操作性は変わらない(見出し内のラベルでチェックできる)。
  const tenyu = page.getByRole('listitem').filter({ hasText: '転入届' });
  await tenyu.getByRole('heading', { name: '転入届', level: 3 }).click();
  await expect(tenyu.getByRole('checkbox')).toBeChecked();
});
