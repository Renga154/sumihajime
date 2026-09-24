import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { Layout } from './Layout';

/**
 * なぜ: Step2 のナビ再編を固定する。メインナビは利用者の主要動線のみ(ホーム/入力/
 * チェックリスト/窓口一覧/ごみ収集)に絞り、「対応状況・来歴」等の透明性情報はメインナビから
 * 外してフッターの「このサービスのデータについて」(/about-data)へ移設したことを担保する。
 *
 * データルーター(createMemoryRouter)で描画する理由: Layout は <ScrollRestoration /> を
 * 含み、これは本番と同じ createBrowserRouter 系のルーターでのみ動作する。
 */
function renderLayout() {
  const router = createMemoryRouter(
    [
      {
        element: <Layout />,
        children: [{ path: '/', element: <div>ホーム本文</div> }],
      },
    ],
    { initialEntries: ['/'] },
  );
  return render(<RouterProvider router={router} />);
}

describe('Layout ナビゲーション (Step2)', () => {
  it('メインナビは利用者動線の6項目のみ(来歴系は含まない)', () => {
    renderLayout();
    const nav = screen.getByRole('navigation', { name: 'メインナビゲーション' });
    const labels = within(nav)
      .getAllByRole('link')
      .map((a) => a.textContent?.trim());
    // 「区ごとの期限」は末尾。主要動線(入力→チェックリスト→窓口/ごみ)の後ろに置き、
    // 順番で寄り道であることを表す(2026-08-09)。来歴系(/about-data)はフッターのまま。
    expect(labels).toEqual([
      'ホーム',
      '入力',
      'チェックリスト',
      '窓口一覧',
      'ごみ収集',
      '自治体ごとの期限',
    ]);
    expect(labels).not.toContain('対応状況・来歴');
  });

  it('フッターに「このサービスのデータについて」→/about-data の導線がある', () => {
    renderLayout();
    const link = screen.getByRole('link', { name: 'このサービスのデータについて' });
    expect(link).toHaveAttribute('href', '/about-data');
  });
});
