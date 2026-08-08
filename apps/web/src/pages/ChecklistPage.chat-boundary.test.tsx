import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { Route } from 'react-router-dom';
import { profileSchema, type ChecklistResponse } from '@tmn/schemas';
import { renderWithProviders } from '../test/utils';

/**
 * なぜ(独立点検 P1 / 原則8): チャットの描画時例外はルータの errorElement まで抜けていた。
 * 白画面にはならないものの、チェックリスト本体と公式リンクごと「画面を表示できませんでした」に
 * 差し替わる — 補助機能の不具合で、利用者が本当に必要としているものが消えていた。
 * 境界がチャットの中で例外を止め、本体が無傷で残ることを固定する。
 */

const FIXTURE: ChecklistResponse = {
  ruleVersion: 'v1',
  generatedAt: '2026-07-21T00:00:00Z',
  tasks: [
    {
      id: 't-res',
      procedureId: 'procedure_resident_registration',
      title: '転入届',
      category: 'resident_registration',
      priority: 'urgent',
      applicabilityReason: '転入したため',
      dueDate: '2026-08-15',
      requiredDocuments: [],
      channels: ['counter'],
      sources: [
        {
          sourceId: 's-1',
          title: '世田谷区 転入届',
          url: 'https://www.city.setagaya.lg.jp/02233/88.html',
          lastVerifiedAt: '2026-07-21T00:00:00Z',
        },
      ],
      dataStatus: 'verified',
      ruleVersion: 'v1',
      procedureVersion: 'v1',
      applicable: 'applicable',
    },
  ],
};

vi.mock('../api/client', () => ({
  ApiError: class ApiError extends Error {},
  ChatDisabledError: class ChatDisabledError extends Error {},
  getMunicipalities: vi.fn(async () => [
    { code: '13112', name: '世田谷区', supported: true, coverage: [] },
  ]),
  postChecklist: vi.fn(async () => FIXTURE),
  getChatAvailability: vi.fn(async () => ({ enabled: true, mode: 'full' })),
  postChat: vi.fn(),
}));

// チャットが描画中に必ず落ちる状況を作る。代替表示(ChatUnavailable)は本物を使い、
// 実際に利用者へ出る文面を検査する。
vi.mock('../components/ChatPanel', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../components/ChatPanel')>();
  return {
    ...actual,
    ChatPanel: () => {
      throw new Error('チャットの描画で落ちた(テスト)');
    },
  };
});

import { ChecklistPage } from './ChecklistPage';

let consoleError: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  // React は境界が捕まえた例外を必ず console.error へ出す。テスト出力を汚さないよう抑える。
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  localStorage.clear();
  localStorage.setItem('tmn:municipality', '13112');
  localStorage.setItem(
    'tmn:profile:13112',
    JSON.stringify(
      profileSchema.parse({
        destination: { municipalityCode: '13112' },
        moveDate: '2026-08-01',
        originType: 'outside_tokyo',
        household: { memberCount: 1, ageBands: ['adult'] },
        flags: {
          hasMyNumberCard: true,
          needsNationalHealthInsurance: true,
          needsNationalPension: true,
          hasSchoolOrChildcareNeeds: false,
          hasDog: false,
          needsDisabilityOrCareSupport: false,
          needsForeignResidentGuidance: false,
        },
      }),
    ),
  );
});
afterEach(() => consoleError.mockRestore());

describe('ChecklistPage — チャットが描画時に落ちても', () => {
  it('チェックリスト本体と公式根拠への導線が残る', async () => {
    renderWithProviders(<ChecklistPage />, {
      path: '/checklist',
      initialEntry: '/checklist',
      extraRoutes: <Route path="/procedures/:id" element={<div>詳細</div>} />,
    });

    // 本体。
    expect(await screen.findByRole('heading', { name: 'あなたのチェックリスト' })).toBeVisible();
    expect(screen.getByText('転入届')).toBeVisible();
    expect(screen.getByRole('link', { name: /詳細・必要書類・公式根拠を見る/ })).toBeVisible();
    expect(screen.getByText(/件 完了/)).toBeVisible();

    // ルータの共通エラー画面まで抜けていない。
    expect(screen.queryByRole('heading', { name: '画面を表示できませんでした' })).toBeNull();
  });

  it('チャット部分だけが「次に何をすればよいか」の分かる代替表示になる', async () => {
    renderWithProviders(<ChecklistPage />, {
      path: '/checklist',
      initialEntry: '/checklist',
      extraRoutes: <Route path="/procedures/:id" element={<div>詳細</div>} />,
    });

    expect(
      await screen.findByRole('heading', { name: 'AIへの質問は、ただいまご利用いただけません' }),
    ).toBeVisible();
    // 何がそのまま使えるかを言う。
    expect(
      screen.getByText(
        /チェックリストと、各手続きの公式ページへのリンクはこのままご利用いただけます/,
      ),
    ).toBeVisible();
    // いま押せる操作がある。
    expect(screen.getByRole('button', { name: 'もう一度読み込む' })).toBeVisible();
    // 入力欄は出さない(送っても無駄な操作を誘わない)。
    expect(screen.queryByLabelText(/質問を入力/)).toBeNull();
  });
});
