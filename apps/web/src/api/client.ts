import {
  checklistResponseSchema,
  errorResponseSchema,
  facilitiesResponseSchema,
  municipalitiesResponseSchema,
  procedureDetailResponseSchema,
  wasteSchedulesResponseSchema,
  type ChecklistResponse,
  type FacilitiesResponse,
  type MunicipalitiesResponse,
  type ProcedureDetailResponse,
  type Profile,
  type WasteSchedulesResponse,
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
