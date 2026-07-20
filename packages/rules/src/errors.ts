/**
 * なぜ: CLAUDE.md原則4「選択自治体と異なる自治体の情報を混ぜない」。
 * Profile.destination.municipalityCode と RuleSet.municipalityCode が一致しない場合、
 * 評価を1件たりとも進めず必ず例外にする(越境誤適用の構造的防止。REQUIREMENTS §9.4)。
 */
export class MunicipalityScopeMismatchError extends Error {
  readonly profileMunicipalityCode: string;
  readonly ruleSetMunicipalityCode: string;

  constructor(profileMunicipalityCode: string, ruleSetMunicipalityCode: string) {
    super(
      `municipality scope mismatch: profile.destination.municipalityCode=` +
        `"${profileMunicipalityCode}" does not match ruleSet.municipalityCode=` +
        `"${ruleSetMunicipalityCode}". Refusing to evaluate to prevent cross-municipality misapplication.`,
    );
    this.name = 'MunicipalityScopeMismatchError';
    this.profileMunicipalityCode = profileMunicipalityCode;
    this.ruleSetMunicipalityCode = ruleSetMunicipalityCode;
  }
}
