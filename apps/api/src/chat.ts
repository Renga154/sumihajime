import type { Context } from 'hono';
import {
  chatRequestSchema,
  chatResponseSchema,
  type ChatCitation,
  type ProcedureVersion,
} from '@tmn/schemas';
import {
  ABSTAIN_ANSWER,
  RateLimiter,
  buildMessages,
  chatComplete,
  confidenceFromScore,
  embedText,
  hasDocumentIntent,
  isHoldAnswer,
  mentionsOtherMunicipality,
  orderByDocumentPosition,
  parseAnswer,
  orderedQuestionCategories,
  renderVerifiedDocumentAnswers,
  rerankByProcedureIntent,
  selectDocumentProcedures,
  selectMatches,
  shouldAbstain,
  validateCitations,
  type Confidence,
  type PromptChunk,
} from '@tmn/rag';
import { logEvent } from './log.js';
import {
  getMunicipality,
  getOtherMunicipalityNames,
  getProcedureVersions,
  getRagChunks,
  getSourcesByIds,
  type Bindings,
  type MunicipalityRow,
} from './db.js';

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

// なぜ: 生成プロンプトへ渡す抜粋数(LLMのコンテキスト予算)。
const TOP_K = 8;
// なぜ: ベクトル検索で取得する候補プール数。TOP_Kより広く取り、決定論的な手続き意図リランク
// (rerankByProcedureIntent)で「質問が主題とする手続き」のチャンクを TOP_K 内へ引き上げるための余地。
// コーパス拡張(世田谷=90チャンク; 学校16/保育12が転入届に頻繁言及)で、resident_registration の
// 正チャンクが埋め込み類似度の上位6から押し出される回帰への対策。returnMetadata:'none' のため
// Vectorize は topK を広めに取れる。
// なぜ23区化(2026-08-07)でも 50 のままでよいか: 検索は municipalityCode の $eq フィルタで
// **1自治体に閉じている**ため、候補プールの母数は「全コーパス1756チャンク」ではなく「その区の
// チャンク数」。23区で最大なのは品川162(次いで世田谷108・足立106)で、これは7区時点の最大値と
// 同じ(品川は7区に含まれていた)。すなわち区あたりの混雑度は増えておらず、FETCH_K の据え置きは
// 実測済みの条件と等価。区あたりチャンク数がこれを大きく超えるデータ追加時は再測定すること。
const FETCH_K = 50;
// なぜ: 手続き意図リランクで先頭へ昇格させる「一致カテゴリ」チャンクの上限(TOP_K=8 のうち6枠)。
// 残り2枠は検索スコア最上位に確保する。1カテゴリのチャンク数が TOP_K 以上ある区では、昇格だけで
// 窓が埋まり検索最上位が1件も渡らないため(本番実測: 練馬区マイナンバー継続利用。答えは転入届
// ページ側にあり保留へ退行した)。詳細は packages/rag/src/intent.ts の maxPromoted。
//
// なぜ TOP_K を 6→8 に広げたうえで上限6にしたか(2026-08-07 実測): 23区には1手続きの案内を
// 1枚の巨大ページに集約した区があり、1カテゴリだけで数十チャンクになる(品川のmy_numberは52、
// 港の子ども医療は11)。似た節が大量に並ぶため類似度の差が小さく、答えの節が窓の直下に沈む
// (実測: 品川 my_number-001#23 は score 0.534 で全体10位、窓の8件は 0.543〜0.623 とわずか0.009差)。
// 窓6・上限4では 港 子ども医療15日 / 葛飾 子ども医療3か月 / 品川 が保留へ退行した。TOP_K=8・上限6なら
// 一致カテゴリの枠数は従来(6)を下回らず、検索最上位2件も必ず通る=どちらの取りこぼしも起きない。
// TOP_K をさらに 12 まで広げても解けないケース(品川の「いつまでに」)は検索ではなく生成側の
// 言い回し依存であることを実測で確認済みのため、窓は必要最小限の8に留める(distractor増を避ける)。
const MAX_PROMOTED = 6;
// なぜ上限2件か: 1文で複数の手続きを尋ねられたとき、該当手続きを手続き名つきで並べて答える
// (どれか1つを推測で選ばない)。ただし際限なく並べると回答が長くなり要点が埋もれるため、
// 質問文で先に言及された2件までに留める。3件以上を1文で尋ねる質問は実測で観測していない。
const MAX_DOCUMENT_PROCEDURES = 2;
const TIMEOUT_MS = 15_000;
const DEFAULT_MIN_SCORE = 0.3;

// なぜ: 分離isolate間では共有されないため厳密なグローバル制限ではない(DoS緩和の第一防波堤)。
const limiter = new RateLimiter(10, 10 / 60);

function abstainBody(confidence: Confidence = 'unknown', answer: string = ABSTAIN_ANSWER) {
  return chatResponseSchema.parse({ answer, citations: [], confidence, abstained: true });
}

/**
 * なぜ: 引用は必ず承認済み台帳(sources)の権威情報へ解決する。lastVerifiedAt を持たない行は
 * 「最終確認日を示せない出典」なので採用しない(原則2)。RAG経路・構造化データ経路で共通。
 */
async function resolveCitations(
  db: Bindings['DB'],
  sourceIds: readonly string[],
): Promise<ChatCitation[]> {
  const sourceMap = await getSourcesByIds(db, [...sourceIds]);
  const citations: ChatCitation[] = [];
  for (const sid of sourceIds) {
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
  return citations;
}

/**
 * 必要書類・持ち物の質問を **人手レビュー済みの構造化データ** で答える経路(ADR-010 案A)。
 *
 * なぜLLMに再導出させないか: 自治体ページは持ち物を複数の並列ブロック(場合分けの表・上位の共通節)で
 * 書き、生成モデルは1ブロックだけを読んで他ブロックの無条件必須項目を落とす(本番実測: 江戸川で
 * 「お持ちの方」限定のカードを唯一の必須物と断定、千代田で転出証明書欠落、葛飾で本人確認書類欠落)。
 * requiredDocuments[] は required/conditional の区別と sourceIds・lastVerifiedAt を持つ人手承認済み
 * データで、既にチェックリストAPIが同じ値を返している。チャットだけが生HTMLからLLMに再導出させて
 * いたのが誤答の原因であり、CLAUDE.md 原則1「該当判定をLLMへ任せない」の趣旨にも反していた。
 *
 * 適用条件(すべて満たすときのみ。ひとつでも欠ければ null を返し従来のRAG経路へ委ねる):
 * - 質問が書類・持ち物を主題にしている(決定論的キーワード判定)
 * - 質問が主題とする手続きが1つ以上に決まる(複数一致した場合は**言及順に最大2件**を手続き名つきで
 *   並べて答える。どれか1つを推測で選ばない)
 * - その手続きの検証済みレコードが存在し、dataStatus=verified で requiredDocuments が空でない
 * - 質問が選択自治体**以外**の自治体名を含まない(越境は規則3を持つRAG経路へ委ねる)
 * - 出典が承認済み台帳へ解決でき、最終確認日を示せる
 */
async function tryVerifiedDocumentAnswer(
  db: Bindings['DB'],
  municipality: MunicipalityRow,
  question: string,
): Promise<{ answer: string; citations: ChatCitation[] } | null> {
  // 1) 純粋な判定を先に済ませ、該当しない質問ではD1を一切引かない。
  if (!hasDocumentIntent(question)) return null;
  // なぜ「言及順の配列」か(本番実測 2026-08-08): 利用者は1文で複数の手続きを尋ねる
  // (「転入届に必要な持ち物は？マイナンバーカードは必要ですか？」)。以前はカテゴリが複数一致すると
  // 構造化経路を諦めていたが、その戻り先のRAGこそが必須の本人確認書類を落としていた(葛飾・江戸川)。
  // 日本語では主題が先に述べられるため言及順に並べ、先頭から該当手続きを採用する。
  const categories = orderedQuestionCategories(question);
  if (categories.length === 0) return null;

  const [procedures, otherNames] = await Promise.all([
    getProcedureVersions(db, municipality.code),
    getOtherMunicipalityNames(db, municipality.code),
  ]);

  if (mentionsOtherMunicipality(question, municipality.name, otherNames)) return null;

  // 選択と落選の判定は純関数に持たせている。以前はここのループが「採用できなかったcategory」を
  // 変数にも残さず捨てており、利用者が「聞いたことの片方が無視された」と気づけなかった。
  // 落選が戻り値の一部になったので、無言の欠落は型の上で起こり得ない(原則3)。
  const { selected, unresolved } = selectDocumentProcedures<ProcedureVersion>(
    categories,
    [...procedures.values()],
    MAX_DOCUMENT_PROCEDURES,
  );
  if (selected.length === 0) return null;

  const citations = await resolveCitations(
    db,
    selected.flatMap((p) => p.sourceIds),
  );
  if (citations.length === 0) return null;

  // 落選した話題にも公式ページの導線を付ける。D1アクセスは純関数へ持ち込まない方針のため、
  // 出典IDからのURL解決はここで行う。解決できなければ文面が一般的な誘導へ退避する。
  const unresolvedSources = await getSourcesByIds(
    db,
    unresolved.flatMap((topic) => topic.sourceIds),
  );
  const unresolvedWithUrls = unresolved.map((topic) => {
    const url = topic.sourceIds.map((sid) => unresolvedSources.get(sid)?.sourceUrl).find(Boolean);
    return url ? { ...topic, officialUrl: url } : topic;
  });

  return {
    answer: renderVerifiedDocumentAnswers(
      municipality.name,
      selected.map((procedure) => ({
        title: procedure.title,
        requiredDocuments: procedure.requiredDocuments,
        ...(procedure.dueDescription ? { dueDescription: procedure.dueDescription } : {}),
        ...(procedure.contact ? { contact: procedure.contact } : {}),
        lastVerifiedAt: procedure.lastVerifiedAt,
      })),
      unresolvedWithUrls,
    ),
    citations,
  };
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

  // 5) 検証済み構造化データ経路(ADR-010 案A)。必要書類・持ち物の質問は、人手承認済みの
  //    requiredDocuments[](required/conditional の区別付き)を根拠に決定論的へ答える。
  //    LLM・ベクトル検索より**前**に置くのは、(a)生HTMLからの再導出を行わせないため、
  //    (b)RAG基盤(OpenAI/Vectorize)が落ちていてもこの回答は返せるため(原則8)。
  const verified = await tryVerifiedDocumentAnswer(env.DB, municipality, question);
  if (verified) {
    logEvent({
      requestId,
      event: 'chat.answered.verified_documents',
      municipalityCode: code,
      latencyMs: Date.now() - start,
      count: verified.citations.length,
      abstained: false,
    });
    return c.json(
      chatResponseSchema.parse({
        answer: verified.answer,
        citations: verified.citations,
        // なぜ 'high' 固定か: 人手レビュー承認済みデータをそのまま提示しているため。この値はUIには
        // 表示せず(ADR-010「確度表示の削除」)、評価・計測のための内部値として残す。
        confidence: 'high',
        abstained: false,
      }),
    );
  }

  // 6) OpenAI設定(キーはsecret。値は一切ログ・レスポンスに出さない)。
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
      topK: FETCH_K,
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

    // なぜ: 決定論的な手続き意図リランク。質問が主題とする手続き(category)のチャンクを候補プールの
    // 先頭へ安定昇格させ、上位 TOP_K のみを生成へ渡す。これで埋め込み類似度で沈んだ正手続きチャンク
    // (例: 転入届の質問に対する resident_registration)が、学校/保育チャンクに押し出されず載る。
    // 意図が判定できない質問は no-op(検索スコア順のまま)。LLM判定は用いない(決定論原則)。
    // MAX_PROMOTED で「意図一致カテゴリの昇格」を窓の一部に留め、残り(TOP_K-MAX_PROMOTED)は
    // 検索スコア最上位を必ず通す。カテゴリ判定が実際の所在とずれた区(例: 継続利用の期限を
    // 転入届ページに書く区)でも答えのチャンクが窓から落ちない(intent.ts の maxPromoted 参照)。
    const window = rerankByProcedureIntent(question, orderedChunks, MAX_PROMOTED).slice(0, TOP_K);

    // なぜ: **どのチャンクを見せるか**は上の検索+リランクで決め、**どの順で見せるか**は原文順へ戻す。
    // 自治体ページは同じ手続きの持ち物・条件を複数の並列ブロック(場合分けの表、上位の共通節)で書く。
    // スコア順のまま提示すると節が原文と逆順・飛び飛びで並び、モデルは共通節と場合分けの関係を
    // 読み取れず1ブロックだけを根拠に答える。文書順へ戻すと統合が効く(実測 2026-08-08: 書類系の
    // 失敗3件→1件、他ケースの退行なし)。純関数・再索引不要(ADR-010 案C)。
    const promptSource = orderByDocumentPosition(window);

    const allowedSourceIds = new Set(promptSource.map((r) => r.sourceId));
    const promptChunks: PromptChunk[] = promptSource.map((r) => ({
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
    // なぜ: 本文の主文(先頭)が「確認できません」等の保留語で、なお SOURCES に抜粋を列挙している
    // 矛盾ケース(保留を主文としつつ引用付き)は、引用付きの実回答として提示しない。標準の保留応答へ差し替える
    // (§11.5/§11.6)。手続き・自治体に依存しない一般規則。
    if (isHoldAnswer(body)) {
      logEvent({
        requestId,
        event: 'chat.abstained',
        municipalityCode: code,
        latencyMs: Date.now() - start,
        abstained: true,
      });
      return c.json(abstainBody('unknown'));
    }
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
    const citations = await resolveCitations(env.DB, validSourceIds);
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
