import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '../test/utils';

/**
 * なぜ: 比較ページは「自治体間の比較をここだけで行う」という原則4の例外的な場所なので、
 * 位置づけの明示・根拠と最終確認日・値が無い区の正直な表示・全区への到達可能性という、
 * 落とすと原則違反になる要素を固定する。
 */

const cell = (code: string, name: string, valueId: string, label: string, caution = false) => ({
  municipalityCode: code,
  municipalityName: name,
  valueId,
  valueLabel: label,
  tone: caution ? 'caution' : 'neutral',
  officialText: `${name}の公式文言(テスト)。`,
  procedureTitle: `${name} 子ども医療費助成`,
  sources: [
    {
      sourceId: `src-${code}-child_medical-001`,
      title: `${name} 子ども医療費助成ページ`,
      url: `https://example.invalid/${code}`,
      lastVerifiedAt: '2026-08-07T00:00:00Z',
    },
  ],
});

const report = {
  municipalities: [
    { code: '13101', name: 'テストA区' },
    { code: '13102', name: 'テストB区' },
    { code: '13103', name: 'テストC区' },
  ],
  topics: [
    {
      topicId: 'child_medical_application_deadline',
      title: '子ども医療費助成の申請期限',
      question: '転入日にさかのぼって助成を受けるには、いつまでに申請すればよい？',
      procedureId: 'procedure_child_medical',
      derivationNote: '公式文言から機械的に取り出しています。',
      valueGroups: [
        {
          valueId: 'month_3',
          label: '3か月以内に申請',
          tone: 'neutral',
          municipalityCodes: ['13101'],
        },
        {
          valueId: 'day_14',
          label: '14日以内に申請',
          tone: 'neutral',
          municipalityCodes: ['13102'],
        },
        {
          valueId: 'not_stated',
          label: '自治体の公式ページに申請期限の記載なし（要確認）',
          tone: 'caution',
          municipalityCodes: ['13103'],
        },
      ],
      cells: [
        cell('13101', 'テストA区', 'month_3', '3か月以内に申請'),
        cell('13102', 'テストB区', 'day_14', '14日以内に申請'),
        cell(
          '13103',
          'テストC区',
          'not_stated',
          '自治体の公式ページに申請期限の記載なし（要確認）',
          true,
        ),
      ],
      omittedMunicipalityCodes: [],
    },
  ],
};

vi.mock('../api/client', () => ({
  ApiError: class ApiError extends Error {},
  getWardDifferences: vi.fn(async () => report),
}));

import { DifferencesPage } from './DifferencesPage';

beforeEach(() => {
  localStorage.clear();
});

function renderPage() {
  return renderWithProviders(<DifferencesPage />, {
    path: '/differences',
    initialEntry: '/differences',
  });
}

describe('自治体ごとの期限のちがい(比較ページ)', () => {
  it('冒頭で「比較ページであること」と「チェックリストは選んだ区だけ」を明示する', async () => {
    renderPage();
    expect(await screen.findByText('これは自治体間の比較ページです。')).toBeInTheDocument();
    expect(
      screen.getByText(/あなたのチェックリストには、選んだ自治体の情報だけを表示しています/),
    ).toBeInTheDocument();
  });

  it('2区を選ぶと、それぞれの値・公式文言・出典リンク・最終確認日が出る', async () => {
    renderPage();
    await screen.findByRole('heading', { name: '子ども医療費助成の申請期限' });

    fireEvent.change(screen.getByLabelText('基準の自治体'), { target: { value: '13101' } });
    fireEvent.change(screen.getByLabelText('くらべる区'), { target: { value: '13102' } });

    // 値(比較セル + 全区一覧の両方に出るため getAllBy で確認する)
    expect(screen.getAllByText('3か月以内に申請').length).toBeGreaterThan(0);
    expect(screen.getAllByText('14日以内に申請').length).toBeGreaterThan(0);

    // 公式文言(折りたたみの中身もDOM上に存在する)
    expect(screen.getAllByText(/テストA区の公式文言/).length).toBeGreaterThan(0);

    // 出典リンクと最終確認日
    const links = screen.getAllByRole('link', { name: /テストA区 子ども医療費助成ページ/ });
    expect(links[0]).toHaveAttribute('href', 'https://example.invalid/13101');
    expect(screen.getAllByText(/最終確認 2026年8月7日/).length).toBeGreaterThan(0);
  });

  it('値が無い区は「記載なし（要確認）」と正直に出す(推測で埋めない)', async () => {
    renderPage();
    await screen.findByRole('heading', { name: '子ども医療費助成の申請期限' });
    expect(
      screen.getAllByText('自治体の公式ページに申請期限の記載なし（要確認）').length,
    ).toBeGreaterThan(0);
  });

  it('選んだ2区の扱いが違うことを言葉で伝える', async () => {
    renderPage();
    await screen.findByRole('heading', { name: '子ども医療費助成の申請期限' });
    fireEvent.change(screen.getByLabelText('基準の自治体'), { target: { value: '13101' } });
    fireEvent.change(screen.getByLabelText('くらべる区'), { target: { value: '13102' } });
    expect(screen.getByText(/この2つの自治体では扱いが違います/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('くらべる区'), { target: { value: '13101' } });
    expect(screen.getByText(/この2つの自治体は同じ扱いです/)).toBeInTheDocument();
  });

  it('全区一覧へ到達できる(情報を隠さない)', async () => {
    renderPage();
    await screen.findByRole('heading', { name: '子ども医療費助成の申請期限' });
    expect(screen.getByText('対応している3区すべての値を見る')).toBeInTheDocument();
    // 一覧には選んでいない区も出る。
    expect(screen.getAllByText('テストC区').length).toBeGreaterThan(0);
  });

  it('判定方法(推測でないこと)を開示する', async () => {
    renderPage();
    await screen.findByRole('heading', { name: '子ども医療費助成の申請期限' });
    expect(
      screen.getByText(/判定方法: 公式文言から機械的に取り出しています。/),
    ).toBeInTheDocument();
  });

  it('選択中の自治体があれば「あなたの区」の初期値になる', async () => {
    localStorage.setItem('tmn:municipality', '13102');
    renderPage();
    await screen.findByRole('heading', { name: '子ども医療費助成の申請期限' });
    expect(screen.getByLabelText<HTMLSelectElement>('あなたの自治体').value).toBe('13102');
  });
  /**
   * なぜ左のラベルが可変か(2026-08-09): このページをメインナビへ載せたことで、自治体を
   * 一度も選んでいない人が直接到達するようになった。そのとき左には一覧の先頭が既定で
   * 入るが、それを「あなたの区」と呼ぶのは利用者について事実に反する断定になる(原則3)。
   */
  it('自治体を選んでいなければ左は「基準の区」で、既定値である旨と次の行動を示す', async () => {
    renderPage();
    await screen.findByRole('heading', { name: '子ども医療費助成の申請期限' });
    expect(screen.getByLabelText('基準の自治体')).toBeInTheDocument();
    expect(screen.queryByLabelText('あなたの自治体')).toBeNull();
    expect(screen.getByText(/左は一覧の先頭を仮に表示しています/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '自治体を選ぶ' })).toHaveAttribute('href', '/');
  });

  it('選択中の区から左を別の区へ変えたら「あなたの区」とは呼ばない', async () => {
    localStorage.setItem('tmn:municipality', '13102');
    renderPage();
    await screen.findByRole('heading', { name: '子ども医療費助成の申請期限' });
    expect(screen.getByLabelText('あなたの自治体')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('あなたの自治体'), { target: { value: '13101' } });
    expect(screen.getByLabelText('基準の自治体')).toBeInTheDocument();
    expect(screen.queryByLabelText('あなたの自治体')).toBeNull();
    // 選択済みなので「まだ選んでいない」旨の案内は出さない。
    expect(screen.queryByText(/左は一覧の先頭を仮に表示しています/)).toBeNull();
  });
});
