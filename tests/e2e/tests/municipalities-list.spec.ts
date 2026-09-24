import { test, expect } from '@playwright/test';

/**
 * Wave2/Step5/Batch6-A/Batch7/Batch8/Batch9/Batch10: 東京都62市区町村の誠実リスト化。
 * 2026-08-07 の人手レビュー承認で23特別区すべてが、2026-09-25 に八王子市が対応済みになった。未対応の38市町村は
 * 「市部/町村部」の折りたたみグループに収め、各自治体は選択不可で公式サイト導線のみ
 * (CLAUDE.md原則9)。
 */
test('62リスト: 対応24件+未対応グループの展開と公式リンク', async ({ page }) => {
  await page.goto('/');

  // 既定では対応自治体を先頭8件だけ並べる(2026-08-09。23件を常に積むとモバイルで
  // 一覧だけで2,014pxを占め、続く節が見えない位置まで押し下げられていた)。
  // 件数の表示は実態と一致していなければならない(原則3・9)。
  await expect(page.getByRole('button', { name: /この自治体で始める/ })).toHaveCount(8);
  await expect(page.getByText(/24件のうち8件を表示しています/)).toBeVisible();
  await expect(page.getByText(/全62件（対応 24件 \/ 未対応 38件）/)).toBeVisible();

  // 「すべて表示」で24件そろう。押すたびに開閉できる。
  const showAll = page.getByRole('button', { name: /すべて表示（残り16件）/ });
  await expect(showAll).toHaveAttribute('aria-expanded', 'false');
  await showAll.click();
  await expect(page.getByRole('button', { name: /この自治体で始める/ })).toHaveCount(24);
  await expect(page.getByRole('button', { name: /表示を減らす/ })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await page.getByRole('button', { name: /表示を減らす/ }).click();
  await expect(page.getByRole('button', { name: /この自治体で始める/ })).toHaveCount(8);

  // 既定では未対応グループは折りたたまれ、市部の自治体は見えない。
  const tachikawaInitial = page.getByRole('listitem').filter({ hasText: '立川市' });
  await expect(tachikawaInitial).toHaveCount(0);

  // 「市部」を開く → 立川市が公式サイト導線つきで現れる(開始ボタンは無い)。
  await page.locator('summary').filter({ hasText: '市部' }).click();
  const tachikawa = page.getByRole('listitem').filter({ hasText: '立川市' });
  await expect(tachikawa).toBeVisible();
  await expect(tachikawa.getByRole('button', { name: /この自治体で始める/ })).toHaveCount(0);
  await expect(tachikawa.getByRole('link', { name: /公式サイトを見る/ })).toHaveAttribute(
    'href',
    /city\.tachikawa\.lg\.jp/,
  );

  // 「町村部」を開く → 島しょ部(小笠原村)も公式リンクで到達できる。
  await page.locator('summary').filter({ hasText: '町村部' }).click();
  const ogasawara = page.getByRole('listitem').filter({ hasText: '小笠原村' });
  await expect(ogasawara).toBeVisible();
  await expect(ogasawara.getByRole('link', { name: /公式サイトを見る/ })).toHaveAttribute(
    'href',
    /vill\.ogasawara\.tokyo\.jp/,
  );
});

/**
 * 62件を縦に並べるだけでは自分の自治体に辿り着くまでのスクロールが長すぎるため、
 * 一覧の先頭に絞り込みを置いた。対応・未対応の双方に同じ規則で効き、件数表示も追随する。
 */
test('62リスト: 自治体名の絞り込み(漢字・かな・ローマ字)', async ({ page }) => {
  await page.goto('/');
  const filter = page.getByLabel('自治体名で絞り込む');
  await expect(filter).toBeVisible();
  await expect(page.getByText(/全62件（対応 24件/)).toBeVisible();

  // 漢字で絞り込む → 練馬区だけが残り、開始ボタンも1つになる。
  await filter.fill('練馬');
  await expect(page.getByRole('button', { name: /この自治体で始める/ })).toHaveCount(1);
  await expect(page.getByRole('listitem').filter({ hasText: '練馬区' })).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: '世田谷区' })).toHaveCount(0);

  // ひらがな・ローマ字でも同じ結果になる。
  await filter.fill('ねりま');
  await expect(page.getByRole('listitem').filter({ hasText: '練馬区' })).toBeVisible();
  await filter.fill('nerima');
  await expect(page.getByRole('listitem').filter({ hasText: '練馬区' })).toBeVisible();

  // 対応済みの市(八王子市)も区と同じ規則で引け、開始ボタンがある。
  await filter.fill('八王子');
  const hachioji = page.getByRole('listitem').filter({ hasText: '八王子市' });
  await expect(hachioji).toBeVisible();
  await expect(hachioji.getByRole('button', { name: /この自治体で始める/ })).toHaveCount(1);

  // 未対応の自治体も同じ規則で引ける(絞り込み中はグループが開いて中身が見える)。
  await filter.fill('立川');
  const tachikawa = page.getByRole('listitem').filter({ hasText: '立川市' });
  await expect(tachikawa).toBeVisible();
  await expect(tachikawa.getByRole('button', { name: /この自治体で始める/ })).toHaveCount(0);

  // 絞り込みを消すと既定の表示(先頭8件+「すべて表示」)へ戻る。件数表示は24件のまま。
  await filter.fill('');
  await expect(page.getByRole('button', { name: /この自治体で始める/ })).toHaveCount(8);
  await expect(page.getByText(/全62件（対応 24件/)).toBeVisible();
});
