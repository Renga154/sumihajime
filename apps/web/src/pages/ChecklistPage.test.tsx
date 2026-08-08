import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
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
  ApiError: class ApiError extends Error {},
  ChatDisabledError: class ChatDisabledError extends Error {},
  getMunicipalities: vi.fn(async () => [
    { code: '13112', name: '世田谷区', supported: true, coverage: [] },
  ]),
  postChecklist: vi.fn(async () => FIXTURE),
  // RAGはこのテストのスコープ外。無効(false)にしてチャットパネルを非表示にする。
  getChatAvailability: vi.fn(async () => false),
  postChat: vi.fn(),
}));

import { postChecklist } from '../api/client';
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
