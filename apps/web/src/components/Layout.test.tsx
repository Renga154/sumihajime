import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Layout } from './Layout';

/**
 * なぜ: Step2 のナビ再編を固定する。メインナビは利用者の主要動線のみ(ホーム/入力/
 * チェックリスト/窓口一覧/ごみ収集)に絞り、「対応状況・来歴」等の透明性情報はメインナビから
 * 外してフッターの「このサービスのデータについて」(/about-data)へ移設したことを担保する。
 */
function renderLayout() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<div>ホーム本文</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('Layout ナビゲーション (Step2)', () => {
  it('メインナビは利用者動線の5項目のみ(来歴系は含まない)', () => {
    renderLayout();
    const nav = screen.getByRole('navigation', { name: 'メインナビゲーション' });
    const labels = within(nav)
      .getAllByRole('link')
      .map((a) => a.textContent?.trim());
    expect(labels).toEqual(['ホーム', '入力', 'チェックリスト', '窓口一覧', 'ごみ収集']);
    expect(labels).not.toContain('対応状況・来歴');
  });

  it('フッターに「このサービスのデータについて」→/about-data の導線がある', () => {
    renderLayout();
    const link = screen.getByRole('link', { name: 'このサービスのデータについて' });
    expect(link).toHaveAttribute('href', '/about-data');
  });
});
