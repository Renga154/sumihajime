import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import type { Profile } from '@tmn/schemas';
import { createTestDb, type TestDb } from '../test/d1-harness.js';
import { app } from './index.js';
import {
  DRIFT_USER_AGENT,
  MAX_BODY_BYTES,
  MAX_REDIRECT_HOPS,
  readBodyCapped,
  runDriftCheck,
} from './drift.js';

/**
 * なぜ: ADR-014 の D1 統合検証。
 *  (a) 巡回が changed を記録したソースを根拠に持つ手続きは、チェックリストと詳細で stale
 *      (再確認中)と検知日を返す。別自治体(13102)は影響を受けない(自治体スコープの分離)。
 *  (b) 検知後に人が再監査して台帳の last_verified_at が進んでいれば、マークは効力を失う。
 *  (c) runDriftCheck を fetch スタブで回し、更新日の変化→changed、404→transient→unreachable
 *      (2回連続で確定)、不変→ok、csv のハッシュ変化→changed を実 D1 で確認する。
 *  (d) /api/health が効力のあるマーク数を返す。
 */

let harness: TestDb;
let db: D1Database;

beforeAll(async () => {
  // 千代田(13101)と中央(13102)を同一 D1 へ載せ、片方のマークが他方へ漏れないことを見る。
  harness = await createTestDb(['13101', '13102']);
  db = harness.db as unknown as D1Database;
});

afterAll(async () => {
  await harness.dispose();
});

afterEach(async () => {
  await db.prepare('DELETE FROM source_drift').run();
});

function request(path: string, init?: RequestInit): Promise<Response> {
  return Promise.resolve(app.request(path, init, { DB: db }));
}

function profile(municipalityCode: string): Profile {
  return {
    destination: { municipalityCode, town: 'テスト町1丁目' },
    moveDate: '2026-08-01',
    originType: 'outside_tokyo',
    household: { memberCount: 1, ageBands: ['adult'] },
    flags: {
      hasMyNumberCard: false,
      needsNationalHealthInsurance: true,
      needsNationalPension: true,
      hasSchoolOrChildcareNeeds: false,
      hasDog: false,
      dogHasMicrochip: 'unknown',
      needsDisabilityOrCareSupport: false,
      needsForeignResidentGuidance: false,
      needsVehicleGuidance: false,
      isPregnantMember: false,
    },
  };
}

interface TaskView {
  procedureId: string;
  dataStatus: string;
  sources: { sourceId: string; driftDetectedOn?: string; driftKind?: string }[];
}

async function checklistTasks(municipalityCode: string): Promise<TaskView[]> {
  const res = await request('/api/checklists', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(profile(municipalityCode)),
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { tasks: TaskView[] }).tasks;
}

const SRC_CHIYODA_RESIDENT = 'src-13101-resident_registration-001';

async function insertMark(sourceId: string, verifiedAtSeen: string | null, status = 'changed') {
  await db
    .prepare(
      'INSERT INTO source_drift (source_id, status, reason, detected_at, verified_at_seen, ' +
        'last_checked_at, consecutive_failures) VALUES (?, ?, ?, ?, ?, ?, 0)',
    )
    .bind(
      sourceId,
      status,
      'page_updated_on_changed',
      '2026-09-22T03:00:00Z',
      verifiedAtSeen,
      '2026-09-22T03:00:00Z',
    )
    .run();
}

async function sourceLastVerifiedAt(sourceId: string): Promise<string> {
  const row = await db
    .prepare('SELECT last_verified_at FROM sources WHERE source_id = ?')
    .bind(sourceId)
    .first<{ last_verified_at: string }>();
  expect(row?.last_verified_at).toBeTruthy();
  return row!.last_verified_at;
}

describe('(a) 読み出し時の自動降格(ADR-014 §2)', () => {
  it('changed のソースを根拠に持つ手続きは stale + 検知日を返し、別自治体は無傷', async () => {
    await insertMark(SRC_CHIYODA_RESIDENT, await sourceLastVerifiedAt(SRC_CHIYODA_RESIDENT));

    const chiyoda = await checklistTasks('13101');
    const task = chiyoda.find((t) => t.procedureId === 'procedure_resident_registration');
    expect(task).toBeDefined();
    expect(task?.dataStatus).toBe('stale');
    const ref = task?.sources.find((s) => s.sourceId === SRC_CHIYODA_RESIDENT);
    expect(ref?.driftKind).toBe('changed');
    expect(ref?.driftDetectedOn).toBe('2026-09-22');

    const detail = await request(
      '/api/procedures/procedure_resident_registration?municipality=13101',
    );
    expect(detail.status).toBe(200);
    const body = (await detail.json()) as {
      procedure: { dataStatus: string };
      sources: { sourceId: string; driftDetectedOn?: string; driftKind?: string }[];
    };
    expect(body.procedure.dataStatus).toBe('stale');
    expect(body.sources[0]?.driftKind).toBe('changed');
    expect(body.sources[0]?.driftDetectedOn).toBe('2026-09-22');

    // 中央区(13102)の転入届は千代田のマークに影響されない(原則4)。
    const chuo = await checklistTasks('13102');
    const chuoTask = chuo.find((t) => t.procedureId === 'procedure_resident_registration');
    expect(chuoTask?.dataStatus).toBe('verified');
    for (const s of chuoTask?.sources ?? []) expect(s.driftKind).toBeUndefined();
  });

  it('unreachable も同様に stale へ落とす', async () => {
    await insertMark(
      SRC_CHIYODA_RESIDENT,
      await sourceLastVerifiedAt(SRC_CHIYODA_RESIDENT),
      'unreachable',
    );
    const tasks = await checklistTasks('13101');
    const task = tasks.find((t) => t.procedureId === 'procedure_resident_registration');
    expect(task?.dataStatus).toBe('stale');
    expect(task?.sources[0]?.driftKind).toBe('unreachable');
  });
});

describe('(b) 人の再監査で効力を失う', () => {
  it('verified_at_seen が sources.last_verified_at より古ければマークは適用されない', async () => {
    // 検知時点(2026-07-01)より後に人が再確認して台帳を進めた(sources 側は 2026-07-25)。
    await insertMark(SRC_CHIYODA_RESIDENT, '2026-07-01T00:00:00Z');
    const tasks = await checklistTasks('13101');
    const task = tasks.find((t) => t.procedureId === 'procedure_resident_registration');
    expect(task?.dataStatus).toBe('verified');
    expect(task?.sources[0]?.driftKind).toBeUndefined();

    const health = (await (await request('/api/health')).json()) as {
      drift: { flaggedSources: number };
    };
    expect(health.drift.flaggedSources).toBe(0);
  });
});

describe('(c) runDriftCheck — fetch スタブで巡回を回す', () => {
  const HTML_CHANGED = 'src-13101-my_number-001'; // snapshot: 2026-07-10
  const HTML_SAME = 'src-13101-resident_registration-001'; // snapshot: 2026-01-05
  const HTML_404 = 'src-13101-waste_guide-001';
  const CSV_CHANGED = 'src-13101-facilities-001';
  const TARGETS = [CSV_CHANGED, HTML_CHANGED, HTML_SAME, HTML_404];

  /** 対象4件以外を「巡回済み(遠い未来)」にして、バッチ選択が対象4件だけを拾うようにする。 */
  async function prefillOthers() {
    const placeholders = TARGETS.map(() => '?').join(',');
    await db
      .prepare(
        'INSERT INTO source_drift (source_id, status, reason, last_checked_at, consecutive_failures) ' +
          "SELECT source_id, 'ok', 'test_prefill', '2099-01-01T00:00:00Z', 0 FROM sources " +
          `WHERE review_status = 'approved' AND source_id NOT IN (${placeholders})`,
      )
      .bind(...TARGETS)
      .run();
  }

  const seenUserAgents: string[] = [];
  const stubFetch: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const ua = new Headers(init?.headers).get('user-agent') ?? '';
    seenUserAgents.push(ua);
    const html = (updatedOn: string) =>
      new Response(
        `<html><head><meta charset="utf-8"></head><body><p>更新日：${updatedOn}</p></body></html>`,
        {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        },
      );
    if (url.includes('card-keizoku')) return html('2026年9月1日'); // my_number: 変わった
    if (url.includes('tennyu.html')) return html('2026年1月5日'); // resident: 同じ
    if (url.includes('wakekata')) return new Response('not found', { status: 404 });
    if (url.endsWith('131016_01public_facility.csv')) {
      return new Response('id,name\n1,changed\n', {
        status: 200,
        headers: { 'content-type': 'text/csv' },
      });
    }
    throw new Error(`unexpected url in stub: ${url}`);
  };

  interface DriftRow {
    source_id: string;
    status: string;
    reason: string;
    detected_at: string | null;
    verified_at_seen: string | null;
    consecutive_failures: number;
    current_page_updated_on: string | null;
    http_status: number | null;
  }

  async function rows(): Promise<Map<string, DriftRow>> {
    const placeholders = TARGETS.map(() => '?').join(',');
    const res = await db
      .prepare(`SELECT * FROM source_drift WHERE source_id IN (${placeholders})`)
      .bind(...TARGETS)
      .all<DriftRow>();
    return new Map(res.results.map((r) => [r.source_id, r]));
  }

  it('更新日変化→changed / 不変→ok / csv ハッシュ変化→changed / 404→transient→unreachable', async () => {
    await prefillOthers();
    const now1 = new Date('2026-09-22T04:00:00Z');
    const summary1 = await runDriftCheck(db, { now: now1, fetchImpl: stubFetch, batchSize: 4 });
    expect(summary1.checked).toBe(4);
    expect(new Set(summary1.sourceIds)).toEqual(new Set(TARGETS));
    expect(summary1.byStatus).toEqual({
      ok: 1,
      changed: 2,
      unreachable: 0,
      unverifiable: 0,
      transient: 1,
    });
    // 全リクエストが ADR-014 で疎通確認した UA を名乗る。
    expect(seenUserAgents.length).toBe(4);
    for (const ua of seenUserAgents) expect(ua).toBe(DRIFT_USER_AGENT);

    const r1 = await rows();
    const changed = r1.get(HTML_CHANGED)!;
    expect(changed.status).toBe('changed');
    expect(changed.reason).toBe('page_updated_on_changed');
    expect(changed.current_page_updated_on).toBe('2026-09-01');
    expect(changed.detected_at).toBe(now1.toISOString());
    expect(changed.verified_at_seen).toBe(await sourceLastVerifiedAt(HTML_CHANGED));
    expect(changed.http_status).toBe(200);

    const same = r1.get(HTML_SAME)!;
    expect(same.status).toBe('ok');
    expect(same.detected_at).toBeNull();
    expect(same.current_page_updated_on).toBe('2026-01-05');

    const csv = r1.get(CSV_CHANGED)!;
    expect(csv.status).toBe('changed');
    expect(csv.reason).toBe('content_hash_changed');
    expect(csv.detected_at).toBe(now1.toISOString());

    const nf = r1.get(HTML_404)!;
    expect(nf.status).toBe('transient');
    expect(nf.reason).toBe('http_404');
    expect(nf.consecutive_failures).toBe(1);
    expect(nf.detected_at).toBeNull();
    expect(nf.http_status).toBe(404);

    // 1回目の時点で changed 2件が読み出しに効く(health も同じ数を見る)。
    const health1 = (await (await request('/api/health')).json()) as {
      drift: { flaggedSources: number; checkedSources: number; lastCheckedAt: string | null };
    };
    expect(health1.drift.flaggedSources).toBe(2);
    expect(health1.drift.lastCheckedAt).toBe('2099-01-01T00:00:00Z');

    // 2回目: 同じ4件が「最も古い巡回」として再び選ばれる。404 が2回連続で unreachable に確定。
    const now2 = new Date('2026-09-22T05:00:00Z');
    const summary2 = await runDriftCheck(db, { now: now2, fetchImpl: stubFetch, batchSize: 4 });
    expect(new Set(summary2.sourceIds)).toEqual(new Set(TARGETS));
    expect(summary2.byStatus.unreachable).toBe(1);

    const r2 = await rows();
    const nf2 = r2.get(HTML_404)!;
    expect(nf2.status).toBe('unreachable');
    expect(nf2.consecutive_failures).toBe(2);
    expect(nf2.detected_at).toBe(now2.toISOString());
    expect(nf2.verified_at_seen).toBe(await sourceLastVerifiedAt(HTML_404));
    // 既に changed だったものは最初の検知日を保つ。
    expect(r2.get(HTML_CHANGED)!.detected_at).toBe(now1.toISOString());

    // 手続き詳細: my_number の根拠が changed → stale と検知日。
    const detail = (await (
      await request('/api/procedures/procedure_mynumber_continued_use?municipality=13101')
    ).json()) as {
      procedure: { dataStatus: string };
      sources: { sourceId: string; driftDetectedOn?: string }[];
    };
    expect(detail.procedure.dataStatus).toBe('stale');
    expect(detail.sources.find((s) => s.sourceId === HTML_CHANGED)?.driftDetectedOn).toBe(
      '2026-09-22',
    );
  });

  it('changed の後に一過性の失敗が挟まっても要確認は下りず、検知日も保つ', async () => {
    await prefillOthers();
    const now1 = new Date('2026-09-22T04:00:00Z');
    await runDriftCheck(db, { now: now1, fetchImpl: stubFetch, batchSize: 4 });
    expect((await rows()).get(HTML_CHANGED)?.status).toBe('changed');

    // 2回目: 全件がネットワーク例外(一過性)。changed だった行は据え置き、観測は残す。
    const throwing: typeof fetch = async () => {
      throw new TypeError('boom');
    };
    const now2 = new Date('2026-09-22T05:00:00Z');
    await runDriftCheck(db, { now: now2, fetchImpl: throwing, batchSize: 4 });
    const r2 = await rows();
    const changed = r2.get(HTML_CHANGED)!;
    expect(changed.status).toBe('changed');
    expect(changed.reason).toBe('network_error');
    expect(changed.consecutive_failures).toBe(1);
    expect(changed.detected_at).toBe(now1.toISOString());
    // 元から ok だった行は通常どおり transient になる(据え置くのは要確認だけ)。
    expect(r2.get(HTML_SAME)?.status).toBe('transient');

    // 読み出し側でも要確認のまま(ちらつかない)。
    const detail = (await (
      await request('/api/procedures/procedure_mynumber_continued_use?municipality=13101')
    ).json()) as {
      procedure: { dataStatus: string };
      sources: { sourceId: string; driftDetectedOn?: string }[];
    };
    expect(detail.procedure.dataStatus).toBe('stale');
    expect(detail.sources.find((s) => s.sourceId === HTML_CHANGED)?.driftDetectedOn).toBe(
      '2026-09-22',
    );

    // 3回目: 復旧して更新日が同じなら ok に戻り、検知記録は消える。
    const now3 = new Date('2026-09-22T06:00:00Z');
    const recovered: typeof fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('card-keizoku')) {
        return new Response('<p>更新日：2026年7月10日</p>', {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        });
      }
      return stubFetch(input, init);
    };
    await runDriftCheck(db, { now: now3, fetchImpl: recovered, batchSize: 4 });
    const r3 = await rows();
    expect(r3.get(HTML_CHANGED)?.status).toBe('ok');
    expect(r3.get(HTML_CHANGED)?.detected_at).toBeNull();
  });

  it('スタブが例外を投げても他のソースの記録は止まらない(transient/exception)', async () => {
    await prefillOthers();
    const throwing: typeof fetch = async () => {
      throw new TypeError('boom');
    };
    const summary = await runDriftCheck(db, {
      now: new Date('2026-09-22T06:00:00Z'),
      fetchImpl: throwing,
      batchSize: 4,
    });
    expect(summary.checked).toBe(4);
    expect(summary.byStatus.transient).toBe(4);
    const r = await rows();
    for (const id of TARGETS) {
      expect(r.get(id)?.status).toBe('transient');
      expect(r.get(id)?.reason).toBe('network_error');
      expect(r.get(id)?.consecutive_failures).toBe(1);
    }
  });

  /**
   * なぜ: 以前は redirect: 'follow' で、公式ページが第三者サイトへ転送されると Worker がその先へ
   * 要求を送り本文まで読んでいた。各ホップで公式ホストかを確かめ、非公式の転送先には要求自体を
   * 送らないこと、転送の重ねすぎ・巨大な本文で巡回が詰まらないことを固定する。
   */
  it('リダイレクトは公式ホストの間だけ辿り、非公式の転送先へは要求を送らない', async () => {
    await prefillOthers();
    const requested: string[] = [];
    const redirect = (location: string) =>
      new Response(null, { status: 302, headers: { location } });
    const redirectingFetch: typeof fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      requested.push(url);
      // 自動追従させていないこと(手動で1ホップずつ確かめている)。
      expect(init?.redirect).toBe('manual');
      // resident: 同じ公式ホスト内の転送(相対 Location)→ 辿って更新日を比べる。
      if (url.endsWith('tennyu.html')) return redirect('./tennyu-new.html');
      if (url.endsWith('tennyu-new.html')) {
        return new Response('<html><body><p>更新日：2026年1月5日</p></body></html>', {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        });
      }
      // my_number: 非公式ホストへの転送 → そこへは要求しない。
      if (url.includes('card-keizoku')) return redirect('https://evil.example/landing');
      // csv: 公式ホスト内で転送が終わらない → ホップ上限で打ち切る。
      if (url.includes('public_facility.csv')) return redirect(`${url}?again`);
      // waste_guide: 上限(5MB)を超える本文を Content-Length なしで流す → 読むのをやめる。
      if (url.includes('wakekata')) {
        const chunk = new Uint8Array(1024 * 1024);
        let sent = 0;
        const body = new ReadableStream<Uint8Array>({
          pull(controller) {
            sent += 1;
            if (sent > 8) controller.close();
            else controller.enqueue(chunk);
          },
        });
        return new Response(body, { status: 200, headers: { 'content-type': 'text/html' } });
      }
      if (url.startsWith('https://evil.example/')) throw new Error('非公式ホストへ要求した');
      throw new Error(`unexpected url in stub: ${url}`);
    };

    await runDriftCheck(db, {
      now: new Date('2026-09-22T07:00:00Z'),
      fetchImpl: redirectingFetch,
      batchSize: 4,
    });
    const r = await rows();

    expect(requested.some((u) => u.startsWith('https://evil.example/'))).toBe(false);
    expect(r.get(HTML_SAME)).toMatchObject({ status: 'ok', reason: 'page_updated_on_same' });
    // 別サイトへ飛ばされた HTML は従来の host_changed と同じく到達性の失敗(1回目は transient)。
    expect(r.get(HTML_CHANGED)).toMatchObject({
      status: 'transient',
      reason: 'redirect_not_official',
      consecutive_failures: 1,
    });
    expect(r.get(CSV_CHANGED)).toMatchObject({
      status: 'transient',
      reason: 'too_many_redirects',
    });
    // 最初の要求1 + 転送 MAX_REDIRECT_HOPS 回で打ち切り、それ以上は要求しない(サブリクエスト枠)。
    expect(requested.filter((u) => u.includes('public_facility.csv'))).toHaveLength(
      1 + MAX_REDIRECT_HOPS,
    );
    expect(r.get(HTML_404)).toMatchObject({ status: 'unverifiable', reason: 'body_too_large' });
  });
});

describe('readBodyCapped', () => {
  it('上限以内なら全バイトを返し、Content-Length が上限超えなら読まずに null', async () => {
    const small = await readBodyCapped(new Response('abc'), 10);
    expect(new TextDecoder().decode(small!)).toBe('abc');
    expect(await readBodyCapped(new Response('abcdefghijk'), 10)).toBeNull();
    const declared = new Response('x', {
      headers: { 'content-length': String(MAX_BODY_BYTES + 1) },
    });
    expect(await readBodyCapped(declared, MAX_BODY_BYTES)).toBeNull();
  });
});

describe('(d) /api/health の巡回要約', () => {
  it('flaggedSources は効力のあるマーク数、未巡回なら lastCheckedAt は null', async () => {
    const before = (await (await request('/api/health')).json()) as {
      ok: boolean;
      drift: {
        flaggedSources: number;
        unverifiableSources: number;
        checkedSources: number;
        lastCheckedAt: string | null;
      };
    };
    expect(before.ok).toBe(true);
    expect(before.drift).toEqual({
      flaggedSources: 0,
      unverifiableSources: 0,
      checkedSources: 0,
      lastCheckedAt: null,
    });

    await insertMark(SRC_CHIYODA_RESIDENT, await sourceLastVerifiedAt(SRC_CHIYODA_RESIDENT));
    await insertMark('src-13101-my_number-001', null, 'unverifiable');
    const after = (await (await request('/api/health')).json()) as typeof before;
    expect(after.drift.flaggedSources).toBe(1);
    expect(after.drift.unverifiableSources).toBe(1);
    expect(after.drift.checkedSources).toBe(2);
    expect(after.drift.lastCheckedAt).toBe('2026-09-22T03:00:00Z');

    // /api/stats も同じ数を出す(対応状況ページ用)。
    const stats = (await (await request('/api/stats')).json()) as {
      driftFlaggedSources: number;
      driftLastCheckedAt?: string;
    };
    expect(stats.driftFlaggedSources).toBe(1);
    expect(stats.driftLastCheckedAt).toBe('2026-09-22T03:00:00Z');
  });
});

describe('(e) /api/health の自己判定(A-1-4)', () => {
  it('実D1: 未巡回なら patrol_never_ran、最近の巡回があれば ok(公開データありを確認)', async () => {
    const before = (await (await request('/api/health')).json()) as {
      status: string;
      issues: string[];
    };
    expect(before).toMatchObject({ status: 'degraded', issues: ['patrol_never_ran'] });

    // 直近の巡回を1件記録すると ok に戻る(毎時 Cron が動いている状態)。
    await db
      .prepare(
        'INSERT INTO source_drift (source_id, status, reason, last_checked_at, consecutive_failures) ' +
          "VALUES (?, 'ok', 'page_updated_on_same', ?, 0)",
      )
      .bind(SRC_CHIYODA_RESIDENT, new Date().toISOString())
      .run();
    const after = (await (await request('/api/health')).json()) as typeof before;
    expect(after).toMatchObject({ status: 'ok', issues: [] });
  });
});
