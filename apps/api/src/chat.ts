import type { Context } from 'hono';
import { chatRequestSchema, chatResponseSchema, type ChatCitation } from '@tmn/schemas';
import {
  ABSTAIN_ANSWER,
  RateLimiter,
  buildMessages,
  chatComplete,
  confidenceFromScore,
  embedText,
  parseAnswer,
  selectMatches,
  shouldAbstain,
  validateCitations,
  type Confidence,
  type PromptChunk,
} from '@tmn/rag';
import { logEvent } from './log.js';
import { getMunicipality, getRagChunks, getSourcesByIds, type Bindings } from './db.js';

/**
 * POST /api/chat — 自治体スコープ付きRAGチャット(T-013 / FR-016〜019 / §11)。
 *
 * 設計上の要:
 * - RAG_ENABLED!=='true' の間は 503 {disabled:true}(UIはパネルを隠す。既存機能は無傷)。
 * - municipalityCode は supported 自治体のみ許可。検索は Vectorize の $eq で**サーバー側強制**フィルタし、
 *   さらに D1 rag_chunks の municipality_code でも二重チェックする(§11.3 他自治体混入=重大障害)。
 * - 根拠(閾値以上のマッチ)が無ければ保留(§11.5「確認できません」+公式誘導)。
 * - 生成応答は末尾 SOURCES 行を解析し、検索でヒットした sourceId に解決できる引用のみ採用。
 *   1件も解決できなければ保留へ差し替える(§11.6 出力検証)。
 * - レート制限(IP単位トークンバケット 10req/分、超過429)。タイムアウト15秒。
 * - ログに**質問本文・回答本文を残さない**(municipalityCode/event/latency/abstained/引用数のみ)。
 */

type Variables = { requestId: string };
type Env = { Bindings: Bindings; Variables: Variables };

const TOP_K = 6;
const TIMEOUT_MS = 15_000;
const DEFAULT_MIN_SCORE = 0.3;

// なぜ: 分離isolate間では共有されないため厳密なグローバル制限ではない(DoS緩和の第一防波堤)。
const limiter = new RateLimiter(10, 10 / 60);

function abstainBody(confidence: Confidence = 'unknown', answer: string = ABSTAIN_ANSWER) {
  return chatResponseSchema.parse({ answer, citations: [], confidence, abstained: true });
}

/**
 * GET /api/chat/availability — RAGが有効か(RAG_ENABLED)を軽量に返す。
 * レート制限・秘密・入力を伴わない。UIはこれでチャットパネルの表示可否を決める。
 */
export function handleChatAvailability(c: Context<Env>): Response {
  return c.json({ enabled: c.env.RAG_ENABLED === 'true' } as const);
}

export async function handleChat(c: Context<Env>): Promise<Response> {
  const start = Date.now();
  const requestId = c.get('requestId');
  const env = c.env;

  // 1) フィーチャーフラグ(最優先・最安)。
  if (env.RAG_ENABLED !== 'true') {
    return c.json({ disabled: true } as const, 503);
  }

  // 2) レート制限(IP単位)。
  const ip = c.req.header('CF-Connecting-IP') ?? 'unknown';
  if (!limiter.allow(ip)) {
    logEvent({ requestId, event: 'chat.rate_limited', status: 429 });
    return c.json(
      {
        error: {
          code: 'rate_limited',
          message: '短時間に多くのご質問をいただきました。1分ほど時間をおいて再度お試しください。',
          requestId,
        },
      },
      429,
    );
  }

  // 3) 入力検証(question は最大500字)。
  let json: unknown;
  try {
    json = await c.req.json();
  } catch {
    return c.json(
      {
        error: {
          code: 'invalid_json',
          message: 'リクエストを読み取れませんでした。もう一度お試しください。',
          requestId,
        },
      },
      400,
    );
  }
  const parsed = chatRequestSchema.safeParse(json);
  if (!parsed.success) {
    return c.json(
      {
        error: {
          code: 'invalid_chat_request',
          message: '質問の形式に誤りがあります(質問は500文字以内で入力してください)。',
          requestId,
        },
      },
      422,
    );
  }
  const { municipalityCode: code, question } = parsed.data;

  // 4) 自治体スコープ: supported 自治体のみ許可。未対応は保留(対象外を明示+公式誘導)。
  const municipality = await getMunicipality(env.DB, code);
  if (!municipality) {
    return c.json(
      {
        error: {
          code: 'municipality_unknown',
          message: `自治体コード ${code} は登録されていません。`,
          requestId,
        },
      },
      404,
    );
  }
  if (!municipality.supported) {
    logEvent({
      requestId,
      event: 'chat.abstained',
      municipalityCode: code,
      latencyMs: Date.now() - start,
      abstained: true,
    });
    const guide = municipality.officialUrl
      ? `${municipality.name}は現在このチャットの対応対象外です。お手続きは${municipality.name}の公式サイト(${municipality.officialUrl})でご確認ください。`
      : `${municipality.name}は現在このチャットの対応対象外です。${municipality.name}の公式サイトでご確認ください。`;
    return c.json(abstainBody('unknown', guide));
  }

  // 5) OpenAI設定(キーはsecret。値は一切ログ・レスポンスに出さない)。
  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) {
    logEvent({ requestId, event: 'chat.unavailable', municipalityCode: code, status: 503 });
    return c.json(
      {
        error: {
          code: 'chat_unavailable',
          message: 'ただいまチャットをご利用いただけません。時間をおいて再度お試しください。',
          requestId,
        },
      },
      503,
    );
  }
  const baseURL = env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1';
  const chatModel = env.OPENAI_CHAT_MODEL ?? 'gpt-4o-mini';
  const embedModel = env.OPENAI_EMBED_MODEL ?? 'text-embedding-3-small';
  const minScore = Number(env.RAG_MIN_SCORE ?? '') || DEFAULT_MIN_SCORE;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    // 6) 質問を埋め込み → Vectorize を municipalityCode 強制フィルタで検索。
    const queryVector = await embedText(question, embedModel, {
      apiKey,
      baseURL,
      signal: controller.signal,
    });

    if (!env.VECTORIZE) {
      logEvent({ requestId, event: 'chat.unavailable', municipalityCode: code, status: 503 });
      return c.json(
        {
          error: {
            code: 'chat_unavailable',
            message: 'ただいまチャットをご利用いただけません。時間をおいて再度お試しください。',
            requestId,
          },
        },
        503,
      );
    }

    const result = await env.VECTORIZE.query(queryVector, {
      topK: TOP_K,
      filter: { municipalityCode: code },
      returnMetadata: 'none',
    });
    const matches = result.matches ?? [];

    // 7) 閾値未満/0件 → 保留(§11.5)。
    if (shouldAbstain(matches, minScore)) {
      logEvent({
        requestId,
        event: 'chat.abstained',
        municipalityCode: code,
        latencyMs: Date.now() - start,
        abstained: true,
      });
      return c.json(abstainBody('unknown'));
    }

    const selected = selectMatches(matches, minScore);

    // 8) D1 から本文取得(municipality_code で二重スコープ強制)。
    const chunkRows = await getRagChunks(
      env.DB,
      code,
      selected.map((m) => m.id),
    );
    // なぜ: Vectorizeが万一スコープ外idを返しても、D1側フィルタで落ちる(=chunkRowsに現れない)。
    const orderedChunks = selected
      .map((m) => chunkRows.get(m.id))
      .filter((r): r is NonNullable<typeof r> => r !== undefined);

    if (orderedChunks.length === 0) {
      logEvent({
        requestId,
        event: 'chat.abstained',
        municipalityCode: code,
        latencyMs: Date.now() - start,
        abstained: true,
      });
      return c.json(abstainBody('unknown'));
    }

    const allowedSourceIds = new Set(orderedChunks.map((r) => r.sourceId));
    const promptChunks: PromptChunk[] = orderedChunks.map((r) => ({
      sourceId: r.sourceId,
      title: r.title,
      text: r.text,
    }));

    // 9) 生成(抜粋の範囲でのみ回答・抜粋内命令は無視・SOURCES必須)。
    const messages = buildMessages(municipality.name, question, promptChunks);
    const raw = await chatComplete(messages, chatModel, {
      apiKey,
      baseURL,
      signal: controller.signal,
    });

    // 10) 出力検証: SOURCES行を解析し、検索ヒット済みsourceIdに解決できる引用のみ採用。
    const { body, citedSourceIds } = parseAnswer(raw);
    const validSourceIds = validateCitations(citedSourceIds, allowedSourceIds);
    if (validSourceIds.length === 0 || body.length === 0) {
      // 引用なし/本文なし → 捏造の疑い。保留へ差し替え(§11.6)。
      logEvent({
        requestId,
        event: 'chat.abstained',
        municipalityCode: code,
        latencyMs: Date.now() - start,
        abstained: true,
      });
      return c.json(abstainBody('unknown'));
    }

    // 11) 引用を台帳(sources)の権威情報に解決して citations[] を組む。
    const sourceMap = await getSourcesByIds(env.DB, validSourceIds);
    const citations: ChatCitation[] = [];
    for (const sid of validSourceIds) {
      const s = sourceMap.get(sid);
      if (!s || !s.lastVerifiedAt) continue;
      citations.push({
        sourceId: s.sourceId,
        title: s.sourceTitle,
        ownerOrganization: s.ownerOrganization,
        url: s.sourceUrl,
        lastVerifiedAt: s.lastVerifiedAt,
      });
    }
    if (citations.length === 0) {
      logEvent({
        requestId,
        event: 'chat.abstained',
        municipalityCode: code,
        latencyMs: Date.now() - start,
        abstained: true,
      });
      return c.json(abstainBody('unknown'));
    }

    const topScore = selected[0]?.score;
    const responseBody = chatResponseSchema.parse({
      answer: body,
      citations,
      confidence: confidenceFromScore(topScore),
      abstained: false,
    });

    // 12) ログ: 質問・回答本文は残さない。件数・保留フラグ・レイテンシのみ。
    logEvent({
      requestId,
      event: 'chat.answered',
      municipalityCode: code,
      latencyMs: Date.now() - start,
      count: citations.length,
      abstained: false,
    });
    return c.json(responseBody);
  } catch (err) {
    // OpenAI障害・タイムアウト等はチャットのみのエラー(チェックリスト経路には影響しない)。
    const aborted = err instanceof Error && err.name === 'AbortError';
    logEvent({
      requestId,
      event: aborted ? 'chat.timeout' : 'chat.error',
      municipalityCode: code,
      latencyMs: Date.now() - start,
      status: 503,
    });
    return c.json(
      {
        error: {
          code: 'chat_unavailable',
          message:
            'ただいまチャットの回答を生成できませんでした。時間をおいて再度お試しください（チェックリスト機能は引き続きご利用いただけます）。',
          requestId,
        },
      },
      503,
    );
  } finally {
    clearTimeout(timer);
  }
}
