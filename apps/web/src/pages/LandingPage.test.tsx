import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { Route } from 'react-router-dom';
import { renderWithProviders } from '../test/utils';

/**
 * なぜ: VS1受入1 / FR-021。対応自治体のみ選択でき、未対応自治体は選択不可で
 * 公式サイトへの外部リンクだけを表示することを固定する。
 */

vi.mock('../api/client', () => ({
  ApiError: class ApiError extends Error {},
  getMunicipalities: vi.fn(async () => [
    { code: '13112', name: '世田谷区', supported: true, note: '対応済み', coverage: [] },
    {
      code: '13104',
      name: '新宿区',
      supported: false,
      note: '対応準備中',
      officialUrl: 'https://www.city.shinjuku.lg.jp/',
      coverage: [],
    },
  ]),
  getServiceStats: vi.fn(async () => ({
    supportedMunicipalities: 23,
    totalMunicipalities: 62,
    approvedSources: 332,
    lastVerifiedDate: '2026-08-07',
  })),
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
    const startButtons = screen.getAllByRole('button', { name: /この自治体で始める/ });
    expect(startButtons).toHaveLength(1);
  });

  it('同名ボタン/リンクのアクセシブル名に自治体名を含める(読み上げの一覧で区別できる)', async () => {
    renderLanding();
    await screen.findByText('世田谷区');
    // 視覚表示は「この自治体で始める」のままだが、アクセシブル名には区名が入る。
    expect(screen.getByRole('button', { name: 'この自治体で始める 世田谷区' })).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: '新宿区の公式サイトを見る（別タブで開きます）' }),
    ).toBeInTheDocument();
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

/**
 * なぜ(独立点検の指摘): トップに「オープンデータ」「AI」の語が一度も出ず、審査基準の
 * 「データ活用」がトップで一切伝わっていなかった。掲出した数値が /api/stats の実データ由来で
 * あること(画面に定数を書かないこと)を、モックの値を変えて追随するかで固定する。
 */
describe('LandingPage — オープンデータとAIの訴求', () => {
  it('オープンデータとAIの扱いをトップに掲出する', async () => {
    renderLanding();
    expect(
      await screen.findByRole('heading', { name: 'オープンデータとAIの使い方' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/オープンデータ（CSV・API）を機械判読/)).toBeInTheDocument();
    expect(screen.getByText(/出典つきの回答だけ/)).toBeInTheDocument();
  });

  it('数値は /api/stats の実データを表示する(画面に定数を持たない)', async () => {
    renderLanding();
    expect(await screen.findByText('23 / 62')).toBeInTheDocument();
    expect(screen.getByText('332件')).toBeInTheDocument();
    expect(screen.getByText('2026年8月7日')).toBeInTheDocument();
  });
});

/**
 * なぜ: 62自治体が同じ形のカードで縦に並ぶだけでは、自分の区に辿り着くまでの
 * スクロールが長すぎる。絞り込みが対応・未対応の双方に効き、件数表示も追随することを固定する。
 */
describe('LandingPage — 自治体の絞り込み', () => {
  function filterInput(): HTMLElement {
    return screen.getByLabelText('自治体名で絞り込む');
  }

  it('ラベル付きの検索欄があり、既定では全件を表示する', async () => {
    renderLanding();
    await screen.findByText('世田谷区');
    expect(filterInput()).toBeInTheDocument();
    expect(screen.getByText(/全2件を表示中/)).toBeInTheDocument();
  });

  it('漢字で絞り込むと一致した自治体だけが残る', async () => {
    renderLanding();
    await screen.findByText('世田谷区');
    fireEvent.change(filterInput(), { target: { value: '世田谷' } });
    expect(screen.getByText('世田谷区')).toBeInTheDocument();
    expect(screen.queryByText('新宿区', { exact: false })).toBeNull();
    expect(screen.getByText(/1件が一致/)).toBeInTheDocument();
  });

  it('ひらがな・ローマ字でも引ける(未対応の自治体も同じ規則で絞り込む)', async () => {
    renderLanding();
    await screen.findByText('世田谷区');
    fireEvent.change(filterInput(), { target: { value: 'しんじゅく' } });
    expect(screen.getByText('新宿区', { exact: false })).toBeInTheDocument();
    expect(screen.queryByText('世田谷区')).toBeNull();

    fireEvent.change(filterInput(), { target: { value: 'setagaya' } });
    expect(screen.getByText('世田谷区')).toBeInTheDocument();
    expect(screen.queryByText('新宿区', { exact: false })).toBeNull();
  });

  it('一致0件のときは次の行動が分かる空状態を出す', async () => {
    renderLanding();
    await screen.findByText('世田谷区');
    fireEvent.change(filterInput(), { target: { value: '八王子' } });
    expect(screen.getByText('一致する自治体は見つかりませんでした')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /この自治体で始める/ })).toBeNull();
  });
});
