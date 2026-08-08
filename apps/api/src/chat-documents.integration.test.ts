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

// 3話題を1文で尋ねる質問。上限(MAX_DOCUMENT_PROCEDURES=2)を必ず超えるため、3番目は回答へ載らない。
// 転入届・マイナンバー・国民健康保険は23区すべてで verified かつ requiredDocuments が非空
// (data/normalized 実測)なので、どの区でも「先頭2件が採用され、国民健康保険が落ちる」で確定する。
const COMPOUND_QUESTION =
  '転入届に必要な持ち物は？マイナンバーカードはどうすればいいですか？国民健康保険の手続きも教えてください';
const DROPPED_CATEGORY = 'national_health_insurance';
const DROPPED_LABEL = '国民健康保険';
const UNRESOLVED_HEADING = '■ この回答でご案内できなかったこと';

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

/**
 * なぜこの試験が要るか(2026-08-08): 回答に載せられなかった話題を利用者へ明示する仕組みは
 * packages/rag 側(selectDocumentProcedures / renderVerifiedDocumentAnswers)に実装済みだったが、
 * apps/api のハンドラが旧ループのままで**一度も呼ばれていなかった**。純関数側のテストは全て緑なのに
 * 本番の回答からは話題が黙って消える、という状態を検出できるのはこの経路試験だけである。
 * 「無言で落とさない」(原則3・9)を配線ごと固定する。
 */
describe('POST /api/chat — 回答へ載せられなかった話題は必ず本文で明示される', () => {
  it.each(WARDS)(
    '%s: 上限で落ちた話題を利用者向けの名前で示し、URLは承認済み台帳からのみ引く',
    async (code) => {
      const res = await ask(code, COMPOUND_QUESTION);
      expect(res.status).toBe(200);
      const body = (await res.json()) as ChatBody;
      expect(body.abstained).toBe(false);

      const noticeIdx = body.answer.indexOf(UNRESOLVED_HEADING);
      expect(noticeIdx, `${code}: 落選の注記が無い(話題が無言で消えている)`).toBeGreaterThan(-1);
      const notice = body.answer.slice(noticeIdx);
      expect(notice, `${code}: 落ちた話題名が示されていない`).toContain(DROPPED_LABEL);
      // 内部enum名を利用者へ見せない。
      expect(body.answer).not.toContain(DROPPED_CATEGORY);

      // 注記のURLは、その区の**最終確認日を持つ承認済み出典**だけから来ること(原則2・4)。
      const row = await db
        .prepare(
          'SELECT source_ids FROM procedure_versions WHERE municipality_code = ? AND canonical_type = ?',
        )
        .bind(code, DROPPED_CATEGORY)
        .first<{ source_ids: string }>();
      const sourceIds = row ? (JSON.parse(row.source_ids) as string[]) : [];
      const allowed: string[] = [];
      for (const sid of sourceIds) {
        const s = await db
          .prepare('SELECT source_url, last_verified_at FROM sources WHERE source_id = ?')
          .bind(sid)
          .first<{ source_url: string; last_verified_at: string | null }>();
        if (s?.last_verified_at) allowed.push(s.source_url);
      }

      const url = /https?:\/\/\S+?(?=）)/.exec(notice)?.[0];
      if (allowed.length > 0) {
        expect(url, `${code}: 承認済み出典があるのに公式URLを示していない`).toBeTruthy();
        expect(allowed, `${code}: 台帳外のURL ${url}`).toContain(url);
      } else {
        // 解決できない区では推測でURLを作らず、公式サイトへの一般的な導線に留める(原則3・5)。
        expect(url, `${code}: 根拠の無いURLを生成している`).toBeUndefined();
        expect(notice).toContain('公式サイトでご確認ください');
      }
    },
    30_000,
  );
});
