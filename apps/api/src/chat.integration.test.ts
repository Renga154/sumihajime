import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import type { VectorizeMatch, VectorizeQueryOptions, VectorizeQueryable } from '@tmn/rag';
import { createTestDb, type TestDb } from '../test/d1-harness.js';
import app from './index.js';

/**
 * なぜ: /api/chat(RAG)を Miniflare の本物のD1 + モックVectorize + スタブOpenAI で通しで検証する
 * (OpenAI/Vectorizeは実呼び出ししない方針)。フラグ無効=503、正常系(引用付き)、保留系、
 * 出力検証(捏造引用→保留差し替え)、municipalityCode強制フィルタ、ログに質問文が出ないこと、
 * レート制限(429)を確認する。
 */

let harness: TestDb;
let db: D1Database;

const CHUNK_ID = 'src-13112-resident_registration-001#0';
const SOURCE_ID = 'src-13112-resident_registration-001';

beforeAll(async () => {
  harness = await createTestDb();
  db = harness.db as unknown as D1Database;
  // rag_chunks は publish 経由では入らないため、テスト用に世田谷の転入届チャンクを1件投入する。
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
      '転入届は引越しをしてきた日から14日以内に窓口へ提出してください。郵送はできません。手数料は無料です。',
    )
    .run();
});

afterAll(async () => {
  await harness.dispose();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** OpenAI(embeddings/chat)への fetch をスタブする。chat応答本文はテストごとに指定。 */
function stubOpenAI(chatContent: string): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.endsWith('/embeddings')) {
        return new Response(JSON.stringify({ data: [{ embedding: [0.1, 0.2, 0.3] }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.endsWith('/chat/completions')) {
        return new Response(JSON.stringify({ choices: [{ message: { content: chatContent } }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
}

interface CapturingVectorize extends VectorizeQueryable {
  lastFilter: Record<string, unknown> | undefined;
}

/** マッチを返すモックVectorize。query に渡された filter を記録する(スコープ強制の検証用)。 */
function mockVectorize(matches: VectorizeMatch[]): CapturingVectorize {
  const idx: CapturingVectorize = {
    lastFilter: undefined,
    async query(_vector: number[], opts: VectorizeQueryOptions) {
      idx.lastFilter = opts.filter;
      return { matches };
    },
  };
  return idx;
}

let ipCounter = 0;
/** モジュール内共有のレート制限バケットを汚染しないよう、テストごとに新規IPを使う。 */
function freshIp(): string {
  ipCounter += 1;
  return `10.0.0.${ipCounter}`;
}

interface ChatEnv {
  DB: D1Database;
  VECTORIZE?: VectorizeQueryable;
  RAG_ENABLED?: string;
  OPENAI_API_KEY?: string;
  OPENAI_BASE_URL?: string;
  OPENAI_CHAT_MODEL?: string;
  OPENAI_EMBED_MODEL?: string;
  RAG_MIN_SCORE?: string;
}

function baseEnv(overrides: Partial<ChatEnv> = {}): ChatEnv {
  return {
    DB: db,
    RAG_ENABLED: 'true',
    OPENAI_API_KEY: 'test-key',
    OPENAI_BASE_URL: 'https://api.openai.test/v1',
    OPENAI_CHAT_MODEL: 'gpt-4o-mini',
    OPENAI_EMBED_MODEL: 'text-embedding-3-small',
    RAG_MIN_SCORE: '0.3',
    ...overrides,
  };
}

function chat(env: ChatEnv, body: unknown, ip = freshIp()): Promise<Response> {
  return Promise.resolve(
    app.request(
      '/api/chat',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'CF-Connecting-IP': ip },
        body: JSON.stringify(body),
      },
      env,
    ),
  );
}

describe('POST /api/chat — フラグ無効', () => {
  it('RAG_ENABLED!=="true" は 503 {disabled:true}(既存機能の劣化なし)', async () => {
    const res = await chat(baseEnv({ RAG_ENABLED: 'false' }), {
      municipalityCode: '13112',
      question: '転入届の持ち物は?',
    });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ disabled: true });
  });
});

describe('POST /api/chat — 正常系(引用付き)', () => {
  it('抜粋に基づく回答 + 台帳解決済み citations を返し、municipalityCode $eq でフィルタする', async () => {
    stubOpenAI(
      '転入届は引越し日から14日以内に窓口へ提出してください。郵送はできません。\nSOURCES: ' +
        SOURCE_ID,
    );
    const vz = mockVectorize([{ id: CHUNK_ID, score: 0.72 }]);
    const res = await chat(baseEnv({ VECTORIZE: vz }), {
      municipalityCode: '13112',
      question: '転入届の持ち物と期限は?',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      answer: string;
      citations: { sourceId: string; url: string; ownerOrganization: string }[];
      confidence: string;
      abstained: boolean;
    };
    expect(body.abstained).toBe(false);
    expect(body.answer).toContain('14日以内');
    expect(body.answer).not.toContain('SOURCES'); // SOURCES行は本文から除去
    expect(body.citations).toHaveLength(1);
    expect(body.citations[0]?.sourceId).toBe(SOURCE_ID);
    expect(body.citations[0]?.url).toMatch(/^https:\/\//);
    expect(body.citations[0]?.ownerOrganization).toBe('世田谷区');
    expect(body.confidence).toBe('high');
    // サーバー側強制フィルタ(§11.3)。
    expect(vz.lastFilter).toEqual({ municipalityCode: '13112' });
  });
});

describe('POST /api/chat — 保留系', () => {
  it('閾値未満のマッチしか無ければ「確認できません」で保留(§11.5)', async () => {
    stubOpenAI('(呼ばれないはず)');
    const vz = mockVectorize([{ id: CHUNK_ID, score: 0.1 }]);
    const res = await chat(baseEnv({ VECTORIZE: vz }), {
      municipalityCode: '13112',
      question: '保育園の空き状況は?',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { answer: string; citations: unknown[]; abstained: boolean };
    expect(body.abstained).toBe(true);
    expect(body.citations).toHaveLength(0);
    expect(body.answer).toContain('確認できません');
  });

  it('未対応自治体(supported=false)は対象外を明示+公式誘導で保留', async () => {
    const vz = mockVectorize([]);
    const res = await chat(baseEnv({ VECTORIZE: vz }), {
      municipalityCode: '13115', // 杉並(未対応)
      question: 'ごみの出し方は?',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { answer: string; abstained: boolean };
    expect(body.abstained).toBe(true);
    expect(body.answer).toContain('杉並区');
    expect(body.answer).toContain('公式サイト');
  });
});

describe('POST /api/chat — 出力検証(§11.6)', () => {
  it('検索でヒットしていない sourceId を引用した回答は保留へ差し替える', async () => {
    stubOpenAI('もっともらしい回答です。\nSOURCES: src-FAKE-999');
    const vz = mockVectorize([{ id: CHUNK_ID, score: 0.8 }]);
    const res = await chat(baseEnv({ VECTORIZE: vz }), {
      municipalityCode: '13112',
      question: '転入届について教えて',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { citations: unknown[]; abstained: boolean; answer: string };
    expect(body.abstained).toBe(true);
    expect(body.citations).toHaveLength(0);
    expect(body.answer).toContain('確認できません');
  });
});

describe('POST /api/chat — 入力検証', () => {
  it('500字超の質問は 422', async () => {
    const vz = mockVectorize([]);
    const res = await chat(baseEnv({ VECTORIZE: vz }), {
      municipalityCode: '13112',
      question: 'あ'.repeat(501),
    });
    expect(res.status).toBe(422);
  });
});

describe('POST /api/chat — ログにPII(質問本文・回答本文)を残さない(§13)', () => {
  it('質問文・回答本文がログに現れない(自治体コード/イベントのみ)', async () => {
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
    });
    const secretQuestion = 'ヒミツの質問トークンXYZ';
    const secretAnswer = 'ヒミツの回答トークンABC';
    stubOpenAI(`${secretAnswer}\nSOURCES: ${SOURCE_ID}`);
    const vz = mockVectorize([{ id: CHUNK_ID, score: 0.7 }]);
    await chat(baseEnv({ VECTORIZE: vz }), {
      municipalityCode: '13112',
      question: secretQuestion,
    });
    const joined = logs.join('\n');
    expect(joined).toContain('chat.answered');
    expect(joined).toContain('13112');
    expect(joined).not.toContain(secretQuestion);
    expect(joined).not.toContain(secretAnswer);
  });
});

describe('POST /api/chat — レート制限(10req/分)', () => {
  it('同一IPで11回目は 429', async () => {
    stubOpenAI('回答。\nSOURCES: ' + SOURCE_ID);
    const vz = mockVectorize([{ id: CHUNK_ID, score: 0.7 }]);
    const ip = '203.0.113.77';
    const env = baseEnv({ VECTORIZE: vz });
    for (let i = 0; i < 10; i++) {
      const ok = await chat(env, { municipalityCode: '13112', question: `質問${i}` }, ip);
      expect(ok.status).toBe(200);
    }
    const limited = await chat(env, { municipalityCode: '13112', question: '超過' }, ip);
    expect(limited.status).toBe(429);
  });
});
