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
    expect(v).toEqual({ status: 'changed', reason: 'content_hash_changed', consecutiveFailures: 0 });
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
    expect(v).toEqual({ status: 'unverifiable', reason: 'charset_not_utf8', consecutiveFailures: 0 });
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
      input({ baseline: { pageUpdatedOn: '2026-01-01' }, current: { pageUpdatedOn: '2026-02-02' } }),
    );
    expect(v.status).toBe('changed');
    expect(v.reason).toBe('page_updated_on_changed');
  });

  it('更新日が同じなら ok', () => {
    const v = classifyCheck(
      input({ baseline: { pageUpdatedOn: '2026-01-01' }, current: { pageUpdatedOn: '2026-01-01' } }),
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
