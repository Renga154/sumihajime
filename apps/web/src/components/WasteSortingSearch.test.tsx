import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { WasteSortingItem } from '@tmn/schemas';

/**
 * なぜ: 分別検索UIの主要分岐(サマリー→検索→0件→未整備)を、APIをモックして固定する。
 * デバウンス(300ms)後に検索が走り、結果に分別区分バッジと出典(CC BY 4.0)が出ること、
 * 0件時に公式導線が出ることを担保する。
 */

// vi.mock はホイストされるため、共有するモック・クラスは vi.hoisted で先に用意する。
const { FakeApiError, getWasteSortingSummary, searchWasteSorting } = vi.hoisted(() => {
  class FakeApiError extends Error {
    code: string;
    constructor(code: string) {
      super(code);
      this.code = code;
    }
  }
  return { FakeApiError, getWasteSortingSummary: vi.fn(), searchWasteSorting: vi.fn() };
});

vi.mock('../api/client', () => ({
  ApiError: FakeApiError,
  getWasteSortingSummary,
  searchWasteSorting,
}));

import { WasteSortingSearch } from './WasteSortingSearch';

function item(o: Partial<WasteSortingItem>): WasteSortingItem {
  return {
    itemId: o.itemId ?? '131121S00001',
    municipalityCode: '13112',
    name: o.name ?? 'ペットボトル',
    category: o.category ?? '資源',
    notes: o.notes,
    feeNote: o.feeNote,
    sourceId: o.sourceId ?? 'src-13112-waste_sorting-001',
  };
}

function renderSearch(officialUrl = 'https://www.city.setagaya.lg.jp/') {
  return render(
    <WasteSortingSearch
      municipalityCode="13112"
      municipalityName="世田谷区"
      officialUrl={officialUrl}
    />,
  );
}

beforeEach(() => {
  getWasteSortingSummary.mockReset();
  searchWasteSorting.mockReset();
  getWasteSortingSummary.mockResolvedValue({
    municipalityCode: '13112',
    categories: [
      { category: '可燃ごみ', count: 300 },
      { category: '資源', count: 120 },
    ],
    total: 420,
  });
});

describe('WasteSortingSearch', () => {
  it('q未指定でカテゴリ別件数チップを表示する', async () => {
    renderSearch();
    expect(await screen.findByText('可燃ごみ')).toBeInTheDocument();
    expect(screen.getByText('資源')).toBeInTheDocument();
    expect(screen.getByText('420')).toBeInTheDocument();
  });

  it('入力(デバウンス後)で検索し、分別区分バッジと出典(CC BY 4.0)を表示する', async () => {
    searchWasteSorting.mockResolvedValue({
      municipalityCode: '13112',
      query: 'ペットボトル',
      items: [
        item({
          name: 'ペットボトル',
          category: '資源',
          notes: 'ラベルとキャップを外す',
          feeNote: '無料',
        }),
      ],
      total: 1,
    });

    renderSearch();
    await screen.findByText('可燃ごみ');

    fireEvent.change(screen.getByLabelText('品目名で調べる'), {
      target: { value: 'ペットボトル' },
    });

    expect(await screen.findByText('ラベルとキャップを外す')).toBeInTheDocument();
    expect(screen.getByText('資源')).toBeInTheDocument();
    expect(screen.getByText(/CC BY 4.0/)).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /公式の分別ページで最新情報を確認する/ }),
    ).toHaveAttribute('href', 'https://www.city.setagaya.lg.jp/');
    await waitFor(() => expect(searchWasteSorting).toHaveBeenCalledWith('13112', 'ペットボトル'));
  });

  it('0件時は「見つかりません」と公式分別ページへの導線を出す', async () => {
    searchWasteSorting.mockResolvedValue({
      municipalityCode: '13112',
      query: 'そんざいしない',
      items: [],
      total: 0,
    });

    renderSearch();
    await screen.findByText('可燃ごみ');

    fireEvent.change(screen.getByLabelText('品目名で調べる'), {
      target: { value: 'そんざいしない' },
    });

    expect(await screen.findByText(/一致する品目は見つかりませんでした/)).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /世田谷区の公式サイトで分別を調べる/ }),
    ).toBeInTheDocument();
  });

  it('データ未整備(404)は公式サイト導線で誠実に表示する', async () => {
    getWasteSortingSummary.mockRejectedValue(new FakeApiError('waste_sorting_data_unavailable'));
    renderSearch();
    expect(await screen.findByText(/ごみ分別データはまだ整備されていません/)).toBeInTheDocument();
  });
});
