import { afterEach, describe, expect, it, vi } from 'vitest';
import { app } from './index';
import { API_SECURITY_HEADERS, DOCUMENT_SECURITY_HEADERS } from './headers.js';
import { API_VERSION } from './version.js';

describe('GET /api/health', () => {
  it('D1 未接続でも 200 を保ち、自己判定は degraded / db_unreachable を返す', async () => {
    const res = await app.request('/api/health');
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ok: true,
      version: API_VERSION,
      status: 'degraded',
      issues: ['db_unreachable'],
      drift: null,
    });
  });

  it('セキュリティヘッダが付く', async () => {
    const res = await app.request('/api/health');
    for (const [name, value] of Object.entries(API_SECURITY_HEADERS)) {
      expect(res.headers.get(name)).toBe(value);
    }
  });
});

/** どのクエリでも例外を投げる D1 の代役(D1 障害の再現)。 */
const throwingDb = {
  prepare() {
    throw new Error('D1_ERROR: simulated outage for SELECT secret_column');
  },
  batch() {
    throw new Error('D1_ERROR: simulated outage');
  },
};

function captureLogs(): string[] {
  const logs: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    logs.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
  });
  return logs;
}

/**
 * なぜ: 以前は onError が無く、ハンドラの例外は Hono 既定の素の "Internal Server Error"(text/plain・
 * requestId なし)になっていた。画面は標準のエラー形を読めず、ログにも何も残らなかった。
 */
describe('想定外の例外(app.onError)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('D1 が例外を投げると 500 の標準エラー形(requestId 付き)で返し、error.unhandled を記録する', async () => {
    const logs = captureLogs();
    const res = await app.request('/api/municipalities', undefined, { DB: throwingDb });
    expect(res.status).toBe(500);
    const body = (await res.json()) as {
      error: { code: string; message: string; requestId: string };
    };
    expect(body.error.code).toBe('internal_error');
    expect(body.error.message).toContain('時間をおいて');
    expect(body.error.requestId).toMatch(/^[0-9a-f-]{36}$/);
    // 例外の中身は応答にもログにも出さない(上流の断片・内部の列名などが混ざり得る)。
    expect(JSON.stringify(body)).not.toContain('secret_column');
    const joined = logs.join('\n');
    expect(joined).toContain('"event":"error.unhandled"');
    expect(joined).toContain(body.error.requestId);
    expect(joined).not.toContain('secret_column');
    // セキュリティヘッダも付く。
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('POST の本文(利用者の入力)をログに残さない', async () => {
    const logs = captureLogs();
    const res = await app.request(
      '/api/checklists',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          destination: { municipalityCode: '13112' },
          moveDate: '2026-09-17',
          originType: 'outside_tokyo',
          household: { memberCount: 3, ageBands: ['adult', 'adult', 'age0_2'] },
          flags: {
            hasMyNumberCard: true,
            needsNationalHealthInsurance: false,
            needsNationalPension: false,
            hasSchoolOrChildcareNeeds: true,
            hasDog: false,
            needsDisabilityOrCareSupport: false,
            needsForeignResidentGuidance: false,
          },
        }),
      },
      { DB: throwingDb },
    );
    expect(res.status).toBe(500);
    const joined = logs.join('\n');
    expect(joined).toContain('error.unhandled');
    expect(joined).not.toContain('2026-09-17');
    expect(joined).not.toContain('age0_2');
  });
});

describe('POST /api/checklists の入口制限', () => {
  it('Content-Type が application/json でなければ 415(クロスサイトの単純リクエストを断る)', async () => {
    const res = await app.request(
      '/api/checklists',
      { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' },
      { DB: throwingDb },
    );
    expect(res.status).toBe(415);
    const body = (await res.json()) as { error: { code: string; requestId?: string } };
    expect(body.error.code).toBe('unsupported_media_type');
    expect(body.error.requestId).toBeTruthy();
  });

  it('本文が 8KB を超えれば 413', async () => {
    const res = await app.request(
      '/api/checklists',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pad: 'x'.repeat(9 * 1024) }),
      },
      { DB: throwingDb },
    );
    expect(res.status).toBe(413);
  });
});

/** 静的アセットの代役。index.html を返すだけの最小 Fetcher。 */
const INDEX_HTML = '<!doctype html><html lang="ja"><head><title>スミハジメ</title></head></html>';
function fakeAssets() {
  return {
    fetch: (input: Request) =>
      Promise.resolve(
        new URL(input.url).pathname === '/index.html'
          ? new Response(INDEX_HTML, {
              headers: { 'Content-Type': 'text/html; charset=utf-8', ETag: '"abc"' },
            })
          : new Response('not found', { status: 404 }),
      ),
  } as unknown as Fetcher;
}

const assetsEnv = () => ({ ASSETS: fakeAssets() }) as unknown as Record<string, unknown>;

describe('SPAフォールバック — ソフト404を出さない', () => {
  it.each(['/', '/wizard', '/checklist', '/facilities', '/waste', '/differences', '/about-data'])(
    '既知ルート %s は 200 で index.html を返す',
    async (path) => {
      const res = await app.request(path, undefined, assetsEnv());
      expect(res.status).toBe(200);
      await expect(res.text()).resolves.toBe(INDEX_HTML);
    },
  );

  it('動的ルート /procedures/:id も 200 を返す', async () => {
    const res = await app.request('/procedures/resident-registration', undefined, assetsEnv());
    expect(res.status).toBe(200);
  });

  it.each(['/no-such-page', '/checklist2', '/procedures', '/wizard/extra'])(
    '未定義URL %s は 404 を返す(画面は同じHTML=クライアントルーティングは無傷)',
    async (path) => {
      const res = await app.request(path, undefined, assetsEnv());
      expect(res.status).toBe(404);
      await expect(res.text()).resolves.toBe(INDEX_HTML);
    },
  );

  it('404応答は検証子を残さずキャッシュもさせない', async () => {
    const res = await app.request('/no-such-page', undefined, assetsEnv());
    expect(res.headers.get('ETag')).toBeNull();
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('フォールバックHTMLにもセキュリティヘッダが付く', async () => {
    const res = await app.request('/wizard', undefined, assetsEnv());
    for (const [name, value] of Object.entries(DOCUMENT_SECURITY_HEADERS)) {
      expect(res.headers.get(name)).toBe(value);
    }
  });

  it('未定義の /api/* にHTMLを返さない', async () => {
    const res = await app.request('/api/no-such-endpoint', undefined, assetsEnv());
    expect(res.status).toBe(404);
    await expect(res.text()).resolves.not.toContain('<!doctype html>');
  });
});

describe('クローラ向けファイル', () => {
  it('robots.txt は /api/ を除外し、同じオリジンの sitemap を指す', async () => {
    const res = await app.request('https://example.test/robots.txt', undefined, assetsEnv());
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/plain; charset=utf-8');
    const body = await res.text();
    expect(body).toContain('User-agent: *');
    expect(body).toContain('Disallow: /api/');
    expect(body).toContain('Sitemap: https://example.test/sitemap.xml');
  });

  it('sitemap.xml は公開ページだけを絶対URLで載せる', async () => {
    const res = await app.request('https://example.test/sitemap.xml', undefined, assetsEnv());
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/xml; charset=utf-8');
    const body = await res.text();
    expect(body).toContain('<loc>https://example.test/</loc>');
    expect(body).toContain('<loc>https://example.test/differences</loc>');
    expect(body).toContain('<loc>https://example.test/about-data</loc>');
    // 自治体を選ばないと中身の出ないページ・動的URL・旧URLは載せない。
    expect(body).not.toContain('/checklist');
    expect(body).not.toContain('/procedures');
    expect(body).not.toContain('/coverage');
    expect(body).not.toContain(':id');
  });

  it('sitemap に載る全URLがフォールバックで 200 を返す(存在しないURLを載せない)', async () => {
    const res = await app.request('https://example.test/sitemap.xml', undefined, assetsEnv());
    const locs = [...(await res.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1] ?? '');
    expect(locs.length).toBeGreaterThan(0);
    for (const loc of locs) {
      const page = await app.request(loc, undefined, assetsEnv());
      expect(page.status, loc).toBe(200);
    }
  });
});
