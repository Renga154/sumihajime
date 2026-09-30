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
  {
    // 2026-09-26: 葛飾区のマイナンバー継続利用のページが書き直され、注意書き2つの根拠が消えた(人手承認)。
    date: '2026-09-26',
    procedures: { '13122': ['procedure_mynumber_continued_use'] },
  },
  {
    // 2026-09-28: 大田区の保育ページが令和9年度版へ切り替わり、しおりの年度と様式名が変わった(人手承認)。
    date: '2026-09-28',
    procedures: { '13111': ['procedure_childcare_application'] },
  },
  {
    // 2026-09-29: 品質点検で無作為抽出した公開データを公式ページと突き合わせ、誤り・根拠の無い記述を
    // 直した(閉所した出張所、漏れていた持ち物、試験場の問合せ先、全国共通の期限を「自治体により
    // 異なる」とした注記など。人手承認)。
    date: '2026-09-29',
    procedures: {
      '13101': [
        'procedure_childcare_application',
        'procedure_driver_license_change',
        'procedure_mynumber_continued_use',
      ],
      '13102': ['procedure_driver_license_change'],
      '13103': ['procedure_driver_license_change'],
      '13104': ['procedure_driver_license_change', 'procedure_mynumber_continued_use'],
      '13105': [
        'procedure_child_medical',
        'procedure_dog_registration_transfer',
        'procedure_driver_license_change',
      ],
      '13106': ['procedure_driver_license_change'],
      '13107': [
        'procedure_driver_license_change',
        'procedure_mynumber_continued_use',
        'procedure_national_health_insurance',
        'procedure_national_pension_address',
        'procedure_resident_registration',
      ],
      '13108': ['procedure_driver_license_change', 'procedure_mynumber_continued_use'],
      '13109': [
        'procedure_driver_license_change',
        'procedure_mynumber_continued_use',
        'procedure_school_transfer',
      ],
      '13110': ['procedure_driver_license_change'],
      '13111': [
        'procedure_child_allowance',
        'procedure_driver_license_change',
        'procedure_mynumber_continued_use',
      ],
      '13112': ['procedure_driver_license_change'],
      '13113': [
        'procedure_child_medical',
        'procedure_dog_registration_transfer',
        'procedure_driver_license_change',
        'procedure_mynumber_continued_use',
      ],
      '13114': [
        'procedure_childcare_application',
        'procedure_driver_license_change',
        'procedure_mynumber_continued_use',
      ],
      '13115': ['procedure_driver_license_change', 'procedure_mynumber_continued_use'],
      '13116': ['procedure_driver_license_change', 'procedure_mynumber_continued_use'],
      '13117': [
        'procedure_childcare_application',
        'procedure_dog_registration_transfer',
        'procedure_driver_license_change',
      ],
      '13118': ['procedure_driver_license_change', 'procedure_mynumber_continued_use'],
      '13119': ['procedure_driver_license_change', 'procedure_mynumber_continued_use'],
      '13120': ['procedure_driver_license_change', 'procedure_mynumber_continued_use'],
      '13121': ['procedure_driver_license_change'],
      '13122': ['procedure_driver_license_change'],
      '13123': ['procedure_driver_license_change', 'procedure_waste_check'],
      '13201': ['procedure_driver_license_change'],
    },
  },
  {
    // 2026-09-30: 窓口一覧の点検。区公式の窓口一覧ページを出典として登録し、手続きの窓口の誤りを直した
    // (台場分室ではマイナンバーカードの手続きを扱わない、特別出張所では保育の申込みを受け付けない、
    // 赤塚支所は年金の請求・受給のみ、デジタルフロントスポット長房は転入・国保・転入学を扱わない、
    // 「10か所」はくみん窓口と出張所の合計、本庁舎の窓口の移転予定)。同じ日に、利用者に見える注意書きの
    // 開発者向けの言い回し(「本データでは」「unknown としています」など)を利用者向けに直した(人手承認待ち)。
    date: '2026-09-30',
    procedures: {
      '13101': ['procedure_dog_registration_transfer'],
      '13102': ['procedure_national_health_insurance'],
      '13103': ['procedure_mynumber_continued_use', 'procedure_national_health_insurance'],
      '13104': ['procedure_childcare_application', 'procedure_waste_check'],
      '13108': [
        'procedure_child_medical',
        'procedure_childcare_application',
        'procedure_waste_check',
      ],
      '13109': [
        'procedure_child_medical',
        'procedure_dog_registration_transfer',
        'procedure_national_pension_address',
        'procedure_school_transfer',
      ],
      '13111': ['procedure_national_pension_address'],
      '13112': [
        'procedure_mynumber_continued_use',
        'procedure_national_health_insurance',
        'procedure_national_pension_address',
        'procedure_resident_registration',
        'procedure_school_transfer',
        'procedure_waste_check',
      ],
      '13114': ['procedure_national_pension_address'],
      '13116': [
        'procedure_child_medical',
        'procedure_dog_registration_transfer',
        'procedure_school_transfer',
      ],
      '13117': [
        'procedure_childcare_application',
        'procedure_dog_registration_transfer',
        'procedure_national_health_insurance',
      ],
      '13118': ['procedure_dog_registration_transfer', 'procedure_school_transfer'],
      '13119': ['procedure_national_pension_address', 'procedure_waste_check'],
      '13120': [
        'procedure_child_medical',
        'procedure_childcare_application',
        'procedure_national_pension_address',
        'procedure_waste_check',
      ],
      '13121': ['procedure_childcare_application'],
      '13122': ['procedure_school_transfer'],
      '13201': [
        'procedure_national_health_insurance',
        'procedure_resident_registration',
        'procedure_school_transfer',
      ],
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
