import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { ServiceStats } from '@tmn/schemas';
import { renderWithProviders } from '../test/utils';

/**
 * なぜ: 透明性ページは本サービスの信頼の要だが、62自治体×332ソースを全部展開すると
 * モバイルで12万px超になり、長すぎて誰も辿れなかった。情報は一切削らずに、
 *  - 冒頭に要約(対応自治体数・掲載自治体数・承認済みソース数・最終更新日)
 *  - 自治体名での絞り込み
 *  - 自治体ごとの詳細は既定で折りたたむ(<details>)
 * という形にしたことを固定する。「すべて到達可能なまま初期表示を短くする」が要件。
 */

const statsMock = vi.fn(async (): Promise<ServiceStats> => ({
  supportedMunicipalities: 1,
  totalMunicipalities: 2,
  approvedSources: 2,
  lastVerifiedDate: '2026-08-01',
  driftFlaggedSources: 3,
  driftLastCheckedAt: '2026-09-22T00:00:00Z',
}));

vi.mock('../api/client', () => ({
  ApiError: class ApiError extends Error {},
  getServiceStats: () => statsMock(),
  getMunicipalities: vi.fn(async () => [
    {
      code: '13112',
      name: '世田谷区',
      supported: true,
      officialUrl: 'https://www.city.setagaya.lg.jp/',
      coverage: [
        { municipalityCode: '13112', category: 'waste_schedule', status: 'verified' },
        { municipalityCode: '13112', category: 'resident_registration', status: 'partial' },
      ],
    },
    { code: '13201', name: '八王子市', supported: false, coverage: [] },
  ]),
  getSources: vi.fn(async () => [
    {
      sourceId: 'src-13112-waste_schedule-001',
      sourceTitle: '世田谷区 資源・ごみ収集曜日一覧',
      ownerOrganization: '世田谷区',
      municipalityCode: '13112',
      category: 'waste_schedule',
      sourceUrl: 'https://www.city.setagaya.lg.jp/x.csv',
      sourceType: 'csv',
      license: 'CC BY 4.0',
      attributionText: '世田谷区オープンデータ',
      updateFrequency: 'annual',
      lastVerifiedAt: '2026-07-21T00:00:00Z',
      effectiveTo: '2027-03-31',
    },
    {
      sourceId: 'src-00000-mynumber-001',
      sourceTitle: 'マイナンバーカードの継続利用',
      ownerOrganization: 'デジタル庁',
      municipalityCode: undefined,
      category: 'mynumber',
      sourceUrl: 'https://www.digital.go.jp/x',
      sourceType: 'html',
      license: '公共データ利用規約(第1.0版)',
      attributionText: 'デジタル庁',
      updateFrequency: 'unknown',
      lastVerifiedAt: '2026-08-01T00:00:00Z',
    },
  ]),
}));

import { CoveragePage } from './CoveragePage';

beforeEach(() => {
  localStorage.clear();
});

function renderCoverage() {
  return renderWithProviders(<CoveragePage />, {
    path: '/about-data',
    initialEntry: '/about-data',
  });
}

describe('CoveragePage(このサービスのデータについて)', () => {
  it('冒頭に要約(対応・掲載・承認済みソース・最終更新日)を表示する', async () => {
    renderCoverage();
    expect(await screen.findByRole('heading', { name: 'このページの要約' })).toBeInTheDocument();
    const supported = screen.getByText('対応している自治体').closest('div');
    expect(supported?.textContent).toContain('1');
    const listed = screen.getByText('掲載している自治体').closest('div');
    expect(listed?.textContent).toContain('2');
    // 最終更新日は台帳中で最も新しい最終確認日(2026-08-01)。
    const lastUpdated = screen.getByText('最終更新日').closest('div')!;
    expect(within(lastUpdated).getByText('2026年8月1日')).toBeInTheDocument();
  });

  it('自治体ごとの詳細は既定で折りたたまれている(情報は削らず、初期表示だけ短くする)', async () => {
    renderCoverage();
    await screen.findByRole('heading', { name: 'このページの要約' });
    const details = document.querySelectorAll('details');
    expect(details.length).toBeGreaterThan(0);
    for (const d of details) expect(d.open).toBe(false);
  });

  it('折りたたみを開くとカテゴリ表・出典テーブルに到達できる', async () => {
    renderCoverage();
    await screen.findByRole('heading', { name: 'このページの要約' });
    // 世田谷区の見出しは「対応状況」と「出典一覧」の2セクションに1つずつある。
    const headings = screen.getAllByRole('heading', { name: '世田谷区', level: 3 });
    expect(headings).toHaveLength(2);
    for (const heading of headings) {
      const details = heading.closest('details')!;
      fireEvent.click(details.querySelector('summary')!);
      expect(details.open).toBe(true);
      expect(within(details).getByRole('table')).toBeInTheDocument();
    }
    // 出典一覧側では公式リンクとライセンス(帰属表示)まで辿れる。
    const ledger = headings[1]!.closest('details')!;
    expect(within(ledger).getByText('CC BY 4.0')).toBeInTheDocument();
    expect(within(ledger).getByText('世田谷区オープンデータ')).toBeInTheDocument();
  });

  it('自治体名で絞り込むと対応状況・出典の双方が絞られ、一致分は開いた状態になる', async () => {
    renderCoverage();
    await screen.findByRole('heading', { name: 'このページの要約' });
    fireEvent.change(screen.getByLabelText('自治体名で絞り込む'), {
      target: { value: 'せたがや' },
    });
    expect(screen.getAllByRole('heading', { name: '世田谷区', level: 3 }).length).toBe(2);
    expect(screen.queryByRole('heading', { name: '八王子市', level: 3 })).toBeNull();
    // 絞り込み中は中身が見えるように開く。
    for (const d of document.querySelectorAll('details')) expect(d.open).toBe(true);
  });

  it('一致0件では削除ではなく空状態を出す(絞り込みを外せば全件へ戻れる)', async () => {
    renderCoverage();
    await screen.findByRole('heading', { name: 'このページの要約' });
    const input = screen.getByLabelText('自治体名で絞り込む');
    fireEvent.change(input, { target: { value: 'ぜったいにない' } });
    expect(screen.getByText('一致する自治体は見つかりませんでした')).toBeInTheDocument();

    fireEvent.change(input, { target: { value: '' } });
    expect(screen.getByRole('heading', { name: '八王子市', level: 3 })).toBeInTheDocument();
  });
});

/**
 * なぜ: ADR-014 の機械巡回は「動いていること・何件を再確認中にしているか」まで公開する
 * (原則9)。数値は /api/stats 由来で、未巡回なら「まだ巡回していません。」と正直に出す。
 */
describe('CoveragePage — 機械巡回の状況(ADR-014)', () => {
  it('再確認中の件数と最終巡回時刻(日本時間)を表示する', async () => {
    renderCoverage();
    const heading = await screen.findByRole('heading', { name: '機械巡回の状況' });
    const section = heading.closest('section')!;
    await waitFor(() => {
      expect(section.textContent).toContain('3');
      expect(section.textContent).toContain('件が再確認中です');
    });
    // 2026-09-22T00:00:00Z = 日本時間 9:00。
    expect(section.textContent).toContain('最終巡回: 2026年9月22日 09:00 JST');
  });

  it('まだ一度も巡回していなければ、その旨を出す', async () => {
    statsMock.mockResolvedValueOnce({
      supportedMunicipalities: 1,
      totalMunicipalities: 2,
      approvedSources: 2,
      driftFlaggedSources: 0,
    });
    renderCoverage();
    const heading = await screen.findByRole('heading', { name: '機械巡回の状況' });
    const section = heading.closest('section')!;
    await waitFor(() => expect(section.textContent).toContain('まだ巡回していません。'));
  });
});
