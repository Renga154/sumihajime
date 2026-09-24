import { describe, expect, it } from 'vitest';
import { PATROL_STALE_AFTER_MS, assessHealth } from './health.js';

const NOW = new Date('2026-09-24T03:00:00Z');
const drift = (lastCheckedAt: string | null) => ({
  flaggedSources: 12,
  unverifiableSources: 5,
  checkedSources: 332,
  lastCheckedAt,
});

describe('assessHealth', () => {
  it('D1が読め、公開データがあり、巡回が最近動いていれば ok', () => {
    expect(
      assessHealth({
        dbReachable: true,
        publishedProcedures: 322,
        drift: drift('2026-09-24T02:00:10Z'),
        now: NOW,
      }),
    ).toEqual({ status: 'ok', issues: [] });
  });

  it('再確認中の件数が多くても障害ではない(運用上の積み残しは issues に入れない)', () => {
    const r = assessHealth({
      dbReachable: true,
      publishedProcedures: 322,
      drift: { ...drift('2026-09-24T02:00:10Z'), flaggedSources: 300 },
      now: NOW,
    });
    expect(r.status).toBe('ok');
  });

  it('D1が読めなければ db_unreachable だけを返す(他は判定できない)', () => {
    expect(
      assessHealth({ dbReachable: false, publishedProcedures: null, drift: null, now: NOW }),
    ).toEqual({ status: 'degraded', issues: ['db_unreachable'] });
  });

  it('公開データが空なら no_published_data', () => {
    const r = assessHealth({
      dbReachable: true,
      publishedProcedures: 0,
      drift: drift('2026-09-24T02:00:10Z'),
      now: NOW,
    });
    expect(r).toEqual({ status: 'degraded', issues: ['no_published_data'] });
  });

  it('巡回が一度も無ければ patrol_never_ran', () => {
    const r = assessHealth({
      dbReachable: true,
      publishedProcedures: 322,
      drift: drift(null),
      now: NOW,
    });
    expect(r.issues).toEqual(['patrol_never_ran']);
  });

  it('境界: 猶予ちょうどは ok、1ms 超えたら patrol_stalled', () => {
    const at = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
    expect(
      assessHealth({
        dbReachable: true,
        publishedProcedures: 322,
        drift: drift(at(PATROL_STALE_AFTER_MS)),
        now: NOW,
      }).status,
    ).toBe('ok');
    expect(
      assessHealth({
        dbReachable: true,
        publishedProcedures: 322,
        drift: drift(at(PATROL_STALE_AFTER_MS + 1)),
        now: NOW,
      }).issues,
    ).toEqual(['patrol_stalled']);
  });

  it('日時が壊れていれば止まっている扱い(推測で ok にしない)', () => {
    expect(
      assessHealth({
        dbReachable: true,
        publishedProcedures: 322,
        drift: drift('not-a-date'),
        now: NOW,
      }).issues,
    ).toEqual(['patrol_stalled']);
  });
});
