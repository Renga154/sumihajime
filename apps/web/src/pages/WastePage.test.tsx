import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../test/utils';

/**
 * なぜ: 収集曜日データを整備していない対応自治体(例: 杉並区=第三者SaaS依存、千代田区=PDFのみ)で、
 * WastePage が「エラー表示」ではなく「未対応+公式導線」の空状態へ縮退することを固定する(汎用実装)。
 * FR-021/原則3・9: 曜日を推測表示せず、公式サイトへ誘導する。
 */

// なぜ: vi.mock ファクトリはファイル先頭へ巻き上げられるため、共有する mock 参照とエラー型は
// vi.hoisted で先に生成する(トップレベル変数を直接参照するとhoist順で初期化前アクセスになる)。
const { ApiError, getWaste, getWasteSortingSummary } = vi.hoisted(() => {
  class ApiError extends Error {
    code: string;
    status: number;
    officialUrl?: string;
    constructor(status: number, code: string, message: string, officialUrl?: string) {
      super(message);
      this.status = status;
      this.code = code;
      this.officialUrl = officialUrl;
    }
  }
  return { ApiError, getWaste: vi.fn(), getWasteSortingSummary: vi.fn() };
});

vi.mock('../api/client', () => ({
  ApiError,
  getMunicipalities: vi.fn(async () => [
    {
      code: '13115',
      name: '杉並区',
      supported: true,
      officialUrl: 'https://www.city.suginami.tokyo.jp/',
    },
  ]),
  getWaste: (...args: unknown[]) => getWaste(...args),
  // 分別辞書も未整備扱い(404)。空状態のテストでは分別検索も自身の縮退表示になる。
  getWasteSortingSummary: (...args: unknown[]) => getWasteSortingSummary(...args),
  searchWasteSorting: vi.fn(),
}));

import { WastePage } from './WastePage';

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('tmn:municipality', '13115');
  getWaste.mockReset();
  getWasteSortingSummary.mockReset();
  getWasteSortingSummary.mockRejectedValue(
    new ApiError(404, 'waste_sorting_data_unavailable', '未整備'),
  );
});

describe('WastePage — 収集曜日データ未対応の空状態フォールバック', () => {
  it('API が waste_data_unavailable(404) を返すと、未対応メッセージ+公式リンクを表示する', async () => {
    getWaste.mockRejectedValue(new ApiError(404, 'waste_data_unavailable', '未整備'));
    renderWithProviders(<WastePage />, { path: '/waste', initialEntry: '/waste' });

    expect(await screen.findByText(/収集曜日はまだデータ対応していません/)).toBeInTheDocument();
    const link = await screen.findByRole('link', { name: /杉並区の公式サイトで確認する/ });
    expect(link).toHaveAttribute('href', 'https://www.city.suginami.tokyo.jp/');
    // 地区選択のセレクトは描画されない(曜日を推測表示しない)。
    expect(screen.queryByLabelText('地区を選ぶ')).not.toBeInTheDocument();
  });

  it('dataset はあるが地区が0件でも同じ空状態へ縮退する', async () => {
    getWaste.mockResolvedValue({
      municipalityCode: '13115',
      areas: [],
      caution: '注意',
    });
    renderWithProviders(<WastePage />, { path: '/waste', initialEntry: '/waste' });
    expect(await screen.findByText(/収集曜日はまだデータ対応していません/)).toBeInTheDocument();
  });
});
