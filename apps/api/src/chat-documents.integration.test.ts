import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import type { VectorizeQueryable } from '@tmn/rag';
import { MUNICIPALITIES } from '@tmn/publish';
import { createTestDb, type TestDb } from '../test/d1-harness.js';
import app from './index.js';

/**
 * なぜ: 「必要書類の質問が**全対応区で**検証済みデータ経路に入る」ことを、ネットワーク非依存で固定する
 * (ADR-010)。
 *
 * この回帰を2度起こさないための試験である。実際に起きたこと(2026-08-08):
 * 1. 評価データセットの書類系ケースが23区化で全て失われ、UIのプレースホルダそのものの質問が未計測だった。
 * 2. 復活させた際、質問文に区名を前置していたため、利用者が実際に打つ「区名なし」の入力が未検証だった。
 * 3. 本番実測はデプロイのロールアウト中だと旧版に当たり、結果が版によってぶれる。
 *
 * ここでは本物のD1(Miniflare)+承認ゲートを通したシード+実際のWorkerコードを使い、
 * **LLMもVectorizeも呼ばずに**23区すべてを決定論的に検証する。呼ばれたら失敗するスタブを置くことで
 * 「構造化データ経路に入ったこと」自体を証明する(latencyや文面の推測に頼らない)。
 */

// なぜ台帳から導くか: 区を増やしたときに列挙の更新漏れで「新しい区だけ未検証」になるのを防ぐ。
const WARDS = MUNICIPALITIES.filter((m) => m.supported).map((m) => m.code);
// UIのプレースホルダと同じ、利用者が実際に打つ形(区名なし)。
const QUESTION = '転入届に必要な持ち物は？';

let harness: TestDb;
let db: D1Database;

beforeAll(async () => {
  harness = await createTestDb(WARDS);
  db = harness.db as unknown as D1Database;
}, 180_000);

afterAll(async () => {
  await harness.dispose();
  vi.unstubAllGlobals();
});

/** 呼ばれたら失敗する = 構造化データ経路に入ったことの証明。 */
const explodingVectorize: VectorizeQueryable = {
  query() {
    throw new Error('Vectorize must not be queried for document questions');
  },
};

function env() {
  return {
    DB: db,
    VECTORIZE: explodingVectorize,
    RAG_ENABLED: 'true',
    // OPENAI_API_KEY を敢えて渡さない。RAG経路へ落ちれば 503 になるため、
    // 200 が返ること自体が「LLMを使わずに答えた」ことの証明になる(原則8の縮退も兼ねる)。
    RAG_MIN_SCORE: '0.3',
  };
}

let ip = 0;
async function ask(code: string, question: string): Promise<Response> {
  ip += 1;
  return app.request(
    '/api/chat',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'CF-Connecting-IP': `10.9.${ip >> 8}.${ip & 255}`,
      },
      body: JSON.stringify({ municipalityCode: code, question }),
    },
    env(),
  );
}

interface ChatBody {
  answer: string;
  citations: { sourceId: string }[];
  abstained: boolean;
}

describe('POST /api/chat — 必要書類は23区すべてで検証済みデータ経路に入る (ADR-010)', () => {
  it.each(WARDS)(
    '%s: LLM・Vectorizeを使わず、requiredの公式文言を落とさず、conditionalを必須と断定しない',
    async (code) => {
      const res = await ask(code, QUESTION);
      expect(res.status).toBe(200);
      const body = (await res.json()) as ChatBody;
      expect(body.abstained).toBe(false);

      // D1の検証済みレコードを正とし、required が1件残らず本文に現れることを確認する。
      const row = await db
        .prepare(
          'SELECT title, required_documents FROM procedure_versions ' +
            "WHERE municipality_code = ? AND canonical_type = 'resident_registration'",
        )
        .bind(code)
        .first<{ title: string; required_documents: string }>();
      expect(row, `${code} に転入届の検証済みレコードが無い`).toBeTruthy();
      const docs = JSON.parse(row!.required_documents) as { label: string; status: string }[];
      const required = docs.filter((d) => d.status === 'required');
      const conditional = docs.filter((d) => d.status === 'conditional');

      expect(required.length, `${code}: required が0件`).toBeGreaterThan(0);
      for (const d of required) {
        expect(body.answer, `${code}: required の欠落 -> ${d.label}`).toContain(d.label);
      }

      // conditional は必ず別見出しの下(「お持ちの方」限定を唯一の必須物として断定しない)。
      if (conditional.length > 0) {
        const conIdx = body.answer.indexOf('■ 場合により必要なもの');
        expect(conIdx, `${code}: 条件付き見出しが無い`).toBeGreaterThan(-1);
        for (const d of conditional) {
          expect(
            body.answer.indexOf(d.label),
            `${code}: conditional が必須欄側にある`,
          ).toBeGreaterThan(conIdx);
        }
      }

      // 出典は自区のみ(原則4)。最終確認日つき。
      expect(body.citations.length).toBeGreaterThan(0);
      for (const c of body.citations) {
        expect(c.sourceId.startsWith(`src-${code}-`), `${code}: 他自治体出典 ${c.sourceId}`).toBe(
          true,
        );
      }
    },
    30_000,
  );
});
