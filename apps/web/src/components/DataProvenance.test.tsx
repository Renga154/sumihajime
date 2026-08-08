import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DataProvenance, buildStatChips } from './DataProvenance';

/**
 * なぜ: トップの「オープンデータとAIの使い方」は審査基準「データ活用」を3分で伝えるための
 * 訴求だが、数値を誇張したり手打ちしたりすると本プロダクトの土台(公式根拠の追跡可能性)を
 * 自ら壊す。ここでは次の2点を機械的に固定する。
 *  1. 表示される数値は与えられた統計そのものであり、コンポーネント内に定数を持たない。
 *  2. 統計が取れないときは数値を一切出さない(推測しない=CLAUDE.md原則3)。
 */

const STATS = {
  supportedMunicipalities: 23,
  totalMunicipalities: 62,
  approvedSources: 332,
  lastVerifiedDate: '2026-08-07',
} as const;

describe('buildStatChips', () => {
  it('渡された統計をそのままチップにする(定数を持たない)', () => {
    expect(buildStatChips(STATS)).toEqual([
      { label: '対応自治体', value: '23 / 62' },
      { label: '承認済みの公式ソース', value: '332件' },
      { label: '最終確認', value: '2026年8月7日' },
    ]);
  });

  it('統計が増減すれば表示も追随する', () => {
    const chips = buildStatChips({
      supportedMunicipalities: 30,
      totalMunicipalities: 62,
      approvedSources: 401,
      lastVerifiedDate: '2027-01-15',
    });
    expect(chips[0]?.value).toBe('30 / 62');
    expect(chips[1]?.value).toBe('401件');
    expect(chips[2]?.value).toBe('2027年1月15日');
  });

  it('最終確認日が無ければそのチップだけ出さない', () => {
    const chips = buildStatChips({
      supportedMunicipalities: 23,
      totalMunicipalities: 62,
      approvedSources: 332,
    });
    expect(chips.map((c) => c.label)).toEqual(['対応自治体', '承認済みの公式ソース']);
  });

  it('統計が無ければチップは空(数値を推測しない)', () => {
    expect(buildStatChips(undefined)).toEqual([]);
  });
});

describe('DataProvenance', () => {
  it('オープンデータとAIの扱いを本文で明示する', () => {
    render(<DataProvenance stats={STATS} />);
    expect(screen.getByRole('heading', { name: 'オープンデータとAIの使い方' })).toBeInTheDocument();
    expect(screen.getByText(/オープンデータ（CSV・API）を機械判読/)).toBeInTheDocument();
    // AIに任せていないこと・出典つきでのみ答えること(原則1・原則3)を必ず書く。
    expect(screen.getByText(/AIには任せていません/)).toBeInTheDocument();
    expect(screen.getByText(/出典つきの回答だけ/)).toBeInTheDocument();
  });

  it('統計が無いときは数値を出さず、説明文だけを出す', () => {
    const { container } = render(<DataProvenance />);
    expect(screen.getByRole('heading', { name: 'オープンデータとAIの使い方' })).toBeInTheDocument();
    expect(container.querySelector('dl')).toBeNull();
    expect(container.textContent).not.toMatch(/\d+件/);
  });

  it('対応自治体数は必ず母数と併記する(未対応を対応済みに見せない)', () => {
    render(<DataProvenance stats={STATS} />);
    expect(screen.getByText('23 / 62')).toBeInTheDocument();
  });
  /**
   * 折りたたみ形式(トップで自治体選択の直下に置くときの形)。
   * たたんでも「無くなった」ことにはしない: 見出しはDOMに残し、中身も描画したうえで
   * details が閉じているだけにする。スクリーンリーダーの見出しジャンプから到達できる。
   */
  it('collapsible では details/summary になり、見出しは残る', () => {
    const { container } = render(<DataProvenance stats={STATS} collapsible />);
    const details = container.querySelector('details');
    expect(details).not.toBeNull();
    expect(details?.open).toBe(false);
    expect(container.querySelector('summary')).not.toBeNull();
    // 見出しは summary の中に置く(たたんだ状態でも見出しの一覧から辿れる)。
    const heading = screen.getByRole('heading', { name: 'オープンデータとAIの使い方' });
    expect(heading.closest('summary')).not.toBeNull();
    // 中身は描画されている(開けば読める)。
    expect(screen.getByText('23 / 62')).toBeInTheDocument();
  });
});
