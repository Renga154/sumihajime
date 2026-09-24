import type { ReactNode } from 'react';
import { Link, isRouteErrorResponse, useRouteError } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { Card } from '../components/ui';
import { useDocumentTitle } from '../lib/navigation';

/**
 * 未定義URL(404)と、描画時の想定外例外の受け皿。
 *
 * なぜ: これが無いと React Router の既定エラー画面(英語・開発者向け文言)が全画面で出て、
 * ヘッダー・フッター・戻る導線がすべて消える。都民向けの公共情報サービスとして、利用者に
 * 見せてよい文面ではない(§16.2 / CLAUDE.md §7「ユーザー向けエラーは次の行動が分かる文面に」)。
 * 原因の推測はせず、確実に言えることと次の行動だけを日本語で示す(原則3)。
 */

/** 復帰導線。どの状態からでも主要動線へ戻れるようにする。 */
const RECOVERY_LINKS: { to: string; label: string; description: string }[] = [
  {
    to: '/',
    label: 'ホーム（自治体を選ぶ）',
    description: 'お住まいの自治体を選んで最初から始めます',
  },
  { to: '/checklist', label: 'チェックリスト', description: '入力済みの内容があれば再表示します' },
  { to: '/facilities', label: '窓口一覧', description: '自治体の窓口の場所・受付時間を見ます' },
  {
    to: '/about-data',
    label: 'このサービスのデータについて',
    description: '対応自治体・出典・最終確認日を公開しています',
  },
];

function RecoveryLinks() {
  return (
    <nav aria-label="他のページへ移動">
      <ul className="mt-4 space-y-2">
        {RECOVERY_LINKS.map((l) => (
          <li key={l.to}>
            <Link
              to={l.to}
              className="font-semibold text-brand-700 underline decoration-brand-300 underline-offset-2 hover:text-brand-800"
            >
              {l.label}
            </Link>
            <span className="ml-1.5 text-sm text-slate-600">— {l.description}</span>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function NoticeCard({
  heading,
  children,
  extra,
}: {
  heading: string;
  children: ReactNode;
  extra?: ReactNode;
}) {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight text-slate-900">{heading}</h1>
      <Card>
        <div className="text-slate-700">{children}</div>
        {extra}
        <RecoveryLinks />
      </Card>
    </div>
  );
}

/** 未定義URL(catch-all ルート)。ヘッダー・フッターは Layout の <Outlet /> 経由で保たれる。 */
export function NotFoundPage() {
  useDocumentTitle('ページが見つかりません');
  return (
    <NoticeCard heading="ページが見つかりません">
      <p>
        お探しのページは見つかりませんでした。アドレスが変わったか、入力に誤りがある可能性があります。
      </p>
      <p className="mt-1 text-sm text-slate-600">下のリンクから、目的の情報へお進みください。</p>
    </NoticeCard>
  );
}

/** 想定外の描画時例外。原因は推測せず、再読み込みと復帰導線だけを案内する。 */
function UnexpectedError() {
  useDocumentTitle('画面を表示できませんでした');
  return (
    <NoticeCard
      heading="画面を表示できませんでした"
      extra={
        <p className="mt-4">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-lg bg-brand-600 px-4 py-2 font-semibold text-white transition-colors hover:bg-brand-700 active:bg-brand-800"
          >
            このページを再読み込みする
          </button>
        </p>
      }
    >
      <p>
        一時的な問題が発生した可能性があります。ページを再読み込みすると解消することがあります。
      </p>
      <p className="mt-1 text-sm text-slate-600">
        解消しない場合は、下のリンクから他のページへお進みください。手続きの内容は各自治体の公式ページでもご確認いただけます。
      </p>
    </NoticeCard>
  );
}

/**
 * ルーターの errorElement。Layout をそのまま包み直すことで、エラー時もヘッダー・ナビ・
 * フッター(免責と公式ページ導線)を残す。
 */
export function AppErrorPage() {
  const error = useRouteError();
  const isNotFound = isRouteErrorResponse(error) && error.status === 404;
  return <Layout>{isNotFound ? <NotFoundPage /> : <UnexpectedError />}</Layout>;
}
