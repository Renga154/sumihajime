import { test, expect } from '@playwright/test';
import type { Page, Response } from '@playwright/test';
import { mockChat, seedProfile } from './helpers';

/**
 * セキュリティヘッダ・ソフト404・クローラ対応の実測(IMPLEMENTATION_PLAN §13 / REQUIREMENTS §16.3)。
 *
 * CSPは「設定した」だけでは意味がなく、実際に画面が壊れていないことまで見て初めて意味がある。
 * ここでは本番相当のビルド(webServerが `pnpm --filter web build` してから wrangler dev)に対し、
 * 全画面を実際に操作して「CSP違反0件・コンソールエラー0件」を固定する。
 * ヘッダ値そのものの定義・整合は apps/api/src/headers.test.ts が担当し、ここは効いているかを見る。
 */

const EXPECTED_DOCUMENT_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'DENY',
};

interface Problems {
  consoleErrors: string[];
  pageErrors: string[];
  cspViolations: string[];
  /** 4xx/5xx を返したリクエスト(`METHOD status URL`)。副資源の取りこぼしを見る。 */
  badResponses: string[];
}

/**
 * ページ内で発生した CSP 違反を集める。console のエラー文言だけだと「何が」「どの指令で」
 * 弾かれたのかが分からず、直す手掛かりにならないため、違反イベント自体を拾う。
 */
async function watchProblems(page: Page): Promise<Problems> {
  const problems: Problems = {
    consoleErrors: [],
    pageErrors: [],
    cspViolations: [],
    badResponses: [],
  };
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => problems.pageErrors.push(err.message));
  page.on('response', (res) => {
    if (res.status() >= 400) problems.badResponses.push(`${res.status()} ${res.url()}`);
  });
  await page.addInitScript(() => {
    const store: string[] = [];
    (window as unknown as { __cspViolations: string[] }).__cspViolations = store;
    document.addEventListener('securitypolicyviolation', (event) => {
      store.push(`${event.violatedDirective} blocked ${event.blockedURI || '(inline)'}`);
    });
  });
  return problems;
}

async function drainCspViolations(page: Page, problems: Problems): Promise<void> {
  const found = await page.evaluate(() => {
    const store = window as unknown as { __cspViolations?: string[] };
    const violations = store.__cspViolations ?? [];
    store.__cspViolations = [];
    return violations;
  });
  // どの画面で出たかが分からないと直しようがないため、パスを添えて記録する。
  const path = new URL(page.url()).pathname;
  problems.cspViolations.push(...found.map((v) => `${path} — ${v}`));
}

function assertClean(problems: Problems, where: string): void {
  expect(problems.cspViolations, `${where}: CSP違反`).toEqual([]);
  expect(problems.pageErrors, `${where}: 未捕捉の例外`).toEqual([]);
  expect(problems.consoleErrors, `${where}: コンソールエラー`).toEqual([]);
  expect(problems.badResponses, `${where}: 4xx/5xxの応答`).toEqual([]);
}

function expectDocumentHeaders(res: Response | null, where: string): void {
  const headers = res?.headers() ?? {};
  const csp = headers['content-security-policy'] ?? '';
  expect(csp, `${where}: CSP`).toContain("default-src 'self'");
  expect(csp, `${where}: CSP`).not.toContain('unsafe-inline');
  expect(csp, `${where}: CSP`).toContain("frame-ancestors 'none'");
  expect(headers['permissions-policy'] ?? '', `${where}: Permissions-Policy`).toContain(
    'geolocation=()',
  );
  for (const [name, value] of Object.entries(EXPECTED_DOCUMENT_HEADERS)) {
    expect(headers[name], `${where}: ${name}`).toBe(value);
  }
}

test('ヘッダ: HTML文書(静的アセット配信)に全ヘッダが付く', async ({ page }) => {
  expectDocumentHeaders(await page.goto('/'), 'GET /');
});

test('ヘッダ: SPAフォールバック(Worker生成)にも同じヘッダが付く', async ({ page }) => {
  // /wizard は実ファイルが無くWorkerが index.html を返す経路。ここが抜けると
  // トップだけCSPが効いて他画面が素通り、という気づきにくい穴になる。
  expectDocumentHeaders(await page.goto('/wizard'), 'GET /wizard');
  expectDocumentHeaders(await page.goto('/no-such-page'), 'GET /no-such-page');
});

test('ヘッダ: 静的アセットにも付き、長期キャッシュ規則も残っている', async ({ page }) => {
  const assetResponse = page.waitForResponse((r) => /\/assets\/index-.*\.js$/.test(r.url()));
  await page.goto('/');
  const res = await assetResponse;
  expectDocumentHeaders(res, 'GET /assets/index-*.js');
  expect(res.headers()['cache-control']).toBe('public, max-age=31536000, immutable');
});

test('ヘッダ: /api/* は何も読み込ませないCSPになる', async ({ request }) => {
  const res = await request.get('/api/health');
  expect(res.headers()['content-security-policy']).toContain("default-src 'none'");
  expect(res.headers()['x-content-type-options']).toBe('nosniff');
  expect(res.headers()['x-frame-options']).toBe('DENY');
});

test('404: 既知ルートは200、未定義URLは404(画面は日本語の404案内)', async ({ page }) => {
  for (const path of [
    '/',
    '/wizard',
    '/checklist',
    '/differences',
    '/about-data',
    '/waste',
    '/terms',
    '/privacy',
  ]) {
    const res = await page.goto(path);
    expect(res?.status(), `GET ${path}`).toBe(200);
  }
  for (const path of ['/no-such-page', '/checklist2', '/procedures', '/wizard/extra']) {
    const res = await page.goto(path);
    expect(res?.status(), `GET ${path}`).toBe(404);
  }
  await expect(
    page.getByRole('heading', { level: 1, name: 'ページが見つかりません' }),
  ).toBeVisible();
});

test('クローラ: robots.txt が /api/ を除外し sitemap を指す', async ({ request }) => {
  const res = await request.get('/robots.txt');
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('text/plain');
  const body = await res.text();
  expect(body).toContain('User-agent: *');
  expect(body).toContain('Disallow: /api/');
  expect(body).toMatch(/^Sitemap: http.*\/sitemap\.xml$/m);
});

test('クローラ: sitemap.xml は実在する公開ページだけを載せる', async ({ request }) => {
  const res = await request.get('/sitemap.xml');
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('xml');
  const locs = [...(await res.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1] ?? '');
  expect(locs.length).toBeGreaterThan(0);
  // 載っているURLが全て200であること(=存在しないURLを載せていない)。
  for (const loc of locs) {
    expect((await request.get(loc)).status(), loc).toBe(200);
  }
});

test('OGP: 共有カードの説明文で非公式サービスだと分かる', async ({ page }) => {
  await page.goto('/');
  const meta = async (selector: string) => page.locator(selector).first().getAttribute('content');

  expect(await meta('meta[property="og:title"]')).toContain('スミハジメ');
  expect(await meta('meta[property="og:description"]')).toContain('非公式');
  expect(await meta('meta[property="og:image"]')).toMatch(/^https:\/\/.+\.png$/);
  expect(await meta('meta[name="twitter:card"]')).toBeTruthy();
  expect(await meta('meta[name="twitter:description"]')).toContain('非公式');
});

test('CSP実測: 主要画面をひと通り操作してもCSP違反・コンソールエラーが出ない', async ({ page }) => {
  const problems = await watchProblems(page);

  // (1) トップ → 透明性ページ → 比較ページ(いずれも自治体選択なしで中身が出るページ)。
  for (const path of ['/', '/about-data', '/differences']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await drainCspViolations(page, problems);
  }

  // (2) チェックリスト(APIへのfetch)と手続き詳細。
  await seedProfile(page, '13112');
  await page.goto('/checklist');
  await expect(page.getByText(/件 完了/)).toBeVisible();
  await drainCspViolations(page, problems);

  await page.goto('/procedures/procedure_resident_registration');
  await expect(page.getByRole('heading', { name: '公式の根拠' })).toBeVisible();
  await drainCspViolations(page, problems);

  // (3) 地図(maplibre のWeb Worker + 地理院タイルの外部リクエスト)。
  //     worker-src / img-src / connect-src が実際に足りているかはここでしか分からない。
  await page.goto('/facilities');
  await expect(page.getByRole('region', { name: /地図/ })).toBeVisible();
  await expect(
    page.getByRole('region', { name: /地図/ }).getByRole('link', { name: '地理院タイル' }),
  ).toBeVisible({
    timeout: 20_000,
  });
  await drainCspViolations(page, problems);

  // (4) ごみ分別検索(入力→APIへのfetch→結果描画)。
  await page.goto('/waste');
  const search = page.getByRole('region', { name: '分別を調べる' });
  await search.getByLabel('品目名で調べる').fill('ペットボトル');
  await expect(search.getByText('ペットボトル').first()).toBeVisible();
  await drainCspViolations(page, problems);

  assertClean(problems, '主要画面');
});

test('CSP実測: 404画面もCSP違反なしで描画される', async ({ page }) => {
  // 404画面だけ別テストにする理由: 文書自体が 404 を返すため、ブラウザは
  // 「Failed to load resource: … 404」を必ずコンソールへ出す。これはソフト404を直した結果
  // そのもので、アプリの不具合ではない。他の画面の「エラー0件」判定を緩めないよう切り離し、
  // ここでは「404を出したのは文書だけで、副資源は1つも失敗していない」ことまで確かめる。
  const problems = await watchProblems(page);

  const res = await page.goto('/no-such-page');
  expect(res?.status()).toBe(404);
  await expect(
    page.getByRole('heading', { level: 1, name: 'ページが見つかりません' }),
  ).toBeVisible();
  await drainCspViolations(page, problems);

  expect(problems.cspViolations, '404画面: CSP違反').toEqual([]);
  expect(problems.pageErrors, '404画面: 未捕捉の例外').toEqual([]);
  expect(problems.badResponses, '404を返したのは文書だけ').toEqual([
    `404 ${new URL('/no-such-page', page.url()).toString()}`,
  ]);
  expect(problems.consoleErrors.filter((e) => !/status of 404/.test(e))).toEqual([]);
});

test('CSP実測: AIチャットの送信でもCSP違反・コンソールエラーが出ない', async ({ page }) => {
  const problems = await watchProblems(page);
  await mockChat(page, 'normal');

  await page.goto('/');
  await seedProfile(page, '13112');
  await page.goto('/checklist');
  await expect(page.getByRole('heading', { name: 'AIに質問する' })).toBeVisible();

  await page.getByRole('textbox', { name: /質問を入力/ }).fill('転入届に必要な持ち物は？');
  await page.getByRole('button', { name: '質問する' }).click();
  await expect(page.getByRole('heading', { name: '公式の根拠' })).toBeVisible();

  await drainCspViolations(page, problems);
  assertClean(problems, 'AIチャット');
});
