import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { Route } from 'react-router-dom';
import { profileSchema } from '@tmn/schemas';
import { WizardPage, parseStepParam } from './WizardPage';
import { renderWithProviders } from '../test/utils';
import { moveDateBounds, todayInTokyo } from '../lib/move-date';

vi.mock('../api/client', () => ({
  getMunicipalities: vi.fn(async () => [
    { code: '13112', name: '世田谷区', supported: true, officialUrl: 'https://example.invalid' },
  ]),
}));

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

/**
 * なぜ: 入力画面に選択中の自治体が一度も出ないと、区を取り違えたまま全項目を入力しきって
 * しまう(CLAUDE.md原則4がUIから見えない)。区名と選び直す導線が常に見えることを固定する。
 */
describe('WizardPage 選択中の自治体', () => {
  it('区名を表示し、自治体を変える導線を出す', async () => {
    renderWizard();
    await waitFor(() => {
      expect(screen.getByText('世田谷区')).toBeVisible();
    });
    expect(screen.getByRole('link', { name: '自治体を変える' })).toHaveAttribute('href', '/');
  });

  it('名称を取得できない間もコードを出し、無表示にはしない', () => {
    renderWizard();
    // 取得完了前でも「どの自治体か」の手掛かりが画面に残る。
    expect(screen.getByText(/世田谷区|13112/)).toBeVisible();
  });
});

/**
 * なぜ: 自治体を選び、ステップ1に入力してステップ2へ進んだところでリロードすると、
 * 入力した引越し日・転入元が空に戻っていた(保存は「作成」時だけだった)。
 * 手続きの判定に使う確定プロフィールとは別のキーへ下書きを持ち、復元したことを利用者へ伝える。
 */
describe('WizardPage 入力途中の下書き', () => {
  const DRAFT_KEY = 'tmn:wizard-draft:13112';

  /** リロード相当: いったん画面を捨てて、同じ localStorage のまま描画し直す。 */
  function reload(initialEntry = '/wizard') {
    cleanup();
    return renderWizard(initialEntry);
  }

  function fillStep1(moveDate = '2026-08-01') {
    fireEvent.change(screen.getByLabelText('引越し日または転入予定日', { exact: false }), {
      target: { value: moveDate },
    });
    fireEvent.click(screen.getByLabelText('東京都外'));
  }

  it('入力しただけでは確定プロフィールを書き換えず、下書きキーにだけ保存する', () => {
    renderWizard();
    fillStep1();

    expect(localStorage.getItem('tmn:profile:13112')).toBeNull();
    const draft = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null');
    expect(draft?.answers?.moveDate).toBe('2026-08-01');
    expect(draft?.answers?.originType).toBe('outside_tokyo');
  });

  it('ステップ2へ進んでリロードしても、引越し日と転入元が残る', () => {
    renderWizard();
    fillStep1();
    fireEvent.click(screen.getByRole('button', { name: '次へ（世帯の入力）' }));

    reload();

    // 中断したステップ(2)から再開する。
    expect(screen.getByRole('button', { name: '世帯（任意）' })).toHaveAttribute(
      'aria-current',
      'step',
    );
    fireEvent.click(screen.getByRole('button', { name: '引越し日と転入元（必須）' }));
    expect(screen.getByLabelText('引越し日または転入予定日', { exact: false })).toHaveValue(
      '2026-08-01',
    );
    expect(screen.getByLabelText('東京都外')).toBeChecked();
    expect(screen.getByRole('button', { name: 'この内容でチェックリストを作成' })).toBeEnabled();
  });

  it('ステップ2・3の入力も残る', () => {
    renderWizard();
    fillStep1();
    fireEvent.click(screen.getByRole('button', { name: '次へ（世帯の入力）' }));
    fireEvent.click(screen.getByLabelText('複数人'));
    fireEvent.click(screen.getByRole('checkbox', { name: /0〜2歳|0-2歳/ }));
    fireEvent.click(screen.getByRole('button', { name: '次へ（条件チェック）' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /マイナンバーカードを持っている/ }));

    reload();

    expect(screen.getByRole('checkbox', { name: /マイナンバーカードを持っている/ })).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: '世帯（任意）' }));
    expect(screen.getByLabelText('複数人')).toBeChecked();
  });

  it('復元したことを利用者へ伝え、破棄する手段を出す', () => {
    renderWizard();
    fillStep1();

    reload();

    const notice = screen.getByRole('status');
    expect(notice).toHaveTextContent('前回の入力途中の内容を復元しました');
    // 次に何をすればよいかが読める文面であること。
    expect(notice).toHaveTextContent('この内容でチェックリストを作成');

    fireEvent.click(screen.getByRole('button', { name: /破棄/ }));

    expect(screen.getByLabelText('引越し日または転入予定日', { exact: false })).toHaveValue('');
    expect(screen.getByLabelText('東京都外')).not.toBeChecked();
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('破棄しました');
  });

  it('何も入力していなければ下書きを作らない(次回に「復元しました」と言わない)', () => {
    renderWizard();
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull();

    // ステップを移動しただけでも下書きは作らない。
    fireEvent.click(screen.getByRole('button', { name: '次へ（世帯の入力）' }));
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull();

    reload();
    expect(screen.queryByText('前回の入力途中の内容を復元しました')).toBeNull();
  });

  it('作成すると下書きを消す(確定内容を「入力途中」として復元しない)', () => {
    renderWizard();
    fillStep1();
    expect(localStorage.getItem(DRAFT_KEY)).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'この内容でチェックリストを作成' }));
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull();

    // 確定後に入力画面へ戻っても「復元しました」とは言わない(確定内容が初期値として出るだけ)。
    reload();
    expect(screen.queryByText('前回の入力途中の内容を復元しました')).toBeNull();
    expect(screen.getByLabelText('引越し日または転入予定日', { exact: false })).toHaveValue(
      '2026-08-01',
    );
  });

  it('壊れた下書きは無視する(確定値・初期値へ混ぜない)', () => {
    localStorage.setItem(DRAFT_KEY, '{壊れた');
    renderWizard();
    expect(screen.getByLabelText('引越し日または転入予定日', { exact: false })).toHaveValue('');
    expect(screen.queryByText('前回の入力途中の内容を復元しました')).toBeNull();

    cleanup();
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ answers: { moveDate: '2026-08-01' } }));
    renderWizard();
    expect(screen.getByLabelText('引越し日または転入予定日', { exact: false })).toHaveValue('');
  });

  it('?step= の明示指定は下書きの中断位置より優先する', () => {
    renderWizard();
    fillStep1();
    fireEvent.click(screen.getByRole('button', { name: '次へ（世帯の入力）' }));

    reload('/wizard?step=3');
    expect(screen.getByRole('button', { name: '条件チェック（任意）' })).toHaveAttribute(
      'aria-current',
      'step',
    );
  });
});

/**
 * なぜ: 転入後にこのサービスを知る利用者が主要ターゲットで、過去日入力は現実的に起きる。
 * 一方 1900年のような値は誤入力なので受け付けない(監査P1-5)。
 */
describe('WizardPage 引越し日の受付範囲', () => {
  const today = todayInTokyo();
  const bounds = moveDateBounds(today);

  function dateInput() {
    return screen.getByLabelText('引越し日または転入予定日', { exact: false });
  }

  it('date入力に min/max を設定する', () => {
    renderWizard();
    expect(dateInput()).toHaveAttribute('min', bounds.min);
    expect(dateInput()).toHaveAttribute('max', bounds.max);
  });

  it('範囲外(1900年)は説明を出し、生成ボタンを無効にする', () => {
    renderWizard();
    fireEvent.change(dateInput(), { target: { value: '1900-01-01' } });
    fireEvent.click(screen.getByLabelText('東京都外'));

    expect(screen.getByRole('alert')).toHaveTextContent(bounds.min);
    expect(dateInput()).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('button', { name: 'この内容でチェックリストを作成' })).toBeDisabled();
    expect(localStorage.getItem('tmn:profile:13112')).toBeNull();
  });

  it('範囲内の過去日は受け付ける(転入後に使い始める利用者を切り捨てない)', () => {
    renderWizard();
    fireEvent.change(dateInput(), { target: { value: bounds.min } });
    fireEvent.click(screen.getByLabelText('東京都外'));

    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: 'この内容でチェックリストを作成' })).toBeEnabled();
  });
});
