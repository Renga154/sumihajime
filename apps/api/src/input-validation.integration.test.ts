import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import {
  FACILITY_CATEGORIES,
  PROCEDURE_ID_PATTERN,
  WASTE_SORTING_QUERY_MAX_LENGTH,
} from '@tmn/schemas';
import { createTestDb, type TestDb } from '../test/d1-harness.js';
import { app } from './index.js';

/**
 * 5・6. 入力検証(サーバー = 画面)。攻撃系は「D1 に触れる前に 4xx で断る」、正常系は
 * 公開データの実際の値(最長の品目名・全区分・全手続きID)が通ることを本物の D1 で確かめる。
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const normalizedDir = resolve(repoRoot, 'data/normalized');

function readAll<T>(file: string, pick: (json: unknown) => T[]): T[] {
  const out: T[] = [];
  for (const code of readdirSync(normalizedDir).filter((d) => /^\d{5}$/.test(d))) {
    const path = resolve(normalizedDir, code, file);
    if (existsSync(path)) out.push(...pick(JSON.parse(readFileSync(path, 'utf-8'))));
  }
  return out;
}
const asArray = (json: unknown, key: string): Record<string, unknown>[] =>
  (Array.isArray(json) ? json : ((json as Record<string, unknown>)[key] ?? [])) as Record<
    string,
    unknown
  >[];

let harness: TestDb;
let db: D1Database;

beforeAll(async () => {
  harness = await createTestDb();
  db = harness.db as unknown as D1Database;
});

afterAll(async () => {
  await harness.dispose();
});

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

const request = (path: string, init?: RequestInit) =>
  Promise.resolve(app.request(path, init, { DB: db }));

describe('公開データと検証規則の整合(規則を締めても正当な値を落とさない)', () => {
  it('全区の窓口区分が許可リストに含まれる', () => {
    const categories = new Set(
      readAll('facilities.json', (j) => asArray(j, 'facilities')).map((f) => String(f.category)),
    );
    expect(categories.size).toBeGreaterThan(0);
    const allowed = new Set<string>(FACILITY_CATEGORIES);
    expect([...categories].filter((c) => !allowed.has(c))).toEqual([]);
  });

  it('全区の手続きIDが procedureIdSchema の形に合う', () => {
    const ids = readAll('procedures.json', (j) => asArray(j, 'procedures')).map((p) =>
      String(p.procedureId ?? p.id),
    );
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.filter((id) => !PROCEDURE_ID_PATTERN.test(id))).toEqual([]);
    expect(ids.filter((id) => !PROCEDURE_ID_PATTERN.test(`task_${id}`))).toEqual([]);
  });

  it('最長の品目名・読み仮名も検索語の上限に収まる', () => {
    const items = readAll('waste-sorting.json', (j) => asArray(j, 'items'));
    expect(items.length).toBeGreaterThan(0);
    const longest = Math.max(
      ...items.flatMap((i) => [String(i.name).length, String(i.reading ?? '').length]),
    );
    expect(longest).toBeLessThanOrEqual(WASTE_SORTING_QUERY_MAX_LENGTH);
  });
});

describe('GET /api/waste-sorting?q= の長さ', () => {
  it('攻撃: 2000字の検索語は 400 で、検索語を応答に反射しない', async () => {
    const q = 'あ'.repeat(2000);
    const res = await request(`/api/waste-sorting?municipality=13112&q=${encodeURIComponent(q)}`);
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).toContain('invalid_query');
    expect(text).not.toContain('ああああ');
  });

  it('境界: 上限+1 字は 400、上限ちょうどは 200', async () => {
    const over = 'a'.repeat(WASTE_SORTING_QUERY_MAX_LENGTH + 1);
    const exact = 'a'.repeat(WASTE_SORTING_QUERY_MAX_LENGTH);
    expect((await request(`/api/waste-sorting?municipality=13112&q=${over}`)).status).toBe(400);
    expect((await request(`/api/waste-sorting?municipality=13112&q=${exact}`)).status).toBe(200);
  });

  it('正常: 通常の検索語は従来どおり', async () => {
    const res = await request(
      `/api/waste-sorting?municipality=13112&q=${encodeURIComponent('ペットボトル')}`,
    );
    expect(res.status).toBe(200);
  });
});

describe('GET /api/facilities?category=', () => {
  it.each(['存在しない区分', 'x'.repeat(500), "出張所' OR 1=1 --"])(
    '攻撃: %j は 400 invalid_category',
    async (category) => {
      const res = await request(
        `/api/facilities?municipality=13112&category=${encodeURIComponent(category)}`,
      );
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
        'invalid_category',
      );
    },
  );

  it('正常: 許可リストの区分と未指定は従来どおり', async () => {
    const filtered = await request(
      `/api/facilities?municipality=13112&category=${encodeURIComponent('出張所')}`,
    );
    expect(filtered.status).toBe(200);
    expect((await request('/api/facilities?municipality=13112')).status).toBe(200);
  });
});

describe('GET /api/procedures/:id の形', () => {
  it.each(['Procedure_Upper', 'a%20b', '..%2F..%2Fetc', 'x'.repeat(200)])(
    '攻撃: %s は D1 を引かずに 404 procedure_not_found',
    async (id) => {
      const throwingDb = {
        prepare() {
          throw new Error('D1 reached');
        },
      };
      const res = await app.request(`/api/procedures/${id}?municipality=13112`, undefined, {
        DB: throwingDb,
      });
      expect(res.status).toBe(404);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
        'procedure_not_found',
      );
    },
  );

  it('正常: 実在の手続きは 200', async () => {
    const res = await request('/api/procedures/procedure_resident_registration?municipality=13112');
    expect(res.status).toBe(200);
  });
});

describe('POST /api/checklists の日付', () => {
  const profile = (moveDate: string, moveOutScheduledDate?: string) => ({
    destination: { municipalityCode: '13112' },
    moveDate,
    ...(moveOutScheduledDate ? { moveOutScheduledDate } : {}),
    originType: 'outside_tokyo',
    household: { memberCount: 1, ageBands: ['adult'] },
    flags: {
      hasMyNumberCard: true,
      needsNationalHealthInsurance: false,
      needsNationalPension: false,
      hasSchoolOrChildcareNeeds: false,
      hasDog: false,
      needsDisabilityOrCareSupport: false,
      needsForeignResidentGuidance: false,
    },
  });
  const post = (body: unknown) =>
    request('/api/checklists', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  it.each([
    ['9999-12-31', undefined],
    ['0001-01-01', undefined],
    ['2026-08-01', '9999-12-31'],
    ['2026-08-01', '0001-01-01'],
  ])('攻撃: moveDate=%s moveOut=%s は 500 ではなく 422', async (moveDate, moveOut) => {
    const res = await post(profile(moveDate, moveOut));
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('invalid_profile');
  });

  it('正常: 過去の引越し日(保存済みの控え)でも生成できる', async () => {
    const res = await post(profile('2025-04-01', '2025-03-25'));
    expect(res.status).toBe(200);
  });
});
