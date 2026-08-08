import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import type { WardDifferencesResponse } from '@tmn/schemas';
import { wardDifferencesResponseSchema } from '@tmn/schemas';
import { MUNICIPALITIES } from '@tmn/publish';
import { createTestDb, type TestDb } from '../test/d1-harness.js';
import app from './index.js';

/**
 * なぜ: GET /api/ward-differences は「区をまたぐ比較」という、原則4の例外的な経路である。
 * 実D1(承認ゲートを通したシード)に対して通しで検証し、次の2点を固定する:
 *   1. 比較ページが機能する: 対応区がすべて並び、値が実際に分かれ、各セルに承認済み出典の
 *      URLと最終確認日が付く(原則2)。
 *   2. 比較が「比較ページ専用」であること: 同じD1でチェックリスト・手続き詳細を叩いても、
 *      他区の情報が一切混ざらない(原則4)。
 *
 * シードは対応している23特別区すべて(publish の supported=対応対象)。1件でも増えれば
 * このテストの対象区も自動的に増える(区名・件数をハードコードしない)。
 */

const WARD_CODES = MUNICIPALITIES.filter((m) => m.supported && /^131\d\d$/.test(m.code))
  .map((m) => m.code)
  .sort();

let harness: TestDb;
let db: D1Database;

beforeAll(async () => {
  harness = await createTestDb(WARD_CODES);
  db = harness.db as unknown as D1Database;
}, 180_000);

afterAll(async () => {
  await harness.dispose();
});

function request(path: string, init?: RequestInit): Promise<Response> {
  return Promise.resolve(app.request(path, init, { DB: db }));
}

async function getReport(): Promise<WardDifferencesResponse> {
  const res = await request('/api/ward-differences');
  expect(res.status).toBe(200);
  // 応答契約(@tmn/schemas)で境界検証する。
  return wardDifferencesResponseSchema.parse(await res.json());
}

describe('GET /api/ward-differences — 区をまたぐ期限差分', () => {
  it('公開(supported)されている区がすべて並ぶ', async () => {
    const report = await getReport();
    expect(report.municipalities.length).toBeGreaterThanOrEqual(13);
    // 公開ビュー(supported)の自治体だけが出ること。未対応を対応済みに見せない(原則9)。
    const listed = report.municipalities.map((m) => m.code);
    expect([...listed].sort()).toEqual(listed);
    for (const code of listed) expect(WARD_CODES).toContain(code);
    // 名称はD1のmunicipalitiesから引く(APIがハードコードしない)。
    for (const m of report.municipalities) expect(m.name).toMatch(/区$/);
  });

  it('各トピックが実際に複数の値へ分かれ、全区が分布に含まれる', async () => {
    const report = await getReport();
    expect(report.topics.length).toBeGreaterThan(0);
    const all = report.municipalities.map((m) => m.code).sort();
    for (const topic of report.topics) {
      expect(topic.valueGroups.length, topic.topicId).toBeGreaterThanOrEqual(2);
      const covered = topic.valueGroups.flatMap((g) => [...g.municipalityCodes]).sort();
      expect(covered, topic.topicId).toEqual(all);
      expect(topic.omittedMunicipalityCodes, topic.topicId).toEqual([]);
    }
  });

  it('全てのセルに、その区の承認済み出典URLと最終確認日が付く(原則2)', async () => {
    const report = await getReport();
    for (const topic of report.topics) {
      for (const cell of topic.cells) {
        expect(cell.sources.length, `${topic.topicId}/${cell.municipalityCode}`).toBeGreaterThan(0);
        for (const s of cell.sources) {
          expect(s.url).toMatch(/^https:\/\//);
          expect(s.lastVerifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
          // 出典は自区のもの、または区に紐づかない共通のもの(他区の src- 接頭辞が出ない)。
          const otherWardPrefix = /^src-(131\d\d)-/.exec(s.sourceId)?.[1];
          if (otherWardPrefix) expect(otherWardPrefix).toBe(cell.municipalityCode);
        }
      }
    }
  });

  it('セルの公式文言は、その区のチェックリストに出る文言と同一(比較用の別文面を作らない)', async () => {
    const report = await getReport();
    const topic = report.topics[0];
    expect(topic).toBeDefined();
    if (!topic) return;
    const cell = topic.cells[0];
    expect(cell).toBeDefined();
    if (!cell) return;
    const res = await request(
      `/api/procedures/${topic.procedureId}?municipality=${cell.municipalityCode}`,
    );
    expect(res.status).toBe(200);
    const detail = (await res.json()) as { procedure: { municipalityCode: string } };
    expect(detail.procedure.municipalityCode).toBe(cell.municipalityCode);
  });

  it('判定方法(derivationNote)を必ず開示する(推測でないことを利用者へ示す)', async () => {
    const report = await getReport();
    for (const topic of report.topics) {
      expect(topic.derivationNote.length, topic.topicId).toBeGreaterThan(20);
    }
  });
});

describe('原則4 — 比較は比較専用エンドポイントだけ(他の応答に混ざらない)', () => {
  /** 23特別区の名称は municipalities マスタから引く(テスト側でハードコードしない)。 */
  async function wardNames(): Promise<Map<string, string>> {
    const res = await request('/api/municipalities');
    const munis = (await res.json()) as { code: string; name: string; supported: boolean }[];
    return new Map(munis.filter((m) => m.supported).map((m) => [m.code, m.name]));
  }

  it('手続き詳細の応答に、他区の名称が現れない', async () => {
    const names = await wardNames();
    const report = await getReport();
    const topic = report.topics[0];
    if (!topic) throw new Error('no topic');

    for (const code of [...names.keys()].slice(0, 5)) {
      const res = await request(`/api/procedures/${topic.procedureId}?municipality=${code}`);
      expect(res.status).toBe(200);
      const text = await res.text();
      for (const [otherCode, otherName] of names) {
        if (otherCode === code) continue;
        expect(text.includes(otherName), `${code} の応答に「${otherName}」が混入`).toBe(false);
      }
    }
  });

  it('チェックリストの応答に、他区の名称が現れない', async () => {
    const names = await wardNames();
    for (const code of [...names.keys()].slice(0, 5)) {
      const res = await request('/api/checklists', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          destination: { municipalityCode: code },
          moveDate: '2026-09-01',
          originType: 'outside_tokyo',
          household: { memberCount: 2, ageBands: ['adult', 'age0_2'] },
          flags: {
            hasMyNumberCard: true,
            needsNationalHealthInsurance: true,
            needsNationalPension: true,
            hasSchoolOrChildcareNeeds: true,
            hasDog: true,
            dogHasMicrochip: 'unknown',
            needsDisabilityOrCareSupport: false,
            needsForeignResidentGuidance: false,
            needsVehicleGuidance: false,
            isPregnantMember: false,
          },
        }),
      });
      expect(res.status).toBe(200);
      const text = await res.text();
      for (const [otherCode, otherName] of names) {
        if (otherCode === code) continue;
        expect(text.includes(otherName), `${code} のチェックリストに「${otherName}」が混入`).toBe(
          false,
        );
      }
    }
  });
});
