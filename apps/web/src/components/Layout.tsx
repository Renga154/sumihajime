import { NavLink, Outlet, Link } from 'react-router-dom';

/**
 * なぜ: 全ページ共通のランドマーク(header/nav/main/footer)とスキップリンクを提供し、
 * §15.3 の見出し・ランドマーク構造とキーボード操作の土台を担保する。footerには
 * §16.2「正式な行政サービスではない/公式ページで最終確認」の常設注意書きを置く。
 *
 * ロゴマークは東京の抽象(重なる街並み+チェック)をインラインSVGで表現し、外部リソースに
 * 依存しない(CDN/画像URL禁止)。ブランドカラー(brand)で信頼感を、アクセントで親しみを添える。
 */

const navItems = [
  { to: '/', label: 'ホーム', end: true },
  { to: '/wizard', label: '入力', end: false },
  { to: '/checklist', label: 'チェックリスト', end: false },
  { to: '/facilities', label: '窓口一覧', end: false },
  { to: '/waste', label: 'ごみ収集', end: false },
  { to: '/coverage', label: '対応状況・来歴', end: false },
];

function LogoMark() {
  return (
    <span
      aria-hidden="true"
      className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-brand-600 to-brand-800 shadow-sm ring-1 ring-brand-900/10"
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none">
        {/* 東京の街並みを抽象化した三本のビル。 */}
        <rect x="3" y="11" width="4" height="9" rx="1" className="fill-white/55" />
        <rect x="9.5" y="7" width="5" height="13" rx="1" className="fill-white/80" />
        <rect x="17" y="13" width="4" height="7" rx="1" className="fill-white/55" />
        {/* 完了チェック(ToDoの達成)。 */}
        <path
          d="M8.5 5.4l2 2 4.2-4.2"
          stroke="var(--color-accent-400)"
          strokeWidth="2.1"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

export function Layout() {
  return (
    <div className="min-h-screen bg-slate-50">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-brand-700 focus:px-3 focus:py-2 focus:text-white"
      >
        本文へスキップ
      </a>

      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur supports-[backdrop-filter]:bg-white/75">
        <div className="mx-auto flex max-w-3xl flex-col gap-2.5 px-4 py-3">
          <Link to="/" className="flex items-center gap-2.5 no-underline">
            <LogoMark />
            <span className="flex flex-col leading-tight">
              <span className="text-lg font-bold tracking-tight text-slate-900">東京転入ToDo</span>
              <span className="text-xs font-medium text-slate-500">
                非公式・公式根拠つきチェックリスト
              </span>
            </span>
          </Link>
          <nav aria-label="メインナビゲーション">
            <ul className="-mx-1 flex flex-wrap gap-x-1 gap-y-1 text-sm">
              {navItems.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.end}
                    className={({ isActive }) =>
                      `inline-block rounded-md px-2.5 py-1 no-underline transition-colors ${
                        isActive
                          ? 'bg-brand-50 font-semibold text-brand-700'
                          : 'text-slate-600 hover:bg-slate-100 hover:text-brand-700'
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

      <main id="main" className="mx-auto max-w-3xl px-4 py-6 sm:py-8">
        <Outlet />
      </main>

      <footer className="mt-10 border-t border-slate-200 bg-white">
        <div className="mx-auto max-w-3xl px-4 py-5 text-xs leading-relaxed text-slate-500">
          <p className="flex items-start gap-2">
            <svg
              aria-hidden="true"
              viewBox="0 0 20 20"
              className="mt-0.5 h-4 w-4 shrink-0 text-slate-400"
              fill="currentColor"
            >
              <path
                fillRule="evenodd"
                d="M10 2a8 8 0 100 16 8 8 0 000-16zm0 4a1 1 0 011 1v4a1 1 0 11-2 0V7a1 1 0 011-1zm0 8a1 1 0 100-2 1 1 0 000 2z"
                clipRule="evenodd"
              />
            </svg>
            <span>
              本サービスは行政の正式なサービスではありません。表示内容は目安です。実際の手続きの前に、
              必ず各自治体の公式ページで最新情報をご確認ください。
            </span>
          </p>
          <p className="mt-2 pl-6">
            入力内容（引越し日・世帯・条件など）はお使いの端末内にのみ保存され、サーバーには保存されません。
          </p>
        </div>
      </footer>
    </div>
  );
}
