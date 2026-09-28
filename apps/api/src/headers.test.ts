import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { GSI_TILE_ORIGIN } from '@tmn/domain';
import {
  API_SECURITY_HEADERS,
  DOCUMENT_SECURITY_HEADERS,
  withDocumentSecurityHeaders,
} from './headers.js';

/**
 * セキュリティヘッダは2か所(静的アセット= _headers / Worker応答= headers.ts)で付ける。
 * 片方だけ更新されると「トップだけCSPが古い」等の見つけにくい穴になるため、ここで一致を固定する。
 */

const here = dirname(fileURLToPath(import.meta.url));
const headersFile = resolve(here, '../../web/public/_headers');

/** `_headers` のルールブロック(`/pattern` + インデントされた `Name: value`)を読み取る。 */
function parseHeadersFile(text: string): Map<string, Map<string, string>> {
  const rules = new Map<string, Map<string, string>>();
  let current: Map<string, string> | undefined;
  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/\s+$/, '');
    if (line.trim().length === 0 || line.trim().startsWith('#')) continue;
    if (!/^\s/.test(line)) {
      current = new Map();
      rules.set(line.trim(), current);
      continue;
    }
    const separator = line.indexOf(':');
    if (separator < 0 || !current) continue;
    current.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
  }
  return rules;
}

describe('_headers(静的アセット)と headers.ts(Worker応答)の一致', () => {
  const rules = parseHeadersFile(readFileSync(headersFile, 'utf-8'));

  it('`/*` ルールが存在する(全アセットに掛かる)', () => {
    expect([...rules.keys()]).toContain('/*');
  });

  it.each(Object.entries(DOCUMENT_SECURITY_HEADERS))(
    '`/*` の %s が Worker 側と同じ値である',
    (name, value) => {
      expect(rules.get('/*')?.get(name)).toBe(value);
    },
  );

  it('`/*` に想定外のヘッダを増やしていない(片側だけの追加を防ぐ)', () => {
    expect([...(rules.get('/*')?.keys() ?? [])].sort()).toEqual(
      Object.keys(DOCUMENT_SECURITY_HEADERS).sort(),
    );
  });

  it('既存の /assets/* 長期キャッシュ規則を壊していない', () => {
    expect(rules.get('/assets/*')?.get('Cache-Control')).toBe(
      'public, max-age=31536000, immutable',
    );
  });
});

describe('CSP の中身', () => {
  const csp = DOCUMENT_SECURITY_HEADERS['Content-Security-Policy'] ?? '';

  it('危険な緩和を含まない', () => {
    expect(csp).not.toContain('unsafe-inline');
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).not.toContain('*');
  });

  it('地図タイルの取得元を img-src と connect-src の両方で許可する', () => {
    expect(csp).toContain(`img-src 'self' data: ${GSI_TILE_ORIGIN}`);
    expect(csp).toContain(`connect-src 'self' ${GSI_TILE_ORIGIN}`);
  });

  it('埋め込み・プラグイン・base乗っ取りを塞ぐ', () => {
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
  });

  it('APIの応答は何も読み込ませない', () => {
    expect(API_SECURITY_HEADERS['Content-Security-Policy']).toContain("default-src 'none'");
  });
});

/**
 * なぜ: https への格下げ防止(HSTS)と、他サイトとのウィンドウ参照・資源の読み込みの遮断
 * (COOP/CORP)。文書・静的アセット(_headers)・API の3系統すべてで同じ値であることを固定する
 * (_headers との一致は上の describe が、ここでは値そのものと API 側を確かめる)。
 */
describe('HSTS / COOP / CORP', () => {
  const expected = {
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
  };

  it.each(Object.entries(expected))('文書・API の両方に %s: %s が付く', (name, value) => {
    expect(DOCUMENT_SECURITY_HEADERS[name]).toBe(value);
    expect(API_SECURITY_HEADERS[name]).toBe(value);
  });

  it('HSTS に preload を付けない(親ドメイン workers.dev を管理していないため)', () => {
    expect(DOCUMENT_SECURITY_HEADERS['Strict-Transport-Security']).not.toContain('preload');
  });
});

describe('withDocumentSecurityHeaders', () => {
  it('本文とステータスを保ったままヘッダだけ足す', async () => {
    const res = withDocumentSecurityHeaders(
      new Response('<!doctype html>', {
        status: 404,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      }),
    );
    expect(res.status).toBe(404);
    expect(res.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
    await expect(res.text()).resolves.toBe('<!doctype html>');
    for (const [name, value] of Object.entries(DOCUMENT_SECURITY_HEADERS)) {
      expect(res.headers.get(name)).toBe(value);
    }
  });
});
