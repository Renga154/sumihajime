import {
  checklistResponseSchema,
  chatResponseSchema,
  errorResponseSchema,
  facilitiesResponseSchema,
  municipalitiesResponseSchema,
  procedureDetailResponseSchema,
  serviceStatsSchema,
  sourcesResponseSchema,
  wardDifferencesResponseSchema,
  wasteSchedulesResponseSchema,
  wasteSortingSearchResponseSchema,
  wasteSortingSummaryResponseSchema,
  type ChatRequest,
  type ChatResponse,
  type ChecklistResponse,
  type FacilitiesResponse,
  type MunicipalitiesResponse,
  type ProcedureDetailResponse,
  type Profile,
  type ServiceStats,
  type SourcesResponse,
  type WardDifferencesResponse,
  type WasteSchedulesResponse,
  type WasteSortingSearchResponse,
  type WasteSortingSummaryResponse,
} from '@tmn/schemas';

/**
 * なぜ: フロントは packages/schemas を唯一のAPI契約とする(境界検証)。全レスポンスを
 * 対応するZodスキーマでparseし、想定外の形状をUIへ流さない。エラー応答も errorResponseSchema
 * で読み、message(次の行動が分かる文面)と officialUrl(FR-021の公式導線)をUIへ渡す。
 */

const BASE = '/api';

/** APIのエラー応答を表す例外。UIは message をそのまま表示し、officialUrl があれば導線を出す。 */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly officialUrl?: string;

  constructor(status: number, code: string, message: string, officialUrl?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.officialUrl = officialUrl;
  }
}

async function request(path: string, init?: RequestInit): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, init);
  } catch {
    throw new ApiError(
      0,
      'network_error',
      'サーバーに接続できませんでした。通信環境をご確認のうえ、もう一度お試しください。',
    );
  }

  const text = await res.text();
  let json: unknown = undefined;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
  }

  if (!res.ok) {
    const parsed = errorResponseSchema.safeParse(json);
    if (parsed.success) {
      throw new ApiError(
        res.status,
        parsed.data.error.code,
        parsed.data.error.message,
        parsed.data.error.officialUrl,
      );
    }
    throw new ApiError(
      res.status,
      'unexpected_error',
      '予期しないエラーが発生しました。時間をおいて再度お試しください。',
    );
  }

  return json;
}

export async function getMunicipalities(): Promise<MunicipalitiesResponse> {
  return municipalitiesResponseSchema.parse(await request('/municipalities'));
}

export async function postChecklist(profile: Profile): Promise<ChecklistResponse> {
  return checklistResponseSchema.parse(
    await request('/checklists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(profile),
    }),
  );
}

export async function getProcedure(
  procedureId: string,
  municipalityCode: string,
): Promise<ProcedureDetailResponse> {
  const q = new URLSearchParams({ municipality: municipalityCode });
  return procedureDetailResponseSchema.parse(
    await request(`/procedures/${encodeURIComponent(procedureId)}?${q.toString()}`),
  );
}

/**
 * GET /api/sources : データソース台帳の公開ビュー(Wave3・来歴ダッシュボード)。
 * 承認済みの全ソースを返す(自治体スコープなし。UI側で自治体別にグルーピングする)。
 */
export async function getSources(): Promise<SourcesResponse> {
  return sourcesResponseSchema.parse(await request('/sources'));
}

/**
 * GET /api/stats : 公開データの規模サマリー(対応自治体数・承認済みソース件数・最終確認日)。
 * トップの訴求文で使う数値をここから取る。/api/sources(台帳全文)を読まずに済ませるための
 * 軽量エンドポイントで、数値を画面へ手打ちしないための唯一の入口。
 */
export async function getServiceStats(): Promise<ServiceStats> {
  return serviceStatsSchema.parse(await request('/stats'));
}

/**
 * GET /api/ward-differences : 区をまたぐ期限差分(比較ページ /differences 専用)。
 * このデータを使ってよいのは「自治体間の比較」を明示的に開いたページだけで、
 * チェックリスト・手続き詳細には持ち込まない(CLAUDE.md原則4)。
 */
export async function getWardDifferences(): Promise<WardDifferencesResponse> {
  return wardDifferencesResponseSchema.parse(await request('/ward-differences'));
}

export async function getFacilities(
  municipalityCode: string,
  category?: string,
): Promise<FacilitiesResponse> {
  const q = new URLSearchParams({ municipality: municipalityCode });
  if (category) q.set('category', category);
  return facilitiesResponseSchema.parse(await request(`/facilities?${q.toString()}`));
}

export async function getWaste(
  municipalityCode: string,
  areaId?: string,
): Promise<WasteSchedulesResponse> {
  const q = new URLSearchParams({ municipality: municipalityCode });
  if (areaId) q.set('area', areaId);
  return wasteSchedulesResponseSchema.parse(await request(`/waste-schedules?${q.toString()}`));
}

/**
 * GET /api/waste-sorting?municipality=&q= : ごみ分別辞書(Wave1-B)。
 * q未指定 → カテゴリ別件数サマリー、q指定 → 品目検索(最大30件+総件数)。境界検証は
 * 応答形状に応じて対応するスキーマで行い、想定外形状をUIへ流さない。データ未整備の自治体は
 * ApiError(404 waste_sorting_data_unavailable)を投げ、UIは公式分別ページへ誘導する。
 */
export async function getWasteSortingSummary(
  municipalityCode: string,
): Promise<WasteSortingSummaryResponse> {
  const q = new URLSearchParams({ municipality: municipalityCode });
  return wasteSortingSummaryResponseSchema.parse(await request(`/waste-sorting?${q.toString()}`));
}

export async function searchWasteSorting(
  municipalityCode: string,
  query: string,
): Promise<WasteSortingSearchResponse> {
  const q = new URLSearchParams({ municipality: municipalityCode, q: query });
  return wasteSortingSearchResponseSchema.parse(await request(`/waste-sorting?${q.toString()}`));
}

/**
 * なぜ: RAGチャットが有効か(RAG_ENABLED)を軽量に判定する。無効時(または到達不可時)は
 * UIがチャットパネルを一切描画しないための入口(FR-016〜019の縮退。既存機能は無傷)。
 */
export async function getChatAvailability(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/chat/availability`);
    if (!res.ok) return false;
    const json = (await res.json()) as { enabled?: boolean } | null;
    return json?.enabled === true;
  } catch {
    return false;
  }
}

/** RAGが無効(503 disabled)であることを表す例外。UIはパネルを隠すために使う。 */
export class ChatDisabledError extends Error {
  constructor() {
    super('chat disabled');
    this.name = 'ChatDisabledError';
  }
}

/**
 * POST /api/chat。RAG無効時は ChatDisabledError、その他失敗は ApiError を投げる。
 * 成功時は chatResponseSchema で境界検証してから返す(想定外形状をUIへ流さない)。
 */
export async function postChat(req: ChatRequest): Promise<ChatResponse> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    });
  } catch {
    throw new ApiError(
      0,
      'network_error',
      'サーバーに接続できませんでした。通信環境をご確認のうえ、もう一度お試しください。',
    );
  }

  const text = await res.text();
  let json: unknown = undefined;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
  }

  if (res.status === 503 && json && (json as { disabled?: boolean }).disabled === true) {
    throw new ChatDisabledError();
  }

  if (!res.ok) {
    const parsed = errorResponseSchema.safeParse(json);
    if (parsed.success) {
      throw new ApiError(
        res.status,
        parsed.data.error.code,
        parsed.data.error.message,
        parsed.data.error.officialUrl,
      );
    }
    throw new ApiError(
      res.status,
      'unexpected_error',
      '予期しないエラーが発生しました。時間をおいて再度お試しください。',
    );
  }

  return chatResponseSchema.parse(json);
}
