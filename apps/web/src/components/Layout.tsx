import { NavLink, Outlet, Link } from 'react-router-dom';

/**
 * なぜ: 全ページ共通のランドマーク(header/nav/main/footer)とスキップリンクを提供し、
 * §15.3 の見出し・ランドマーク構造とキーボード操作の土台を担保する。footerには
 * §16.2「正式な行政サービスではない/公式ページで最終確認」の常設注意書きを置く。
 */

const navItems = [
  { to: '/', label: 'ホーム', end: true },
  { to: '/wizard', label: '入力', end: false },
  { to: '/checklist', label: 'チェックリスト', end: false },
  { to: '/facilities', label: '窓口一覧', end: false },
  { to: '/waste', label: 'ごみ収集', end: false },
  { to: '/coverage', label: '対応状況・データ出典', end: false },
];

export function Layout() {
  return (
    <div className="min-h-screen bg-slate-50">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-blue-700 focus:px-3 focus:py-2 focus:text-white"
      >
        本文へスキップ
      </a>

      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl flex-col gap-2 px-4 py-3">
          <Link to="/" className="text-lg font-bold text-slate-900 no-underline">
            東京転入ToDo
            <span className="ml-2 align-middle text-xs font-normal text-slate-500">
              非公式・公式根拠つきチェックリスト
            </span>
          </Link>
          <nav aria-label="メインナビゲーション">
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {navItems.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.end}
                    className={({ isActive }) =>
                      `inline-block py-1 no-underline ${
                        isActive
                          ? 'font-semibold text-blue-700 underline'
                          : 'text-slate-600 hover:text-blue-700 hover:underline'
                      }`
                    }
                  >
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </header>

      <main id="main" className="mx-auto max-w-3xl px-4 py-6">
        <Outlet />
      </main>

      <footer className="mt-8 border-t border-slate-200 bg-white">
        <div className="mx-auto max-w-3xl px-4 py-4 text-xs leading-relaxed text-slate-500">
          <p>
            本サービスは行政の正式なサービスではありません。表示内容は目安です。実際の手続きの前に、
            必ず各自治体の公式ページで最新情報をご確認ください。
          </p>
          <p className="mt-1">
            入力内容（引越し日・世帯・条件など）はお使いの端末内にのみ保存され、サーバーには保存されません。
          </p>
        </div>
      </footer>
    </div>
  );
}
