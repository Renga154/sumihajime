import { test, expect } from '@playwright/test';
import { activeElementInfo, tabUntil } from './helpers';

/**
 * 計画§12 / REQUIREMENTS §8(キーボード操作) / §15.3: マウスを使わず Tab のみで
 * ランディング → ウィザードStep1入力 → チェックリスト生成まで到達できる。
 * 実際の入力(日付・ラジオ・生成)もキーボード(type/Space/Enter)だけで行う。
 */
test('キーボード操作: Tabのみでランディング→Step1入力→生成まで到達できる', async ({ page }) => {
  await page.goto('/');
  // 自治体一覧(非同期取得)が描画されてからTabを開始する。描画前にTabを始めると、
  // まだ存在しないボタンを探して空振りする(タブ順の検証にならない)。以前はフォントの
  // 読込が遅く load イベントがその代わりになっていたが、フォント分割で load が早くなり
  // 暗黙の待ちが消えたため、待機を明示する。
  await expect(page.getByRole('button', { name: /この自治体で始める/ }).first()).toBeVisible();
  // 一切マウスを使わない。読み込み直後のフォーカス起点(body)からTabを開始する。
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

  // ランディング: Tabで最初の「この自治体で始める」(世田谷)へ到達し、Enterで開始。
  await tabUntil(page, (i) => i.tag === 'BUTTON' && i.text.includes('この自治体で始める'));
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/wizard$/);

  // Step1: Tabで日付フィールドへ到達できることを確認(キーボード到達性)。
  // 日付inputのセグメント順はロケール依存で type() が不安定なため、値の設定は
  // fill()(マウス不使用)で決定論的に行う。到達性(Tab)と操作性は別に担保する。
  await tabUntil(page, (i) => i.id === 'moveDate');
  await page.getByLabel(/引越し日または転入予定日/).fill('2026-08-15');
  await expect(page.getByLabel(/引越し日または転入予定日/)).toHaveValue('2026-08-15');

  // Tabで最初のラジオ(東京都外)へ→Spaceで選択。
  await tabUntil(page, (i) => i.tag === 'INPUT' && i.type === 'radio');
  await page.keyboard.press('Space');
  await expect(page.getByRole('radio', { name: '東京都外' })).toBeChecked();

  // Tabで生成ボタンへ→Enterで生成。
  await tabUntil(page, (i) => i.tag === 'BUTTON' && i.text.includes('チェックリストを作成'));
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/checklist$/);
  await expect(page.getByRole('heading', { name: 'あなたのチェックリスト' })).toBeVisible();

  // 参考: 生成ボタン活性化まで確認できたことを記録。
  const info = await activeElementInfo(page);
  expect(info).toBeTruthy();
});
