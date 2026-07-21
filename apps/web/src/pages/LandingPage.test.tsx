import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { Route } from 'react-router-dom';
import { renderWithProviders } from '../test/utils';

/**
 * なぜ: VS1受入1 / FR-021。対応自治体のみ選択でき、未対応自治体は選択不可で
 * 公式サイトへの外部リンクだけを表示することを固定する。
 */

vi.mock('../api/client', () => ({
  ApiError: class ApiError extends Error {},
  getMunicipalities: vi.fn(async () => [
    { code: '13112', name: '世田谷区', supported: true, note: 'MVP対象', coverage: [] },
    {
      code: '13104',
      name: '新宿区',
      supported: false,
      note: '対応準備中',
      officialUrl: 'https://www.city.shinjuku.lg.jp/',
      coverage: [],
    },
  ]),
}));

import { LandingPage } from './LandingPage';

beforeEach(() => {
  localStorage.clear();
});

function renderLanding() {
  return renderWithProviders(<LandingPage />, {
    path: '/',
    initialEntry: '/',
    extraRoutes: <Route path="/wizard" element={<div>入力画面</div>} />,
  });
}

describe('LandingPage', () => {
  it('対応自治体のみ「始める」ボタンを表示する', async () => {
    renderLanding();
    expect(await screen.findByText('世田谷区')).toBeInTheDocument();
    const startButtons = screen.getAllByRole('button', { name: 'この自治体で始める' });
    expect(startButtons).toHaveLength(1);
  });

  it('未対応自治体は「未対応」表示と公式サイトへの外部リンクを持つ(選択不可)', async () => {
    renderLanding();
    expect(await screen.findByText('新宿区', { exact: false })).toBeInTheDocument();
    // バッジ「未対応（対応準備中）」を特定する(見出し「未対応の自治体」と区別)。
    expect(screen.getByText(/未対応（/)).toBeInTheDocument();

    const link = screen.getByRole('link', { name: /公式サイトを見る/ });
    expect(link).toHaveAttribute('href', 'https://www.city.shinjuku.lg.jp/');
    expect(link).toHaveAttribute('target', '_blank');
  });
});
