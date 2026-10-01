import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SPA_ROUTES } from '@tmn/domain';
import { canonicalRedirectTarget, entryDecision } from './canonical-host.js';
import { RATE_LIMIT_PERIOD_SECONDS } from './rate-limit.js';

const CANONICAL = 'https://sumihajime.com';
const at = (u: string) => new URL(u);

describe('canonicalRedirectTarget', () => {
  it('旧URLと www の画面は、パスとクエリを保ったまま独自ドメインへ送る', () => {
    expect(
      canonicalRedirectTarget(
        at('https://app.sumihajime.workers.dev/checklist?x=1'),
        'GET',
        CANONICAL,
      ),
    ).toBe('https://sumihajime.com/checklist?x=1');
    expect(canonicalRedirectTarget(at('https://www.sumihajime.com/'), 'HEAD', CANONICAL)).toBe(
      'https://sumihajime.com/',
    );
  });

  it('独自ドメイン自身・API・GET/HEAD 以外・ローカルは送らない', () => {
    expect(canonicalRedirectTarget(at('https://sumihajime.com/'), 'GET', CANONICAL)).toBeNull();
    expect(
      canonicalRedirectTarget(
        at('https://app.sumihajime.workers.dev/api/health'),
        'GET',
        CANONICAL,
      ),
    ).toBeNull();
    expect(
      canonicalRedirectTarget(
        at('https://app.sumihajime.workers.dev/checklist'),
        'POST',
        CANONICAL,
      ),
    ).toBeNull();
    expect(canonicalRedirectTarget(at('http://localhost:8788/'), 'GET', CANONICAL)).toBeNull();
    expect(canonicalRedirectTarget(at('http://[::1]:8788/'), 'GET', CANONICAL)).toBeNull();
  });

  it('CANONICAL_ORIGIN が無い環境(ミラー)や不正な値では何もしない', () => {
    const url = at('https://sumihajime.tokyo-odh-145.workers.dev/');
    expect(canonicalRedirectTarget(url, 'GET', undefined)).toBeNull();
    expect(canonicalRedirectTarget(url, 'GET', 'not a url')).toBeNull();
  });
});

describe('entryDecision(平文HTTP → https と独自ドメインへの一本化)', () => {
  it('平文HTTPの GET/HEAD は https へ(独自ドメインの対象なら直接そこへ=1回の転送)', () => {
    expect(entryDecision(at('http://sumihajime.com/x?y=1'), 'GET', CANONICAL)).toEqual({
      kind: 'redirect',
      location: 'https://sumihajime.com/x?y=1',
    });
    expect(entryDecision(at('http://www.sumihajime.com/'), 'HEAD', CANONICAL)).toEqual({
      kind: 'redirect',
      location: 'https://sumihajime.com/',
    });
    expect(entryDecision(at('http://app.sumihajime.workers.dev/api/x'), 'GET', CANONICAL)).toEqual({
      kind: 'redirect',
      location: 'https://app.sumihajime.workers.dev/api/x',
    });
  });

  it('CANONICAL_ORIGIN が空でも平文HTTPは https へ', () => {
    expect(entryDecision(at('http://mirror.example.workers.dev/'), 'GET', '')).toEqual({
      kind: 'redirect',
      location: 'https://mirror.example.workers.dev/',
    });
  });

  it('平文HTTPの POST 等は転送せず断る', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
      expect(entryDecision(at('http://sumihajime.com/api/chat'), method, CANONICAL)).toEqual({
        kind: 'reject_insecure',
      });
    }
  });

  it('https の独自ドメイン・ループバックは何もしない', () => {
    expect(entryDecision(at('https://sumihajime.com/'), 'GET', CANONICAL)).toBeNull();
    expect(entryDecision(at('https://sumihajime.com/api/chat'), 'POST', CANONICAL)).toBeNull();
    for (const u of ['http://localhost:8787/', 'http://127.0.0.1/', 'http://[::1]:5173/']) {
      expect(entryDecision(at(u), 'POST', CANONICAL)).toBeNull();
    }
  });
});

/**
 * なぜ: トップ等の画面は、静的アセットとして Worker を通らずに配信される。Worker が先に受けないと
 * 旧URLの画面を転送できないので、wrangler.jsonc の run_worker_first に画面のパスを並べている。
 * 画面を足したのにここへ書き忘れると、その画面だけ旧URLに残る。SPA_ROUTES との一致で止める。
 */
describe('wrangler.jsonc の run_worker_first', () => {
  const jsonc = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), '../wrangler.jsonc'),
    'utf8',
  );
  const config = JSON.parse(jsonc.replace(/^\s*\/\/.*$/gm, '').replace(/,(\s*[}\]])/g, '$1')) as {
    assets: { run_worker_first: string[] };
    env: { odh: { assets: { run_worker_first: string[] } } };
  };
  const expected = SPA_ROUTES.map((r) => r.path.replace(/:[a-z]+$/, '*'));

  it.each([
    ['正典', config.assets.run_worker_first],
    ['ミラー', config.env.odh.assets.run_worker_first],
  ])('%s: すべての画面のパスを Worker が先に受ける', (_, patterns) => {
    for (const path of expected) expect(patterns).toContain(path);
    expect(patterns).toContain('/api/*');
    // security.txt は Worker が生成する(静的ファイルは置かない)。
    expect(patterns).toContain('/.well-known/security.txt');
  });
});

/**
 * 流量制限のバインディングは env に継承されない。ミラーだけ制限が無い、を防ぐ。
 * rate-limit.ts が読む名前と、Retry-After に使う期間(60秒)もここで揃っていることを見る。
 */
describe('wrangler.jsonc の ratelimits', () => {
  type RateLimitConfig = {
    name: string;
    namespace_id: string;
    simple: { limit: number; period: number };
  };
  const jsonc = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), '../wrangler.jsonc'),
    'utf8',
  );
  const config = JSON.parse(jsonc.replace(/^\s*\/\/.*$/gm, '').replace(/,(\s*[}\]])/g, '$1')) as {
    ratelimits: RateLimitConfig[];
    env: { odh: { ratelimits: RateLimitConfig[] } };
  };

  it.each([
    ['正典', config.ratelimits],
    ['ミラー', config.env.odh.ratelimits],
  ])('%s: 読み取り用とチャット用の2つがあり、期間は60秒', (_, limits) => {
    expect(limits.map((l) => l.name).sort()).toEqual(['API_RATE_LIMITER', 'CHAT_RATE_LIMITER']);
    for (const l of limits) {
      expect(l.simple.period).toBe(RATE_LIMIT_PERIOD_SECONDS);
      expect(l.namespace_id).toMatch(/^\d+$/);
    }
    expect(new Set(limits.map((l) => l.namespace_id)).size).toBe(limits.length);
    const chat = limits.find((l) => l.name === 'CHAT_RATE_LIMITER');
    const read = limits.find((l) => l.name === 'API_RATE_LIMITER');
    expect(chat!.simple.limit).toBeLessThan(read!.simple.limit);
  });
});
