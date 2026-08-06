/**
 * なぜ: チェックリストには「区(自治体)の窓口で行う手続き」と「区以外(東京都水道局・日本郵便・
 * 警視庁・契約先の電気ガス会社)で行う手続き」が混在する(ADR-009)。どこへ行けばよいのかを
 * 利用者が取り違えないよう、表示側で1バッジぶんの区別をつける。
 *
 * 判定は GeneratedTask.category(= ProcedureVersion.canonicalType)だけを見る純関数で、
 * 自治体固有の分岐は持たない(CLAUDE.md §4「自治体固有ロジックをUIへ埋め込まない」)。
 * スキーマに提供主体のフィールドは足していないため、非自治体カテゴリの集合をここに1か所だけ持つ。
 */

export type ProviderScope = 'municipality' | 'non_municipality';

/**
 * 区(自治体)以外が所管する手続きの canonicalType。
 * data/normalized/<code>/procedures.json の canonicalType と対応する。
 */
const NON_MUNICIPAL_CATEGORIES: ReadonlySet<string> = new Set([
  'water_supply', // 東京都水道局(下水道は23区では水道の届出に含まれる)
  'postal_forwarding', // 日本郵便
  'utilities_contact', // 契約先の電気・ガス事業者(特定事業者は名指ししない)
  'driver_license', // 警視庁
]);

export function providerScope(category: string): ProviderScope {
  return NON_MUNICIPAL_CATEGORIES.has(category) ? 'non_municipality' : 'municipality';
}

export function isNonMunicipal(category: string): boolean {
  return providerScope(category) === 'non_municipality';
}

export const providerScopeLabel: Record<ProviderScope, string> = {
  municipality: '区の手続き',
  non_municipality: '区以外の手続き',
};
