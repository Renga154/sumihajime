import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { GeneratedTask, ProcedureDetailResponse } from '@tmn/schemas';
import { AppStateProvider } from '../state/AppState';

/**
 * なぜ: VS1ブラウザ検証で発見した不整合の再発防止。ChecklistPageから
 * state={{task}}付きで遷移した場合はルール評価済みの期限を表示し、
 * 直接URL訪問(stateなし)の場合は現行の「期限は要確認」表示にフォールバックする
 * ことを固定する。
 */

function makeTask(o: Partial<GeneratedTask>): GeneratedTask {
  return {
    id: o.id ?? 'id',
    procedureId: o.procedureId ?? 'procedure_resident_registration',
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
    dataStatus: 'verified',
    ruleVersion: 'v1',
    procedureVersion: 'v1',
    ...o,
  };
}

const DETAIL_RESPONSE: ProcedureDetailResponse = {
  procedure: {
    id: 'procedure_resident_registration',
    version: '2026-07-21.1',
    municipalityCode: '13112',
    canonicalType: 'resident_registration',
    title: '転入届',
    shortDescription: '転入の届出',
    applicabilityReason: 'すべての方に必要です。',
    priority: 'urgent',
    dueDescription: '引越しをしてきた日から14日以内。',
    requiredDocuments: [],
    channels: ['counter'],
    sourceIds: ['src-13112-resident_registration-001'],
    lastVerifiedAt: '2026-07-21T11:44:00Z',
    dataStatus: 'verified',
  },
  sources: [
    {
      sourceId: 'src-13112-resident_registration-001',
      sourceTitle: '転入届ページ',
      ownerOrganization: '世田谷区',
      category: 'resident_registration',
      sourceUrl: 'https://www.city.setagaya.lg.jp/x',
      sourceType: 'html',
      license: 'CC-BY-4.0',
      attributionText: '世田谷区',
      updateFrequency: 'irregular',
    },
  ],
};

vi.mock('../api/client', () => ({
  ApiError: class ApiError extends Error {},
  ChatDisabledError: class ChatDisabledError extends Error {},
  getProcedure: vi.fn(async () => DETAIL_RESPONSE),
  // RAGはこのテストのスコープ外。無効(false)にしてチャットパネルを非表示にする。
  getChatAvailability: vi.fn(async () => false),
  getMunicipalities: vi.fn(async () => []),
  postChat: vi.fn(),
}));

import { ProcedureDetailPage } from './ProcedureDetailPage';

function renderDetail(initialEntry: string | { pathname: string; state?: unknown }) {
  return render(
    <AppStateProvider>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/procedures/:id" element={<ProcedureDetailPage />} />
        </Routes>
      </MemoryRouter>
    </AppStateProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('tmn:municipality', '13112');
});

describe('ProcedureDetailPage', () => {
  it('state付き遷移では計算済みの期限(dueDate)を表示する', async () => {
    const task = makeTask({ dueDate: '2026-08-29' });
    renderDetail({ pathname: '/procedures/procedure_resident_registration', state: { task } });

    expect(await screen.findByText('転入届')).toBeInTheDocument();
    expect(screen.getByText('期限：')).toBeInTheDocument();
    expect(screen.getByText('2026年8月29日')).toBeInTheDocument();
    // 公式文言(dueDescription)は常に併記される。
    expect(screen.getByText('引越しをしてきた日から14日以内。')).toBeInTheDocument();
  });

  it('stateなし(直接URL訪問)では「期限は要確認」にフォールバックする', async () => {
    renderDetail('/procedures/procedure_resident_registration');

    expect(await screen.findByText('転入届')).toBeInTheDocument();
    expect(screen.getByText('期限は要確認')).toBeInTheDocument();
    expect(screen.getByText('引越しをしてきた日から14日以内。')).toBeInTheDocument();
  });
});
