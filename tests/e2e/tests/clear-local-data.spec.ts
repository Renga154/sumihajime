import { test, expect } from '@playwright/test';
import { fillWizardStep1, generateChecklist, startWithWard } from './helpers';

/**
 * なぜ: プライバシーポリシーは「サイトデータを削除」(ブラウザの設定)しか案内していなかったが、
 * 妊娠・障害・外国籍・世帯年齢などの機微フラグを含むプロフィールを、その場で消せるボタンを
 * チェックリスト画面とプライバシーポリシーに追加した(CLAUDE.md 原則6・7)。
 * ここでは実際にプロフィールを作ってから消し、この端末に保存した内容が空になること、
 * チェックリスト画面が古い内容を出し続けないこと(原則9寄りの「未対応を対応済みに見せない」と
 * 同じ考え方 — 消したはずのデータを見せない)を固定する。
 */
test('この端末に保存した入力を消去: プロフィールを作ってから消すと、保存内容が空になりチェックリストも初期状態に戻る', async ({
  page,
}) => {
  await page.goto('/');
  await startWithWard(page, '世田谷区');
  await fillWizardStep1(page, { moveDate: '2026-08-15', origin: '東京都外' });
  await generateChecklist(page);

  // 完了チェックも1件付け、消去対象が複数種類(プロフィール・完了状態・チェックリスト控え)
  // 保存されている状態を作る。
  const tenyu = page.getByRole('listitem').filter({ hasText: '転入届' });
  await tenyu.getByRole('checkbox').check();

  const keysBefore = await page.evaluate(() =>
    Object.keys(localStorage).filter((k) => k.startsWith('tmn:')),
  );
  expect(keysBefore.length).toBeGreaterThan(0);
  expect(keysBefore).toEqual(expect.arrayContaining(['tmn:municipality', 'tmn:profile:13112']));

  // 2段階確認: 1段目のボタンではまだ何も消えない。
  await page.getByRole('button', { name: 'この端末に保存した入力を消去' }).click();
  await expect(page.getByRole('button', { name: '消去する' })).toBeVisible();
  expect(
    (await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('tmn:'))))
      .length,
  ).toBeGreaterThan(0);

  await page.getByRole('button', { name: '消去する' }).click();

  // 完了を告知したうえで / へ遷移する。
  await expect(page).toHaveURL('/');

  const keysAfter = await page.evaluate(() =>
    Object.keys(localStorage).filter((k) => k.startsWith('tmn:')),
  );
  expect(keysAfter).toEqual([]);

  // チェックリストへ直接戻っても、消したはずの古い内容(転入届・世田谷区)は出ない。
  // 自治体選択も消えているため「先に自治体を選んでください」の初期状態に戻る
  // (原則9と同じ考え方: 消去済みを装わない)。
  await page.goto('/checklist');
  await expect(page.getByText('先に自治体を選んでください。')).toBeVisible();
  await expect(page.getByText('転入届')).toHaveCount(0);
});

/**
 * なぜ: プライバシーポリシーにも同じ機能が要求されている(実装だけがあってポリシー画面に
 * 出ていない状態を防ぐ)。ここでは押せること・案内どおりの確認文言が出ることだけを固定する
 * (消去そのものの検証は上のテストで既に行っている)。
 */
test('プライバシーポリシー画面にも同じ消去ボタンがあり、押すと確認が出る', async ({ page }) => {
  await page.goto('/privacy');
  await expect(page.getByRole('button', { name: 'この端末に保存した入力を消去' })).toBeVisible();
  await page.getByRole('button', { name: 'この端末に保存した入力を消去' }).click();
  await expect(page.getByText('本当に消去しますか？')).toBeVisible();
  await expect(page.getByRole('button', { name: '消去する' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'やめる' })).toBeVisible();

  // 「やめる」では何も起きない(このページのまま)。
  await page.getByRole('button', { name: 'やめる' }).click();
  await expect(page.getByRole('button', { name: '消去する' })).toHaveCount(0);
});
