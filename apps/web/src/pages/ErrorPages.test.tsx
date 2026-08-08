import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { AppErrorPage, NotFoundPage } from './ErrorPages';
import { SITE_TITLE } from '../lib/navigation';

/**
 * なぜ: 未定義URLと描画時例外で React Router の英語既定エラー画面
 * (「Unexpected Application Error!」「Hey developer」)が利用者に出ないことを固定する。
 * ヘッダー/フッターと復帰導線が残ることも同時に担保する(戻れない画面を作らない)。
 */

function Boom(): never {
  throw new Error('描画時の想定外例外(テスト)');
}

/** 本番(main.tsx)と同じ構造: Layout に errorElement、children の末尾に catch-all。 */
function renderApp(initialEntry: string) {
  const router = createMemoryRouter(
    [
      {
        element: <Layout />,
        errorElement: <AppErrorPage />,
        children: [
          { path: '/', element: <h1>ホーム</h1> },
          { path: '/boom', element: <Boom /> },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
    { initialEntries: [initialEntry] },
  );
  return render(<RouterProvider router={router} />);
}

const DEVELOPER_FACING = [
  'Unexpected Application Error',
  'Hey developer',
  'ErrorBoundary',
  'errorElement',
  '404 Not Found',
];

function expectNoDeveloperFacingText() {
  for (const phrase of DEVELOPER_FACING) {
    expect(document.body.textContent).not.toContain(phrase);
  }
}

describe('未定義URL (404)', () => {
  it('日本語の案内を出し、開発者向け文言は出さない', () => {
    renderApp('/typo-url');
    expect(screen.getByRole('heading', { level: 1, name: 'ページが見つかりません' })).toBeVisible();
    expectNoDeveloperFacingText();
  });

  it('ヘッダー・フッターと復帰導線が残る', () => {
    renderApp('/typo-url');
    expect(screen.getByRole('navigation', { name: 'メインナビゲーション' })).toBeInTheDocument();
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
    const recovery = screen.getByRole('navigation', { name: '他のページへ移動' });
    expect(recovery).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'ホーム（自治体を選ぶ）' })).toHaveAttribute(
      'href',
      '/',
    );
  });

  it('<title> をページ名で上書きする', () => {
    renderApp('/typo-url');
    expect(document.title).toBe(`ページが見つかりません | ${SITE_TITLE}`);
  });
});

describe('描画時の想定外例外 (errorElement)', () => {
  it('日本語の案内と再読み込み導線を出し、開発者向け文言は出さない', () => {
    renderApp('/boom');
    expect(
      screen.getByRole('heading', { level: 1, name: '画面を表示できませんでした' }),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'このページを再読み込みする' })).toBeVisible();
    expectNoDeveloperFacingText();
  });

  it('ヘッダー・フッターを保ったまま表示する', () => {
    renderApp('/boom');
    expect(screen.getByRole('navigation', { name: 'メインナビゲーション' })).toBeInTheDocument();
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
  });

  it('例外メッセージ(内部情報)を画面に出さない', () => {
    renderApp('/boom');
    expect(document.body.textContent).not.toContain('描画時の想定外例外(テスト)');
  });
});
