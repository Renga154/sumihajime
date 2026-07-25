import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, redirect, RouterProvider } from 'react-router-dom';
import './index.css';
import { AppStateProvider } from './state/AppState';
import { Layout } from './components/Layout';
import { LandingPage } from './pages/LandingPage';
import { WizardPage } from './pages/WizardPage';
import { ChecklistPage } from './pages/ChecklistPage';
import { ProcedureDetailPage } from './pages/ProcedureDetailPage';
import { FacilitiesPage } from './pages/FacilitiesPage';
import { WastePage } from './pages/WastePage';
import { CoveragePage } from './pages/CoveragePage';

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: '/', element: <LandingPage /> },
      { path: '/wizard', element: <WizardPage /> },
      { path: '/checklist', element: <ChecklistPage /> },
      { path: '/procedures/:id', element: <ProcedureDetailPage /> },
      { path: '/facilities', element: <FacilitiesPage /> },
      { path: '/waste', element: <WastePage /> },
      // 透明性ページ(来歴・鮮度・出典)。Step2でメインナビから外しフッター導線へ移設。
      { path: '/about-data', element: <CoveragePage /> },
      // 旧URL /coverage は直リンク互換のため /about-data へリダイレクトする。
      { path: '/coverage', loader: () => redirect('/about-data') },
    ],
  },
]);

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('Root element #root not found');
}

createRoot(rootEl).render(
  <StrictMode>
    <AppStateProvider>
      <RouterProvider router={router} />
    </AppStateProvider>
  </StrictMode>,
);
