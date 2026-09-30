import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SPA_ROUTES } from '@tmn/domain';
import { canonicalRedirectTarget } from './canonical-host.js';

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
  });

  it('CANONICAL_ORIGIN が無い環境(ミラー)や不正な値では何もしない', () => {
    const url = at('https://sumihajime.tokyo-odh-145.workers.dev/');
    expect(canonicalRedirectTarget(url, 'GET', undefined)).toBeNull();
    expect(canonicalRedirectTarget(url, 'GET', 'not a url')).toBeNull();
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
  });
});
