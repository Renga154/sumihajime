/**
 * なぜ: 各区のテストは「手続きは全件、承認日の版・最終確認日のまま」を回帰ガードとして固定している。
 * 再監査(docs/ops/reaudit.md。ADR-014 の定期巡回が検知した公式ページの更新を人が確かめ直す)で
 * 内容を直した手続きだけは、その日の版・最終確認日へ進む。ガードを緩めるのではなく、進んでよい
 * 手続きをここに列挙して、それ以外は従来どおり厳密に固定する。
 */
export const REAUDITS: readonly {
  date: string;
  procedures: Readonly<Record<string, readonly string[]>>;
}[] = [
  {
    // 2026-09-25: 初回の全件巡回で「再確認中」になった73ソースの再監査(人手承認)。
    date: '2026-09-25',
    procedures: {
      '13104': ['procedure_mynumber_continued_use'],
      '13108': ['procedure_child_allowance'],
      '13111': [
        'procedure_resident_registration',
        'procedure_mynumber_continued_use',
        'procedure_national_health_insurance',
        'procedure_child_medical',
        'procedure_school_transfer',
      ],
      '13115': ['procedure_child_medical'],
      '13121': ['procedure_childcare_application'],
    },
  },
];

/** その手続きが再監査で進んだ日付(無ければ undefined = 承認日のまま)。 */
function reauditDate(code: string, procedureId: string): string | undefined {
  let latest: string | undefined;
  for (const r of REAUDITS) if (r.procedures[code]?.includes(procedureId)) latest = r.date;
  return latest;
}

/** 期待する最終確認日(ISO datetime)。 */
export function expectedLastVerifiedAt(
  code: string,
  procedureId: string,
  approved: string,
): string {
  const d = reauditDate(code, procedureId);
  return d ? `${d}T00:00:00Z` : approved;
}

/** 期待する手続きの版。 */
export function expectedVersion(code: string, procedureId: string, approved: string): string {
  const d = reauditDate(code, procedureId);
  return d ? `${d}.1` : approved;
}
