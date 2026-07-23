import { Hono } from 'hono';
import type { Context } from 'hono';
import {
  checklistRequestSchema,
  checklistResponseSchema,
  facilitiesResponseSchema,
  municipalitiesResponseSchema,
  municipalityCodeSchema,
  procedureDetailResponseSchema,
  sourcesResponseSchema,
  wasteSchedulesResponseSchema,
  wasteSortingSearchResponseSchema,
  wasteSortingSummaryResponseSchema,
} from '@tmn/schemas';
import { evaluate } from '@tmn/rules';
import { logEvent } from './log.js';
import { buildTasks } from './checklist.js';
import { handleChat, handleChatAvailability } from './chat.js';
import type { Bindings } from './db.js';
import {
  getFacilities,
  getMunicipalitiesWithCoverage,
  getMunicipality,
  getApprovedSources,
  getProcedureVersion,
  getProcedureVersions,
  getRuleSet,
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
 */

type Variables = { requestId: string };
type Env = { Bindings: Bindings; Variables: Variables };

const app = new Hono<Env>();

/** リクエストIDを採番(ログ相関用。PIIではない)。 */
app.use('/api/*', async (c, next) => {
  c.set('requestId', crypto.randomUUID());
  await next();
});

function fail(
  c: Context<Env>,
  status: 400 | 404 | 409 | 422 | 500,
  code: string,
  message: string,
  extra?: { municipalityCode?: string; officialUrl?: string },
) {
  const requestId = c.get('requestId');
  logEvent({
    requestId,
    event: `error.${code}`,
    status,
    municipalityCode: extra?.municipalityCode,
  });
  return c.json(
    {
      error: {
        code,
        message,
        requestId,
        ...(extra?.officialUrl ? { officialUrl: extra.officialUrl } : {}),
      },
    },
    status,
  );
}

/** クエリの municipality を検証(全read系で必須)。 */
function requireMunicipalityQuery(c: Context<Env>): string | null {
  const raw = c.req.query('municipality');
  const parsed = municipalityCodeSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

app.get('/api/health', (c) => c.json({ ok: true, version: '0.0.1' } as const));

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
    return fail(
      c,
      404,
      'municipality_unknown',
      `自治体コード ${code} は登録されていません。対応自治体の一覧からお選びください。`,
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
  const sources = await getSourcesByIds(c.env.DB, referencedSourceIds);

  const tasks = buildTasks(outcomes, procedureVersions, sources, ruleVersion);

  const body = checklistResponseSchema.parse({
    tasks,
    ruleVersion,
    generatedAt: new Date().toISOString(),
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
    return fail(
      c,
      404,
      'procedure_not_found',
      `指定の手続き(${procedureId})はこの自治体では見つかりませんでした。手続き一覧からお選びください。`,
      { municipalityCode: code },
    );
  }
  const sourcesMap = await getSourcesByIds(c.env.DB, procedure.sourceIds);
  const sources = procedure.sourceIds
    .map((sid) => sourcesMap.get(sid))
    .filter((s) => s !== undefined);

  const body = procedureDetailResponseSchema.parse({ procedure, sources });
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
 * GET /api/sources : データソース台帳の公開ビュー(Wave3・来歴ダッシュボード)。
 * 承認済み(review_status=approved)の全ソースを、公開に必要な列だけへ射影して返す
 * (内部レビュー用メタは出さない)。自治体スコープではなく台帳全体を返し、UI側で自治体別に
 * グルーピングする。ログはallowlist(件数のみ。PIIなし)。
 */
app.get('/api/sources', async (c) => {
  const start = Date.now();
  const requestId = c.get('requestId');
  const sources = await getApprovedSources(c.env.DB);
  const body = sourcesResponseSchema.parse(
    sources.map((s) => ({
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
    })),
  );
  logEvent({
    requestId,
    event: 'sources.list',
    latencyMs: Date.now() - start,
    count: body.length,
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

export default app;
