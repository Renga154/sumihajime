import { NavLink, Outlet, Link } from 'react-router-dom';

/**
 * なぜ: 全ページ共通のランドマーク(header/nav/main/footer)とスキップリンクを提供し、
 * §15.3 の見出し・ランドマーク構造とキーボード操作の土台を担保する。footerには
 * §16.2「正式な行政サービスではない/公式ページで最終確認」の常設注意書きを置く。
 *
 * ロゴマークは東京の抽象(重なる街並み+チェック)をインラインSVGで表現し、外部リソースに
 * 依存しない(CDN/画像URL禁止)。ブランドカラー(brand)で信頼感を、アクセントで親しみを添える。
 */

// なぜ: メインナビは利用者の主要動線のみに絞る(Step2)。来歴・鮮度・出典の透明性情報は
// 一般利用者にとってはノイズになりうるため、メインナビから外し、フッターの
// 「このサービスのデータについて」(/about-data)からたどれるようにする。
const navItems = [
  { to: '/', label: 'ホーム', end: true },
  { to: '/wizard', label: '入力', end: false },
  { to: '/checklist', label: 'チェックリスト', end: false },
  { to: '/facilities', label: '窓口一覧', end: false },
  { to: '/waste', label: 'ごみ収集', end: false },
];

function LogoMark() {
  // 正式ロゴ(家+扉+チェック)。装飾画像のため alt は空にする。
  return (
    <img
      src="/logo.png"
      alt=""
      aria-hidden="true"
      className="h-9 w-9 shrink-0 rounded-xl shadow-sm ring-1 ring-brand-900/10"
    />
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
              <span className="text-lg font-bold tracking-tight text-slate-900">スミハジメ</span>
              <span className="text-xs font-medium text-slate-500">
                東京の新生活ToDo(非公式・公式根拠つき)
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
          {/*
            比較ページへの導線。自治体間の比較は利用者が明示的に選んで到達するこの1ページだけで行い、
            各画面のチェックリスト・詳細には他区の値を出さない(CLAUDE.md原則4)。
          */}
          <p className="mt-3 pl-6">
            <Link
              to="/differences"
              className="font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800"
            >
              区ごとの期限のちがい
            </Link>
            <span className="ml-1.5 text-slate-500">
              — 同じ手続きでも区によって期限が違うことを比較できます
            </span>
          </p>
          <p className="mt-2 pl-6">
            <Link
              to="/about-data"
              className="font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800"
            >
              このサービスのデータについて
            </Link>
            <span className="ml-1.5 text-slate-500">
              — 対応自治体・データの新しさ・出典を公開しています
            </span>
          </p>
        </div>
      </footer>
    </div>
  );
}
