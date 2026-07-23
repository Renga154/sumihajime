import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import type { Profile } from '@tmn/schemas';
import { createTestDb, type TestDb } from '../test/d1-harness.js';
import app from './index.js';

/**
 * なぜ: API+D1 の統合テスト(計画§9受入・§12)。Miniflare の本物のD1(SQLite)へ
 * migrations適用+承認済みシード投入し(test/d1-harness.ts)、app.request(path, init, { DB })
 * で Worker コードを通しで検証する。
 */

let harness: TestDb;
let db: D1Database;

beforeAll(async () => {
  harness = await createTestDb();
  db = harness.db as unknown as D1Database;
});

afterAll(async () => {
  await harness.dispose();
});

function request(path: string, init?: RequestInit): Promise<Response> {
  return Promise.resolve(app.request(path, init, { DB: db }));
}

function postChecklist(profile: unknown): Promise<Response> {
  return request('/api/checklists', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(profile),
  });
}

const MOVE_DATE = '2026-08-01';

function profile(overrides: {
  town?: string;
  moveDate?: string;
  memberCount?: number;
  ageBands?: Profile['household']['ageBands'];
  flags?: Partial<Profile['flags']>;
  municipalityCode?: string;
}): Profile {
  return {
    destination: {
      municipalityCode: overrides.municipalityCode ?? '13112',
      town: overrides.town ?? 'テスト町1丁目',
    },
    moveDate: overrides.moveDate ?? MOVE_DATE,
    originType: 'outside_tokyo',
    household: {
      memberCount: overrides.memberCount ?? 1,
      ageBands: overrides.ageBands ?? ['adult'],
    },
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
      ...overrides.flags,
    },
  };
}

interface Task {
  procedureId: string;
  priority: string;
  dueDate?: string;
  dueDescription?: string;
  applicable?: string;
  sources: { sourceId: string }[];
}

describe('GET /api/municipalities', () => {
  it('returns 62 municipalities; 世田谷(13112)・江東(13108)・新宿(13104)がsupported(2026-07-22承認)', async () => {
    const res = await request('/api/municipalities');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      code: string;
      name: string;
      supported: boolean;
      officialUrl?: string;
      coverage: unknown[];
    }[];
    // 東京都62市区町村の誠実リスト化(Wave2)。
    expect(body).toHaveLength(62);
    const supported = body
      .filter((m) => m.supported)
      .map((m) => m.code)
      .sort();
    expect(supported).toEqual(['13104', '13108', '13112']);
    // 各自治体に公式導線URL(FR-021)。出典ページの表記どおり http/https いずれもあり得る。
    for (const m of body) expect(m.officialUrl).toMatch(/^https?:\/\//);
    // 世田谷にはカバレッジ行がある(FR-024)。
    const setagaya = body.find((m) => m.code === '13112');
    expect(setagaya?.coverage.length).toBeGreaterThan(0);
  });
});

describe('POST /api/checklists — 単身・都外', () => {
  it('転入届(urgent, dueDate=moveDate+14日) を含み、児童手当を含まない', async () => {
    const res = await postChecklist(profile({}));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tasks: Task[]; ruleVersion: string; generatedAt: string };
    const ids = body.tasks.map((t) => t.procedureId);

    expect(ids).toContain('procedure_resident_registration');
    expect(ids).not.toContain('procedure_child_allowance');

    const jusho = body.tasks.find((t) => t.procedureId === 'procedure_resident_registration')!;
    expect(jusho.priority).toBe('urgent');
    expect(jusho.dueDate).toBe('2026-08-15'); // 2026-08-01 + 14日
    expect(jusho.sources.length).toBeGreaterThan(0);

    // 期限順: 転入届が先頭(最も早い期限)。
    expect(body.tasks[0]?.procedureId).toBe('procedure_resident_registration');
    expect(body.ruleVersion).toBe('2026-07-21.1');
  });
});

describe('POST /api/checklists — 子育て世帯', () => {
  it('児童手当が追加され、dueDate なし + dueDescription に「15日以内」', async () => {
    const res = await postChecklist(
      profile({
        memberCount: 3,
        ageBands: ['adult', 'adult', 'age0_2'],
        flags: { hasSchoolOrChildcareNeeds: true, needsNationalPension: false },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tasks: Task[] };
    const allowance = body.tasks.find((t) => t.procedureId === 'procedure_child_allowance');
    expect(allowance).toBeDefined();
    expect(allowance!.dueDate).toBeUndefined();
    expect(allowance!.dueDescription).toContain('15日以内');
    expect(allowance!.applicable).toBe('applicable');
    // 子ども医療も追加される。
    expect(body.tasks.map((t) => t.procedureId)).toContain('procedure_child_medical');
  });
});

describe('POST /api/checklists — 犬・マイクロチップ不明', () => {
  it('犬の届出が needs_confirmation として返る(推測しない, C-10)', async () => {
    const res = await postChecklist(
      profile({ flags: { hasDog: true, dogHasMicrochip: 'unknown' } }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tasks: Task[] };
    const dog = body.tasks.find((t) => t.procedureId === 'procedure_dog_registration_transfer');
    expect(dog).toBeDefined();
    expect(dog!.applicable).toBe('needs_confirmation');
  });
});

describe('POST /api/checklists — 未対応自治体', () => {
  it('杉並(13115)は supported=false エラー + 公式URL(FR-021)', async () => {
    const res = await postChecklist(profile({ municipalityCode: '13115' }));
    expect(res.status).toBe(409);
    const body = (await res.json()) as {
      error: { code: string; message: string; officialUrl?: string };
    };
    expect(body.error.code).toBe('municipality_not_supported');
    expect(body.error.officialUrl).toBe('https://www.city.suginami.tokyo.jp/');
    expect(body.error.message).toContain('杉並区');
  });

  it('存在しない自治体コードは 404', async () => {
    const res = await postChecklist(profile({ municipalityCode: '99999' }));
    expect(res.status).toBe(404);
  });

  it('不正なプロフィールは 422', async () => {
    const res = await postChecklist({ destination: { municipalityCode: '13112' } });
    expect(res.status).toBe(422);
  });
});

describe('GET /api/procedures/:id', () => {
  it('手続き詳細と根拠ソースを返す', async () => {
    const res = await request('/api/procedures/procedure_resident_registration?municipality=13112');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      procedure: { id: string; municipalityCode: string };
      sources: { sourceId: string; sourceUrl: string }[];
    };
    expect(body.procedure.id).toBe('procedure_resident_registration');
    expect(body.procedure.municipalityCode).toBe('13112');
    expect(body.sources.length).toBeGreaterThan(0);
    expect(body.sources[0]?.sourceUrl).toMatch(/^https:\/\//);
  });

  it('municipality 未指定は 400', async () => {
    const res = await request('/api/procedures/procedure_resident_registration');
    expect(res.status).toBe(400);
  });
});

describe('GET /api/facilities', () => {
  it('世田谷の窓口一覧を返す(本庁舎/総合支所/出張所を含む)', async () => {
    const res = await request('/api/facilities?municipality=13112');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { facilityId: string; category: string }[];
    expect(body.length).toBeGreaterThan(0);
    const cats = new Set(body.map((f) => f.category));
    expect(cats.has('本庁舎')).toBe(true);
    // facility_id は publish で採番した一意キー。
    expect(new Set(body.map((f) => f.facilityId)).size).toBe(body.length);
  });

  it('category で絞り込める', async () => {
    const res = await request('/api/facilities?municipality=13112&category=本庁舎');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { category: string }[];
    expect(body.every((f) => f.category === '本庁舎')).toBe(true);
  });
});

describe('GET /api/waste-schedules', () => {
  it('area 未指定 → 118地区一覧 + caution', async () => {
    const res = await request('/api/waste-schedules?municipality=13112');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      areas: { areaId: string; areaLabel: string }[];
      schedules?: unknown[];
      caution: string;
    };
    expect(body.areas).toHaveLength(118);
    expect(body.schedules).toBeUndefined();
    expect(body.caution).toContain('祝日');
  });

  it('area 指定 → 曜日 + caution を返す', async () => {
    const res = await request('/api/waste-schedules?municipality=13112&area=area-13112-001');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      schedules: { areaId: string; wasteType: string; weekday: string }[];
      caution: string;
    };
    expect(body.schedules.length).toBeGreaterThan(0);
    expect(body.schedules.every((s) => s.areaId === 'area-13112-001')).toBe(true);
    expect(body.caution).toContain('祝日');
  });

  it('存在しない area は 404', async () => {
    const res = await request('/api/waste-schedules?municipality=13112&area=area-does-not-exist');
    expect(res.status).toBe(404);
  });
});

describe('GET /api/waste-sorting', () => {
  it('q未指定 → カテゴリ別件数サマリー(世田谷787品目・17カテゴリ)', async () => {
    const res = await request('/api/waste-sorting?municipality=13112');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      municipalityCode: string;
      categories: { category: string; count: number }[];
      total: number;
    };
    expect(body.municipalityCode).toBe('13112');
    expect(body.total).toBe(787);
    expect(body.categories.length).toBeGreaterThan(0);
    const sumOfCounts = body.categories.reduce((n, c) => n + c.count, 0);
    expect(sumOfCounts).toBe(787);
  });

  it('q指定 → name部分一致で品目がヒットする(品目名/カテゴリの入れ替わりを補正済み)', async () => {
    const res = await request('/api/waste-sorting?municipality=13112&q=アイロン');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      query: string;
      items: { name: string; category: string }[];
      total: number;
    };
    expect(body.total).toBeGreaterThan(0);
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items.length).toBeLessThanOrEqual(30);
    expect(body.items.every((i) => i.name.includes('アイロン'))).toBe(true);
    // 品目/カテゴリの入れ替わり補正: nameは品目名(アイロン系)、categoryは分別区分(不燃ごみ等)。
    expect(body.items.every((i) => i.category !== i.name)).toBe(true);
  });

  it('0件ヒットのクエリは items:[] + total:0 を返す(存在しない自治体データ扱いにしない)', async () => {
    const res = await request(
      '/api/waste-sorting?municipality=13112&q=絶対に存在しない品目名XYZ123',
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[]; total: number };
    expect(body.items).toEqual([]);
    expect(body.total).toBe(0);
  });

  it('municipality 未指定は 400', async () => {
    const res = await request('/api/waste-sorting');
    expect(res.status).toBe(400);
  });

  it('データ未整備の自治体(杉並=13115)は 404 waste_sorting_data_unavailable', async () => {
    const res = await request('/api/waste-sorting?municipality=13115');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('waste_sorting_data_unavailable');
  });
});

describe('構造化ログ: プロフィール内容(PII)を出さない(§13)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('checklist 実行時のログに moveDate / ageBand / 町丁目 が現れない', async () => {
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
    });

    const secretTown = 'ヒミツ町9丁目';
    const secretMoveDate = '2026-09-17';
    await postChecklist(
      profile({
        town: secretTown,
        moveDate: secretMoveDate,
        memberCount: 3,
        ageBands: ['adult', 'adult', 'age0_2'],
        flags: { hasSchoolOrChildcareNeeds: true },
      }),
    );

    const joined = logs.join('\n');
    // イベント名・自治体コードは出る(allowlist)。
    expect(joined).toContain('checklist.generated');
    expect(joined).toContain('13112');
    // プロフィール内容は出ない(allowlist方式の構造的保証)。
    expect(joined).not.toContain(secretTown);
    expect(joined).not.toContain(secretMoveDate);
    expect(joined).not.toContain('age0_2');
    expect(joined).not.toContain('ageBands');
    expect(joined).not.toContain('hasSchoolOrChildcareNeeds');
  });
});

describe('レイテンシ計測(ローカル目安。厳密なCIアサートは不要)', () => {
  it('POST /api/checklists を10回実行し p95相当を記録', async () => {
    const samples: number[] = [];
    for (let i = 0; i < 10; i++) {
      const t0 = Date.now();
      const res = await postChecklist(profile({ flags: { hasMyNumberCard: true } }));
      samples.push(Date.now() - t0);
      expect(res.status).toBe(200);
    }
    samples.sort((a, b) => a - b);
    const p95 = samples[Math.min(samples.length - 1, Math.ceil(0.95 * samples.length) - 1)] ?? 0;
    console.log(JSON.stringify({ event: 'measure.checklist_latency_ms', p95, samples }));
    // 目安として大きめの上限のみ確認(環境依存のため緩い)。
    expect(p95).toBeLessThan(2000);
  });
});
