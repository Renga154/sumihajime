import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  profileSchema,
  type AgeBand,
  type Flags,
  type OriginType,
  type Profile,
} from '@tmn/schemas';
import { getMunicipalities } from '../api/client';
import { useAppState } from '../state/AppState';
import {
  clearWizardDraft,
  isSameWizardAnswers,
  loadProfile,
  loadReviewedSteps,
  loadWizardDraft,
  saveProfile,
  saveReviewedSteps,
  saveWizardDraft,
  type ReviewedSteps,
  type WizardAnswers,
} from '../lib/storage';
import { ageBandLabel, originTypeLabel } from '../lib/format';
import {
  isMoveDateWithinRange,
  moveDateBounds,
  moveDateRangeMessage,
  moveOutScheduledDateRangeMessage,
  todayInTokyo,
} from '../lib/move-date';
import { useDocumentTitle } from '../lib/navigation';
import { useAsync } from '../lib/useAsync';
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

/**
 * ?step=n を開始ステップとして解釈する(範囲外・不正値は1に倒す)。チェックリスト画面の
 * 「条件を追加する」からステップ3へ直接来られるようにするための入口。
 */
export function parseStepParam(raw: string | null): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= STEPS.length ? n : 1;
}

/**
 * 確定プロフィール(あれば)から、画面の初期回答を作る。下書きが無いときの基準値でもある。
 * 純関数にしておき、「下書きに中身があるか(=復元したと言ってよいか)」の判定に使う。
 */
export function answersFromProfile(profile: Profile | null): WizardAnswers {
  return {
    moveDate: profile?.moveDate ?? '',
    moveOutScheduledDate: profile?.moveOutScheduledDate ?? '',
    originType: profile?.originType ?? '',
    householdKind: profile && profile.household.memberCount > 1 ? 'multiple' : 'single',
    ageBands: profile?.household.ageBands ?? ['adult'],
    isPregnant: profile?.flags.isPregnantMember ?? false,
    flags: {
      hasMyNumberCard: profile?.flags.hasMyNumberCard ?? false,
      needsNationalHealthInsurance: profile?.flags.needsNationalHealthInsurance ?? false,
      needsNationalPension: profile?.flags.needsNationalPension ?? false,
      hasSchoolOrChildcareNeeds: profile?.flags.hasSchoolOrChildcareNeeds ?? false,
      hasDog: profile?.flags.hasDog ?? false,
      needsDisabilityOrCareSupport: profile?.flags.needsDisabilityOrCareSupport ?? false,
      needsForeignResidentGuidance: profile?.flags.needsForeignResidentGuidance ?? false,
      needsVehicleGuidance: profile?.flags.needsVehicleGuidance ?? false,
    },
    dogMicrochip:
      profile?.flags.dogHasMicrochip === true
        ? 'yes'
        : profile?.flags.dogHasMicrochip === false
          ? 'no'
          : 'unknown',
  };
}

export function WizardPage() {
  useDocumentTitle('条件を入力する');
  const navigate = useNavigate();
  const { municipalityCode } = useAppState();
  const [searchParams] = useSearchParams();

  /**
   * 確定プロフィールと、確定前の下書き。どちらも端末内(localStorage)のみ。
   * useMemo で自治体ごとに1回だけ読む(下書きは保存のたびに読み直さない=起動時の状態を保つ)。
   */
  const existing = useMemo(
    () => (municipalityCode ? loadProfile(municipalityCode) : null),
    [municipalityCode],
  );
  const baselineAnswers = useMemo(() => answersFromProfile(existing), [existing]);
  const storedDraft = useMemo(
    () => (municipalityCode ? loadWizardDraft(municipalityCode) : null),
    [municipalityCode],
  );
  /**
   * 下書きを実際に「復元した」と言えるのは、確定内容(または初期値)と違う回答が残っていたときだけ。
   * ステップを進めただけの状態を復元と呼ぶと、何も入力していない利用者に嘘を伝えることになる。
   */
  const restoredAnswers =
    storedDraft && !isSameWizardAnswers(storedDraft.answers, baselineAnswers)
      ? storedDraft.answers
      : null;
  const [restoreNotice, setRestoreNotice] = useState<'restored' | 'discarded' | null>(
    restoredAnswers ? 'restored' : null,
  );
  const initialAnswers = restoredAnswers ?? baselineAnswers;

  // 入力中の自治体を画面に出すため名称を引く。取得できない間はコードを表示し、
  // 「どの区の入力をしているか」が一度も見えない状態を作らない(CLAUDE.md原則4)。
  const muniState = useAsync(async () => {
    if (!municipalityCode) return null;
    const munis = await getMunicipalities();
    return munis.find((m) => m.code === municipalityCode)?.name ?? null;
  }, [municipalityCode]);
  const muniName = muniState.data ?? municipalityCode ?? '';

  // 引越し日の受付範囲。マウント時の日本時間の暦日で固定する(描画中に日付が変わらない)。
  const today = useMemo(() => todayInTokyo(), []);
  const dateBounds = useMemo(() => moveDateBounds(today), [today]);

  /**
   * 開始ステップ。?step= の明示指定(チェックリストの「条件を追加する」)が最優先で、
   * 指定が無ければ下書きの中断位置から再開する。
   */
  const initialStep = useMemo(() => {
    const raw = searchParams.get('step');
    if (raw !== null) return parseStepParam(raw);
    return storedDraft?.step ?? 1;
  }, [searchParams, storedDraft]);
  const [step, setRawStep] = useState(initialStep);

  /**
   * 任意ステップを実際に開いたかの記録。過去に開いた記録があれば引き継ぎ、
   * 今回 ?step=2/3 で直接入った場合もその場で「開いた」とみなす。
   *
   * なぜ「開いた」を根拠にするか: ステップ3を開いた利用者は8項目すべてを目にしており、
   * 1つも選ばなかったことは「未入力」ではなく「当てはまるものが無い」という回答である。
   * 選択の有無ではなく閲覧の有無を記録することで、両者を取り違えずに済む。
   */
  const [reviewedSteps, setReviewedSteps] = useState<ReviewedSteps>(() => {
    const stored = municipalityCode
      ? loadReviewedSteps(municipalityCode)
      : { household: false, conditions: false };
    // 下書きの閲覧記録も引き継ぐ。リロードで失うと、実際にはステップ3を見た利用者へ
    // チェックリスト側が「未入力です」と誤った案内を出してしまう。
    const draft = storedDraft?.reviewedSteps ?? { household: false, conditions: false };
    return {
      household: stored.household || draft.household || initialStep >= 2,
      conditions: stored.conditions || draft.conditions || initialStep >= 3,
    };
  });

  function setStep(next: number) {
    setRawStep(next);
    if (next === 2)
      setReviewedSteps((prev) => (prev.household ? prev : { ...prev, household: true }));
    if (next === 3)
      setReviewedSteps((prev) => (prev.conditions ? prev : { ...prev, conditions: true }));
  }

  // 初期値は「下書き(あれば) → 確定プロフィール → 既定値」の順。
  // Step1
  const [moveDate, setMoveDate] = useState(initialAnswers.moveDate);
  const [moveOutScheduledDate, setMoveOutScheduledDate] = useState(
    initialAnswers.moveOutScheduledDate,
  );
  const [originType, setOriginType] = useState<OriginType | ''>(initialAnswers.originType);

  // Step2
  const [householdKind, setHouseholdKind] = useState<HouseholdKind>(initialAnswers.householdKind);
  const [ageBands, setAgeBands] = useState<AgeBand[]>(initialAnswers.ageBands);
  const [isPregnant, setIsPregnant] = useState(initialAnswers.isPregnant);

  // Step3
  const [flags, setFlags] = useState<Record<FlagField['key'], boolean>>(initialAnswers.flags);
  const [dogMicrochip, setDogMicrochip] = useState<Tri>(initialAnswers.dogMicrochip);

  /** いま画面に入っている回答。下書き保存と「初期値と同じか」の判定に使う。 */
  const answers = useMemo<WizardAnswers>(
    () => ({
      moveDate,
      moveOutScheduledDate,
      originType,
      householdKind,
      ageBands,
      isPregnant,
      flags,
      dogMicrochip,
    }),
    [
      moveDate,
      moveOutScheduledDate,
      originType,
      householdKind,
      ageBands,
      isPregnant,
      flags,
      dogMicrochip,
    ],
  );

  /**
   * 入力のたびに下書きを保存する(端末内のみ)。リロード・戻る操作で入力が消えないようにするため。
   * 初期値と同じ内容になったら下書きは消す(何も入力していない利用者に、次回
   * 「復元しました」と伝えないため)。moveDate が受付範囲外のときも保存する
   * — 直しかけの値を消さないほうが利用者の損失が小さく、確定時に別途弾かれる。
   */
  useEffect(() => {
    if (!municipalityCode) return;
    if (isSameWizardAnswers(answers, baselineAnswers)) {
      clearWizardDraft(municipalityCode);
      return;
    }
    saveWizardDraft(municipalityCode, { answers, step, reviewedSteps });
    // 破棄後にまた入力し始めたら「破棄しました」は事実と合わなくなるので下げる。
    setRestoreNotice((prev) => (prev === 'discarded' ? null : prev));
  }, [municipalityCode, answers, baselineAnswers, step, reviewedSteps]);

  // 1900年のような値が素通りしないよう、受付範囲外は入力時点で止める。
  const moveDateOutOfRange = moveDate !== '' && !isMoveDateWithinRange(moveDate, today);
  // 転出予定日は任意項目。未入力(空文字)は「範囲外」ではなく「答えていない」であり、
  // 生成をブロックしない(未入力なら期日を算定しないだけ)。
  const moveOutDateOutOfRange =
    moveOutScheduledDate !== '' && !isMoveDateWithinRange(moveOutScheduledDate, today);
  const step1Filled = moveDate !== '' && originType !== '';
  const step1Valid = step1Filled && !moveDateOutOfRange && !moveOutDateOutOfRange;

  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  /** 下書きを捨てて、確定済みの内容(無ければ空)へ戻す。 */
  function discardDraft() {
    if (municipalityCode) clearWizardDraft(municipalityCode);
    setMoveDate(baselineAnswers.moveDate);
    setMoveOutScheduledDate(baselineAnswers.moveOutScheduledDate);
    setOriginType(baselineAnswers.originType);
    setHouseholdKind(baselineAnswers.householdKind);
    setAgeBands(baselineAnswers.ageBands);
    setIsPregnant(baselineAnswers.isPregnant);
    setFlags(baselineAnswers.flags);
    setDogMicrochip(baselineAnswers.dogMicrochip);
    setErrorMsg(null);
    setRestoreNotice('discarded');
  }

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
      // 未入力なら項目ごと落とす。空文字を送ると境界スキーマ(z.iso.date())が弾くうえ、
      // 「答えていない」を「空という答え」に変えてしまう。
      ...(moveOutScheduledDate !== '' ? { moveOutScheduledDate } : {}),
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
    moveOutScheduledDate,
    originType,
    flags,
    isPregnant,
  ]);

  function generate() {
    if (!municipalityCode) return;
    if (moveDateOutOfRange) {
      setErrorMsg(moveDateRangeMessage(today));
      setStep(1);
      return;
    }
    if (moveOutDateOutOfRange) {
      setErrorMsg(moveOutScheduledDateRangeMessage(today));
      setStep(1);
      return;
    }
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
    // 「どのステップを見たか」はプロフィールと同じタイミングで確定させる(端末内のみ)。
    saveReviewedSteps(municipalityCode, reviewedSteps);
    // 確定した内容はプロフィール側が持つ。下書きを残すと、次に開いたとき
    // 確定済みの内容を「入力途中」として復元してしまう。
    clearWizardDraft(municipalityCode);
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

      {/*
        いま何区の入力をしているかを常に見せる(CLAUDE.md原則4)。区名が初めて出るのが
        チェックリスト到達後だと、区を取り違えたまま全項目を入力しきってしまう。
        チェックリスト画面と同じ体裁のチップを使い、隣に選び直す導線を置く。
      */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1 font-semibold text-brand-800 ring-1 ring-inset ring-brand-100">
          <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor">
            <path
              fillRule="evenodd"
              d="M10 2a5 5 0 00-5 5c0 3.5 5 9 5 9s5-5.5 5-9a5 5 0 00-5-5zm0 6.5A1.5 1.5 0 1110 5.5a1.5 1.5 0 010 3z"
              clipRule="evenodd"
            />
          </svg>
          <span className="sr-only">自治体：</span>
          {muniName}
        </span>
        <Link
          to="/"
          className="tap-target inline-flex items-center gap-1 font-semibold text-brand-700 underline decoration-brand-300 underline-offset-2 hover:text-brand-800"
        >
          自治体を変える
        </Link>
      </div>

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

      {/*
        下書きの復元を黙って行わない。値が勝手に入っていると「自分が入力したのか」が
        分からず、確定してよいかも判断できない。何をしたのか・次に何をすればよいのかを書き、
        破棄する手段を同じ場所に置く。role="status" で読み上げにも届ける。
      */}
      {restoreNotice === 'restored' && (
        <div
          role="status"
          className="rounded-lg border border-brand-200 bg-brand-50 p-3 text-sm text-brand-900"
        >
          <p className="font-semibold">前回の入力途中の内容を復元しました</p>
          <p className="mt-1">
            この端末に一時保存していた内容です（まだチェックリストには反映していません）。内容を確認し、必要なら直してから「この内容でチェックリストを作成」を押してください。
          </p>
          <p className="mt-2">
            <button
              type="button"
              onClick={discardDraft}
              className="tap-target inline-flex items-center rounded-lg border border-brand-300 bg-white px-3 py-1.5 font-semibold text-brand-800 transition-colors hover:bg-brand-50"
            >
              復元した内容を破棄して入力し直す
            </button>
          </p>
        </div>
      )}
      {restoreNotice === 'discarded' && (
        <p
          role="status"
          className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700"
        >
          入力途中の内容を破棄しました。最初から入力してください。
        </p>
      )}

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
            <p className="text-xs text-slate-500" id="moveDate-help">
              手続きの期限は引越し日を基準に計算するため、目安の日付を選んでください。
              {`（${dateBounds.min} 〜 ${dateBounds.max} の範囲で入力できます）`}
            </p>
            <input
              id="moveDate"
              type="date"
              value={moveDate}
              onChange={(e) => setMoveDate(e.target.value)}
              min={dateBounds.min}
              max={dateBounds.max}
              aria-describedby={
                moveDateOutOfRange ? 'moveDate-help moveDate-error' : 'moveDate-help'
              }
              aria-invalid={moveDateOutOfRange || undefined}
              className="mt-2 rounded-lg border border-slate-300 px-3 py-2 transition-colors focus:border-brand-500"
              required
            />
            {moveDateOutOfRange && (
              <p
                id="moveDate-error"
                role="alert"
                className="mt-2 rounded border border-red-300 bg-red-50 p-2 text-sm text-red-900"
              >
                {moveDateRangeMessage(today)}
              </p>
            )}
          </div>

          {/*
            なぜこの欄を足したか: 児童手当の15日特例は多くの区が「前住所地の転出予定日の翌日から
            15日以内」と明記しており、マイナンバーカードの継続利用も「転出予定日から30日以内に
            転入届」を失効条件に挙げる区がある。引越し日だけでは、これらの期日を算定できない。
            任意項目のままにするのは、まだ転出届を出していない利用者を止めないため。未入力なら
            推測で埋めず「要確認」のまま表示する(CLAUDE.md原則3)。
          */}
          <div>
            <label htmlFor="moveOutScheduledDate" className="block font-semibold text-slate-900">
              前住所地の転出予定日（任意）
            </label>
            <p className="text-xs text-slate-500" id="moveOutScheduledDate-help">
              前の住所の市区町村へ転出届を出すときに「いつ引っ越すか」として届け出た日です（転出証明書にも記載されています）。児童手当の15日特例やマイナンバーカードの継続利用は、この日を起算日として期限を定めている区があるため、うかがいます。分からない・まだ転出届を出していない場合は空欄で構いません（その場合、該当する手続きの期限は「要確認」と表示します）。海外からの転入では入力不要です。
            </p>
            <input
              id="moveOutScheduledDate"
              type="date"
              value={moveOutScheduledDate}
              onChange={(e) => setMoveOutScheduledDate(e.target.value)}
              min={dateBounds.min}
              max={dateBounds.max}
              aria-describedby={
                moveOutDateOutOfRange
                  ? 'moveOutScheduledDate-help moveOutScheduledDate-error'
                  : 'moveOutScheduledDate-help'
              }
              aria-invalid={moveOutDateOutOfRange || undefined}
              className="mt-2 rounded-lg border border-slate-300 px-3 py-2 transition-colors focus:border-brand-500"
            />
            {moveOutDateOutOfRange && (
              <p
                id="moveOutScheduledDate-error"
                role="alert"
                className="mt-2 rounded border border-red-300 bg-red-50 p-2 text-sm text-red-900"
              >
                {moveOutScheduledDateRangeMessage(today)}
              </p>
            )}
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
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-3 text-base font-bold text-white transition-colors hover:bg-brand-700 active:bg-brand-800 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500"
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
        {/* なぜ: ステップ1だけでも作成できる(FR-003)ことは維持しつつ、条件を選ばないと
            マイナンバーカード等の手続きが判定対象外のままになることを、押す前に伝える。 */}
        <p className="mt-1 text-center text-xs text-slate-500">
          {moveDateOutOfRange
            ? moveDateRangeMessage(today)
            : moveOutDateOutOfRange
              ? moveOutScheduledDateRangeMessage(today)
              : !step1Valid
                ? '引越し日と転入元区分（ステップ1）を入力すると作成できます。'
                : 'ステップ2・3も入力すると、マイナンバーカード・国民健康保険・国民年金などの該当判定まで含められます。'}
        </p>
      </div>
    </div>
  );
}
