import { describe, expect, it } from 'vitest';
import { classifyCheck, type DriftCheckInput } from './classify.js';

/**
 * なぜ: ADR-014 の判定表(到達性 → csv/xlsx はハッシュ → HTML は更新日 → Last-Modified →
 * 検証不能)の各分岐と、「unreachable は2回連続で確定」「www. の有無は同一ホスト」
 * 「トップへ潰されたら失敗」の境界を固定する。
 */

const URL_A = 'https://www.city.setagaya.lg.jp/a/b.html';

function okFetch(over: Partial<Extract<DriftCheckInput['fetch'], { ok: boolean }>> = {}) {
  return { ok: true, status: 200, requestedUrl: URL_A, finalUrl: URL_A, ...over };
}

function input(over: Partial<DriftCheckInput>): DriftCheckInput {
  return {
    sourceType: 'html',
    fetch: okFetch(),
    baseline: {},
    current: {},
    previousConsecutiveFailures: 0,
    ...over,
  };
}

describe('classifyCheck — 到達性', () => {
  it('ネットワーク例外: 1回目は transient、2回目で unreachable', () => {
    const first = classifyCheck(input({ fetch: { networkError: true } }));
    expect(first).toEqual({ status: 'transient', reason: 'network_error', consecutiveFailures: 1 });
    const second = classifyCheck(
      input({ fetch: { networkError: true }, previousConsecutiveFailures: 1 }),
    );
    expect(second).toEqual({
      status: 'unreachable',
      reason: 'network_error',
      consecutiveFailures: 2,
    });
  });

  it('HTTP 404 は http_404 として失敗に数える', () => {
    const v = classifyCheck(input({ fetch: okFetch({ ok: false, status: 404 }) }));
    expect(v).toEqual({ status: 'transient', reason: 'http_404', consecutiveFailures: 1 });
  });

  it('最終URLのホストが変わったら失敗(host_changed)', () => {
    const v = classifyCheck(
      input({ fetch: okFetch({ finalUrl: 'https://example.com/a/b.html' }) }),
    );
    expect(v.status).toBe('transient');
    expect(v.reason).toBe('host_changed');
  });

  it('www. の有無・大文字小文字の違いは同一ホストとみなす', () => {
    const v = classifyCheck(
      input({
        fetch: okFetch({ finalUrl: 'https://CITY.setagaya.lg.jp/a/b.html' }),
        baseline: { pageUpdatedOn: '2026-01-01' },
        current: { pageUpdatedOn: '2026-01-01' },
      }),
    );
    expect(v.status).toBe('ok');
  });

  it('深いパスがトップへ潰されたら失敗(path_collapsed_to_root)', () => {
    const v = classifyCheck(
      input({ fetch: okFetch({ finalUrl: 'https://www.city.setagaya.lg.jp/' }) }),
    );
    expect(v.reason).toBe('path_collapsed_to_root');
    expect(v.status).toBe('transient');
  });

  it('最初からトップを要求していればトップへの着地は失敗ではない', () => {
    const root = 'https://www.city.setagaya.lg.jp/';
    const v = classifyCheck(
      input({
        fetch: okFetch({ requestedUrl: root, finalUrl: root, lastModified: 'x' }),
      }),
    );
    expect(v.status).toBe('ok');
    expect(v.reason).toBe('baseline_established');
  });

  it('成功したら連続失敗回数は 0 に戻る', () => {
    const v = classifyCheck(
      input({
        previousConsecutiveFailures: 3,
        baseline: { pageUpdatedOn: '2026-01-01' },
        current: { pageUpdatedOn: '2026-01-01' },
      }),
    );
    expect(v.consecutiveFailures).toBe(0);
  });
});

describe('classifyCheck — csv / xlsx(生ハッシュ)', () => {
  it('ハッシュが違えば changed', () => {
    const v = classifyCheck(
      input({ sourceType: 'csv', baseline: { contentHash: 'aa' }, current: { contentHash: 'bb' } }),
    );
    expect(v).toEqual({
      status: 'changed',
      reason: 'content_hash_changed',
      consecutiveFailures: 0,
    });
  });

  it('同じなら ok', () => {
    const v = classifyCheck(
      input({
        sourceType: 'xlsx',
        baseline: { contentHash: 'aa' },
        current: { contentHash: 'aa' },
      }),
    );
    expect(v.status).toBe('ok');
  });

  it('基準ハッシュが無ければ unverifiable/no_signal', () => {
    const v = classifyCheck(input({ sourceType: 'csv', current: { contentHash: 'aa' } }));
    expect(v).toEqual({ status: 'unverifiable', reason: 'no_signal', consecutiveFailures: 0 });
  });

  it('ダウンロードが別ホストの保存先へリダイレクトしても失敗にしない(中身のハッシュで判定)', () => {
    // 渋谷区の ArcGIS Hub は毎回、署名付きの保存先URLへリダイレクトして CSV を返す。
    const v = classifyCheck(
      input({
        sourceType: 'csv',
        fetch: okFetch({
          requestedUrl: 'https://city-shibuya-data.opendata.arcgis.com/api/download/v1/items/x/csv',
          finalUrl: 'https://stg-arcgisazurecdataprod3.az.arcgis.com/exportfiles/x.csv?sig=abc',
        }),
        baseline: { contentHash: 'aa' },
        current: { contentHash: 'aa' },
      }),
    );
    expect(v).toEqual({ status: 'ok', reason: 'content_hash_same', consecutiveFailures: 0 });
  });

  it('ダウンロードでも HTTP エラーは失敗に数える', () => {
    const v = classifyCheck(
      input({
        sourceType: 'csv',
        fetch: okFetch({ ok: false, status: 404 }),
        baseline: { contentHash: 'aa' },
      }),
    );
    expect(v.reason).toBe('http_404');
  });
});

describe('classifyCheck — html(更新日)', () => {
  it('非 UTF-8 宣言は unverifiable/charset_not_utf8', () => {
    const v = classifyCheck(
      input({
        fetch: okFetch({ declaredCharset: 'Shift_JIS' }),
        baseline: { pageUpdatedOn: '2026-01-01' },
        current: { pageUpdatedOn: '2026-01-01' },
      }),
    );
    expect(v).toEqual({
      status: 'unverifiable',
      reason: 'charset_not_utf8',
      consecutiveFailures: 0,
    });
  });

  it('utf-8 / UTF8 の宣言ゆれは UTF-8 として扱う', () => {
    for (const cs of ['utf-8', 'UTF-8', 'utf8']) {
      const v = classifyCheck(
        input({
          fetch: okFetch({ declaredCharset: cs }),
          baseline: { pageUpdatedOn: '2026-01-01' },
          current: { pageUpdatedOn: '2026-01-01' },
        }),
      );
      expect(v.status, cs).toBe('ok');
    }
  });

  it('基準の更新日があり、今回抽出できなければ changed/page_updated_on_missing_now', () => {
    const v = classifyCheck(
      input({ baseline: { pageUpdatedOn: '2026-01-01' }, current: { pageUpdatedOn: null } }),
    );
    expect(v).toEqual({
      status: 'changed',
      reason: 'page_updated_on_missing_now',
      consecutiveFailures: 0,
    });
  });

  it('更新日が違えば changed/page_updated_on_changed', () => {
    const v = classifyCheck(
      input({
        baseline: { pageUpdatedOn: '2026-01-01' },
        current: { pageUpdatedOn: '2026-02-02' },
      }),
    );
    expect(v.status).toBe('changed');
    expect(v.reason).toBe('page_updated_on_changed');
  });

  it('更新日が同じなら ok', () => {
    const v = classifyCheck(
      input({
        baseline: { pageUpdatedOn: '2026-01-01' },
        current: { pageUpdatedOn: '2026-01-01' },
      }),
    );
    expect(v.status).toBe('ok');
  });
});

describe('classifyCheck — html(更新日表記なし → Last-Modified)', () => {
  it('初回は基準を確立(ok/baseline_established)', () => {
    const v = classifyCheck(
      input({ fetch: okFetch({ lastModified: 'Mon, 01 Sep 2026 00:00:00 GMT' }) }),
    );
    expect(v).toEqual({ status: 'ok', reason: 'baseline_established', consecutiveFailures: 0 });
  });

  it('基準と違えば changed/last_modified_changed', () => {
    const v = classifyCheck(
      input({
        fetch: okFetch({ lastModified: 'Tue, 02 Sep 2026 00:00:00 GMT' }),
        baseline: { lastModified: 'Mon, 01 Sep 2026 00:00:00 GMT' },
      }),
    );
    expect(v.status).toBe('changed');
    expect(v.reason).toBe('last_modified_changed');
  });

  it('基準と同じなら ok', () => {
    const lm = 'Mon, 01 Sep 2026 00:00:00 GMT';
    const v = classifyCheck(
      input({ fetch: okFetch({ lastModified: lm }), baseline: { lastModified: lm } }),
    );
    expect(v.status).toBe('ok');
  });

  it('更新日もヘッダも無ければ unverifiable/no_signal', () => {
    const v = classifyCheck(input({}));
    expect(v).toEqual({ status: 'unverifiable', reason: 'no_signal', consecutiveFailures: 0 });
  });
});

/**
 * なぜ: 巡回はリダイレクトを自動では辿らず、各ホップで公式ホストかを確かめる(非公式ホストの
 * 中身を根拠の判定に使わない=原則5)。打ち切り・本文の上限超過が、従来の判定の意味
 * (HTMLの別サイト転送=到達性の失敗、判定材料なし=検証不能)を保つことを固定する。
 */
describe('classifyCheck — リダイレクトの打ち切り・本文の上限', () => {
  it('HTML が非公式ホストへ転送: 従来の host_changed と同じく1回目 transient・2回目 unreachable', () => {
    const fetch = { redirectRejected: 'redirect_not_official' as const };
    expect(classifyCheck(input({ fetch }))).toEqual({
      status: 'transient',
      reason: 'redirect_not_official',
      consecutiveFailures: 1,
    });
    expect(classifyCheck(input({ fetch, previousConsecutiveFailures: 1 })).status).toBe(
      'unreachable',
    );
  });

  it('ファイルが非公式ホスト(配信基盤の保存先)へ転送: 失敗に数えず検証不能', () => {
    const v = classifyCheck(
      input({
        sourceType: 'csv',
        fetch: { redirectRejected: 'redirect_not_official' },
        baseline: { contentHash: 'abc' },
        previousConsecutiveFailures: 1,
      }),
    );
    expect(v).toEqual({
      status: 'unverifiable',
      reason: 'redirect_not_official',
      consecutiveFailures: 0,
    });
  });

  it('転送が多すぎる: 種類を問わず到達性の失敗', () => {
    for (const sourceType of ['html', 'csv']) {
      const v = classifyCheck(
        input({ sourceType, fetch: { redirectRejected: 'too_many_redirects' } }),
      );
      expect(v).toEqual({
        status: 'transient',
        reason: 'too_many_redirects',
        consecutiveFailures: 1,
      });
    }
  });

  it('本文が上限を超えた: 検証不能(更新日・ハッシュを推測しない)', () => {
    for (const sourceType of ['html', 'xlsx']) {
      const v = classifyCheck(
        input({
          sourceType,
          fetch: okFetch({ bodyTooLarge: true }),
          baseline: { pageUpdatedOn: '2026-09-01', contentHash: 'abc' },
        }),
      );
      expect(v).toEqual({
        status: 'unverifiable',
        reason: 'body_too_large',
        consecutiveFailures: 0,
      });
    }
  });
});
