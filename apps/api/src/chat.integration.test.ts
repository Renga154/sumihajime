import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import type { VectorizeMatch, VectorizeQueryOptions, VectorizeQueryable } from '@tmn/rag';
import { createTestDb, type TestDb } from '../test/d1-harness.js';
import { app } from './index.js';

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

/**
 * なぜ(独立点検 P1): 以前は embeddings(=課金リクエスト)を先に済ませてから Vectorize
 * バインディングの有無を確かめていた。索引が外れている間は、返せないと分かっている応答のために
 * 毎回課金し、その待ち時間ぶん利用者を待たせていた。呼ぶ前に判定できることは呼ぶ前に判定する。
 */
describe('POST /api/chat — 検索索引が無いとき', () => {
  it('503 を返し、OpenAI へ1度も問い合わせない', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        calls.push(url);
        throw new Error('索引が無い状態で外部APIを呼んではいけない');
      }),
    );

    const res = await chat(baseEnv({ VECTORIZE: undefined }), {
      municipalityCode: '13112',
      // 構造化データ経路(持ち物・書類)に当たらない質問にして、検索経路へ落とす。
      question: '粗大ごみの出し方を教えてください',
    });

    expect(res.status).toBe(503);
    expect(calls).toEqual([]);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('chat_unavailable');
    // チェックリストは使えると伝わる文面であること(原則8)。
    expect(body.error.message).toContain('時間をおいて');
  });
});

describe('POST /api/chat — 正常系(引用付き)', () => {
  it('抜粋に基づく回答 + 台帳解決済み citations を返し、municipalityCode $eq でフィルタする', async () => {
    stubOpenAI(
      '転入届は引越し日から14日以内に窓口へ提出してください。郵送はできません。\nSOURCES: ' +
        SOURCE_ID,
    );
    const vz = mockVectorize([{ id: CHUNK_ID, score: 0.72 }]);
    // なぜ書類を尋ねない質問にしたか: 必要書類・持ち物の質問は検証済み構造化データ経路
    // (ADR-010 案A)が先に応答するため、ここではRAG(検索+生成)経路そのものを検証する質問を使う。
    const res = await chat(baseEnv({ VECTORIZE: vz }), {
      municipalityCode: '13112',
      question: '転入届はいつまでに出せばよいですか?',
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

describe('POST /api/chat — 必要書類は検証済み構造化データで答える(ADR-010 案A)', () => {
  /** 検証済みデータ経路はLLMもVectorizeも使わないので、呼ばれたら即失敗するスタブを置く。 */
  function forbidOpenAI(): void {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        throw new Error(`LLM must not be called for document questions: ${url}`);
      }),
    );
  }
  const explodingVectorize: VectorizeQueryable = {
    query() {
      throw new Error('Vectorize must not be queried for document questions');
    },
  };

  it('required と conditional を分けて提示し、conditional を必須と断定しない', async () => {
    forbidOpenAI();
    const res = await chat(baseEnv({ VECTORIZE: explodingVectorize }), {
      municipalityCode: '13112',
      question: '転入届に必要な持ち物を教えてください。',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      answer: string;
      citations: { sourceId: string; lastVerifiedAt: string }[];
      abstained: boolean;
    };
    expect(body.abstained).toBe(false);
    // 世田谷の requiredDocuments: 本人確認書類=required / 転出証明書・マイナンバーカード=conditional。
    const reqIdx = body.answer.indexOf('■ 必ず必要なもの');
    const conIdx = body.answer.indexOf('■ 場合により必要なもの');
    expect(reqIdx).toBeGreaterThan(-1);
    expect(conIdx).toBeGreaterThan(reqIdx);
    const identity = body.answer.indexOf('本人確認書類');
    expect(identity).toBeGreaterThan(reqIdx);
    expect(identity).toBeLessThan(conIdx);
    // 「お持ちの方」限定のカードが必須欄に混ざらない(=誤答の再発防止)。
    expect(body.answer.indexOf('マイナンバーカード')).toBeGreaterThan(conIdx);
    // 出典は手続きレコードの sourceIds。最終確認日付き(原則2)。
    expect(body.citations.length).toBeGreaterThan(0);
    expect(body.citations.map((c) => c.sourceId)).toContain(SOURCE_ID);
    for (const cite of body.citations) {
      expect(cite.sourceId.startsWith('src-13112-')).toBe(true);
      expect(cite.lastVerifiedAt.length).toBeGreaterThan(0);
    }
  });

  it('OpenAI未設定でも必要書類は答えられる(RAG障害時のフォールバック・原則8)', async () => {
    forbidOpenAI();
    const res = await chat(baseEnv({ VECTORIZE: explodingVectorize, OPENAI_API_KEY: undefined }), {
      municipalityCode: '13112',
      question: '転入届の必要書類は？',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { abstained: boolean; answer: string };
    expect(body.abstained).toBe(false);
    expect(body.answer).toContain('■ 必ず必要なもの');
  });

  it('他区の名前を含む越境質問では構造化データを断定せず、従来のRAG経路へ委ねる(原則4)', async () => {
    stubOpenAI('(抜粋に無いため確認できません)\nSOURCES:');
    const vz = mockVectorize([{ id: CHUNK_ID, score: 0.7 }]);
    const res = await chat(baseEnv({ VECTORIZE: vz }), {
      municipalityCode: '13112',
      question: '江東区の転入届に必要な持ち物を教えてください。',
    });
    expect(res.status).toBe(200);
    // RAG経路に落ちたことを、Vectorizeが引かれたことで確認する。
    expect(vz.lastFilter).toEqual({ municipalityCode: '13112' });
    const body = (await res.json()) as { abstained: boolean };
    expect(body.abstained).toBe(true);
  });

  // なぜ: 本番実測(2026-08-08)で「転入届に必要な持ち物は？マイナンバーカードは必要ですか？」のような
  // 1文に複数手続きを含む質問が構造化経路から外れてRAGへ落ち、そのRAG回答が必須の本人確認書類を
  // 落としていた(葛飾・江戸川)。複数一致時も手続き名つきで並べて答えることを固定する。
  it('1文に複数の手続きを含む書類質問でも構造化データで答える(RAGへ落ちない)', async () => {
    forbidOpenAI();
    const res = await chat(baseEnv({ VECTORIZE: explodingVectorize }), {
      municipalityCode: '13112',
      question: '転入届に必要な持ち物は？マイナンバーカードは必要ですか？',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { answer: string; abstained: boolean };
    expect(body.abstained).toBe(false);
    // 先に言及された転入届が先頭。必須の本人確認書類が落ちない(これが誤答の再発防止点)。
    expect(body.answer).toContain('■ 必ず必要なもの');
    expect(body.answer).toContain('本人確認書類');
    const juminIdx = body.answer.indexOf('転入届');
    expect(juminIdx).toBeGreaterThan(-1);
  });

  it('手続きが特定できない書類質問はRAG経路へ委ねる(断定しない)', async () => {
    stubOpenAI('回答。\nSOURCES: ' + SOURCE_ID);
    const vz = mockVectorize([{ id: CHUNK_ID, score: 0.7 }]);
    const res = await chat(baseEnv({ VECTORIZE: vz }), {
      municipalityCode: '13112',
      question: '窓口へ持参するものはありますか？',
    });
    expect(res.status).toBe(200);
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
    // なぜ: 杉並(13115)・千代田(13101)・品川(13109)・大田(13111)は人手レビュー承認により
    // supported=trueへ、八王子市(13201)も2026-09-25の承認で supported=true へ変わったため、
    // 未対応自治体のfixtureとして未整備の立川市(13202、市部)を使う。
    const vz = mockVectorize([]);
    const res = await chat(baseEnv({ VECTORIZE: vz }), {
      municipalityCode: '13202', // 立川(未対応)
      question: 'ごみの出し方は?',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { answer: string; abstained: boolean };
    expect(body.abstained).toBe(true);
    expect(body.answer).toContain('立川市');
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
