import type { ReactElement } from 'react';
import { render, type RenderResult } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AppStateProvider } from '../state/AppState';

/**
 * なぜ: ページテストで Router + AppStateProvider を一括で用意する。extraRoutes に
 * 遷移先のスタブ(例: /checklist)を渡し、useNavigate による遷移を検証できるようにする。
 */
export function renderWithProviders(
  ui: ReactElement,
  opts: { path?: string; initialEntry?: string; extraRoutes?: ReactElement } = {},
): RenderResult {
  const { path = '/', initialEntry = '/', extraRoutes } = opts;
  return render(
    <AppStateProvider>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path={path} element={ui} />
          {extraRoutes}
        </Routes>
      </MemoryRouter>
    </AppStateProvider>,
  );
}
