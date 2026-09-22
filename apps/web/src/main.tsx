// ★ 最初に読む: Zod の JIT機能検出(new Function)がCSP違反を出すのを止める。
//   他のモジュールが parse を始める前に設定する必要があるため、この import は先頭に置く。
import './lib/zod-config';
import { StrictMode } from 'react';
import type { ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, redirect, RouterProvider } from 'react-router-dom';
import { SPA_ROUTES, type SpaRoutePath } from '@tmn/domain';
// フォント(DADS準拠の Noto Sans JP / 400・500・700)。@fontsource の分割サブセットCSSは
// 120個の unicode-range 付き @font-face を宣言し、ブラウザは実際に使う文字を含むスライスだけを
// 取得する。index.css の @import ではなくJSからimportするのは、vite.config.ts の
// strip-fontsource-woff-fallback プラグイン(woff レガシーURLの除去)を通すため
// (CSS内の @import は postcss-import がプラグインを介さずファイルを読むので効かない)。
import '@fontsource/noto-sans-jp/400.css';
import '@fontsource/noto-sans-jp/500.css';
import '@fontsource/noto-sans-jp/700.css';
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
import { PrivacyPage, TermsPage } from './pages/PolicyPages';
import { DifferencesPage } from './pages/DifferencesPage';
import { AppErrorPage, NotFoundPage } from './pages/ErrorPages';

/**
 * パスごとの画面。@tmn/domain の SPA_ROUTES と1対1で対応する。
 *
 * なぜ Record<SpaRoutePath, ...> なのか: SPA_ROUTES はサーバー側(未定義URLの404判定・
 * sitemap生成)と共有している。ここを Record にしておくと、表にパスを足したのに画面を
 * 足し忘れた場合も、画面だけ足して表に書き忘れた場合も型エラーになり、
 * 「画面はあるのに404が返る」ズレが発生しない。
 *
 * 値が要素ではなくリダイレクトのルートは loader を返す。
 */
const ROUTE_CONFIGS: Record<SpaRoutePath, { element: ReactElement } | { loader: () => Response }> =
  {
    '/': { element: <LandingPage /> },
    '/wizard': { element: <WizardPage /> },
    '/checklist': { element: <ChecklistPage /> },
    '/procedures/:id': { element: <ProcedureDetailPage /> },
    '/facilities': { element: <FacilitiesPage /> },
    '/waste': { element: <WastePage /> },
    // 区ごとの期限差分の比較ページ。利用者が「区ごとの違いを見る」と明示的に選んで到達する
    // 独立ページで、自治体間の比較はここだけで行う(CLAUDE.md原則4)。
    '/differences': { element: <DifferencesPage /> },
    // 透明性ページ(来歴・鮮度・出典)。Step2でメインナビから外しフッター導線へ移設。
    '/about-data': { element: <CoveragePage /> },
    // 旧URL /coverage は直リンク互換のため /about-data へリダイレクトする。
    '/coverage': { loader: () => redirect('/about-data') },
    // 利用規約・プライバシーポリシー(A-1-3)。フッターから全ページ経由でたどれる。
    '/terms': { element: <TermsPage /> },
    '/privacy': { element: <PrivacyPage /> },
  };

const router = createBrowserRouter([
  {
    element: <Layout />,
    // なぜ: これが無いと未定義URLや描画時例外で React Router の英語既定エラー画面が
    // 全画面に出て、ヘッダー・フッター・戻る導線が消える。AppErrorPage は Layout を
    // 包み直して共通の枠を保ったまま、日本語で次の行動を案内する。
    errorElement: <AppErrorPage />,
    children: [
      ...SPA_ROUTES.map((route) => ({ path: route.path, ...ROUTE_CONFIGS[route.path] })),
      // 未定義URLの受け皿。ヘッダー/フッターを保ったまま日本語の案内を出す
      // (Workerはこのパスへ 404 ステータスを付けて同じHTMLを返す)。
      { path: '*', element: <NotFoundPage /> },
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
