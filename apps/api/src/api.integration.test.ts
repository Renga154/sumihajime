import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import type { Profile } from '@tmn/schemas';
import { createTestDb, type TestDb } from '../test/d1-harness.js';
import { app } from './index.js';
import { loadPublishData } from '@tmn/publish';

/**
 * なぜ: API+D1 の統合テスト(計画§9受入・§12)。Miniflare の本物のD1(SQLite)へ
 * migrations適用+承認済みシード投入し(test/d1-harness.ts)、app.request(path, init, { DB })
 * で Worker コードを通しで検証する。
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
/** シード(test/d1-harness.ts の buildSeed)と同じ既定の自治体で読み込んだ公開データ。件数の期待値の出どころ。 */
const PUBLISHED = loadPublishData(repoRoot);

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
  it('returns 62 municipalities; 23特別区すべてと八王子市が supported(八王子市は2026-09-25承認)', async () => {
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
    // 23特別区(13101〜13123)がすべて supported。多摩地域・島しょ(13201〜)は人手レビュー承認済みの
    // 八王子市(13201。2026-09-25承認)だけを含む(未対応を対応済みに見せない=CLAUDE.md原則9)。
    expect(supported).toHaveLength(24);
    expect(supported).toEqual(
      [...body.filter((m) => m.code.startsWith('131')).map((m) => m.code), '13201'].sort(),
    );
    expect(supported.filter((c) => !c.startsWith('131'))).toEqual(['13201']);
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
    // 2026-08-07 人手レビュー承認(ライフライン等4件。ADR-009)により publishedRuleVersion が外れ、
    // ruleVersion(=ファイル全体の版)がそのまま公開版になった(ADR-007)。
    // 2026-08-09: 前住所地の転出予定日(任意入力)を起算日にできるようにした改訂で更新。
    expect(body.ruleVersion).toBe('2026-08-09.1');
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
  it('立川(13202)は supported=false エラー + 公式URL(FR-021)', async () => {
    // なぜ: 杉並(13115)・千代田(13101)・品川(13109)は人手レビュー承認によりsupported=trueへ、
    // 八王子市(13201)も2026-09-25の承認でsupported=trueへ変わったため、未対応自治体のfixtureとして
    // 未整備の立川市(13202、市部)を使う。
    const res = await postChecklist(profile({ municipalityCode: '13202' }));
    expect(res.status).toBe(409);
    const body = (await res.json()) as {
      error: { code: string; message: string; officialUrl?: string };
    };
    expect(body.error.code).toBe('municipality_not_supported');
    expect(body.error.officialUrl).toBe('https://www.city.tachikawa.lg.jp/');
    expect(body.error.message).toContain('立川市');
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

  it('根拠ソースに内部レビュー用メタ(reviewer/reviewStatus/contentHash/fetchMethod)を含まない', async () => {
    // なぜ: 2026-08-08発覚。このエンドポイントの sources は台帳の全列(Source)をそのまま
    // 返しており、GET /api/sources とは別経路でレビュー担当者名(reviewer)等が漏れていた
    // (notes列の内部用語混入と同根: 公開経路が複数あり、片方だけ射影を絞っていた)。
    const res = await request('/api/procedures/procedure_resident_registration?municipality=13112');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sources: Record<string, unknown>[] };
    expect(body.sources.length).toBeGreaterThan(0);
    for (const s of body.sources) {
      expect(s.reviewStatus).toBeUndefined();
      expect(s.reviewer).toBeUndefined();
      expect(s.contentHash).toBeUndefined();
      expect(s.fetchMethod).toBeUndefined();
      expect(s.lastFetchedAt).toBeUndefined();
      expect(s.sourceLastModifiedAt).toBeUndefined();
    }
  });

  it('根拠ソースの公開列は GET /api/sources と同一(notes は両方とも出さない)', async () => {
    // なぜ: 2つのエンドポイントが別々に射影を書いており、notes を片方だけが出していた。
    // notes は取り込み・監査の作業メモで、どの画面も表示しない → 両方とも公開しないに揃えた。
    const [detailRes, ledgerRes] = await Promise.all([
      request('/api/procedures/procedure_resident_registration?municipality=13112'),
      request('/api/sources'),
    ]);
    const detail = (await detailRes.json()) as { sources: Record<string, unknown>[] };
    const ledger = new Map(
      ((await ledgerRes.json()) as Record<string, unknown>[]).map((s) => [s.sourceId, s]),
    );
    for (const s of detail.sources) {
      expect(s.notes).toBeUndefined();
      const { driftDetectedOn: _d, driftKind: _k, ...publicColumns } = s;
      expect(publicColumns).toEqual(ledger.get(s.sourceId));
    }
  });

  it('存在しない手続きは 404 で、パスの値を文面へ反射しない', async () => {
    const injected = encodeURIComponent('公式発表:こちらへ https://evil.example');
    const res = await request(`/api/procedures/${injected}?municipality=13112`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('procedure_not_found');
    expect(body.error.message).not.toContain('evil.example');
    expect(body.error.message).not.toContain('公式発表');
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

describe('GET /api/sources — データソース台帳の公開ビュー(Wave3)', () => {
  it('承認済みソースのみを、公開ビュー列だけで返す(内部レビュー用メタは含めない)', async () => {
    const res = await request('/api/sources');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>[];
    // 台帳の承認済みソースは全件シードされる(publish/load は approved のみ挿入し、sql.ts は
    // supported の絞り込みなく approvedSources 全件を挿入する)。
    // なぜ件数を定数で書かないか: 以前は toBe(357) のように手で更新しており、出典を1件承認する
    // たびに無関係なこのテストが落ちた(件数の経緯はコミット履歴と registry.csv にある)。
    // 検査したいのは「承認済みが過不足なく公開される」ことなので、シードと同じ読み込み結果と比べる。
    expect(body.length).toBe(PUBLISHED.approvedSources.length);
    expect(body.length).toBeGreaterThan(0);
    expect(new Set(body.map((s) => s.sourceId))).toEqual(
      new Set(PUBLISHED.approvedSources.map((s) => s.sourceId)),
    );

    for (const s of body) {
      // 公開に必要な列は揃う。
      expect(typeof s.sourceId).toBe('string');
      expect(typeof s.sourceTitle).toBe('string');
      expect(typeof s.ownerOrganization).toBe('string');
      expect(typeof s.sourceUrl).toBe('string');
      expect(String(s.sourceUrl)).toMatch(/^https?:\/\//);
      expect(typeof s.license).toBe('string');
      expect(typeof s.attributionText).toBe('string');
      expect(typeof s.updateFrequency).toBe('string');
      // 内部レビュー用メタは公開ビューに出さない(原則: 台帳の内部状態を露出しない)。
      expect(s.reviewStatus).toBeUndefined();
      expect(s.reviewer).toBeUndefined();
      expect(s.contentHash).toBeUndefined();
      expect(s.fetchMethod).toBeUndefined();
      expect(s.notes).toBeUndefined();
    }

    // 年度データ(effectiveTo付き=ごみ収集曜日等)が含まれ、鮮度カウントダウンの材料になる。
    const withEffectiveTo = body.filter((s) => typeof s.effectiveTo === 'string');
    expect(withEffectiveTo.length).toBeGreaterThan(0);
    expect(withEffectiveTo.some((s) => s.effectiveTo === '2027-03-31')).toBe(true);

    // CC BY ライセンスのソースが台帳に含まれる(帰属表示の対象)。
    expect(body.some((s) => String(s.license).includes('CC BY'))).toBe(true);
  });
});

/**
 * なぜ: トップの訴求文に出す数値は必ず実データ由来にする(手打ちの定数を画面へ書かない)。
 * このエンドポイントが台帳・自治体表の実件数と一致していることを固定する。区やソースが増減
 * したときに、トップの表示だけが取り残される事故を防ぐ。
 */
describe('GET /api/stats — トップの実測サマリー', () => {
  it('自治体表・台帳の実件数と一致し、最終確認日を返す', async () => {
    const [statsRes, munisRes, sourcesRes] = await Promise.all([
      request('/api/stats'),
      request('/api/municipalities'),
      request('/api/sources'),
    ]);
    expect(statsRes.status).toBe(200);
    const stats = (await statsRes.json()) as {
      supportedMunicipalities: number;
      totalMunicipalities: number;
      approvedSources: number;
      lastVerifiedDate?: string;
    };
    const munis = (await munisRes.json()) as { supported: boolean }[];
    const sources = (await sourcesRes.json()) as { lastVerifiedAt?: string }[];

    expect(stats.totalMunicipalities).toBe(munis.length);
    expect(stats.supportedMunicipalities).toBe(munis.filter((m) => m.supported).length);
    expect(stats.approvedSources).toBe(sources.length);

    // 最終確認日は台帳の lastVerifiedAt の最大値(日付部分)と一致する。
    const latest = sources
      .map((s) => s.lastVerifiedAt?.slice(0, 10))
      .filter((d): d is string => typeof d === 'string')
      .sort()
      .at(-1);
    expect(stats.lastVerifiedDate).toBe(latest);
    expect(stats.lastVerifiedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('個人データも自治体スコープも要求しない(クエリ不要で200)', async () => {
    const res = await request('/api/stats');
    expect(res.status).toBe(200);
  });
});

describe('GET /api/waste-schedules', () => {
  it('area 未指定 → 公開データの全地区一覧 + caution', async () => {
    const res = await request('/api/waste-schedules?municipality=13112');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      areas: { areaId: string; areaLabel: string }[];
      schedules?: unknown[];
      caution: string;
    };
    // 地区数は公開データから導出する(収集地区の見直しでテストが落ちないように)。
    const expected = PUBLISHED.wasteAreas.filter((a) => a.municipalityCode === '13112');
    expect(expected.length).toBeGreaterThan(0);
    expect(body.areas).toHaveLength(expected.length);
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

  it('正規化して空になる検索語(長音符のみ)は全件一致にせず0件を返す', async () => {
    // なぜ: 正規化は長音符を落とすため「ー」は needle が空文字になる。空文字を部分一致へ
    // 渡すと String#includes が常に true となり、全787品目が「一致」として返っていた。
    // 一致していない件数を「見つかりました」と提示するのは原則3違反なので、0件と返す。
    const res = await request('/api/waste-sorting?municipality=13112&q=%E3%83%BC');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[]; total: number };
    expect(body.total).toBe(0);
    expect(body.items).toEqual([]);
  });

  it('部分一致より完全一致・前方一致を先に返す(探している品目が先頭に来る)', async () => {
    // なぜ: 長音符を落とす正規化により「ノート」は needle「のと」となり
    // 「ペットのトイレ砂」等にも部分一致する。一致集合は保ったまま並び順で救う。
    const res = await request(
      '/api/waste-sorting?municipality=13112&q=%E3%83%8E%E3%83%BC%E3%83%88',
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: { name: string }[]; total: number };
    expect(body.total).toBeGreaterThan(0);
    expect(body.items[0]?.name).toBe('ノート');
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
