import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from './index';
import { API_SECURITY_HEADERS, DOCUMENT_SECURITY_HEADERS } from './headers.js';

/**
 * 11. ルートの棚卸し。
 *
 * なぜ: 入口の検査(405・403・429・ヘッダ付与)は index.ts のミドルウェアに集約してある。新しい
 * ルートを足したとき、その登録位置やパスの形によって検査を素通りしても、テストは何も言わない。
 *  1. 登録済みのルート(メソッド×パス)をここに列挙し、一覧と一致しなければ落とす
 *     (足した人に「入口の検査を通るか」を確認させる関所)。
 *  2. 一覧の全ルートを実際に叩き、セキュリティヘッダ・メソッド制限・クロスサイト拒否が
 *     効いていることを確かめる(一覧に足しただけでは通らない)。
 */

const EXPECTED_ROUTES = [
  'GET /api/health',
  'GET /api/chat/availability',
  'POST /api/chat',
  'GET /api/municipalities',
  'POST /api/checklists',
  'GET /api/procedures/:id',
  'GET /api/facilities',
  'GET /api/stats',
  'GET /api/sources',
  'GET /api/ward-differences',
  'GET /api/waste-schedules',
  'GET /api/waste-sorting',
  'GET /robots.txt',
  'GET /sitemap.xml',
  'GET /.well-known/security.txt',
];

/** 全メソッドを受けるもの(app.use のミドルウェアと SPA フォールバック)。 */
const EXPECTED_ALL = ['/*', '/api/*', '/api/chat', '/api/checklists'];

const registered = app.routes.filter((r) => r.method !== 'ALL').map((r) => `${r.method} ${r.path}`);

/** パス引数を実在しそうな値で埋める。 */
const concrete = (path: string) => path.replace(':id', 'procedure_resident_registration');

const throwingDb = {
  prepare() {
    throw new Error('D1 reached');
  },
};

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('登録済みルートの一覧', () => {
  it('一覧と一致する(ルートを足したら、入口の検査を確認してからここへ足す)', () => {
    expect([...registered].sort()).toEqual([...EXPECTED_ROUTES].sort());
  });

  it('全メソッドを受ける登録はミドルウェアと SPA フォールバックだけ', () => {
    const all = [...new Set(app.routes.filter((r) => r.method === 'ALL').map((r) => r.path))];
    expect(all.sort()).toEqual([...EXPECTED_ALL].sort());
  });
});

describe('一覧の全ルートが入口の検査を通る', () => {
  const apiRoutes = EXPECTED_ROUTES.filter((r) => r.includes(' /api/'));
  const docRoutes = EXPECTED_ROUTES.filter((r) => !r.includes(' /api/'));

  it.each(apiRoutes)('%s の応答に API のセキュリティヘッダが付く', async (route) => {
    const [method, path] = route.split(' ') as [string, string];
    const res = await app.request(
      concrete(path),
      method === 'POST'
        ? { method, headers: { 'content-type': 'application/json' }, body: '{}' }
        : { method },
      { DB: throwingDb },
    );
    for (const [name, value] of Object.entries(API_SECURITY_HEADERS)) {
      expect(res.headers.get(name), `${route} ${name}`).toBe(value);
    }
  });

  it.each(docRoutes)('%s の応答に文書のセキュリティヘッダが付く', async (route) => {
    const path = route.split(' ')[1] ?? '';
    const res = await app.request(path);
    expect(res.status).toBe(200);
    for (const [name, value] of Object.entries(DOCUMENT_SECURITY_HEADERS)) {
      expect(res.headers.get(name), `${route} ${name}`).toBe(value);
    }
  });

  it.each(apiRoutes)('%s は登録外のメソッドを 405 で断る', async (route) => {
    const [method, path] = route.split(' ') as [string, string];
    const other = method === 'GET' ? 'DELETE' : 'GET';
    const res = await app.request(concrete(path), { method: other }, { DB: throwingDb });
    expect(res.status).toBe(405);
    expect(res.headers.get('Allow')).toBe(method === 'GET' ? 'GET, HEAD' : 'POST');
  });

  it.each(apiRoutes.filter((r) => r.startsWith('POST ')))(
    '%s はクロスサイト送信を 403 で断る',
    async (route) => {
      const path = route.split(' ')[1] ?? '';
      const res = await app.request(
        `https://sumihajime.com${path}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', Origin: 'https://evil.example' },
          body: '{}',
        },
        { DB: throwingDb },
      );
      expect(res.status).toBe(403);
    },
  );
});
