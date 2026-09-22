import { describe, expect, it } from 'vitest';
import { SPA_ROUTES, isKnownSpaPath, sitemapPaths } from './routes.js';

describe('isKnownSpaPath — 既知ルート(200)と未定義URL(404)の境界', () => {
  it.each(SPA_ROUTES.map((r) => r.path))('定義済みパターン %s 自身を既知と判定する', (pattern) => {
    // `:id` は具体値へ置き換えてから判定する(パターンそのものは実URLではない)。
    const concrete = pattern.replace(/:[^/]+/g, 'sample-id');
    expect(isKnownSpaPath(concrete)).toBe(true);
  });

  it('動的セグメントは任意の1セグメントに一致する', () => {
    expect(isKnownSpaPath('/procedures/resident-registration')).toBe(true);
    expect(isKnownSpaPath('/procedures/13112-x')).toBe(true);
  });

  it('動的セグメントが空・多段のURLは既知にしない', () => {
    expect(isKnownSpaPath('/procedures')).toBe(false);
    expect(isKnownSpaPath('/procedures/')).toBe(false);
    expect(isKnownSpaPath('/procedures/a/b')).toBe(false);
  });

  it('未定義URLを既知にしない', () => {
    expect(isKnownSpaPath('/no-such-page')).toBe(false);
    expect(isKnownSpaPath('/checklist2')).toBe(false);
    expect(isKnownSpaPath('/Wizard')).toBe(false); // 大文字小文字は区別する
    expect(isKnownSpaPath('/wizard/extra')).toBe(false);
    expect(isKnownSpaPath('/api/health')).toBe(false); // /api/* はWorkerの担当
  });

  it('末尾スラッシュの有無を同一視する', () => {
    expect(isKnownSpaPath('/wizard/')).toBe(true);
    expect(isKnownSpaPath('/')).toBe(true);
    expect(isKnownSpaPath('')).toBe(true); // 空文字はルートと同じセグメント構成
  });
});

describe('sitemapPaths — 中身のあるURLだけを載せる', () => {
  it('アプリ状態なしで中身が出るページだけを返す', () => {
    expect(sitemapPaths()).toEqual(['/', '/differences', '/about-data', '/terms', '/privacy']);
  });

  it('sitemapに載せるパスはすべて既知ルートである(存在しないURLを載せない)', () => {
    for (const path of sitemapPaths()) {
      expect(isKnownSpaPath(path)).toBe(true);
    }
  });

  it('動的セグメントを含むパスをsitemapへ載せない', () => {
    for (const path of sitemapPaths()) {
      expect(path).not.toContain(':');
    }
  });
});
