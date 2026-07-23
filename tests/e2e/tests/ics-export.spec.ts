import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { seedProfile } from './helpers';

/**
 * Wave2: チェックリストの .ics 書き出し(クライアント生成・サーバー非送信=§13)。
 * ダウンロードのファイル名と内容先頭(VCALENDAR)・UID規則を検証する。
 */
test('ICS書き出し: 期限タスクを .ics でダウンロードできる', async ({ page }) => {
  await page.goto('/');
  await seedProfile(page, '13112');
  await page.goto('/checklist');
  await expect(page.getByText(/件 完了/)).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /カレンダーに登録/ }).click(),
  ]);

  expect(download.suggestedFilename()).toBe('tokyo-move-navi-13112.ics');

  const path = await download.path();
  const content = await readFile(path, 'utf-8');
  // 内容先頭は VCALENDAR、少なくとも1件の終日イベント(転入届など)を含む。
  expect(content.startsWith('BEGIN:VCALENDAR')).toBe(true);
  expect(content).toContain('BEGIN:VEVENT');
  expect(content).toContain('UID:13112-');
  expect(content).toContain('DTSTART;VALUE=DATE:');
});
