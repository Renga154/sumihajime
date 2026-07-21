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
      dueDescription: '生活開始まで',
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
