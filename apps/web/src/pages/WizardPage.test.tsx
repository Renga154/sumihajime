import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { Route } from 'react-router-dom';
import { profileSchema } from '@tmn/schemas';
import { WizardPage, parseStepParam } from './WizardPage';
import { renderWithProviders } from '../test/utils';

/**
 * なぜ: VS1受入2 / FR-003。Step1(引越し日・転入元)のみで生成ボタンが有効になり、
 * Step2/3をスキップしても妥当なプロフィールが保存され、チェックリストへ遷移することを固定する。
 */

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('tmn:municipality', '13112');
});

function renderWizard(initialEntry = '/wizard') {
  return renderWithProviders(<WizardPage />, {
    path: '/wizard',
    initialEntry,
    extraRoutes: <Route path="/checklist" element={<div>チェックリスト画面</div>} />,
  });
}

describe('WizardPage', () => {
  it('Step1未入力では生成ボタンが無効、Step1入力で有効になる', () => {
    renderWizard();
    const generate = screen.getByRole('button', { name: 'この内容でチェックリストを作成' });
    expect(generate).toBeDisabled();

    fireEvent.change(screen.getByLabelText('引越し日または転入予定日', { exact: false }), {
      target: { value: '2026-08-01' },
    });
    fireEvent.click(screen.getByLabelText('東京都外'));

    expect(generate).toBeEnabled();
  });

  it('Step2/3をスキップして生成すると、既定値で妥当なプロフィールが保存され遷移する', () => {
    renderWizard();
    fireEvent.change(screen.getByLabelText('引越し日または転入予定日', { exact: false }), {
      target: { value: '2026-08-01' },
    });
    fireEvent.click(screen.getByLabelText('東京都外'));
    fireEvent.click(screen.getByRole('button', { name: 'この内容でチェックリストを作成' }));

    // 遷移した。
    expect(screen.getByText('チェックリスト画面')).toBeInTheDocument();

    // localStorage に妥当なプロフィールが保存された(単身・adult 既定)。
    const raw = localStorage.getItem('tmn:profile:13112');
    expect(raw).not.toBeNull();
    const parsed = profileSchema.safeParse(JSON.parse(raw!));
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.moveDate).toBe('2026-08-01');
      expect(parsed.data.originType).toBe('outside_tokyo');
      expect(parsed.data.household.memberCount).toBe(1);
      expect(parsed.data.household.ageBands).toEqual(['adult']);
    }
  });

  /**
   * なぜ: チェックリストの「条件を追加する」からステップ3へ直接来られるようにする
   * (ステップ1だけで生成した利用者が、マイナンバー等の判定を後から足せる導線)。
   */
  it('?step=3 で条件チェックのステップから開始する', () => {
    renderWizard('/wizard?step=3');
    expect(screen.getByRole('checkbox', { name: /マイナンバーカードを持っている/ })).toBeVisible();
    expect(screen.getByRole('button', { name: '条件チェック（任意）' })).toHaveAttribute(
      'aria-current',
      'step',
    );
  });

  it('step の指定が無い/範囲外/不正ならステップ1から開始する', () => {
    expect(parseStepParam(null)).toBe(1);
    expect(parseStepParam('0')).toBe(1);
    expect(parseStepParam('4')).toBe(1);
    expect(parseStepParam('2.5')).toBe(1);
    expect(parseStepParam('abc')).toBe(1);
    expect(parseStepParam('1')).toBe(1);
    expect(parseStepParam('2')).toBe(2);
    expect(parseStepParam('3')).toBe(3);

    renderWizard('/wizard?step=9');
    expect(screen.getByLabelText('引越し日または転入予定日', { exact: false })).toBeVisible();
  });

  it('ステップ1だけでも作成できることと、2・3を入れるとより正確になることを添える', () => {
    renderWizard();
    expect(screen.getByText(/ステップ1）を入力すると作成できます/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('引越し日または転入予定日', { exact: false }), {
      target: { value: '2026-08-01' },
    });
    fireEvent.click(screen.getByLabelText('東京都外'));

    expect(screen.getByText(/ステップ2・3も入力すると/)).toBeInTheDocument();
  });
});
