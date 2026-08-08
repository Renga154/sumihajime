import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, Link, createMemoryRouter } from 'react-router-dom';
import { Layout } from './Layout';
import { SITE_TITLE, useDocumentTitle } from '../lib/navigation';

/**
 * なぜ: 遷移まわりの基本(スクロール位置・フォーカス・タイトル)の回帰固定。
 * これらが無いと、区を選んだ直後にウィザードの最下部へ着地し、キーボード利用者は
 * 毎回ページ先頭から辿り直し、履歴・タブではページを区別できない。
 */

function Home() {
  useDocumentTitle();
  return (
    <div>
      <h1>ホーム</h1>
      <Link to="/wizard">条件を入力する</Link>
    </div>
  );
}

function Wizard() {
  useDocumentTitle('条件を入力する');
  return <h1>条件を入力する</h1>;
}

function renderApp() {
  const router = createMemoryRouter(
    [
      {
        element: <Layout />,
        children: [
          { path: '/', element: <Home /> },
          { path: '/wizard', element: <Wizard /> },
        ],
      },
    ],
    { initialEntries: ['/'] },
  );
  return render(<RouterProvider router={router} />);
}

describe('遷移時のスクロール位置', () => {
  it('<ScrollRestoration /> が遷移時に window.scrollTo を呼ぶ(先頭へ戻す)', async () => {
    const scrollTo = vi.mocked(window.scrollTo);
    renderApp();
    scrollTo.mockClear();

    await userEvent.click(screen.getByRole('link', { name: '条件を入力する' }));

    await waitFor(() => {
      expect(scrollTo).toHaveBeenCalled();
    });
    // 新規遷移(POP以外)は必ず先頭へ。復元対象がある場合のみ座標が変わる。
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
  });
});

describe('遷移時のフォーカスとタイトル', () => {
  it('初回表示ではフォーカスを奪わない', () => {
    renderApp();
    expect(document.activeElement).toBe(document.body);
  });

  it('遷移後は body ではなくページ見出し(h1)へフォーカスが移る', async () => {
    renderApp();
    await userEvent.click(screen.getByRole('link', { name: '条件を入力する' }));

    await waitFor(() => {
      const h1 = screen.getByRole('heading', { level: 1, name: '条件を入力する' });
      expect(document.activeElement).toBe(h1);
      expect(h1).toHaveAttribute('tabindex', '-1');
    });
  });

  it('ページごとに <title> が変わり、ページ名が読み上げ通知へ流れる', async () => {
    renderApp();
    expect(document.title).toBe(SITE_TITLE);

    await userEvent.click(screen.getByRole('link', { name: '条件を入力する' }));

    await waitFor(() => {
      expect(document.title).toBe(`条件を入力する | ${SITE_TITLE}`);
    });
    // 視覚非表示の live region にページ名が入る(スクリーンリーダーへの遷移通知)。
    const announcer = document.querySelector('[aria-live="polite"].sr-only');
    await waitFor(() => {
      expect(announcer).toHaveTextContent('条件を入力する');
    });
  });
});
