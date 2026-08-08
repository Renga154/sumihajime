import { test, expect, type Page, type Route } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { fillWizardStep1, generateChecklist, seedProfile, startWithWard, WARDS } from './helpers';

/**
 * 障害を実際に注入して、画面の挙動を固定する(独立点検 P1)。
 *
 * ここで再現するのは、区役所の弱い電波で本当に起きること:
 *  - 応答が返らない(接続は張れるが無音のまま)
 *  - サーバーが 503 を返す
 *  - 接続そのものが失敗する
 *  - チャットの依存(APIキー)が欠けている ← これはモックせず、鍵の無い実サーバーで確認する
 *
 * 守る約束は1つ: **チェックリストと公式リンクは落とさない**(CLAUDE.md 原則8)。
 * そして古い内容を最新のように見せない(原則3)。
 */

const here = dirname(fileURLToPath(import.meta.url));
// スクリーンショットの保存先。gitignore 済みの test-results 配下へ置き、成果物を汚さない。
const shotDir = process.env.FAULT_SHOT_DIR ?? resolve(here, '../test-results/fault-injection');

async function shot(page: Page, name: string): Promise<void> {
  await page.evaluate(() => (document as Document & { fonts: FontFaceSet }).fonts.ready);
  await page.screenshot({ path: resolve(shotDir, `${name}.png`), fullPage: true });
}

/** 一度成功させて端末内の控えを作る(以降の障害注入の前提)。 */
async function seedCacheThroughUi(page: Page): Promise<void> {
  await page.goto('/');
  await startWithWard(page, WARDS.setagaya.name);
  await fillWizardStep1(page, { moveDate: '2026-08-15', origin: '東京都外' });
  await generateChecklist(page);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('tmn:checklist-cache:13112') !== null))
    .toBe(true);
}

/**
 * 転入届のタスクカード。「転入届」は転校手続きの説明文などにも現れるため、
 * カードの見出し(h3)で特定する。
 */
const residentTask = (page: Page) =>
  page.getByRole('heading', { level: 3, name: /^転入届/ }).first();

/** 控えを表示していることの告知。 */
const offlineNotice = (page: Page) =>
  page.getByRole('heading', { name: '保存してあった内容を表示しています' });

test.describe('チェックリストはAPI不達でも消えない', () => {
  test('接続失敗: 控えを表示し、いつ時点かを明示し、公式リンクも残る', async ({ page }) => {
    await seedCacheThroughUi(page);

    // 障害注入: チェックリスト生成への接続そのものを失敗させる。
    await page.route('**/api/checklists', (route: Route) => route.abort('failed'));
    await page.reload();

    await expect(offlineNotice(page)).toBeVisible();
    await expect(page.getByText('これは最新の取得ではありません', { exact: false })).toBeVisible();
    // 取得時刻(日本時間)が出る。
    await expect(page.getByText(/\d{4}年\d{1,2}月\d{1,2}日 \d{2}:\d{2}/)).toBeVisible();

    // 本体が残っている: タスク・進捗・公式根拠への導線。
    await expect(page.getByRole('listitem').filter({ hasText: '転入届' })).toBeVisible();
    await expect(page.getByText(/件 完了/)).toBeVisible();
    await expect(
      page.getByRole('link', { name: /詳細・必要書類・公式根拠を見る/ }).first(),
    ).toBeVisible();

    await shot(page, '01-network-abort-cached-checklist');
  });

  test('503: 控えを表示し、再試行ボタンで復帰する', async ({ page }) => {
    await seedCacheThroughUi(page);

    let failing = true;
    await page.route('**/api/checklists', async (route: Route) => {
      if (!failing) return route.fallback();
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: 'unavailable',
            message: 'ただいま混み合っています。時間をおいて再度お試しください。',
            requestId: 'test',
          },
        }),
      });
    });
    await page.reload();

    await expect(offlineNotice(page)).toBeVisible();
    await shot(page, '02-503-cached-checklist');

    // 障害が解消してから再試行すると、告知が消えて通常表示へ戻る。
    failing = false;
    await page.getByRole('button', { name: '最新の内容を取得する' }).click();
    await expect(offlineNotice(page)).toHaveCount(0);
    await expect(page.getByRole('listitem').filter({ hasText: '転入届' })).toBeVisible();
    await shot(page, '03-503-recovered-after-retry');
  });

  test('無応答(タイムアウト): 読み込み中のまま固まらず、控えへ切り替わる', async ({ page }) => {
    test.setTimeout(60_000);
    await seedCacheThroughUi(page);

    // 障害注入: 接続は張れるが応答を返さない。クライアント側が10秒で打ち切る。
    await page.route('**/api/checklists', () => new Promise(() => {}));
    await page.reload();

    await expect(offlineNotice(page)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('listitem').filter({ hasText: '転入届' })).toBeVisible();
    await shot(page, '04-timeout-cached-checklist');
  });

  test('控えが無い状態で接続失敗: 文面と再試行ボタンを出す(黙って空にしない)', async ({ page }) => {
    await page.goto('/');
    await seedProfile(page, WARDS.setagaya.code);
    // 控えは作らないまま、生成への接続を失敗させる。
    await page.route('**/api/checklists', (route: Route) => route.abort('failed'));
    await page.goto('/checklist');

    const alert = page.getByRole('alert');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText('サーバーに接続できませんでした');
    await expect(page.getByRole('button', { name: 'もう一度作成する' })).toBeVisible();
    await expect(offlineNotice(page)).toHaveCount(0);

    await shot(page, '05-no-cache-network-abort');
  });

  test('自治体一覧だけが落ちても、チェックリストは表示される', async ({ page }) => {
    await page.goto('/');
    await seedProfile(page, WARDS.setagaya.code);
    await page.route('**/api/municipalities', (route: Route) => route.abort('failed'));
    await page.goto('/checklist');

    await expect(residentTask(page)).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await shot(page, '06-municipalities-down-checklist-ok');
  });
});

test.describe('チャットが壊れても本体は無傷', () => {
  /**
   * ここだけはモックしない。ローカルの wrangler dev には OPENAI_API_KEY を置いていないため、
   * 「鍵が無い」状態の実サーバーがそのまま検査対象になる。
   */
  test('鍵なし(実サーバー): availability が縮退を返し、送信前に範囲を伝える', async ({ page }) => {
    const res = await page.request.get('/api/chat/availability');
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { enabled: boolean; mode: string };
    // 鍵が無いので全機能ではない。
    expect(body.mode).not.toBe('full');

    await page.goto('/');
    await seedProfile(page, WARDS.setagaya.code);
    await page.goto('/checklist');
    await expect(page.getByText(/件 完了/)).toBeVisible();

    if (body.enabled) {
      // 縮退表示: 何に答えられるかを送信前に伝える。
      await expect(page.getByText('今おこたえできる範囲がかぎられています')).toBeVisible();
    } else {
      // 完全に使えないならパネル自体を出さない。
      await expect(page.getByRole('heading', { name: 'AIに質問する' })).toHaveCount(0);
    }
    // どちらの場合もチェックリスト本体は無傷。
    await expect(residentTask(page)).toBeVisible();

    await shot(page, '07-real-server-missing-openai-key');
  });

  test('チャットが503: エラー文面と再試行ボタンを出し、チェックリストは残る', async ({ page }) => {
    await page.route('**/api/chat/availability', (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ enabled: true, mode: 'full' }),
      }),
    );
    await page.route('**/api/chat', (route: Route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: 'chat_unavailable',
            message:
              'ただいまチャットの回答を生成できませんでした。時間をおいて再度お試しください（チェックリスト機能は引き続きご利用いただけます）。',
            requestId: 'test',
          },
        }),
      }),
    );

    await page.goto('/');
    await seedProfile(page, WARDS.setagaya.code);
    await page.goto('/checklist');

    await page.getByRole('textbox', { name: /質問を入力/ }).fill('転入届に必要な持ち物は？');
    await page.getByRole('button', { name: '質問する' }).click();

    await expect(page.getByRole('alert')).toContainText('回答を生成できませんでした');
    await expect(page.getByRole('button', { name: 'この質問をもう一度送る' })).toBeVisible();
    // 本体は無傷。
    await expect(residentTask(page)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'あなたのチェックリスト' })).toBeVisible();

    await shot(page, '08-chat-503-checklist-intact');
  });
});
