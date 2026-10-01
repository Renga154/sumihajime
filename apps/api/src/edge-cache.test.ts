import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from './index';
import { API_SECURITY_HEADERS } from './headers.js';
import { EDGE_CACHE_TTL_SECONDS } from './edge-cache.js';

/**
 * 8. 公開の読み取り API のエッジキャッシュ(Cache API)。
 * Node には caches が無いので、URL をキーにした Map で caches.default の代役を置く。
 */

const PROD = 'https://sumihajime.com';

let store: Map<string, Response>;
let puts: Request[];

beforeEach(() => {
  store = new Map();
  puts = [];
  vi.stubGlobal('caches', {
    default: {
      match: (req: Request) => Promise.resolve(store.get(req.url)?.clone()),
      put: (req: Request, res: Response) => {
        puts.push(req);
        store.set(req.url, res);
        return Promise.resolve();
      },
    },
  });
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** 呼ばれた回数を数え、最小の municipalities 応答を返す D1 の代役。 */
function countingDb() {
  let calls = 0;
  const db = {
    prepare() {
      calls += 1;
      return {
        bind() {
          return this;
        },
        all: () => Promise.resolve({ results: [] }),
        first: () => Promise.resolve(null),
      };
    },
  };
  return { db, calls: () => calls };
}

describe('エッジキャッシュ', () => {
  it('独自ドメインの公開 GET は 5 分置き、2回目は D1 を読まない', async () => {
    const { db, calls } = countingDb();
    const env = { DB: db, CANONICAL_ORIGIN: PROD };
    const first = await app.request(`${PROD}/api/municipalities`, undefined, env);
    expect(first.status).toBe(200);
    const readsAfterFirst = calls();
    expect(readsAfterFirst).toBeGreaterThan(0);
    expect(puts).toHaveLength(1);
    expect(store.get(`${PROD}/api/municipalities`)?.headers.get('Cache-Control')).toBe(
      `public, max-age=${EDGE_CACHE_TTL_SECONDS}`,
    );

    const second = await app.request(`${PROD}/api/municipalities`, undefined, env);
    expect(second.status).toBe(200);
    expect(calls()).toBe(readsAfterFirst);
    await expect(second.json()).resolves.toEqual([]);
    // キャッシュから返した応答にもセキュリティヘッダを付け直す。ブラウザには毎回確かめさせる。
    for (const [name, value] of Object.entries(API_SECURITY_HEADERS)) {
      expect(second.headers.get(name), name).toBe(value);
    }
    expect(second.headers.get('Cache-Control')).toBe('no-cache');
  });

  it('置く応答に要求ごとの値(requestId)や Set-Cookie を含めない', async () => {
    const { db } = countingDb();
    await app.request(`${PROD}/api/municipalities`, undefined, { DB: db, CANONICAL_ORIGIN: PROD });
    const stored = store.get(`${PROD}/api/municipalities`);
    expect(stored).toBeDefined();
    const headerNames = [...(stored?.headers.keys() ?? [])].sort();
    expect(headerNames).toEqual(['cache-control', 'content-type']);
    expect(await stored?.clone().text()).not.toMatch(/requestId/);
  });

  it('キーは URL(クエリ込み)の完全一致。別の検索語の結果を返さない', async () => {
    const { db } = countingDb();
    const env = { DB: db, CANONICAL_ORIGIN: PROD };
    await app.request(`${PROD}/api/municipalities?a=1`, undefined, env);
    await app.request(`${PROD}/api/municipalities?a=2`, undefined, env);
    expect(puts.map((r) => r.url)).toEqual([
      `${PROD}/api/municipalities?a=1`,
      `${PROD}/api/municipalities?a=2`,
    ]);
  });

  it('エラー(200 以外)は置かない', async () => {
    const { db } = countingDb();
    const res = await app.request(`${PROD}/api/facilities`, undefined, {
      DB: db,
      CANONICAL_ORIGIN: PROD,
    });
    expect(res.status).toBe(400);
    expect(puts).toHaveLength(0);
  });

  it.each([
    ['旧URL(workers.dev)', 'https://app.sumihajime.workers.dev/api/municipalities', PROD],
    [
      'ミラー(CANONICAL_ORIGIN 空)',
      'https://sumihajime.tokyo-odh-145.workers.dev/api/municipalities',
      '',
    ],
  ])('%s では置かない', async (_, url, canonical) => {
    const { db } = countingDb();
    await app.request(url, undefined, { DB: db, CANONICAL_ORIGIN: canonical });
    expect(puts).toHaveLength(0);
  });

  it('/api/health と POST は置かない', async () => {
    const { db } = countingDb();
    const env = { DB: db, CANONICAL_ORIGIN: PROD };
    await app.request(`${PROD}/api/health`, undefined, env);
    await app.request(
      `${PROD}/api/chat`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ municipalityCode: '13112', question: 'x' }),
      },
      { ...env, RAG_ENABLED: 'false' },
    );
    expect(puts).toHaveLength(0);
  });
});
