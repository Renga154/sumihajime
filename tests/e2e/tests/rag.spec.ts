import { test, expect } from '@playwright/test';
import { fillWizardStep1, generateChecklist, mockChat, startWithWard } from './helpers';
import type { Page } from '@playwright/test';

/**
 * 計画§12 導線⑤⑥ / §11: RAGチャットは決定論的にモックし(実OpenAI/Vectorizeを叩かない)、
 * (a)正常応答→引用カード、(b)保留→「確認できません」+公式導線、(c)無効→パネル非表示(劣化なし)
 * を検証する。自治体スコープ注意文(○○区の公式情報のみ)の表示も併せて確認する。
 */

async function reachChecklist(page: Page): Promise<void> {
  await page.goto('/');
  await startWithWard(page, '世田谷区');
  await fillWizardStep1(page, { moveDate: '2026-08-15', origin: '東京都外' });
  await generateChecklist(page);
}

test('RAG(a): 正常応答モックで回答本文と引用カード(公式URL・最終確認日)を表示', async ({
  page,
}) => {
  await mockChat(page, 'normal');
  await reachChecklist(page);

  const chat = page.getByRole('heading', { name: 'AIに質問する' });
  await expect(chat).toBeVisible();
  // 自治体スコープの注意文。
  await expect(page.getByText('世田谷区の公式情報のみ')).toBeVisible();

  await page.getByRole('textbox', { name: /質問を入力/ }).fill('転入届に必要な持ち物は？');
  await page.getByRole('button', { name: '質問する' }).click();

  await expect(
    page.getByText('転入届には本人確認書類などが必要です', { exact: false }),
  ).toBeVisible();
  await expect(page.getByText('確度: 高')).toBeVisible();

  // 引用カード: 公式URLと最終確認日(チェックリスト画面で「公式ページを開く」はチャット引用のみ)。
  await expect(page.getByRole('heading', { name: '公式の根拠' })).toBeVisible();
  await expect(page.getByRole('link', { name: '公式ページを開く' })).toHaveAttribute(
    'href',
    /city\.setagaya\.lg\.jp/,
  );
  // exact指定: 引用カードのラベルに限定する(印刷専用の「（最終確認日: …）」注記と区別)。
  await expect(page.getByText('最終確認日', { exact: true })).toBeVisible();
});

test('RAG(b): 保留応答モックで「確認できません」+公式導線を表示', async ({ page }) => {
  await mockChat(page, 'abstained');
  await reachChecklist(page);

  await expect(page.getByRole('heading', { name: 'AIに質問する' })).toBeVisible();
  await page.getByRole('textbox', { name: /質問を入力/ }).fill('答えられない質問');
  await page.getByRole('button', { name: '質問する' }).click();

  // 保留メッセージ(回答本文)に「確認できません」と公式ページ導線を含む + 要確認バッジ。
  const answer = page.getByText('ご質問の内容については、確認できませんでした', { exact: false });
  await expect(answer).toBeVisible();
  await expect(answer).toContainText('公式ページで最新情報をご確認ください');
  await expect(page.getByText('要確認', { exact: false }).first()).toBeVisible();
});

test('RAG(c): availability無効ならチャットパネルを描画しない(既存機能は無傷)', async ({ page }) => {
  await mockChat(page, 'disabled');
  await reachChecklist(page);

  // チェックリスト本体は表示されるが、チャットパネルは一切出ない。
  await expect(page.getByRole('heading', { name: 'あなたのチェックリスト' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'AIに質問する' })).toHaveCount(0);
});
