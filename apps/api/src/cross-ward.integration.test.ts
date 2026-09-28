import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import type { Profile } from '@tmn/schemas';
import { createTestDb, type TestDb } from '../test/d1-harness.js';
import { app } from './index.js';

/**
 * なぜ: T-015 付帯不具合の回帰テスト。世田谷(13112)と江東(13108)は同一の procedure_id 体系を
 * 共有するため、procedures/procedure_versions の PK に municipality_code が含まれないと、
 * 両自治体を同一D1へシードした際に片方が他方を上書き(または PK衝突)し、自治体間でデータが
 * 混線する。migration 0003 の複合キー化により混線しないことを、実D1(Miniflare)へ両自治体を
 * 同時シードして通しで検証する。
 */

let harness: TestDb;
let db: D1Database;

beforeAll(async () => {
  // 世田谷(13112)と江東(13108)の両自治体を同一D1へシード(越境混線の再現条件)。
  harness = await createTestDb(['13112', '13108']);
  db = harness.db as unknown as D1Database;
});

afterAll(async () => {
  await harness.dispose();
});

function request(path: string, init?: RequestInit): Promise<Response> {
  return Promise.resolve(app.request(path, init, { DB: db }));
}

interface ProcedureDetail {
  procedure: {
    id: string;
    municipalityCode: string;
    title: string;
    dueDescription: string;
    requiredDocuments: { label: string; status: string }[];
  };
  sources: { sourceId: string; sourceUrl: string }[];
}

async function getProcedureDetail(id: string, municipality: string): Promise<ProcedureDetail> {
  const res = await request(`/api/procedures/${id}?municipality=${municipality}`);
  expect(res.status).toBe(200);
  return (await res.json()) as ProcedureDetail;
}

describe('越境混線なし: 共有 procedure_id が自治体ごとに正しく引ける (T-015)', () => {
  it('procedure_resident_registration は 13112/13108 それぞれ自区の内容を返す(混線しない)', async () => {
    const setagaya = await getProcedureDetail('procedure_resident_registration', '13112');
    const koto = await getProcedureDetail('procedure_resident_registration', '13108');

    // 同一 procedure_id でも自治体コードは取り違えない。
    expect(setagaya.procedure.id).toBe('procedure_resident_registration');
    expect(setagaya.procedure.municipalityCode).toBe('13112');
    expect(koto.procedure.id).toBe('procedure_resident_registration');
    expect(koto.procedure.municipalityCode).toBe('13108');

    // 各区の実データ(タイトル)が返り、互いに上書きされていない。
    expect(setagaya.procedure.title).toContain('世田谷');
    expect(koto.procedure.title).toContain('江東');
    expect(setagaya.procedure.title).not.toBe(koto.procedure.title);

    // 根拠ソースも自区のもの(source_id接頭辞で判別)。
    expect(setagaya.sources.length).toBeGreaterThan(0);
    expect(koto.sources.length).toBeGreaterThan(0);
    expect(koto.sources.some((s) => s.sourceId.startsWith('src-13108-'))).toBe(true);
    expect(setagaya.sources.some((s) => s.sourceId.startsWith('src-13112-'))).toBe(true);
  });

  it('複数の共有 procedure_id すべてで自区の根拠ソースが返り混線しない', async () => {
    // なぜ: タイトルは自治体間で偶然一致しうる(例: 児童手当)。混線の確実な検知子は
    // 「返る municipality_code と 根拠 source_id 接頭辞が要求した自治体のものか」。
    const sharedIds = [
      'procedure_mynumber_continued_use',
      'procedure_national_health_insurance',
      'procedure_national_pension_address',
      'procedure_child_allowance',
    ];
    for (const id of sharedIds) {
      const setagaya = await getProcedureDetail(id, '13112');
      const koto = await getProcedureDetail(id, '13108');
      expect(setagaya.procedure.municipalityCode).toBe('13112');
      expect(koto.procedure.municipalityCode).toBe('13108');
      // 根拠ソースが自区のもの(接頭辞)であること = 一方が他方で上書きされていない。
      expect(setagaya.sources.length).toBeGreaterThan(0);
      expect(koto.sources.length).toBeGreaterThan(0);
      expect(setagaya.sources.every((s) => s.sourceId.startsWith('src-13112-'))).toBe(true);
      expect(koto.sources.every((s) => s.sourceId.startsWith('src-13108-'))).toBe(true);
    }
  });

  it('procedure_school_transfer は両区で200を返すが、内容(必要書類の名称)は自区のもので混線しない(2026-07-25 世田谷Step3承認後の回帰ガード)', async () => {
    // なぜ: 2026-07-25 人手レビュー承認により世田谷(13112)でも procedure_school_transfer が
    // 公開されるようになったため、旧来の「江東限定・世田谷は404」という前提は成立しなくなった。
    // 404の有無より本質的な混線検知として、両区が200を返す前提で「必要書類の名称が自区のもの
    // であること」をアサートする(世田谷=「学校指定通知書」、江東=「転入学通知書」。互いの
    // 名称が混入していないことを機械検証)。
    const setagaya = await getProcedureDetail('procedure_school_transfer', '13112');
    const koto = await getProcedureDetail('procedure_school_transfer', '13108');
    expect(setagaya.procedure.municipalityCode).toBe('13112');
    expect(koto.procedure.municipalityCode).toBe('13108');

    const setagayaDocLabels = setagaya.procedure.requiredDocuments.map((d) => d.label).join(' ');
    const kotoDocLabels = koto.procedure.requiredDocuments.map((d) => d.label).join(' ');

    expect(setagayaDocLabels).toContain('学校指定通知書');
    expect(setagayaDocLabels).not.toContain('転入学通知書');
    expect(kotoDocLabels).toContain('転入学通知書');
    expect(kotoDocLabels).not.toContain('学校指定通知書');

    // 根拠ソースも自区のもの(接頭辞)であること = 一方が他方で上書きされていない。
    expect(setagaya.sources.every((s) => s.sourceId.startsWith('src-13112-'))).toBe(true);
    expect(koto.sources.every((s) => s.sourceId.startsWith('src-13108-'))).toBe(true);
  });
});

function kotoChildProfile(): Profile {
  return {
    destination: { municipalityCode: '13108' },
    moveDate: '2026-08-01',
    originType: 'outside_tokyo',
    household: {
      memberCount: 3,
      ageBands: ['adult', 'adult', 'elementary'],
    },
    flags: {
      hasMyNumberCard: false,
      needsNationalHealthInsurance: true,
      needsNationalPension: true,
      hasSchoolOrChildcareNeeds: true,
      hasDog: false,
      dogHasMicrochip: 'unknown',
      needsDisabilityOrCareSupport: false,
      needsForeignResidentGuidance: false,
      needsVehicleGuidance: false,
      isPregnantMember: false,
    },
  };
}

interface Task {
  procedureId: string;
  applicable?: string;
  priority: string;
}

describe('江東(13108)の子育てチェックリスト: 関連手続きが該当する (T-015)', () => {
  it('school_transfer 等が該当し、自区のルール(13108)で評価される', async () => {
    const res = await request('/api/checklists', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(kotoChildProfile()),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tasks: Task[]; ruleVersion: string };
    const ids = body.tasks.map((t) => t.procedureId);

    // 学齢児童+就学ニーズあり → 江東固有の転入学手続きが該当。
    expect(ids).toContain('procedure_school_transfer');
    const school = body.tasks.find((t) => t.procedureId === 'procedure_school_transfer')!;
    expect(school.applicable).toBe('applicable');

    // 共有手続きも江東として該当(転入届は必ず)。
    expect(ids).toContain('procedure_resident_registration');
    // 子育て関連の追加手続きも該当。
    expect(ids).toContain('procedure_child_allowance');
  });
});

describe('無回帰: 世田谷(13108同時シード下でも)従来どおり自区データを返す (T-015)', () => {
  it('13112 の転入届詳細は世田谷の内容のまま', async () => {
    const setagaya = await getProcedureDetail('procedure_resident_registration', '13112');
    expect(setagaya.procedure.municipalityCode).toBe('13112');
    expect(setagaya.procedure.title).toContain('世田谷');
  });

  it('procedure_childcare_application は両区で200を返すが、申込締切の文言(自区の公式期限)は混線しない(2026-07-25 世田谷Step3承認後の回帰ガード)', async () => {
    // なぜ: 2026-07-25 人手レビュー承認により世田谷(13112)でも procedure_childcare_application が
    // 公開されるようになったため、旧来の「江東限定・世田谷は404」という前提は成立しなくなった。
    // 混線検知として、両区の申込締切の公式文言(世田谷=前月10日、江東=前月末日)が
    // 互いに入れ替わっていないことをアサートする。
    const setagaya = await getProcedureDetail('procedure_childcare_application', '13112');
    const koto = await getProcedureDetail('procedure_childcare_application', '13108');
    expect(setagaya.procedure.municipalityCode).toBe('13112');
    expect(koto.procedure.municipalityCode).toBe('13108');

    expect(setagaya.procedure.dueDescription).toContain('前月10日');
    expect(setagaya.procedure.dueDescription).not.toContain('前月末日');
    expect(koto.procedure.dueDescription).toContain('前月末日');
    expect(koto.procedure.dueDescription).not.toContain('前月10日');

    expect(setagaya.sources.every((s) => s.sourceId.startsWith('src-13112-'))).toBe(true);
    expect(koto.sources.every((s) => s.sourceId.startsWith('src-13108-'))).toBe(true);
  });
});
