import type { ReactNode } from 'react';
import { NavLink, Outlet, Link, ScrollRestoration } from 'react-router-dom';
import { useRouteChangeAnnouncement } from '../lib/navigation';
import { FEEDBACK_FORM_URL } from '../content/contact';

/**
 * なぜ: 全ページ共通のランドマーク(header/nav/main/footer)とスキップリンクを提供し、
 * §15.3 の見出し・ランドマーク構造とキーボード操作の土台を担保する。footerには
 * §16.2「正式な行政サービスではない/公式ページで最終確認」の常設注意書きを置く。
 *
 * ロゴマークは東京の抽象(重なる街並み+チェック)をインラインSVGで表現し、外部リソースに
 * 依存しない(CDN/画像URL禁止)。ブランドカラー(brand)で信頼感を、アクセントで親しみを添える。
 *
 * 遷移まわりの基本もここで一括して担保する:
 *  - <ScrollRestoration />: 遷移時はページ先頭へ、戻る操作では元の位置へ復元する。
 *  - useRouteChangeAnnouncement(): 遷移後に h1 へフォーカスを移し、ページ名を読み上げ通知する。
 * children を渡した場合は <Outlet /> の代わりにそれを描画する(errorElement から
 * ヘッダー・フッターごと再利用するため)。
 */

// なぜ: メインナビは利用者の主要動線のみに絞る(Step2)。来歴・鮮度・出典の透明性情報は
// 一般利用者にとってはノイズになりうるため、メインナビから外し、フッターの
// 「このサービスのデータについて」(/about-data)からたどれるようにする。
//
// 「区ごとの期限」だけは末尾に置く(2026-08-09)。同じ手続きでも申請期限が区で違うことは、
// 転入者にとって実害のある情報(申請が数日遅れただけで助成を遡れない区がある)であり、
// フッターに埋めておくには惜しい。主要動線(入力→チェックリスト→窓口/ごみ)の後ろに置き、
// 順番で「これは寄り道である」ことを表す。
//
// 原則4(選択自治体と異なる自治体の情報を混ぜない)との関係: 比較は利用者が明示的に選んで
// 到達するこの1ページの中だけで行い、他の画面には他区の値を出さない。この条件は
// メニューに載せても変わらない(ナビの選択も明示的な行動である)。
const navItems = [
  { to: '/', label: 'ホーム', end: true },
  { to: '/wizard', label: '入力', end: false },
  { to: '/checklist', label: 'チェックリスト', end: false },
  { to: '/facilities', label: '窓口一覧', end: false },
  { to: '/waste', label: 'ごみ収集', end: false },
  { to: '/differences', label: '区ごとの期限', end: false },
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

export function Layout({ children }: { children?: ReactNode }) {
  const announcement = useRouteChangeAnnouncement();
  return (
    <div className="min-h-screen bg-slate-50">
      {/* 遷移の通知。視覚表示はせず、スクリーンリーダーにだけページ名を伝える。 */}
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      <ScrollRestoration />
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
        {children ?? <Outlet />}
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
          {/*
            なぜ「チェックリストの」に限定するのか(独立点検 P1-10): 以前は「入力内容」と包括的に
            書いていたが、AIチャットの質問文だけはサーバーへ送信されAIモデルで処理される
            (保存・ログ記録はしない)。包括的な文言は、その1点について実態と食い違う。
          */}
          <p className="mt-2 pl-6">
            チェックリストの入力内容（引越し日・世帯・条件など）はお使いの端末内にのみ保存され、サーバーには保存されません。AIチャットの質問文のみサーバーで処理されますが、質問文と回答は保存しません。
          </p>
          {/*
            比較ページへの導線。自治体間の比較は利用者が明示的に選んで到達するこの1ページだけで行い、
            各画面のチェックリスト・詳細には他区の値を出さない(CLAUDE.md原則4)。
          */}
          <p className="mt-3 pl-6">
            {/* tap-target-inline: 地の文と同じ行に混ざるリンク。行送りを変えずに当たり判定だけ広げる。 */}
            <Link
              to="/differences"
              className="tap-target-inline font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800"
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
              className="tap-target-inline font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800"
            >
              このサービスのデータについて
            </Link>
            <span className="ml-1.5 text-slate-500">
              — 対応自治体・データの新しさ・出典を公開しています
            </span>
          </p>
          {/*
            常時公開のサービスとして必要な文書(A-1-3)。本文中の免責と重複するが、独立した
            ページとして全ページからたどれる場所に置く。
          */}
          <p className="mt-3 pl-6">
            <Link
              to="/terms"
              className="tap-target-inline font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800"
            >
              利用規約
            </Link>
            <span className="mx-2 text-slate-300">/</span>
            <Link
              to="/privacy"
              className="tap-target-inline font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800"
            >
              プライバシーポリシー
            </Link>
            {FEEDBACK_FORM_URL && (
              <>
                <span className="mx-2 text-slate-300">/</span>
                {/* 誤り報告の窓口(A-1-2)。外部(Google フォーム)なので新しいタブで開く。 */}
                <a
                  href={FEEDBACK_FORM_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="tap-target-inline font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800"
                >
                  誤りの報告・お問い合わせ
                  <span className="sr-only">（別タブで開きます）</span>
                </a>
              </>
            )}
          </p>
        </div>
      </footer>
    </div>
  );
}
