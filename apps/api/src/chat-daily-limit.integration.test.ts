import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import type { VectorizeQueryable } from '@tmn/rag';
import { createTestDb, type TestDb } from '../test/d1-harness.js';
import { app } from './index.js';
import { tokyoDate } from './tokyo-date.js';

/**
 * なぜ: IP単位の制限はメモリ内(isolate単位)でしか効かず、IPを替えればすり抜けられる。
 * OpenAI の費用には全体で1つの上限が要るため、D1 の chat_usage で日本時間の暦日ごとに数える。
 * この上限は「生成を伴う要求」だけを数え、必要書類の質問(検証済みデータ経路)とチェックリストは
 * 上限・計数の故障の影響を受けない(原則8)。本物のD1(Miniflare)で通しで確かめる。
 */

let harness: TestDb;
let db: D1Database;

const CHUNK_ID = 'src-13112-resident_registration-001#0';
const SOURCE_ID = 'src-13112-resident_registration-001';

beforeAll(async () => {
  harness = await createTestDb();
  db = harness.db as unknown as D1Database;
  await db
    .prepare(
      `INSERT INTO rag_chunks (chunk_id, municipality_code, source_id, procedure_id, category, ` +
        `title, url, last_verified_at, seq, text) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      CHUNK_ID,
      '13112',
      SOURCE_ID,
      'procedure_resident_registration',
      'resident_registration',
      '世田谷区 転入届',
      'https://www.city.setagaya.lg.jp/02233/88.html',
      '2026-07-21T00:00:00Z',
      0,
      '転入届は引越しをしてきた日から14日以内に窓口へ提出してください。',
    )
    .run();
});

afterAll(async () => {
  await harness.dispose();
});

beforeEach(async () => {
  await db.prepare('DELETE FROM chat_usage').run();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

let openAICalls = 0;
function stubOpenAI(): void {
  openAICalls = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      openAICalls += 1;
      if (url.endsWith('/embeddings')) {
        return new Response(JSON.stringify({ data: [{ embedding: [0.1, 0.2] }] }), { status: 200 });
      }
      return new Response(
        JSON.stringify({
          choices: [
            { message: { content: `14日以内に提出してください。\nSOURCES: ${SOURCE_ID}` } },
          ],
        }),
        { status: 200 },
      );
    }),
  );
}

const vectorize: VectorizeQueryable = {
  async query() {
    return { matches: [{ id: CHUNK_ID, score: 0.8 }] };
  },
};

let ipCounter = 0;
function env(overrides: Record<string, unknown> = {}) {
  return {
    DB: db,
    VECTORIZE: vectorize,
    RAG_ENABLED: 'true',
    OPENAI_API_KEY: 'test-key',
    OPENAI_BASE_URL: 'https://api.openai.com/v1',
    CHAT_DAILY_LIMIT: '2',
    ...overrides,
  };
}

function chat(e: Record<string, unknown>, question: string): Promise<Response> {
  ipCounter += 1;
  return Promise.resolve(
    app.request(
      '/api/chat',
      {
        method: 'POST',
        // IPを毎回替える=IP単位の制限では止まらない状況で、全体の上限が効くことを確かめる。
        headers: { 'content-type': 'application/json', 'CF-Connecting-IP': `10.9.0.${ipCounter}` },
        body: JSON.stringify({ municipalityCode: '13112', question }),
      },
      e,
    ),
  );
}

async function usageToday(): Promise<number | null> {
  const row = await db
    .prepare('SELECT count FROM chat_usage WHERE day = ?')
    .bind(tokyoDate(new Date()))
    .first<{ count: number }>();
  return row?.count ?? null;
}

describe('POST /api/chat — 全体の1日上限(CHAT_DAILY_LIMIT)', () => {
  it('上限までは答え、超えたら IP を替えても 429(OpenAI を呼ばない)', async () => {
    stubOpenAI();
    expect((await chat(env(), '転入届はいつまで？')).status).toBe(200);
    expect((await chat(env(), '転入届はいつまで？')).status).toBe(200);
    const callsBefore = openAICalls;

    const res = await chat(env(), '転入届はいつまで？');
    expect(res.status).toBe(429);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('chat_daily_limit');
    // 本日停止していることと、チェックリスト・公式リンクは使えることを伝える(原則8)。
    expect(body.error.message).toContain('本日');
    expect(body.error.message).toContain('チェックリスト');
    expect(body.error.message).toContain('公式ページ');
    expect(openAICalls).toBe(callsBefore);
    // 日本時間の暦日の行へ原子的に加算されている(断った要求も数える=上限は越えたまま)。
    expect(await usageToday()).toBe(3);
  });

  it('上限到達後も、必要書類の質問(生成を伴わない検証済みデータ経路)には答え、計数も増やさない', async () => {
    stubOpenAI();
    const limited = env({ CHAT_DAILY_LIMIT: '0' });
    const res = await chat(limited, '転入届に必要な持ち物を教えてください。');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { abstained: boolean; answer: string };
    expect(body.abstained).toBe(false);
    expect(body.answer).toContain('■ 必ず必要なもの');
    expect(openAICalls).toBe(0);
    expect(await usageToday()).toBeNull();
  });

  it.each(['', 'abc', '-5', '1e9'])(
    'CHAT_DAILY_LIMIT=%s(不正値)は既定値(1500)として扱い、上限が消えも0にもならない',
    async (raw) => {
      stubOpenAI();
      const res = await chat(env({ CHAT_DAILY_LIMIT: raw }), '転入届はいつまで？');
      expect(res.status).toBe(200);
    },
  );

  it('計数(D1)が失敗したらチャットの生成だけを閉じる(503)。チェックリストは影響を受けない', async () => {
    stubOpenAI();
    // chat_usage への書き込みだけを失敗させる D1 の代役(他のクエリは本物へ委ねる)。
    const failingUsageDb = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === 'prepare') {
          return (sql: string) => {
            if (sql.includes('chat_usage')) throw new Error('D1 unavailable');
            return target.prepare(sql);
          };
        }
        const value = Reflect.get(target, prop, receiver) as unknown;
        return typeof value === 'function'
          ? (value as (...a: unknown[]) => unknown).bind(target)
          : value;
      },
    });

    const res = await chat(env({ DB: failingUsageDb }), '転入届はいつまで？');
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('chat_unavailable');
    expect(body.error.message).toContain('チェックリスト');
    // 数えられない間は課金を伴う呼び出しをしない(上限が黙って消えない)。
    expect(openAICalls).toBe(0);

    const checklist = await app.request(
      '/api/checklists',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          destination: { municipalityCode: '13112' },
          moveDate: '2026-10-01',
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
        }),
      },
      { DB: failingUsageDb },
    );
    expect(checklist.status).toBe(200);
  });
});
