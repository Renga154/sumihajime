import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  findSmallTargets,
  formatSmallTargets,
  generateChecklist,
  fillWizardStep1,
  mockChat,
  seedProfile,
  startWithWard,
} from './helpers';

/**
 * WCAG 2.2 SC 2.5.8(ターゲットのサイズ・最小 24px×24px)の回帰テスト。
 *
 * なぜE2Eで実測するか: axe-core は SC 2.5.8 を自動検出しない。標的の大きさは
 * フォント・折り返し・レイアウトの結果で決まるので、実ブラウザで測るしかない。
 * 独立点検では窓口一覧の外部リンクが高さ20pxのままだった(text-sm の行の高さそのもの)。
 *
 * ビューポート: モバイル(375)とデスクトップ(1280)の両方で測る。折り返しが変わると
 * 標的の寸法も変わるため、片方だけでは足りない。
 */

const VIEWPORTS = [
  { name: 'モバイル375', width: 375, height: 812 },
  { name: 'デスクトップ1280', width: 1280, height: 800 },
];

async function expectNoSmallTargets(page: Page, screen: string): Promise<void> {
  const targets = await findSmallTargets(page);
  expect(targets, formatSmallTargets(screen, targets)).toEqual([]);
}

for (const vp of VIEWPORTS) {
  test.describe(`タップ標的24px (${vp.name})`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
    });

    test('自治体選択・入力ウィザード', async ({ page }) => {
      test.setTimeout(90_000);
      await page.goto('/');
      await expect(page.getByRole('heading', { name: '自治体を選ぶ' })).toBeVisible();
      // 未対応自治体の公式サイトリンク(39件)は折りたたみの中にあるので開いて測る。
      await expect(page.getByRole('button', { name: /この自治体で始める/ }).first()).toBeVisible();
      for (const summary of await page.locator('summary').all()) await summary.click();
      await expectNoSmallTargets(page, 'ランディング(未対応グループを開いた状態)');

      await page.goto('/');
      await startWithWard(page, '世田谷区');
      await expect(page.getByLabel(/引越し日または転入予定日/)).toBeVisible();
      await expectNoSmallTargets(page, 'ウィザード ステップ1');

      await page.getByRole('button', { name: /次へ（世帯の入力）/ }).click();
      await expectNoSmallTargets(page, 'ウィザード ステップ2');

      await page.getByRole('button', { name: /次へ（条件チェック）/ }).click();
      await expectNoSmallTargets(page, 'ウィザード ステップ3');
    });

    test('チェックリスト・手続き詳細', async ({ page }) => {
      test.setTimeout(90_000);
      await mockChat(page, 'normal');
      await page.goto('/');
      await startWithWard(page, '世田谷区');
      await fillWizardStep1(page, { moveDate: '2026-08-15', origin: '東京都外' });
      await generateChecklist(page);
      await expect(page.getByRole('heading', { name: 'AIに質問する' })).toBeVisible();
      await expectNoSmallTargets(page, 'チェックリスト');

      await page.goto('/procedures/procedure_resident_registration');
      await expect(page.getByRole('heading', { name: '公式の根拠' })).toBeVisible();
      await expectNoSmallTargets(page, '手続き詳細');
    });

    test('窓口一覧・ごみ収集', async ({ page }) => {
      test.setTimeout(90_000);
      await page.goto('/');
      await seedProfile(page, '13112');
      await page.goto('/facilities');
      await expect(page.getByRole('heading', { name: '窓口一覧' })).toBeVisible();
      // 地図の出典リンク(地理院タイル)はタイル読込後に出る。
      await expect(page.getByRole('link', { name: '地理院タイル' })).toBeVisible();
      await expectNoSmallTargets(page, '窓口一覧(地図の出典リンク込み)');

      await seedProfile(page, '13104');
      await page.goto('/waste');
      await page.getByLabel('地区を選ぶ').selectOption({ label: '愛住町' });
      await expect(page.getByRole('heading', { name: '収集曜日' })).toBeVisible();
      await expectNoSmallTargets(page, 'ごみ収集');
    });

    test('比較ページ・透明性ページ', async ({ page }) => {
      test.setTimeout(90_000);
      await page.goto('/differences');
      await expect(page.getByLabel('あなたの区')).toBeVisible();
      await expectNoSmallTargets(page, '区ごとの期限のちがい');

      await page.goto('/about-data');
      await expect(page.getByRole('heading', { name: 'データソース台帳' })).toBeVisible();
      await expectNoSmallTargets(page, 'このサービスのデータについて');
    });
  });
}
