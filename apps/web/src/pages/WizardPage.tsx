import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  profileSchema,
  type AgeBand,
  type Flags,
  type OriginType,
  type Profile,
} from '@tmn/schemas';
import { useAppState } from '../state/AppState';
import { loadProfile, saveProfile } from '../lib/storage';
import { ageBandLabel, originTypeLabel } from '../lib/format';
import { Card } from '../components/ui';

/**
 * 入力ウィザード(§7.3)。Step1(引越し日・転入元)のみ必須で、Step1完了時点で暫定
 * チェックリストを生成できる(FR-003)。Step2(世帯)/Step3(条件)はスキップ可で、
 * 後から編集して再計算できる(FR-004)。氏名・番地・電話・メール等は一切入力させない(§13)。
 * 各質問の近くに「なぜ聞くか」を添える(§7.3)。
 */

type HouseholdKind = 'single' | 'multiple';
type Tri = 'yes' | 'no' | 'unknown';

const AGE_BANDS: AgeBand[] = [
  'age0_2',
  'age3_5',
  'elementary',
  'junior_senior',
  'adult',
  'senior65plus',
];

const ORIGIN_TYPES: OriginType[] = ['outside_tokyo', 'inside_tokyo', 'overseas'];

interface FlagField {
  key: keyof Pick<
    Flags,
    | 'hasMyNumberCard'
    | 'needsNationalHealthInsurance'
    | 'needsNationalPension'
    | 'hasSchoolOrChildcareNeeds'
    | 'hasDog'
    | 'needsDisabilityOrCareSupport'
    | 'needsForeignResidentGuidance'
    | 'needsVehicleGuidance'
  >;
  label: string;
  why: string;
}

const FLAG_FIELDS: FlagField[] = [
  {
    key: 'needsNationalHealthInsurance',
    label: '国民健康保険への加入が必要',
    why: '会社の健康保険等に入っていない方は、加入届が必要かを判定します。',
  },
  {
    key: 'needsNationalPension',
    label: '国民年金の手続きが必要',
    why: '第1号被保険者などの手続きが必要かを判定します。',
  },
  {
    key: 'hasMyNumberCard',
    label: 'マイナンバーカードを持っている',
    why: '転入に伴う継続利用（住所変更）の手続きが必要かを判定します。',
  },
  {
    key: 'hasSchoolOrChildcareNeeds',
    label: '子どもの学校・保育関連の手続きが必要',
    why: '就学・保育の案内が必要かを判定します。',
  },
  {
    key: 'hasDog',
    label: '犬を飼っている',
    why: '飼い犬の登録事項変更の届出が必要かを判定します。',
  },
  {
    key: 'needsDisabilityOrCareSupport',
    label: '介護・障害福祉に関する手続きがある',
    why: '関連する窓口・手続きの案内が必要かを判定します。',
  },
  {
    key: 'needsForeignResidentGuidance',
    label: '外国籍・在留関連の案内が必要',
    why: '在留カード等に関する案内が必要かを判定します。',
  },
  {
    key: 'needsVehicleGuidance',
    label: '車・バイク等の追加案内が必要',
    why: '車庫証明・登録変更などの案内が必要かを判定します。',
  },
];

const STEPS = ['引越し日と転入元', '世帯', '条件チェック'] as const;

export function WizardPage() {
  const navigate = useNavigate();
  const { municipalityCode } = useAppState();
  const existing = municipalityCode ? loadProfile(municipalityCode) : null;

  const [step, setStep] = useState(1);

  // Step1
  const [moveDate, setMoveDate] = useState(existing?.moveDate ?? '');
  const [originType, setOriginType] = useState<OriginType | ''>(existing?.originType ?? '');

  // Step2
  const [householdKind, setHouseholdKind] = useState<HouseholdKind>(
    existing && existing.household.memberCount > 1 ? 'multiple' : 'single',
  );
  const [ageBands, setAgeBands] = useState<AgeBand[]>(existing?.household.ageBands ?? ['adult']);
  const [isPregnant, setIsPregnant] = useState(existing?.flags.isPregnantMember ?? false);

  // Step3
  const [flags, setFlags] = useState<Record<FlagField['key'], boolean>>(() => {
    const base = {
      hasMyNumberCard: false,
      needsNationalHealthInsurance: false,
      needsNationalPension: false,
      hasSchoolOrChildcareNeeds: false,
      hasDog: false,
      needsDisabilityOrCareSupport: false,
      needsForeignResidentGuidance: false,
      needsVehicleGuidance: false,
    };
    if (!existing) return base;
    return {
      hasMyNumberCard: existing.flags.hasMyNumberCard,
      needsNationalHealthInsurance: existing.flags.needsNationalHealthInsurance,
      needsNationalPension: existing.flags.needsNationalPension,
      hasSchoolOrChildcareNeeds: existing.flags.hasSchoolOrChildcareNeeds,
      hasDog: existing.flags.hasDog,
      needsDisabilityOrCareSupport: existing.flags.needsDisabilityOrCareSupport,
      needsForeignResidentGuidance: existing.flags.needsForeignResidentGuidance,
      needsVehicleGuidance: existing.flags.needsVehicleGuidance,
    };
  });
  const [dogMicrochip, setDogMicrochip] = useState<Tri>(() => {
    const v = existing?.flags.dogHasMicrochip;
    if (v === true) return 'yes';
    if (v === false) return 'no';
    return 'unknown';
  });

  const step1Valid = moveDate !== '' && originType !== '';

  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  function toggleAgeBand(band: AgeBand) {
    setAgeBands((prev) => (prev.includes(band) ? prev.filter((b) => b !== band) : [...prev, band]));
  }

  const builtProfile = useMemo<Profile | null>(() => {
    if (!municipalityCode || !step1Valid) return null;
    const bands = ageBands.length > 0 ? ageBands : (['adult'] as AgeBand[]);
    const memberCount = householdKind === 'multiple' ? Math.max(2, bands.length) : 1;
    const dogHasMicrochip: Flags['dogHasMicrochip'] =
      dogMicrochip === 'yes' ? true : dogMicrochip === 'no' ? false : 'unknown';
    const profile = {
      destination: { municipalityCode },
      moveDate,
      originType,
      household: { memberCount, ageBands: bands },
      flags: {
        ...flags,
        dogHasMicrochip,
        isPregnantMember: isPregnant,
      },
    };
    const parsed = profileSchema.safeParse(profile);
    return parsed.success ? parsed.data : null;
  }, [
    municipalityCode,
    step1Valid,
    ageBands,
    householdKind,
    dogMicrochip,
    moveDate,
    originType,
    flags,
    isPregnant,
  ]);

  function generate() {
    if (!municipalityCode) return;
    if (!step1Valid) {
      setErrorMsg('引越し日と転入元区分を入力してください。');
      setStep(1);
      return;
    }
    if (!builtProfile) {
      setErrorMsg('入力内容を確認してください。');
      return;
    }
    saveProfile(municipalityCode, builtProfile);
    navigate('/checklist');
  }

  if (!municipalityCode) {
    return (
      <Card>
        <p className="text-slate-700">先に自治体を選んでください。</p>
        <p className="mt-2">
          <Link to="/" className="font-semibold text-brand-700 underline">
            自治体選択へ戻る
          </Link>
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold text-slate-900">条件を入力する</h1>

      <ol className="flex flex-wrap gap-2 text-sm" aria-label="入力ステップ">
        {STEPS.map((label, i) => {
          const n = i + 1;
          const active = n === step;
          return (
            <li key={label}>
              <button
                type="button"
                onClick={() => setStep(n)}
                aria-current={active ? 'step' : undefined}
                className={`inline-flex items-center gap-1.5 rounded-full py-1.5 pl-1.5 pr-3 transition-colors ${
                  active
                    ? 'bg-brand-600 font-semibold text-white shadow-sm'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`grid h-5 w-5 place-items-center rounded-full text-xs font-bold ${
                    active ? 'bg-white/25 text-white' : 'bg-white text-slate-600'
                  }`}
                >
                  {n}
                </span>
                {/* なぜ: ラベルと（必須/任意）を1つのテキストノードにまとめ、要素境界での
                    アクセシブル名への空白挿入を防ぐ(E2Eは「世帯（任意）」を空白なしで参照)。 */}
                {`${label}${n === 1 ? '（必須）' : '（任意）'}`}
              </button>
            </li>
          );
        })}
      </ol>

      {errorMsg && (
        <p
          role="alert"
          className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-900"
        >
          {errorMsg}
        </p>
      )}

      {step === 1 && (
        <Card className="space-y-5">
          <div>
            <label htmlFor="moveDate" className="block font-semibold text-slate-900">
              引越し日または転入予定日
              <span className="ml-1 text-red-700">*</span>
            </label>
            <p className="text-xs text-slate-500">
              手続きの期限は引越し日を基準に計算するため、目安の日付を選んでください。
            </p>
            <input
              id="moveDate"
              type="date"
              value={moveDate}
              onChange={(e) => setMoveDate(e.target.value)}
              className="mt-2 rounded-lg border border-slate-300 px-3 py-2 transition-colors focus:border-brand-500"
              required
            />
          </div>

          <fieldset>
            <legend className="font-semibold text-slate-900">
              転入元区分
              <span className="ml-1 text-red-700">*</span>
            </legend>
            <p className="text-xs text-slate-500">
              どこからの引越しかで必要な手続きや持ち物が変わるため、うかがいます。
            </p>
            <div className="mt-2 space-y-1">
              {ORIGIN_TYPES.map((o) => (
                <label
                  key={o}
                  className="-mx-2 flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50"
                >
                  <input
                    type="radio"
                    name="originType"
                    value={o}
                    checked={originType === o}
                    onChange={() => setOriginType(o)}
                  />
                  <span>{originTypeLabel[o]}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => setStep(2)}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-50"
            >
              次へ（世帯の入力）
            </button>
          </div>
        </Card>
      )}

      {step === 2 && (
        <Card className="space-y-5">
          <fieldset>
            <legend className="font-semibold text-slate-900">世帯の人数</legend>
            <p className="text-xs text-slate-500">
              単身か複数人かで必要な手続きが変わることがあるため、うかがいます。
            </p>
            <div className="mt-2 space-y-1">
              {(['single', 'multiple'] as HouseholdKind[]).map((k) => (
                <label
                  key={k}
                  className="-mx-2 flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50"
                >
                  <input
                    type="radio"
                    name="householdKind"
                    checked={householdKind === k}
                    onChange={() => setHouseholdKind(k)}
                  />
                  <span>{k === 'single' ? '単身（1人）' : '複数人'}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="font-semibold text-slate-900">
              世帯員の年齢帯（当てはまるものすべて）
            </legend>
            <p className="text-xs text-slate-500">
              子育て・高齢者向けなど、年齢によって必要な案内が変わるため、うかがいます。
            </p>
            <div className="mt-2 grid grid-cols-2 gap-1 sm:grid-cols-3">
              {AGE_BANDS.map((band) => (
                <label
                  key={band}
                  className="-mx-1 flex cursor-pointer items-center gap-2 rounded-lg px-1 py-1.5 hover:bg-slate-50"
                >
                  <input
                    type="checkbox"
                    checked={ageBands.includes(band)}
                    onChange={() => toggleAgeBand(band)}
                  />
                  <span>{ageBandLabel[band]}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="font-semibold text-slate-900">妊娠中の方がいるか</legend>
            <p className="text-xs text-slate-500">
              母子健康手帳など、妊娠に関する案内の要否を判定します。
            </p>
            <label className="mt-2 flex items-center gap-2">
              <input
                type="checkbox"
                checked={isPregnant}
                onChange={(e) => setIsPregnant(e.target.checked)}
              />
              <span>妊娠中の方がいる</span>
            </label>
          </fieldset>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-50"
            >
              戻る
            </button>
            <button
              type="button"
              onClick={() => setStep(3)}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-50"
            >
              次へ（条件チェック）
            </button>
          </div>
        </Card>
      )}

      {step === 3 && (
        <Card className="space-y-5">
          <fieldset>
            <legend className="font-semibold text-slate-900">当てはまる条件（任意）</legend>
            <p className="text-xs text-slate-500">
              チェックした条件に応じて、必要な手続きを追加します。分からない項目は空欄のままで構いません。
            </p>
            <div className="mt-2 space-y-3">
              {FLAG_FIELDS.map((f) => (
                <div key={f.key}>
                  <label className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={flags[f.key]}
                      onChange={(e) => setFlags((prev) => ({ ...prev, [f.key]: e.target.checked }))}
                    />
                    <span>
                      <span className="font-medium text-slate-900">{f.label}</span>
                      <span className="block text-xs text-slate-500">{f.why}</span>
                    </span>
                  </label>

                  {f.key === 'hasDog' && flags.hasDog && (
                    <fieldset className="ml-6 mt-2 rounded border border-slate-200 p-3">
                      <legend className="px-1 text-sm font-semibold text-slate-800">
                        犬にマイクロチップは装着されていますか？
                      </legend>
                      <p className="text-xs text-slate-500">
                        装着・登録の有無で届出先（区の窓口か環境省データベースか）が変わります。
                      </p>
                      <div className="mt-1 space-y-1">
                        {(['yes', 'no', 'unknown'] as Tri[]).map((v) => (
                          <label
                            key={v}
                            className="-mx-2 flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-white"
                          >
                            <input
                              type="radio"
                              name="dogMicrochip"
                              checked={dogMicrochip === v}
                              onChange={() => setDogMicrochip(v)}
                            />
                            <span>
                              {v === 'yes' ? 'はい' : v === 'no' ? 'いいえ' : 'わからない'}
                            </span>
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  )}
                </div>
              ))}
            </div>
          </fieldset>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => setStep(2)}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-50"
            >
              戻る
            </button>
          </div>
        </Card>
      )}

      {/* Step1完了時点でいつでも生成できる(FR-003)。Step2/3はスキップ可。 */}
      <div className="sticky bottom-0 -mx-4 border-t border-slate-200 bg-white/95 px-4 py-3 shadow-[0_-4px_16px_-8px_rgba(15,41,73,0.25)] backdrop-blur">
        <button
          type="button"
          onClick={generate}
          disabled={!step1Valid}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-3 text-base font-bold text-white shadow-sm transition-colors hover:bg-brand-700 active:bg-brand-800 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500 disabled:shadow-none"
        >
          <svg aria-hidden="true" viewBox="0 0 20 20" className="h-5 w-5" fill="currentColor">
            <path
              fillRule="evenodd"
              d="M16.7 5.3a1 1 0 010 1.4l-7.5 7.5a1 1 0 01-1.4 0l-3.5-3.5a1 1 0 011.4-1.4l2.8 2.79 6.8-6.79a1 1 0 011.4 0z"
              clipRule="evenodd"
            />
          </svg>
          この内容でチェックリストを作成
        </button>
        {!step1Valid && (
          <p className="mt-1 text-center text-xs text-slate-500">
            引越し日と転入元区分（ステップ1）を入力すると作成できます。
          </p>
        )}
      </div>
    </div>
  );
}
