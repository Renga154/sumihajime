import { Hono } from 'hono';
import type { Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import {
  checklistRequestSchema,
  checklistResponseSchema,
  facilitiesResponseSchema,
  municipalitiesResponseSchema,
  municipalityCodeSchema,
  procedureDetailResponseSchema,
  serviceStatsSchema,
  sourcesResponseSchema,
  wasteSchedulesResponseSchema,
  wardDifferencesResponseSchema,
  wasteSortingSearchResponseSchema,
  wasteSortingSummaryResponseSchema,
  type Source,
  type SourceLedgerEntry,
} from '@tmn/schemas';
import {
  buildWardDifferences,
  evaluate,
  moveOutScheduledDateImpact,
  WARD_DIFFERENCE_TOPICS,
  type WardDifferenceInput,
  type WardDifferenceSourceRef,
} from '@tmn/rules';
import { isKnownSpaPath, sitemapPaths } from '@tmn/domain';
import { API_SECURITY_HEADERS, withDocumentSecurityHeaders } from './headers.js';
import { logEvent } from './log.js';
import { buildTasks } from './checklist.js';
import { handleChat, handleChatAvailability } from './chat.js';
import { scheduled } from './drift.js';
import { assessHealth } from './health.js';
import { JSON_BODY_LIMIT_BYTES, fail, requireJsonContentType, type ApiEnv } from './http.js';
import { API_VERSION } from './version.js';
import type { Bindings, DriftMark } from './db.js';
import {
  getActiveDriftMarks,
  getAllRuleSets,
  countPublishedProcedures,
  getDriftSummary,
  getFacilities,
  getMunicipalitiesWithCoverage,
  getMunicipality,
  getApprovedSources,
  getProcedureVersion,
  getProcedureVersions,
  getProcedureVersionsForIds,
  getRuleSet,
  getServiceStats,
  getSourcesByIds,
  getWasteAreas,
  getWasteDataset,
  getWasteSchedules,
  getWasteSortingCategorySummary,
  hasWasteSortingData,
  searchWasteSortingItems,
} from './db.js';

/**
 * 単一Cloudflare Worker: /api/* を提供し(run_worker_first)、それ以外は静的SPAアセット。
 * 全エンドポイント: Zod入力検証 + 構造化ログ(allowlist, PIIなし) + 「次の行動が分かる」エラー文面。
 * データはD1からのみ読み出す(LLM・外部ネットワーク呼び出しはチェックリスト経路に一切入れない)。
 *
 * 静的アセットで解決しなかったリクエストもここへ落ちてくる(wrangler.jsonc の
 * not_found_handling: "none")。ファイル末尾のフォールバックが既知ルートかどうかで
 * 200 / 404 を出し分ける。
 */

type Env = ApiEnv;

export const app = new Hono<Env>();

/** リクエストIDを採番(ログ相関用。PIIではない)。 */
app.use('/api/*', async (c, next) => {
  c.set('requestId', crypto.randomUUID());
  await next();
});

/**
 * 想定外の例外(D1障害・スキーマ検証の失敗など)の受け皿。
 *
 * なぜ要るか: 以前は onError が無く、ハンドラが投げると Hono 既定の素の "Internal Server Error"
 * (text/plain・requestId なし)が返っていた。画面は errorResponseSchema で読めずに汎用文面へ落ち、
 * ログには何も残らないため、利用者の報告と突き合わせる手がかりがなかった。
 * 標準のエラー形で返し、allowlist ログへ error.unhandled として記録する(例外のメッセージ・
 * スタック・リクエスト本文は出さない。上流の応答断片や入力値が混ざり得るため)。
 */
app.onError((_err, c) => {
  // requestId は /api/* のミドルウェアより前で落ちた場合にも必ず持たせる。
  if (!c.get('requestId')) c.set('requestId', crypto.randomUUID());
  return fail(
    c,
    500,
    'internal_error',
    'サーバーで問題が発生しました。時間をおいて再度お試しください（チェックリストの控えと各手続きの公式ページは引き続きご利用いただけます）。',
    { event: 'error.unhandled' },
  );
});

/**
 * JSON を受け取る POST の入口制限: 本文の大きさ(8KB)と Content-Type(application/json)。
 * なぜ: 巨大な本文を JSON.parse させる負荷と、第三者サイトからの「単純リクエスト」(プリフライト
 * 無しで送れる text/plain 等)による悪用を、ハンドラに届く前に断つ(理由の詳細は http.ts)。
 */
const jsonBodyGuards = [
  bodyLimit({
    maxSize: JSON_BODY_LIMIT_BYTES,
    onError: (c) =>
      fail(
        c as Context<Env>,
        413,
        'payload_too_large',
        '送信内容が大きすぎます。入力内容を短くしてから、もう一度お試しください。',
      ),
  }),
  requireJsonContentType(),
] as const;
app.use('/api/chat', ...jsonBodyGuards);
app.use('/api/checklists', ...jsonBodyGuards);

/**
 * /api/* のJSON応答へセキュリティヘッダを付ける(REQUIREMENTS §16.3)。
 * 静的アセット側は apps/web/public/_headers が同等の値を付ける(理由は headers.ts のコメント)。
 */
app.use('/api/*', async (c, next) => {
  await next();
  for (const [name, value] of Object.entries(API_SECURITY_HEADERS)) {
    c.res.headers.set(name, value);
  }
});

/** ADR-014: 巡回マークを根拠カードの2項目へ写す(未検知なら空オブジェクト=項目を出さない)。 */
function driftFields(mark: DriftMark | undefined) {
  return mark ? { driftDetectedOn: mark.detectedOn, driftKind: mark.status } : {};
}

/**
 * 台帳の1行 → 公開してよい列だけの射影(GET /api/sources と GET /api/procedures/:id で共通)。
 *
 * なぜ1つにするか: 以前は2つのエンドポイントがそれぞれ手書きで射影しており、片方だけ notes を
 * 出すなど食い違っていた(2026-08-08 にはレビュー担当者名が片方から漏れた前歴もある)。
 *
 * notes を公開しない判断(2026-09-29): notes は取り込み・監査の作業メモ(データ欠落の補完経緯、
 * 決裁の経緯など)で、利用者向けの文面として書かれていない。web のどの画面も表示しておらず、
 * GET /api/sources は当初から内部メタとして除外していた。出す理由が無いものは出さない。
 */
function publicSourceView(s: Source): SourceLedgerEntry {
  return {
    sourceId: s.sourceId,
    sourceTitle: s.sourceTitle,
    ownerOrganization: s.ownerOrganization,
    ...(s.municipalityCode ? { municipalityCode: s.municipalityCode } : {}),
    category: s.category,
    sourceUrl: s.sourceUrl,
    sourceType: s.sourceType,
    license: s.license,
    attributionText: s.attributionText,
    ...(s.lastVerifiedAt ? { lastVerifiedAt: s.lastVerifiedAt } : {}),
    updateFrequency: s.updateFrequency,
    ...(s.effectiveFrom ? { effectiveFrom: s.effectiveFrom } : {}),
    ...(s.effectiveTo ? { effectiveTo: s.effectiveTo } : {}),
  };
}

/** クエリの municipality を検証(全read系で必須)。 */
function requireMunicipalityQuery(c: Context<Env>): string | null {
  const raw = c.req.query('municipality');
  const parsed = municipalityCodeSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/**
 * GET /api/health : 死活応答 + 自己判定(A-1-4) + 定期巡回の要約(ADR-014 §3)。
 * 外形監視(ops/monitoring)は「HTTP 200 かつ status === 'ok'」だけを見る。判定の中身は
 * health.ts(純関数)にあり、ここは D1 から材料を集めるだけ。
 * ok は「Worker が応答している」の意味で常に true(既存の利用者向けに形を変えない)。
 * D1 が読めなくても Worker 自体の死活は答えるべきなので、HTTP は常に 200。
 */
app.get('/api/health', async (c) => {
  let drift: Awaited<ReturnType<typeof getDriftSummary>> | null = null;
  let publishedProcedures: number | null = null;
  let dbReachable = false;
  if (c.env?.DB) {
    try {
      [drift, publishedProcedures] = await Promise.all([
        getDriftSummary(c.env.DB),
        countPublishedProcedures(c.env.DB),
      ]);
      dbReachable = true;
    } catch {
      drift = null;
      publishedProcedures = null;
    }
  }
  const { status, issues } = assessHealth({
    dbReachable,
    publishedProcedures,
    drift,
    now: new Date(),
  });
  return c.json({ ok: true, version: API_VERSION, status, issues, drift });
});

/**
 * POST /api/chat: 自治体スコープ付きRAGチャット(T-013)。実装は chat.ts。
 * RAG_ENABLED!=='true' なら 503 {disabled:true} を返す(UIはパネルを隠す)。
 */
app.get('/api/chat/availability', handleChatAvailability);
app.post('/api/chat', handleChat);

/** FR-001/021: 対応自治体一覧 + 公式導線 + カバレッジ。 */
app.get('/api/municipalities', async (c) => {
  const start = Date.now();
  const requestId = c.get('requestId');
  const rows = await getMunicipalitiesWithCoverage(c.env.DB);
  const body = municipalitiesResponseSchema.parse(rows);
  logEvent({
    requestId,
    event: 'municipalities.list',
    latencyMs: Date.now() - start,
    count: body.length,
  });
  return c.json(body);
});

/** POST /api/checklists: Profile → 決定論的チェックリスト(§14.2 GeneratedTask[])。 */
app.post('/api/checklists', async (c) => {
  const start = Date.now();
  const requestId = c.get('requestId');

  let json: unknown;
  try {
    json = await c.req.json();
  } catch {
    return fail(
      c,
      400,
      'invalid_json',
      'リクエストボディをJSONとして読み取れませんでした。入力内容をご確認ください。',
    );
  }

  const parsed = checklistRequestSchema.safeParse(json);
  if (!parsed.success) {
    return fail(
      c,
      422,
      'invalid_profile',
      '入力内容に不足または誤りがあります。各ステップの必須項目(自治体・引越し日・世帯・条件)をご確認のうえ、もう一度お試しください。',
    );
  }
  const profile = parsed.data;
  const code = profile.destination.municipalityCode;

  const municipality = await getMunicipality(c.env.DB, code);
  if (!municipality) {
    // 入力値(自治体コード)は文面へ埋め込まない(反射させない。コードはログ側に残る)。
    return fail(
      c,
      404,
      'municipality_unknown',
      '指定の自治体は登録されていません。対応自治体の一覧からお選びください。',
      { municipalityCode: code },
    );
  }
  if (!municipality.supported) {
    // FR-021: 未対応でも公式サイトへの導線を返す。
    return fail(
      c,
      409,
      'municipality_not_supported',
      `${municipality.name}は現在このサービスの対応対象外です。お手続きは${municipality.name}の公式サイトでご確認ください。`,
      { municipalityCode: code, officialUrl: municipality.officialUrl },
    );
  }

  const ruleSet = await getRuleSet(c.env.DB, code);
  if (!ruleSet) {
    return fail(
      c,
      500,
      'ruleset_missing',
      `${municipality.name}のルールデータが見つかりませんでした。時間をおいて再度お試しください。`,
      { municipalityCode: code },
    );
  }

  const { ruleVersion, outcomes } = evaluate(profile, ruleSet);

  const procedureVersions = await getProcedureVersions(c.env.DB, code);
  const referencedSourceIds = outcomes
    .filter((o) => o.applicable === 'applicable' || o.applicable === 'needs_confirmation')
    .flatMap((o) => o.sourceIds);
  // ADR-014: 根拠ソースの巡回マーク(changed/unreachable)を同時に引き、該当手続きを再確認中へ落とす。
  const [sources, driftMarks] = await Promise.all([
    getSourcesByIds(c.env.DB, referencedSourceIds),
    getActiveDriftMarks(c.env.DB, referencedSourceIds),
  ]);

  const tasks = buildTasks(outcomes, procedureVersions, sources, ruleVersion, driftMarks);

  const body = checklistResponseSchema.parse({
    tasks,
    ruleVersion,
    generatedAt: new Date().toISOString(),
    // 転出予定日(任意入力)を入れると期日表示がどう変わるか。判定材料は区のルールデータにしか
    // 無いため、UIが区コードで分岐せずに案内を出せるよう応答へ載せる(CLAUDE.md §4)。
    moveOutScheduledDateImpact: moveOutScheduledDateImpact(profile, ruleSet),
  });

  // なぜ: プロフィール内容(moveDate/ageBands/flags等)はログに出さない(§13)。件数のみ。
  logEvent({
    requestId,
    event: 'checklist.generated',
    municipalityCode: code,
    latencyMs: Date.now() - start,
    count: body.tasks.length,
  });
  return c.json(body);
});

/** GET /api/procedures/:id?municipality= : ProcedureVersion全項目 + 根拠ソース。 */
app.get('/api/procedures/:id', async (c) => {
  const start = Date.now();
  const requestId = c.get('requestId');
  const code = requireMunicipalityQuery(c);
  if (!code) {
    return fail(
      c,
      400,
      'invalid_municipality',
      'municipality クエリ(5桁の自治体コード)を指定してください。',
    );
  }
  const procedureId = c.req.param('id');
  const procedure = await getProcedureVersion(c.env.DB, code, procedureId);
  if (!procedure) {
    // なぜ手続きIDを文面に入れないか: パス引数は任意の文字列を取れる。応答へ反射すると、細工した
    // リンク(/procedures/<任意の文>)でサービスの案内文を装った文言を表示させる足場になる。
    return fail(
      c,
      404,
      'procedure_not_found',
      '指定の手続きはこの自治体では見つかりませんでした。手続き一覧からお選びください。',
      { municipalityCode: code },
    );
  }
  const [sourcesMap, driftMarks] = await Promise.all([
    getSourcesByIds(c.env.DB, procedure.sourceIds),
    getActiveDriftMarks(c.env.DB, procedure.sourceIds),
  ]);
  // なぜ射影するのか: sourcesMap の値は台帳の全列(Source)を持つ。公開列は GET /api/sources と
  // 同じ publicSourceView で決める(内部レビュー用メタ・notes は出さない)。
  const sources = procedure.sourceIds
    .map((sid) => sourcesMap.get(sid))
    .filter((s) => s !== undefined)
    .map((s) => ({ ...publicSourceView(s), ...driftFields(driftMarks.get(s.sourceId)) }));

  // ADR-014: 根拠のいずれかが巡回で揺らいでいれば、読み出し時に stale(再確認中)として返す
  // (公開データは書き換えない。unavailable は据え置き)。
  const drifted = procedure.sourceIds.some((sid) => driftMarks.has(sid));
  const overlaid =
    drifted && procedure.dataStatus !== 'unavailable'
      ? { ...procedure, dataStatus: 'stale' as const }
      : procedure;

  const body = procedureDetailResponseSchema.parse({ procedure: overlaid, sources });
  logEvent({
    requestId,
    event: 'procedure.detail',
    municipalityCode: code,
    latencyMs: Date.now() - start,
  });
  return c.json(body);
});

/** GET /api/facilities?municipality=&category= : 窓口一覧(距離計算なし)。 */
app.get('/api/facilities', async (c) => {
  const start = Date.now();
  const requestId = c.get('requestId');
  const code = requireMunicipalityQuery(c);
  if (!code) {
    return fail(
      c,
      400,
      'invalid_municipality',
      'municipality クエリ(5桁の自治体コード)を指定してください。',
    );
  }
  const category = c.req.query('category');
  const facilities = await getFacilities(c.env.DB, code, category);
  const body = facilitiesResponseSchema.parse(facilities);
  logEvent({
    requestId,
    event: 'facilities.list',
    municipalityCode: code,
    latencyMs: Date.now() - start,
    count: body.length,
  });
  return c.json(body);
});

/**
 * GET /api/stats : 公開データの規模サマリー(トップの「このサービスの約束」用)。
 * 値はすべてD1の実データから毎回導出する(定数を持たない=区やソースが増えれば自動で追随する)。
 * 個人データを一切含まないため自治体スコープもクエリも取らない。
 */
app.get('/api/stats', async (c) => {
  const start = Date.now();
  const requestId = c.get('requestId');
  const body = serviceStatsSchema.parse(await getServiceStats(c.env.DB));
  logEvent({
    requestId,
    event: 'stats.summary',
    latencyMs: Date.now() - start,
    count: body.approvedSources,
  });
  return c.json(body);
});

/**
 * GET /api/sources : データソース台帳の公開ビュー(Wave3・来歴ダッシュボード)。
 * 承認済み(review_status=approved)の全ソースを、公開に必要な列だけへ射影して返す
 * (内部レビュー用メタは出さない)。自治体スコープではなく台帳全体を返し、UI側で自治体別に
 * グルーピングする。ログはallowlist(件数のみ。PIIなし)。
 */
app.get('/api/sources', async (c) => {
  const start = Date.now();
  const requestId = c.get('requestId');
  const sources = await getApprovedSources(c.env.DB);
  const body = sourcesResponseSchema.parse(sources.map(publicSourceView));
  logEvent({
    requestId,
    event: 'sources.list',
    latencyMs: Date.now() - start,
    count: body.length,
  });
  return c.json(body);
});

/**
 * GET /api/ward-differences : 区をまたぐ期限差分(比較ページ /differences の唯一のデータ源)。
 *
 * なぜ自治体スコープを取らないのか: このエンドポイントの目的そのものが「自治体間の比較」であり、
 * 利用者が /differences を明示的に開いたときだけ呼ばれる。原則4(選択自治体と異なる自治体の
 * 情報を混ぜない)は、チェックリスト・手続き詳細・RAGといった「1区ぶんの案内」経路を守る制約で、
 * それらの応答へこの結果を混ぜることはしない(混ぜていないことは cross-ward-text.test.ts が
 * 各区の公開データ側で、E2Eがチェックリスト画面側で固定している)。
 *
 * 値はサーバー側の比較表ではなく、公開済みデータ(rule_sets / procedure_versions / sources)から
 * @tmn/rules の純関数が毎回導出する。対応区が増えれば自動的に増える(手打ちの表を持たない)。
 */
app.get('/api/ward-differences', async (c) => {
  const start = Date.now();
  const requestId = c.get('requestId');

  const [munis, ruleSets, procedures, sources] = await Promise.all([
    getMunicipalitiesWithCoverage(c.env.DB),
    getAllRuleSets(c.env.DB),
    getProcedureVersionsForIds(
      c.env.DB,
      WARD_DIFFERENCE_TOPICS.map((t) => t.procedureId),
    ),
    getApprovedSources(c.env.DB),
  ]);

  const nameByCode = new Map(munis.filter((m) => m.supported).map((m) => [m.code, m.name]));

  // 承認済みソースのみを根拠候補にする(getApprovedSources が review_status を強制済み)。
  // lastVerifiedAt を持たないソースは根拠カードの必須項目を満たせないため候補から外す(原則2)。
  //
  // 自治体ごとにマップを分ける理由(原則4の多重防御): ある区のルールが誤って他区の source_id を
  // 参照していても、その区の根拠カードに他区の出典が出ないよう、引ける候補を
  // 「自区のソース + どの区にも属さない共通ソース(東京都・国など)」へ構造的に限定する。
  const sharedRefs = new Map<string, WardDifferenceSourceRef>();
  const refsByMunicipality = new Map<string, Map<string, WardDifferenceSourceRef>>();
  for (const s of sources) {
    if (!s.lastVerifiedAt) continue;
    const ref: WardDifferenceSourceRef = {
      sourceId: s.sourceId,
      title: s.sourceTitle,
      url: s.sourceUrl,
      lastVerifiedAt: s.lastVerifiedAt,
    };
    // 対応自治体に紐づかないソース(東京都の機関・国など)は全区共通の候補として扱う。
    if (!s.municipalityCode || !nameByCode.has(s.municipalityCode)) {
      sharedRefs.set(s.sourceId, ref);
      continue;
    }
    const own = refsByMunicipality.get(s.municipalityCode) ?? new Map();
    own.set(s.sourceId, ref);
    refsByMunicipality.set(s.municipalityCode, own);
  }

  const proceduresByCode = new Map<string, typeof procedures>();
  for (const p of procedures) {
    proceduresByCode.set(p.municipalityCode, [
      ...(proceduresByCode.get(p.municipalityCode) ?? []),
      p,
    ]);
  }

  const wards: WardDifferenceInput[] = [];
  for (const rs of ruleSets) {
    const name = nameByCode.get(rs.municipalityCode);
    // 未対応(公開ゲート未通過)の自治体は比較にも出さない(未対応を対応済みに見せない=原則9)。
    if (!name) continue;
    wards.push({
      municipalityCode: rs.municipalityCode,
      municipalityName: name,
      rules: rs.rules,
      procedures: proceduresByCode.get(rs.municipalityCode) ?? [],
      sources: new Map([...sharedRefs, ...(refsByMunicipality.get(rs.municipalityCode) ?? [])]),
    });
  }

  const report = buildWardDifferences(wards);
  // ADR-014: 比較セルの根拠にも検知日・種類を添える(値・区分は変えない。根拠カードの表示のみ)。
  const cellSourceIds = report.topics.flatMap((t) =>
    t.cells.flatMap((cell) => cell.sources.map((s) => s.sourceId)),
  );
  const driftMarks = await getActiveDriftMarks(c.env.DB, cellSourceIds);
  const topics = report.topics.map((t) => ({
    ...t,
    cells: t.cells.map((cell) => ({
      ...cell,
      sources: cell.sources.map((s) => ({ ...s, ...driftFields(driftMarks.get(s.sourceId)) })),
    })),
  }));

  const body = wardDifferencesResponseSchema.parse({ ...report, topics });
  logEvent({
    requestId,
    event: 'ward-differences.list',
    latencyMs: Date.now() - start,
    count: body.municipalities.length,
  });
  return c.json(body);
});

/** GET /api/waste-schedules?municipality=&area= : area未指定→地区一覧、指定→曜日+caution。 */
app.get('/api/waste-schedules', async (c) => {
  const start = Date.now();
  const requestId = c.get('requestId');
  const code = requireMunicipalityQuery(c);
  if (!code) {
    return fail(
      c,
      400,
      'invalid_municipality',
      'municipality クエリ(5桁の自治体コード)を指定してください。',
    );
  }

  const dataset = await getWasteDataset(c.env.DB, code);
  if (!dataset) {
    return fail(
      c,
      404,
      'waste_data_unavailable',
      'この自治体のごみ収集データはまだ整備されていません。公式サイトでご確認ください。',
      { municipalityCode: code },
    );
  }

  const areas = await getWasteAreas(c.env.DB, code);
  const areaId = c.req.query('area');

  // C-9: どの応答でも caution(祝日等の注意)を必ず含める。
  const base = {
    municipalityCode: code,
    areas,
    caution: dataset.caution,
    ...(dataset.granularityNote ? { granularityNote: dataset.granularityNote } : {}),
    ...(dataset.effectiveFrom ? { effectiveFrom: dataset.effectiveFrom } : {}),
    ...(dataset.effectiveTo ? { effectiveTo: dataset.effectiveTo } : {}),
  };

  if (!areaId) {
    const body = wasteSchedulesResponseSchema.parse(base);
    logEvent({
      requestId,
      event: 'waste.areas',
      municipalityCode: code,
      latencyMs: Date.now() - start,
      count: areas.length,
    });
    return c.json(body);
  }

  if (!areas.some((a) => a.areaId === areaId)) {
    return fail(
      c,
      404,
      'waste_area_unknown',
      '指定の地区が見つかりませんでした。地区一覧からお選びください。',
      { municipalityCode: code },
    );
  }

  const schedules = await getWasteSchedules(c.env.DB, code, areaId);
  const body = wasteSchedulesResponseSchema.parse({ ...base, schedules });
  logEvent({
    requestId,
    event: 'waste.schedules',
    municipalityCode: code,
    latencyMs: Date.now() - start,
    count: schedules.length,
  });
  return c.json(body);
});

/**
 * GET /api/waste-sorting?municipality=&q= : ごみ分別辞書(Wave1-B)。
 * q未指定 → カテゴリ別件数サマリー。q指定 → name/reading部分一致検索(最大30件+総件数)。
 * この自治体にデータが1件もない場合は 404(waste_sorting_data_unavailable。原則9)。
 */
app.get('/api/waste-sorting', async (c) => {
  const start = Date.now();
  const requestId = c.get('requestId');
  const code = requireMunicipalityQuery(c);
  if (!code) {
    return fail(
      c,
      400,
      'invalid_municipality',
      'municipality クエリ(5桁の自治体コード)を指定してください。',
    );
  }

  const hasData = await hasWasteSortingData(c.env.DB, code);
  if (!hasData) {
    return fail(
      c,
      404,
      'waste_sorting_data_unavailable',
      'この自治体のごみ分別データはまだ整備されていません。公式サイトでご確認ください。',
      { municipalityCode: code },
    );
  }

  const q = c.req.query('q');
  if (!q || q.trim().length === 0) {
    const categories = await getWasteSortingCategorySummary(c.env.DB, code);
    const total = categories.reduce((n, cat) => n + cat.count, 0);
    const body = wasteSortingSummaryResponseSchema.parse({
      municipalityCode: code,
      categories,
      total,
    });
    logEvent({
      requestId,
      event: 'waste_sorting.summary',
      municipalityCode: code,
      latencyMs: Date.now() - start,
      count: total,
    });
    return c.json(body);
  }

  const { items, total } = await searchWasteSortingItems(c.env.DB, code, q, 30);
  const body = wasteSortingSearchResponseSchema.parse({
    municipalityCode: code,
    query: q,
    items,
    total,
  });
  logEvent({
    requestId,
    event: 'waste_sorting.search',
    municipalityCode: code,
    latencyMs: Date.now() - start,
    count: total,
  });
  return c.json(body);
});

/**
 * GET /robots.txt : クローラ向け指示。
 *
 * なぜ静的ファイルではなく Worker が返すのか: Sitemap 行に絶対URLが要る。静的ファイルだと
 * 本番(app.sumihajime.workers.dev)とミラー環境(ADR-008)でオリジンが違うぶん、
 * どちらかが必ず嘘になる。リクエストのオリジンから組み立てれば常に正しい。
 * /api/ を除外するのは、APIがクロール対象の「ページ」ではないため(クロール予算の無駄と、
 * 自治体コード付きURLの無意味な収集を避ける)。
 */
app.get('/robots.txt', (c) => {
  const { origin } = new URL(c.req.url);
  const body = ['User-agent: *', 'Disallow: /api/', '', `Sitemap: ${origin}/sitemap.xml`, ''].join(
    '\n',
  );
  return withDocumentSecurityHeaders(
    new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } }),
  );
});

/**
 * GET /sitemap.xml : 公開ページのみのサイトマップ。
 *
 * 収録対象は @tmn/domain の SPA_ROUTES(sitemap: true)から導出する。ページを増減しても
 * ルート表を直せば追随し、手書きの一覧が古びて「存在しないURL」を載せることがない。
 * lastmod は信頼できる更新日を持たないため出さない(根拠のない値を書かない=原則3)。
 */
app.get('/sitemap.xml', (c) => {
  const { origin } = new URL(c.req.url);
  const urls = sitemapPaths()
    .map((path) => `  <url>\n    <loc>${origin}${path}</loc>\n  </url>`)
    .join('\n');
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
  return withDocumentSecurityHeaders(
    new Response(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } }),
  );
});

/**
 * 静的アセットで解決しなかった全リクエストの受け皿(SPAフォールバック)。
 *
 * 目的(独立点検): 未定義URLが 200 を返す「ソフト404」をなくす。画面はどちらも同じ index.html
 * (=クライアントルーティングは無傷)だが、既知ルートは 200、それ以外は 404 ステータスで返す。
 * これでクローラと外形監視にも「そのURLは無い」と正しく伝わる。
 * 既知ルートの一覧はルータと同じ @tmn/domain の SPA_ROUTES から判定するため、
 * ページを増やしたときに片方だけ古くなることがない。
 */
app.all('*', async (c) => {
  const url = new URL(c.req.url);

  // /api/* の未定義パスへHTMLを返さない(APIは常にAPIとして振る舞う)。
  if (url.pathname.startsWith('/api/')) return c.notFound();

  const assets = c.env.ASSETS;
  // ASSETSバインディング未設定(単体テスト等)では本文を作れないため、状態だけ正しく返す。
  if (!assets) {
    return withDocumentSecurityHeaders(
      new Response('', {
        status: isKnownSpaPath(url.pathname) ? 200 : 404,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      }),
    );
  }

  const method = c.req.method === 'HEAD' ? 'HEAD' : 'GET';
  const index = await assets.fetch(new Request(new URL('/index.html', url.origin), { method }));
  if (!index.ok) return withDocumentSecurityHeaders(index);

  if (isKnownSpaPath(url.pathname)) return withDocumentSecurityHeaders(index);

  const headers = new Headers(index.headers);
  // 404応答に実体の検証子を残さない/中間キャッシュに残さない。あとで有効になったURLの
  // 404が居座ると、直したはずのページが見えないという厄介な壊れ方をする。
  headers.delete('ETag');
  headers.delete('Last-Modified');
  headers.set('Cache-Control', 'no-store');
  return withDocumentSecurityHeaders(new Response(index.body, { status: 404, headers }));
});

/**
 * Worker の入口。fetch は Hono、scheduled は定期巡回(ADR-014。wrangler.jsonc の triggers.crons)。
 * テストは名前付き export の app(app.request)を使う。
 */
const worker: ExportedHandler<Bindings> = {
  fetch: app.fetch,
  scheduled,
};

export default worker;
