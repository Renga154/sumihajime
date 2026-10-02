import { afterEach, describe, expect, it, vi } from 'vitest';
import { app } from './index';
import { API_SECURITY_HEADERS, REDIRECT_SECURITY_HEADERS } from './headers.js';

/**
 * HTTP の入口(全ルート共通の前処理)の回帰テスト。
 *
 * 書籍『Webアプリケーションセキュリティ入門』に沿った監査(2026-10-02)の指摘ごとに、
 * 「攻撃・誤用のリクエストが拒否される」と「正規の利用が壊れていない」を対で固定する。
 * D1 に触れる前に断るべきものは、例外を投げる D1 の代役で「D1 に届いていない」ことも確かめる。
 */

const PROD = 'https://sumihajime.com';
const PROD_ENV = { CANONICAL_ORIGIN: PROD };
const MIRROR_ENV = { CANONICAL_ORIGIN: '' };

/** どのクエリでも例外を投げる D1 の代役(ここへ届いたら 500 になる=前段で断れていない)。 */
const throwingDb = {
  prepare() {
    throw new Error('D1 must not be reached');
  },
  batch() {
    throw new Error('D1 must not be reached');
  },
};

/** 静的アセットの代役。index.html を返すだけの最小 Fetcher。 */
function fakeAssets() {
  return {
    fetch: (input: Request) =>
      Promise.resolve(
        new URL(input.url).pathname === '/index.html'
          ? new Response('<!doctype html>', {
              headers: { 'Content-Type': 'text/html; charset=utf-8' },
            })
          : new Response('not found', { status: 404 }),
      ),
  } as unknown as Fetcher;
}

function env(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { DB: throwingDb, ASSETS: fakeAssets(), ...extra };
}

type ErrorBody = { error: { code: string; message: string; requestId?: string } };

function expectApiHeaders(res: Response): void {
  for (const [name, value] of Object.entries(API_SECURITY_HEADERS)) {
    expect(res.headers.get(name), name).toBe(value);
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('1. HTTPS の強制', () => {
  it.each([
    ['http://sumihajime.com/', 'https://sumihajime.com/'],
    ['http://sumihajime.com/api/health', 'https://sumihajime.com/api/health'],
    ['http://sumihajime.com/checklist?x=1', 'https://sumihajime.com/checklist?x=1'],
  ])('攻撃: 本番の %s (平文HTTP) は 301 で https へ送る', async (from, to) => {
    const res = await app.request(from, undefined, env(PROD_ENV));
    expect(res.status).toBe(301);
    expect(res.headers.get('Location')).toBe(to);
  });

  it('旧URLの平文HTTPの画面は、独自ドメインの https へ1回で送る(2段の転送にしない)', async () => {
    const res = await app.request(
      'http://app.sumihajime.workers.dev/wizard',
      undefined,
      env(PROD_ENV),
    );
    expect(res.status).toBe(301);
    expect(res.headers.get('Location')).toBe('https://sumihajime.com/wizard');
  });

  it('旧URLの平文HTTPの API は同じホストの https へ送る(API は移行期間中どちらでも答える)', async () => {
    const res = await app.request(
      'http://app.sumihajime.workers.dev/api/health',
      undefined,
      env(PROD_ENV),
    );
    expect(res.status).toBe(301);
    expect(res.headers.get('Location')).toBe('https://app.sumihajime.workers.dev/api/health');
  });

  it('CANONICAL_ORIGIN が空のミラーでも平文HTTPは https へ送る', async () => {
    const res = await app.request(
      'http://sumihajime.tokyo-odh-145.workers.dev/api/health',
      undefined,
      env(MIRROR_ENV),
    );
    expect(res.status).toBe(301);
    expect(res.headers.get('Location')).toBe(
      'https://sumihajime.tokyo-odh-145.workers.dev/api/health',
    );
  });

  it('攻撃: 平文HTTPの POST は転送せず 4xx の標準エラーで断る(本文を平文で受け取らない)', async () => {
    const res = await app.request(
      'http://sumihajime.com/api/checklists',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
      env(PROD_ENV),
    );
    expect(res.status).toBe(403);
    expect(res.headers.get('Location')).toBeNull();
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe('https_required');
    expect(body.error.requestId).toBeTruthy();
    expectApiHeaders(res);
  });

  it('正常: https の本番はそのまま答える', async () => {
    const res = await app.request(`${PROD}/api/health`, undefined, env(PROD_ENV));
    expect(res.status).toBe(200);
  });

  it.each(['http://localhost:8788/api/health', 'http://127.0.0.1:8787/api/health'])(
    '正常: ローカル開発 %s は平文HTTPのまま答える',
    async (url) => {
      const res = await app.request(url, undefined, env(PROD_ENV));
      expect(res.status).toBe(200);
    },
  );

  it('転送(301)にも最小限の安全ヘッダが付く', async () => {
    const res = await app.request('http://sumihajime.com/', undefined, env(PROD_ENV));
    for (const [name, value] of Object.entries(REDIRECT_SECURITY_HEADERS)) {
      expect(res.headers.get(name), name).toBe(value);
    }
    const canonical = await app.request(
      'https://www.sumihajime.com/wizard',
      undefined,
      env(PROD_ENV),
    );
    expect(canonical.status).toBe(301);
    for (const [name, value] of Object.entries(REDIRECT_SECURITY_HEADERS)) {
      expect(canonical.headers.get(name), name).toBe(value);
    }
  });
});

describe('2. どの /api/* 応答にもセキュリティヘッダが付く', () => {
  it('413(本文が大きすぎる)', async () => {
    const res = await app.request(
      '/api/checklists',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pad: 'x'.repeat(9 * 1024) }),
      },
      env(),
    );
    expect(res.status).toBe(413);
    expectApiHeaders(res);
  });

  it('415(JSON 以外)', async () => {
    const res = await app.request(
      '/api/chat',
      { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' },
      env(),
    );
    expect(res.status).toBe(415);
    expectApiHeaders(res);
  });

  it('404(未定義の API)', async () => {
    const res = await app.request('/api/no-such-endpoint', undefined, env());
    expect(res.status).toBe(404);
    expectApiHeaders(res);
  });

  it('500(想定外の例外)', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const res = await app.request('/api/municipalities', undefined, env());
    expect(res.status).toBe(500);
    expectApiHeaders(res);
  });
});

describe('3. メソッドの制限', () => {
  it.each([
    ['GET', '/api/chat'],
    ['OPTIONS', '/api/chat'],
    ['GET', '/api/checklists'],
    ['PUT', '/api/checklists'],
    ['DELETE', '/api/chat'],
  ])('攻撃: %s %s は 405 + Allow: POST(415 ではない)', async (method, path) => {
    const res = await app.request(path, { method }, env());
    expect(res.status).toBe(405);
    expect(res.headers.get('Allow')).toBe('POST');
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe('method_not_allowed');
    expectApiHeaders(res);
  });

  it('攻撃: GET 専用の API への POST は 405 + Allow: GET, HEAD', async () => {
    const res = await app.request(
      '/api/municipalities',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
      env(),
    );
    expect(res.status).toBe(405);
    expect(res.headers.get('Allow')).toBe('GET, HEAD');
  });

  it.each(['DELETE', 'POST', 'PUT', 'PATCH'])(
    '攻撃: 画面への %s は 200 を返さず 405 + Allow: GET, HEAD',
    async (method) => {
      const res = await app.request('/', { method }, env());
      expect(res.status).toBe(405);
      expect(res.headers.get('Allow')).toBe('GET, HEAD');
    },
  );

  it('正常: 画面への GET / HEAD は従来どおり 200', async () => {
    expect((await app.request('/', undefined, env())).status).toBe(200);
    expect((await app.request('/wizard', { method: 'HEAD' }, env())).status).toBe(200);
  });

  it('攻撃: 未定義の /api/* は text/plain ではなく標準の JSON エラー', async () => {
    const res = await app.request('/api/no-such-endpoint', undefined, env());
    expect(res.status).toBe(404);
    expect(res.headers.get('Content-Type')).toContain('application/json');
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe('not_found');
    expect(body.error.requestId).toBeTruthy();
  });

  it('正常: 画面の 404 は従来どおり HTML', async () => {
    const res = await app.request('/no-such-page', undefined, env());
    expect(res.status).toBe(404);
    expect(res.headers.get('Content-Type')).toContain('text/html');
  });
});

describe('4. 状態を変える API へのクロスサイト送信を断る(Origin / Sec-Fetch-Site)', () => {
  const post = (headers: Record<string, string>, url = `${PROD}/api/chat`) =>
    app.request(
      url,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify({ municipalityCode: '13112', question: '転入届は？' }),
      },
      env({ ...PROD_ENV, RAG_ENABLED: 'false' }),
    );

  it.each([
    [{ 'Sec-Fetch-Site': 'cross-site' }],
    [{ 'Sec-Fetch-Site': 'same-site' }],
    [{ Origin: 'https://evil.example' }],
    [{ Origin: 'https://sumihajime.com.evil.example' }],
    [{ Origin: 'http://sumihajime.com' }],
    [{ Origin: 'https://sumihajime.com:8443' }],
    [{ Origin: 'null' }],
    [{ Origin: 'http://localhost:5173' }],
  ])('攻撃: %j は 403(標準エラー・セキュリティヘッダ付き)', async (headers) => {
    const res = await post(headers);
    expect(res.status).toBe(403);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe('cross_site_request');
    expectApiHeaders(res);
  });

  it('攻撃: チェックリスト生成にも同じ規則が掛かる', async () => {
    const res = await post({ Origin: 'https://evil.example' }, `${PROD}/api/checklists`);
    expect(res.status).toBe(403);
  });

  it('正常: 同一オリジンの画面からの送信は通る', async () => {
    const res = await post({ Origin: PROD, 'Sec-Fetch-Site': 'same-origin' });
    // RAG_ENABLED=false のため本処理は 503 disabled。403 で止まっていないことを見る。
    expect(res.status).toBe(503);
  });

  it('正常: Origin / Sec-Fetch-Site を送らないクライアント(評価スクリプト・curl)は通る', async () => {
    const res = await post({});
    expect(res.status).toBe(503);
  });

  it('正常: Sec-Fetch-Site: none(利用者自身の操作)は通る', async () => {
    const res = await post({ 'Sec-Fetch-Site': 'none' });
    expect(res.status).toBe(503);
  });

  it('正常: ローカル開発(要求先もループバック)では Vite の別ポートからの送信を通す', async () => {
    const res = await post(
      { Origin: 'http://localhost:5173', 'Sec-Fetch-Site': 'same-origin' },
      'http://localhost:8787/api/chat',
    );
    expect(res.status).toBe(503);
  });
});

describe('9. 世帯属性を含む応答・エラーは保存させない(Cache-Control: no-store)', () => {
  it('POST /api/checklists の失敗応答', async () => {
    const res = await app.request(
      '/api/checklists',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
      env(),
    );
    expect(res.status).toBe(422);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('POST /api/chat の応答', async () => {
    const res = await app.request(
      '/api/chat',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ municipalityCode: '13112', question: '転入届は？' }),
      },
      env({ RAG_ENABLED: 'false' }),
    );
    expect(res.status).toBe(503);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('GET のエラー応答', async () => {
    const res = await app.request('/api/facilities', undefined, env());
    expect(res.status).toBe(400);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });
});

describe('10. /.well-known/security.txt (RFC 9116)', () => {
  it('本番では Canonical を含む連絡先を text/plain で返す', async () => {
    const res = await app.request(`${PROD}/.well-known/security.txt`, undefined, env(PROD_ENV));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/plain; charset=utf-8');
    const body = await res.text();
    expect(body).toMatch(/^Contact: https:\/\/docs\.google\.com\/forms\/.+$/m);
    expect(body).toContain('Expires: 2027-10-01T00:00:00.000Z');
    expect(body).toContain('Preferred-Languages: ja, en');
    expect(body).toContain('Canonical: https://sumihajime.com/.well-known/security.txt');
    expect(body).toContain('Policy: https://github.com/Renga154/sumihajime/blob/main/SECURITY.md');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('CANONICAL_ORIGIN が空のミラーでは Canonical 行を出さない(別オリジンを正典と偽らない)', async () => {
    const res = await app.request(
      'https://sumihajime.tokyo-odh-145.workers.dev/.well-known/security.txt',
      undefined,
      env(MIRROR_ENV),
    );
    expect(res.status).toBe(200);
    expect(await res.text()).not.toContain('Canonical:');
  });

  it('Expires は未来の日付(RFC 9116 は1年以内を推奨。切れたら更新する)', async () => {
    const res = await app.request(`${PROD}/.well-known/security.txt`, undefined, env(PROD_ENV));
    const expires = /^Expires: (.+)$/m.exec(await res.text())?.[1] ?? '';
    expect(Date.parse(expires)).toBeGreaterThan(Date.now());
  });
});
