import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route } from 'react-router-dom';
import { renderWithProviders } from '../test/utils';
import { DeleteLocalDataControl } from './DeleteLocalDataControl';

/**
 * なぜ: 「この端末に保存した入力を消去」はプライバシーポリシー・チェックリストの両画面で使う
 * 取り消せない操作。window.confirm を使わない2段階確認・キーボード操作・完了の告知・
 * 消去後の遷移(原則6・7)を固定する。
 */

function HomeStub() {
  return <p>ホーム</p>;
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('tmn:municipality', '13112');
  localStorage.setItem('tmn:profile:13112', '{"dummy":true}');
  localStorage.setItem('tmn:done:13112', '{}');
  localStorage.setItem('other-site:preference', 'keep-me');
});

function renderControl() {
  return renderWithProviders(<DeleteLocalDataControl />, {
    path: '/privacy',
    initialEntry: '/privacy',
    extraRoutes: <Route path="/" element={<HomeStub />} />,
  });
}

describe('この端末に保存した入力を消去', () => {
  it('最初は消去ボタンのみで、確認は出さない(window.confirm を使わない)', () => {
    renderControl();
    expect(
      screen.getByRole('button', { name: 'この端末に保存した入力を消去' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '消去する' })).not.toBeInTheDocument();
  });

  it('押すとインラインの確認(消去する/やめる)が出る', async () => {
    const user = userEvent.setup();
    renderControl();
    await user.click(screen.getByRole('button', { name: 'この端末に保存した入力を消去' }));
    expect(screen.getByRole('button', { name: '消去する' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'やめる' })).toBeInTheDocument();
  });

  it('キーボードだけで1段階目を開ける', async () => {
    const user = userEvent.setup();
    renderControl();
    await user.tab();
    expect(screen.getByRole('button', { name: 'この端末に保存した入力を消去' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('button', { name: '消去する' })).toBeInTheDocument();
  });

  it('「やめる」を押すと何も消さずに最初の状態へ戻る', async () => {
    const user = userEvent.setup();
    renderControl();
    await user.click(screen.getByRole('button', { name: 'この端末に保存した入力を消去' }));
    await user.click(screen.getByRole('button', { name: 'やめる' }));

    expect(
      screen.getByRole('button', { name: 'この端末に保存した入力を消去' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '消去する' })).not.toBeInTheDocument();
    expect(localStorage.getItem('tmn:profile:13112')).not.toBeNull();
  });

  it('「消去する」を押すとこのアプリのキーだけ消え、完了を告知したうえで / へ遷移する', async () => {
    const user = userEvent.setup();
    renderControl();
    await user.click(screen.getByRole('button', { name: 'この端末に保存した入力を消去' }));
    await user.click(screen.getByRole('button', { name: '消去する' }));

    // 完了の告知(スクリーンリーダー向けライブリージョン)。
    expect(await screen.findByText('この端末に保存した入力を消去しました。')).toBeInTheDocument();

    // このアプリのキー(tmn:)は消え、無関係なキーは残る。
    expect(localStorage.getItem('tmn:municipality')).toBeNull();
    expect(localStorage.getItem('tmn:profile:13112')).toBeNull();
    expect(localStorage.getItem('tmn:done:13112')).toBeNull();
    expect(localStorage.getItem('other-site:preference')).toBe('keep-me');

    // 告知のあとで / へ遷移する。
    await waitFor(() => expect(screen.getByText('ホーム')).toBeInTheDocument());
  });
});
