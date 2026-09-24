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

const getProcedureMock = vi.fn(async (): Promise<ProcedureDetailResponse> => DETAIL_RESPONSE);

vi.mock('../api/client', () => ({
  ApiError: class ApiError extends Error {},
  ChatDisabledError: class ChatDisabledError extends Error {},
  getProcedure: (...args: unknown[]) => getProcedureMock(...(args as [])),
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

/**
 * なぜ: ADR-014 の自動降格。API が stale と検知日を返したら、バッジは「再確認中」になり、
 * 根拠カードの公式リンク直下に検知日つきの1行が出る。リンク自体は消さない(原則8)。
 */
describe('ProcedureDetailPage — 巡回の検知(ADR-014)', () => {
  it('changed: 更新を検知した旨と検知日を根拠カードに出し、バッジは再確認中', async () => {
    getProcedureMock.mockResolvedValueOnce({
      procedure: { ...DETAIL_RESPONSE.procedure, dataStatus: 'stale' },
      sources: [
        { ...DETAIL_RESPONSE.sources[0]!, driftDetectedOn: '2026-09-22', driftKind: 'changed' },
      ],
    });
    renderDetail('/procedures/procedure_resident_registration');
    expect(await screen.findByText('転入届')).toBeInTheDocument();
    expect(screen.getByText('再確認中（情報が古い可能性）')).toBeInTheDocument();
    expect(
      screen.getByText(
        '公式ページの更新を検知（9月22日）。内容を再確認中です。最新の情報は公式ページでご確認ください。',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /公式ページを開く/ })).toHaveAttribute(
      'href',
      'https://www.city.setagaya.lg.jp/x',
    );
  });

  it('unreachable: 接続できない旨を出す', async () => {
    getProcedureMock.mockResolvedValueOnce({
      procedure: { ...DETAIL_RESPONSE.procedure, dataStatus: 'stale' },
      sources: [
        { ...DETAIL_RESPONSE.sources[0]!, driftDetectedOn: '2026-10-01', driftKind: 'unreachable' },
      ],
    });
    renderDetail('/procedures/procedure_resident_registration');
    expect(await screen.findByText('転入届')).toBeInTheDocument();
    expect(
      screen.getByText(
        '公式ページに接続できない状態を検知（10月1日）。リンク先が移動した可能性があります。',
      ),
    ).toBeInTheDocument();
  });

  it('検知が無ければ何も出さない', async () => {
    renderDetail('/procedures/procedure_resident_registration');
    expect(await screen.findByText('転入届')).toBeInTheDocument();
    expect(screen.queryByText(/検知/)).toBeNull();
  });
});

/**
 * なぜ: A-1-2 の誤り報告の導線。根拠カードの直後に、手続き名と自治体コードを事前入力した
 * フォームへのリンクを出す。利用者の入力条件はURLに載せない(原則6・7)。
 */
describe('ProcedureDetailPage — 誤りの報告', () => {
  it('根拠カードの後に、手続き名・自治体コード入りの報告リンクを出す', async () => {
    renderDetail('/procedures/procedure_resident_registration');
    const link = await screen.findByRole('link', { name: /この手続きの誤りを報告する/ });
    const url = new URL(link.getAttribute('href')!);
    expect(url.hostname).toBe('docs.google.com');
    expect(url.searchParams.get('entry.550992746')).toBe('転入届（自治体コード 13112）');
    expect(url.searchParams.get('entry.242184327')).toMatch(
      /\/procedures\/procedure_resident_registration$/,
    );
  });
});
