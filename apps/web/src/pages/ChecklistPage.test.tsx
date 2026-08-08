import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { Route } from 'react-router-dom';
import { profileSchema, type ChecklistResponse, type GeneratedTask } from '@tmn/schemas';
import { renderWithProviders } from '../test/utils';

/**
 * なぜ: VS1受入3/5/6。モックAPI応答から期限順セクションへ振り分けられること、
 * needs_confirmation が「要確認」で表示されること、完了チェックが localStorage に
 * 反映されること(C-4)を固定する。
 */

function makeTask(o: Partial<GeneratedTask>): GeneratedTask {
  return {
    id: o.id ?? 'id',
    procedureId: o.procedureId ?? 'p',
    title: o.title ?? 't',
    category: 'c',
    priority: o.priority ?? 'normal',
    applicabilityReason: o.applicabilityReason ?? 'なぜならば',
    requiredDocuments: [],
    channels: ['counter'],
    sources: [
      {
        sourceId: 's',
        title: 's',
        url: 'https://e.example/x',
        lastVerifiedAt: '2026-07-21T00:00:00Z',
      },
    ],
    dataStatus: 'partial',
    ruleVersion: 'v1',
    procedureVersion: 'v1',
    ...o,
  };
}

const FIXTURE: ChecklistResponse = {
  ruleVersion: 'v1',
  generatedAt: '2026-07-21T00:00:00Z',
  tasks: [
    makeTask({
      id: 't-res',
      procedureId: 'procedure_resident_registration',
      title: '転入届',
      priority: 'urgent',
      dueDate: '2026-08-15',
      applicable: 'applicable',
    }),
    makeTask({
      id: 't-dog',
      procedureId: 'procedure_dog',
      title: '飼い犬の登録事項変更届',
      applicable: 'needs_confirmation',
      applicabilityReason: 'マイクロチップの有無が未確認です。',
    }),
    makeTask({
      id: 't-waste',
      procedureId: 'procedure_waste_check',
      title: 'ごみ収集日の確認',
      category: 'waste_schedule',
      dueDescription: '生活開始まで',
      applicable: 'applicable',
    }),
    // ADR-009: 区の窓口では済まない手続き(東京都水道局)。バッジで区別されることを固定する。
    makeTask({
      id: 't-water',
      procedureId: 'procedure_water_supply',
      title: '水道(下水道を含む)の使用開始・使用中止の手続き',
      category: 'water_supply',
      dueDescription: '3〜4日前までに',
      applicable: 'applicable',
    }),
  ],
};

vi.mock('../api/client', () => ({
  // 実物と同じく status を持たせる。チェックリストは「今は届かない失敗(0/429/5xx)」だけを
  // 端末内の控えへ退避させ、404/409/422 のような確定した答えでは退避しない。
  ApiError: class ApiError extends Error {
    readonly status: number;
    readonly code: string;
    readonly officialUrl?: string;
    constructor(status: number, code: string, message: string) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.code = code;
    }
  },
  ChatDisabledError: class ChatDisabledError extends Error {},
  getMunicipalities: vi.fn(async () => [
    { code: '13112', name: '世田谷区', supported: true, coverage: [] },
  ]),
  postChecklist: vi.fn(async () => FIXTURE),
  // RAGはこのテストのスコープ外。無効にしてチャットパネルを非表示にする。
  getChatAvailability: vi.fn(async () => ({ enabled: false, mode: 'disabled' })),
  postChat: vi.fn(),
}));

import { ApiError, getMunicipalities, postChecklist } from '../api/client';
import { ChecklistPage } from './ChecklistPage';

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('tmn:municipality', '13112');
  const profile = profileSchema.parse({
    destination: { municipalityCode: '13112' },
    moveDate: '2026-08-01',
    originType: 'outside_tokyo',
    household: { memberCount: 1, ageBands: ['adult'] },
    flags: {
      hasMyNumberCard: false,
      needsNationalHealthInsurance: false,
      needsNationalPension: false,
      hasSchoolOrChildcareNeeds: false,
      hasDog: true,
      needsDisabilityOrCareSupport: false,
      needsForeignResidentGuidance: false,
    },
  });
  localStorage.setItem('tmn:profile:13112', JSON.stringify(profile));
});

function renderChecklist() {
  return renderWithProviders(<ChecklistPage />, {
    path: '/checklist',
    initialEntry: '/checklist',
    extraRoutes: <Route path="/procedures/:id" element={<div>詳細</div>} />,
  });
}

describe('ChecklistPage', () => {
  it('タスクを期限順セクションへ振り分けて表示する', async () => {
    renderChecklist();
    expect(await screen.findByRole('heading', { name: /転入後すぐ/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /生活開始/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /該当者のみ・要確認/ })).toBeInTheDocument();
    expect(screen.getByText('転入届')).toBeInTheDocument();
  });

  it('needs_confirmation のタスクに「要確認」バッジと理由を表示する', async () => {
    renderChecklist();
    expect(await screen.findByText('要確認')).toBeInTheDocument();
    expect(screen.getByText('マイクロチップの有無が未確認です。')).toBeInTheDocument();
  });

  it('区以外の手続きだけに「区以外の手続き」バッジを表示する(ADR-009)', async () => {
    renderChecklist();
    const badges = await screen.findAllByText('区以外の手続き');
    // 4タスク中、非自治体カテゴリ(water_supply)の1件だけに付く。
    expect(badges).toHaveLength(1);
    const card = badges[0]?.closest('li');
    expect(card?.textContent).toContain('水道');
    // 区の手続き(転入届・ごみ)のカードには付かない。
    const residentCard = screen.getByText('転入届').closest('li');
    expect(residentCard?.textContent).not.toContain('区以外の手続き');
  });

  it('タスク名を h3 見出しにする(スクリーンリーダーの見出しジャンプで辿れる)', async () => {
    renderChecklist();
    const heading = await screen.findByRole('heading', { name: '転入届', level: 3 });
    expect(heading).toBeInTheDocument();
    // 見出し内のラベルは引き続きチェックボックスに紐づく(クリックで完了にできる)。
    expect(screen.getByLabelText('転入届')).toHaveAttribute('type', 'checkbox');
  });

  it('条件を1つでも選んでいれば「まだ判定していない条件」の案内を出さない', async () => {
    // beforeEach のプロフィールは hasDog=true(=条件を選んでいる)。
    renderChecklist();
    await screen.findByText('転入届');
    expect(screen.queryByRole('heading', { name: 'まだ判定していない条件があります' })).toBeNull();
  });

  it('完了チェックが localStorage に反映される(C-4)', async () => {
    renderChecklist();
    const checkbox = await screen.findByLabelText('転入届');
    expect(checkbox).not.toBeChecked();

    fireEvent.click(checkbox);

    await waitFor(() => {
      const done = JSON.parse(localStorage.getItem('tmn:done:13112') ?? '{}');
      expect(done['procedure_resident_registration']).toBeTruthy();
    });
    expect(checkbox).toBeChecked();
  });
});

/**
 * なぜ: ステップ1だけで生成すると、条件フラグがすべて false のまま評価され、
 * マイナンバーカードの継続利用・国民健康保険・国民年金といった期限つきの手続きが一件も
 * 出ない。それでも「n/m件完了」とだけ出るため全量だと誤解される。案内カードと、
 * ステップ3への導線が出ることを固定する(フラグの既定値は推測で変えない)。
 */
describe('ChecklistPage — ステップ2/3を入力せずに生成した場合', () => {
  beforeEach(() => {
    const profile = profileSchema.parse({
      destination: { municipalityCode: '13112' },
      moveDate: '2026-08-01',
      originType: 'outside_tokyo',
      household: { memberCount: 1, ageBands: ['adult'] },
      flags: {
        hasMyNumberCard: false,
        needsNationalHealthInsurance: false,
        needsNationalPension: false,
        hasSchoolOrChildcareNeeds: false,
        hasDog: false,
        needsDisabilityOrCareSupport: false,
        needsForeignResidentGuidance: false,
      },
    });
    localStorage.setItem('tmn:profile:13112', JSON.stringify(profile));
  });

  it('「まだ判定していない条件があります」の案内と、未判定の条件名を表示する', async () => {
    renderChecklist();
    expect(
      await screen.findByRole('heading', { name: 'まだ判定していない条件があります' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/マイナンバーカード、国民健康保険、国民年金/)).toBeInTheDocument();
  });

  it('世帯(ステップ2)も初期値のままなら、その旨も併せて伝える', async () => {
    renderChecklist();
    await screen.findByRole('heading', { name: 'まだ判定していない条件があります' });
    expect(screen.getByText(/世帯（ステップ2）も未入力/)).toBeInTheDocument();
  });

  it('「条件を追加する」でウィザードのステップ3へ直接遷移できる', async () => {
    renderChecklist();
    const link = await screen.findByRole('link', { name: '条件を追加する' });
    expect(link).toHaveAttribute('href', '/wizard?step=3');
  });

  /**
   * なぜ(独立点検): 会社の健康保険に入っている単身の成人は、ステップ3の8項目を実際に見たうえで
   * 1つも当てはまらないことがある。保存されるフラグはステップ3を飛ばした場合と同一になるため、
   * 以前はこの利用者にも「条件チェック（ステップ3）が未入力です」と表示していた。事実に反する
   * 断定であり、原則3に反する。閲覧記録がある場合は案内を出さないことを固定する。
   */
  it('ステップ3を開いて1つも当てはまらなかった場合は、案内を出さない', async () => {
    localStorage.setItem(
      'tmn:reviewed-steps:13112',
      JSON.stringify({ household: true, conditions: true }),
    );
    renderChecklist();
    // チェックリスト本体が描画されるまで待ってから、案内が無いことを確認する。
    await screen.findByText(/進捗/);
    expect(screen.queryByRole('heading', { name: 'まだ判定していない条件があります' })).toBeNull();
  });

  it('ステップ3を開いていない記録なら、従来どおり案内を出す', async () => {
    localStorage.setItem(
      'tmn:reviewed-steps:13112',
      JSON.stringify({ household: true, conditions: false }),
    );
    renderChecklist();
    await screen.findByRole('heading', { name: 'まだ判定していない条件があります' });
    // 世帯は開いているので、世帯の一文は出さない。
    expect(screen.queryByText(/世帯（ステップ2）も未入力/)).toBeNull();
  });
});

/**
 * なぜ: 前住所地の転出予定日はステップ1の任意項目なので、多くの利用者が空欄のまま進む。
 * その結果、区が「転出予定日の翌日から15日以内」と明記している児童手当のような手続きでも
 * 「期限は要確認」としか出ない。入れれば日付が出せることを、その人に実際に効く手続き名を
 * 添えて伝える(ADR-013)。どの手続きが該当するかは API 応答から受け取り、画面には
 * 区コードの分岐を書かない。
 */
describe('ChecklistPage — 転出予定日の案内', () => {
  const IMPACT_FIXTURE: ChecklistResponse = {
    ...FIXTURE,
    tasks: [
      makeTask({
        id: 't-child',
        procedureId: 'procedure_child_allowance',
        title: '児童手当の認定請求',
        priority: 'high',
        applicable: 'applicable',
      }),
      makeTask({
        id: 't-mynumber',
        procedureId: 'procedure_mynumber_continued_use',
        title: 'マイナンバーカードの継続利用',
        priority: 'high',
        dueDate: '2026-08-15',
        applicable: 'applicable',
      }),
    ],
    moveOutScheduledDateImpact: {
      enablesDueDateFor: ['procedure_child_allowance'],
      advancesDueDateFor: ['procedure_mynumber_continued_use'],
    },
  };

  function seedProfile(over: Record<string, unknown> = {}) {
    const profile = profileSchema.parse({
      destination: { municipalityCode: '13112' },
      moveDate: '2026-08-01',
      originType: 'outside_tokyo',
      household: { memberCount: 2, ageBands: ['adult', 'age0_2'] },
      flags: {
        hasMyNumberCard: true,
        needsNationalHealthInsurance: false,
        needsNationalPension: false,
        hasSchoolOrChildcareNeeds: true,
        hasDog: false,
        needsDisabilityOrCareSupport: false,
        needsForeignResidentGuidance: false,
      },
      ...over,
    });
    localStorage.setItem('tmn:profile:13112', JSON.stringify(profile));
  }

  it('日付を出せるようになる手続き名と、入力画面への導線を表示する', async () => {
    seedProfile();
    vi.mocked(postChecklist).mockResolvedValueOnce(IMPACT_FIXTURE);
    renderChecklist();

    const notice = await screen.findByRole('region', {
      name: '前住所地の転出予定日を入れると、期限を日付で出せます',
    });
    expect(notice).toHaveTextContent('いま「期限は要確認」と表示している児童手当の認定請求');
    expect(notice).toHaveTextContent('期限を日付で表示し');
    // 既に日付が出ている手続きは「より早くなることがある」として別の文で伝える。
    expect(notice).toHaveTextContent(/マイナンバーカードの継続利用は既に日付を表示していますが/);
    expect(notice).toHaveTextContent(/より早い期限に変わることがあります/);
    // 未入力のままでもよいことを言い添える(入力を強いない)。
    expect(notice).toHaveTextContent(/空欄のままで構いません/);

    const link = screen.getByRole('link', { name: '転出予定日を入力する' });
    expect(link).toHaveAttribute('href', '/wizard?step=1');
  });

  /**
   * なぜ role="status" を使わないか: 進捗表示(「n/m件完了」)が既に live region を持っており、
   * 1画面に複数のステータスを置くと読み上げが競合する。見出しつきの region にする。
   */
  it('進捗表示と競合しないよう、role="status" ではなく見出しつきの region にする', async () => {
    seedProfile();
    vi.mocked(postChecklist).mockResolvedValueOnce(IMPACT_FIXTURE);
    renderChecklist();

    const notice = await screen.findByRole('region', {
      name: '前住所地の転出予定日を入れると、期限を日付で出せます',
    });
    expect(notice.getAttribute('role')).toBeNull();
    // live region は進捗のひとつだけ。
    expect(screen.getAllByRole('status')).toHaveLength(1);
  });

  /**
   * なぜ見出しを分けるか: 新宿のように「期日は既に出ているが、より早くなりうる」だけの区がある。
   * そこで「期限を日付で出せます」と書くと、入力しても新しい日付は出ないので約束を破ることになる。
   */
  it('日付が新たに出るものが無い区では、見出しを「より早い日になることがあります」にする', async () => {
    seedProfile();
    vi.mocked(postChecklist).mockResolvedValueOnce({
      ...IMPACT_FIXTURE,
      moveOutScheduledDateImpact: {
        enablesDueDateFor: [],
        advancesDueDateFor: ['procedure_mynumber_continued_use'],
      },
    });
    renderChecklist();

    const notice = await screen.findByRole('region', {
      name: '前住所地の転出予定日を入れると、期限がより早い日になることがあります',
    });
    // 「日付で出せます」とは言わない(この人には新しい日付が出ないため)。
    expect(notice).not.toHaveTextContent('いま「期限は要確認」と表示している');
    expect(notice).toHaveTextContent(/より早い期限に変わることがあります/);
  });

  it('転出予定日が入力済みなら出さない', async () => {
    seedProfile({ moveOutScheduledDate: '2026-07-25' });
    vi.mocked(postChecklist).mockResolvedValueOnce(IMPACT_FIXTURE);
    renderChecklist();

    await screen.findByText('児童手当の認定請求');
    expect(screen.queryByRole('link', { name: '転出予定日を入力する' })).toBeNull();
  });

  it('海外からの転入では出さない', async () => {
    seedProfile({ originType: 'overseas' });
    vi.mocked(postChecklist).mockResolvedValueOnce(IMPACT_FIXTURE);
    renderChecklist();

    await screen.findByText('児童手当の認定請求');
    expect(screen.queryByRole('link', { name: '転出予定日を入力する' })).toBeNull();
  });

  it('該当する手続きが無い区(応答が空)では出さない', async () => {
    seedProfile();
    vi.mocked(postChecklist).mockResolvedValueOnce({
      ...IMPACT_FIXTURE,
      moveOutScheduledDateImpact: { enablesDueDateFor: [], advancesDueDateFor: [] },
    });
    renderChecklist();

    await screen.findByText('児童手当の認定請求');
    expect(screen.queryByRole('link', { name: '転出予定日を入力する' })).toBeNull();
  });

  it('判定材料を持たない応答(古い端末内の控えなど)では出さない', async () => {
    seedProfile();
    vi.mocked(postChecklist).mockResolvedValueOnce({
      ...IMPACT_FIXTURE,
      moveOutScheduledDateImpact: undefined,
    });
    renderChecklist();

    await screen.findByText('児童手当の認定請求');
    expect(screen.queryByRole('link', { name: '転出予定日を入力する' })).toBeNull();
  });
});

/**
 * なぜ: 転入後にこのサービスを知る利用者が主要ターゲットなので、期限を過ぎた状態を
 * 何の表示もなく通常タスクとして並べない(監査P1-5)。ただし届出済みかは分からないため
 * 断定せず「可能性」にとどめ、次の行動を添える(原則3)。
 */
describe('ChecklistPage — 期限を過ぎたタスク', () => {
  function withTasks(dueDate: string) {
    vi.mocked(postChecklist).mockResolvedValueOnce({
      ...FIXTURE,
      tasks: [
        makeTask({
          id: 't-past',
          procedureId: 'procedure_resident_registration',
          title: '転入届',
          priority: 'urgent',
          dueDate,
          applicable: 'applicable',
        }),
      ],
    });
  }

  it('過去の期限には「期限を過ぎている可能性」と次の行動を出す', async () => {
    withTasks('2020-01-01');
    renderChecklist();
    expect(await screen.findByText(/期限を過ぎている可能性/)).toBeVisible();
    expect(screen.getByText(/遅れても手続きは必要です/)).toBeVisible();
    // 断定しない: 「期限切れです」のような言い切りはしない。
    expect(document.body.textContent).not.toContain('期限切れです');
  });

  it('未来の期限には超過表示を出さない', async () => {
    withTasks('2099-12-31');
    renderChecklist();
    await screen.findByText('転入届');
    expect(screen.queryByText(/期限を過ぎている可能性/)).toBeNull();
  });
});

/**
 * なぜ(独立点検 P1 / 原則8): 生成結果はメモリ上にしか無く、APIへ届かないと画面から全部消えた。
 * 区役所の弱い電波で、手続きも公式リンクも窓口の前で失われるのが最悪の場面。端末内の控えへ
 * 退避すること、そのとき**最新の取得ではない**と必ず伝えること、条件を変えたら控えを使わない
 * ことを固定する。
 */
describe('ChecklistPage — APIへ届かないとき', () => {
  const CACHE_KEY = 'tmn:checklist-cache:13112';

  /** 一度成功させて端末内の控えを作り、画面は片付ける。 */
  async function seedCache() {
    renderChecklist();
    await screen.findByText('転入届');
    await waitFor(() => expect(localStorage.getItem(CACHE_KEY)).not.toBeNull());
    cleanup();
  }

  it('取得に成功したら控えを更新する', async () => {
    renderChecklist();
    await screen.findByText('転入届');
    await waitFor(() => expect(localStorage.getItem(CACHE_KEY)).not.toBeNull());

    const entry = JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}');
    expect(entry.municipalityName).toBe('世田谷区');
    expect(entry.checklist.ruleVersion).toBe('v1');
    // 成功表示のときは控えの告知を出さない。
    expect(
      screen.queryByRole('heading', { name: '保存してあった内容を表示しています' }),
    ).toBeNull();
  });

  it.each([
    ['通信断・タイムアウト', 0, 'network_error'],
    ['サーバー不調(503)', 503, 'unavailable'],
    ['混雑(429)', 429, 'rate_limited'],
  ])('%s では控えを表示し、いつ時点かを明示する', async (_label, status, code) => {
    await seedCache();
    vi.mocked(postChecklist).mockRejectedValueOnce(
      new ApiError(status as number, code as string, 'サーバーに接続できませんでした。'),
    );

    renderChecklist();

    expect(
      await screen.findByRole('heading', { name: '保存してあった内容を表示しています' }),
    ).toBeInTheDocument();
    // 本体(タスクと公式根拠への導線)は残る。
    expect(screen.getByText('転入届')).toBeInTheDocument();
    expect(
      screen.getAllByRole('link', { name: /詳細・必要書類・公式根拠を見る/ }).length,
    ).toBeGreaterThan(0);
    // 最新だと言わない。取得時刻と経過を添える(原則3)。
    expect(screen.getByText(/これは最新の取得ではありません/)).toBeInTheDocument();
    expect(screen.getByText(/^\d{4}年\d{1,2}月\d{1,2}日 \d{2}:\d{2}$/)).toBeInTheDocument();
  });

  it('控えが無ければ、エラー文面と再試行ボタンを出す(黙って空にしない)', async () => {
    vi.mocked(postChecklist).mockRejectedValueOnce(
      new ApiError(0, 'network_error', 'サーバーに接続できませんでした。'),
    );

    renderChecklist();

    expect(await screen.findByRole('alert')).toHaveTextContent('サーバーに接続できませんでした。');
    expect(screen.getByRole('button', { name: /もう一度作成する/ })).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: '保存してあった内容を表示しています' }),
    ).toBeNull();
  });

  it('再試行ボタンで取得し直し、成功したら控えの告知が消える', async () => {
    await seedCache();
    vi.mocked(postChecklist).mockRejectedValueOnce(
      new ApiError(0, 'network_error', 'サーバーに接続できませんでした。'),
    );

    renderChecklist();
    await screen.findByRole('heading', { name: '保存してあった内容を表示しています' });

    fireEvent.click(screen.getByRole('button', { name: '最新の内容を取得する' }));

    await waitFor(() =>
      expect(
        screen.queryByRole('heading', { name: '保存してあった内容を表示しています' }),
      ).toBeNull(),
    );
    expect(screen.getByText('転入届')).toBeInTheDocument();
  });

  it('条件を変えたあとは控えを使わない(修正前の判定を復活させない)', async () => {
    await seedCache();

    // 条件を変える(犬を飼っていない)。
    const changed = profileSchema.parse({
      destination: { municipalityCode: '13112' },
      moveDate: '2026-08-01',
      originType: 'outside_tokyo',
      household: { memberCount: 1, ageBands: ['adult'] },
      flags: {
        hasMyNumberCard: false,
        needsNationalHealthInsurance: false,
        needsNationalPension: false,
        hasSchoolOrChildcareNeeds: false,
        hasDog: false,
        needsDisabilityOrCareSupport: false,
        needsForeignResidentGuidance: false,
      },
    });
    localStorage.setItem('tmn:profile:13112', JSON.stringify(changed));
    vi.mocked(postChecklist).mockRejectedValueOnce(
      new ApiError(0, 'network_error', 'サーバーに接続できませんでした。'),
    );

    renderChecklist();

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('飼い犬の登録事項変更届')).toBeNull();
    expect(localStorage.getItem(CACHE_KEY)).toBeNull();
  });

  it('対象外(409)のような確定した答えでは控えを出さず、控えごと捨てる(原則9)', async () => {
    await seedCache();
    vi.mocked(postChecklist).mockRejectedValueOnce(
      new ApiError(409, 'municipality_not_supported', '現在このサービスの対応対象外です。'),
    );

    renderChecklist();

    expect(await screen.findByRole('alert')).toHaveTextContent('対応対象外');
    expect(
      screen.queryByRole('heading', { name: '保存してあった内容を表示しています' }),
    ).toBeNull();
    expect(localStorage.getItem(CACHE_KEY)).toBeNull();
  });

  /**
   * なぜ: 以前は自治体一覧とチェックリストを Promise.all で束ねていたため、見出しの表示名を
   * 引く GET /api/municipalities が失敗しただけで、生成に成功したチェックリストごと消えていた。
   */
  it('自治体一覧が取れなくても、生成できたチェックリストは表示する', async () => {
    vi.mocked(getMunicipalities).mockRejectedValueOnce(
      new ApiError(0, 'network_error', 'サーバーに接続できませんでした。'),
    );

    renderChecklist();

    expect(await screen.findByText('転入届')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
