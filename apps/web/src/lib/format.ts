import type {
  AgeBand,
  Channel,
  CoverageStatus,
  DataStatus,
  DocumentStatus,
  OriginType,
  Priority,
  Weekday,
} from '@tmn/schemas';

/**
 * なぜ: 行政用語・列挙値を利用者向け日本語ラベルへ変換する単一箇所(§15.3「行政用語に
 * 補足説明を付ける」)。自治体固有ロジックは持たず、schemaの固定語彙のみを対象とする。
 */

export const priorityLabel: Record<Priority, string> = {
  urgent: '至急',
  high: '重要',
  normal: '通常',
  optional: '任意',
};

export const channelLabel: Record<Channel, string> = {
  counter: '窓口',
  online: 'オンライン',
  mail: '郵送',
  phone: '電話',
};

export const documentStatusLabel: Record<DocumentStatus, string> = {
  required: '必須',
  conditional: '場合により必要',
  unknown: '公式ページで要確認',
};

export const dataStatusLabel: Record<DataStatus, string> = {
  verified: '確認済み',
  partial: '一部未確認',
  stale: '再確認中（情報が古い可能性）',
  unavailable: '未整備',
};

export const coverageStatusLabel: Record<CoverageStatus, string> = {
  verified: '対応済み',
  partial: '一部対応',
  unavailable: '未対応',
};

export const originTypeLabel: Record<OriginType, string> = {
  outside_tokyo: '東京都外',
  inside_tokyo: '東京都内の別自治体',
  overseas: '海外',
};

export const ageBandLabel: Record<AgeBand, string> = {
  age0_2: '0〜2歳',
  age3_5: '3〜5歳',
  elementary: '小学生',
  junior_senior: '中高生',
  adult: '18〜64歳',
  senior65plus: '65歳以上',
};

export const weekdayLabel: Record<Weekday, string> = {
  monday: '月曜日',
  tuesday: '火曜日',
  wednesday: '水曜日',
  thursday: '木曜日',
  friday: '金曜日',
  saturday: '土曜日',
  sunday: '日曜日',
};

/** カテゴリキー(coverage/procedure等の canonicalType)→利用者向け見出し。未知キーはそのまま返す。 */
export const categoryLabel: Record<string, string> = {
  resident_registration: '住民の届出（転入届など）',
  my_number: 'マイナンバーカード',
  national_health_insurance: '国民健康保険',
  national_pension: '国民年金',
  child_benefits: '子育て（児童手当・子ども医療など）',
  school_childcare: '学校・保育',
  dog_registration: '犬の登録',
  facilities: '窓口・施設',
  waste_schedule: 'ごみ・資源の収集',
  waste_sorting: 'ごみの分別',
  rag: 'AIチャット相談',
  // ADR-009: 自治体以外(ライフライン等)の手続き。coverage の1カテゴリ(non_municipal)と、
  // 手続きの canonicalType(water_supply 等)の両方をここで人間可読な見出しにする。
  non_municipal: '区以外の手続き（水道・郵便・電気ガス・免許）',
  water_supply: '水道（下水道を含む）',
  postal_forwarding: '郵便の転居届',
  utilities_contact: '電気・ガス',
  driver_license: '運転免許証',
};

export function categoryText(key: string): string {
  return categoryLabel[key] ?? key;
}

/** ISO日付(YYYY-MM-DD)→「YYYY年M月D日」。不正値はそのまま返す。 */
export function formatDate(iso: string | undefined): string {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${Number(m[1])}年${Number(m[2])}月${Number(m[3])}日`;
}

/** ISO日時(datetime)→「YYYY年M月D日」表記(最終確認日などの表示用)。 */
export function formatDateFromDateTime(iso: string | undefined): string {
  if (!iso) return '';
  return formatDate(iso.slice(0, 10));
}

/**
 * なぜ: 期限までの残日数などの決定論的な算出に使う。YYYY-MM-DDをUTC正午基準で解釈し
 * タイムゾーン差の丸め誤差を避ける(CLAUDE.md §7 日付計算方針)。
 * 返り値 = (to - from) の日数。
 */
export function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso.slice(0, 10)}T12:00:00Z`);
  const to = Date.parse(`${toIso.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return NaN;
  return Math.round((to - from) / 86_400_000);
}

/** 第n週の配列(weekOfMonth)→「第1・3週」表記。空/未指定は「毎週」。 */
export function weekOfMonthLabel(weeks: number[] | undefined): string {
  if (!weeks || weeks.length === 0) return '毎週';
  return `第${weeks
    .slice()
    .sort((a, b) => a - b)
    .join('・')}週`;
}
