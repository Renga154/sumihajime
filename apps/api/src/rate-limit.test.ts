import { afterEach, describe, expect, it, vi } from 'vitest';
import { app } from './index';
import { API_SECURITY_HEADERS } from './headers.js';

/**
 * 7. Workers Rate Limiting バインディングによる流量制限。
 * バインディングの代役は「key ごとに limit 回まで success」を返す(実物の simple 設定と同じ形)。
 */

function fakeLimiter(limit: number) {
  const counts = new Map<string, number>();
  const keys: string[] = [];
  const binding = {
    limit: vi.fn(({ key }: { key: string }) => {
      keys.push(key);
      const n = (counts.get(key) ?? 0) + 1;
      counts.set(key, n);
      return Promise.resolve({ success: n <= limit });
    }),
  };
  return { binding, keys };
}

/** 本処理へ届いたら 500 になる D1(=429 で止まったかどうかを状態で見分ける)。 */
const throwingDb = {
  prepare() {
    throw new Error('D1 reached');
  },
};

function captureLogs(): string[] {
  const logs: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    logs.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
  });
  return logs;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('読み取り API の流量制限(API_RATE_LIMITER)', () => {
  it('攻撃: 上限を超えた同一 IP は 429 + Retry-After + 標準エラーで、D1 に届かない', async () => {
    captureLogs();
    const { binding } = fakeLimiter(2);
    const env = { DB: throwingDb, API_RATE_LIMITER: binding };
    const headers = { 'CF-Connecting-IP': '203.0.113.9' };
    // 上限までは本処理へ進む(throwingDb なので 500)。
    expect((await app.request('/api/municipalities', { headers }, env)).status).toBe(500);
    expect((await app.request('/api/municipalities', { headers }, env)).status).toBe(500);
    const res = await app.request('/api/municipalities', { headers }, env);
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('60');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    for (const [name, value] of Object.entries(API_SECURITY_HEADERS)) {
      expect(res.headers.get(name), name).toBe(value);
    }
    const body = (await res.json()) as { error: { code: string; requestId?: string } };
    expect(body.error.code).toBe('rate_limited');
    expect(body.error.requestId).toBeTruthy();
  });

  it('攻撃: IPv6 の末尾を替えても同じ /64 として数える', async () => {
    captureLogs();
    const { binding, keys } = fakeLimiter(1);
    const env = { DB: throwingDb, API_RATE_LIMITER: binding };
    await app.request('/api/stats', { headers: { 'CF-Connecting-IP': '2001:db8:aa:bb::1' } }, env);
    const res = await app.request(
      '/api/stats',
      { headers: { 'CF-Connecting-IP': '2001:db8:aa:bb:1234:5678:9abc:def0' } },
      env,
    );
    expect(res.status).toBe(429);
    expect(new Set(keys)).toEqual(new Set(['2001:db8:aa:bb::/64']));
  });

  it('正常: 別の IP は影響を受けない', async () => {
    captureLogs();
    const { binding } = fakeLimiter(1);
    const env = { DB: throwingDb, API_RATE_LIMITER: binding };
    await app.request('/api/stats', { headers: { 'CF-Connecting-IP': '198.51.100.1' } }, env);
    const other = await app.request(
      '/api/stats',
      { headers: { 'CF-Connecting-IP': '198.51.100.2' } },
      env,
    );
    expect(other.status).not.toBe(429);
  });

  it('正常: /api/health は数えない(外形監視を止めない)', async () => {
    const { binding } = fakeLimiter(0);
    const res = await app.request('/api/health', undefined, { API_RATE_LIMITER: binding });
    expect(res.status).toBe(200);
    expect(binding.limit).not.toHaveBeenCalled();
  });

  it('IP をログに残さない', async () => {
    const logs = captureLogs();
    const { binding } = fakeLimiter(0);
    await app.request(
      '/api/stats',
      { headers: { 'CF-Connecting-IP': '192.0.2.77' } },
      { DB: throwingDb, API_RATE_LIMITER: binding },
    );
    const joined = logs.join('\n');
    expect(joined).toContain('"status":429');
    expect(joined).not.toContain('192.0.2.77');
  });

  it('バインディングが無い環境(ローカル・単体テスト)では制限しない', async () => {
    const res = await app.request('/api/health');
    expect(res.status).toBe(200);
  });

  it('バインディング呼び出しの失敗では閉じない(Cloudflare 側の一時障害で全面停止にしない)', async () => {
    captureLogs();
    const broken = { limit: () => Promise.reject(new Error('binding down')) };
    const res = await app.request(
      '/api/stats',
      { headers: { 'CF-Connecting-IP': '198.51.100.3' } },
      { DB: throwingDb, API_RATE_LIMITER: broken },
    );
    expect(res.status).toBe(500); // 429 ではなく本処理へ進んだ(D1 の代役が 500 を返す)
  });
});

describe('チャットの流量制限(CHAT_RATE_LIMITER)', () => {
  const chat = (env: Record<string, unknown>) =>
    app.request(
      '/api/chat',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'CF-Connecting-IP': '203.0.113.50' },
        body: JSON.stringify({ municipalityCode: '13112', question: '転入届は？' }),
      },
      env,
    );

  it('攻撃: チャット専用の枠を超えると 429(chat.rate_limited として記録)', async () => {
    const logs = captureLogs();
    const chatLimiter = fakeLimiter(1);
    const readLimiter = fakeLimiter(100);
    const env = {
      DB: throwingDb,
      RAG_ENABLED: 'false',
      CHAT_RATE_LIMITER: chatLimiter.binding,
      API_RATE_LIMITER: readLimiter.binding,
    };
    expect((await chat(env)).status).toBe(503);
    const res = await chat(env);
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('60');
    expect(logs.join('\n')).toContain('"event":"chat.rate_limited"');
    // チャットは読み取り用の枠を消費しない(チャットを使っただけで画面の読み込みが 429 にならない)。
    expect(readLimiter.binding.limit).not.toHaveBeenCalled();
  });
});
