import { Fragment } from 'react';
import { isTrustedAnswerUrl, linkifyParts } from '@tmn/domain';

/**
 * なぜ: 回答本文に埋め込まれた公式URLをそのままクリックできるようにする。
 *
 * 適用範囲の線引き(重要): **APIが生成した回答本文にだけ**使う。利用者が入力した文章
 * (質問欄の内容)をここへ通してはならない。任意の入力をリンク化すると、画面上に
 * 利用者由来のURLを「サービスが案内した導線」の見た目で置けてしまう。
 *
 * それでも回答本文は安全ではない(本番で確認済み): 生成回答には質問文に仕込まれたURLが
 * 写り込み得る。よってリンクにするのは isTrustedAnswerUrl を満たすURL(公式ホスト、または
 * trustedUrls=台帳由来の引用URL・選択自治体の公式トップと完全一致)だけにし、それ以外は
 * 文字のまま表示する。URLの分解(linkifyParts)はサーバー側の保留判定と同じ関数を使う。サーバーは
 * さらに狭く「選択自治体に適用される承認済みホスト」以外のURLを含む生成回答を保留にするので、
 * ここは表示側の多層防御にあたる。
 *
 * 実装上の制約:
 * - dangerouslySetInnerHTML は使わない。文字列をURLと地の文へ分解し、Reactノードとして組む。
 * - リンクは色だけで区別しない(下線を必ず引く。WCAG 1.4.1)。
 * - 生成するのは <a href> なので、キーボードのTab移動に素直に乗る(tabIndexを触らない)。
 * - 長いURLは折り返す(break-all)。モバイル幅で横スクロールを作らないため。
 */
export function AnswerText({
  text,
  trustedUrls = [],
  className = '',
}: {
  text: string;
  /** 台帳由来で信頼できるURL(引用カードのURL・選択自治体の officialUrl)。 */
  trustedUrls?: readonly string[];
  className?: string;
}) {
  return (
    <p className={`whitespace-pre-wrap text-sm text-slate-800 ${className}`}>
      {linkifyParts(text).map((part, i) =>
        part.kind === 'url' && isTrustedAnswerUrl(part.value, trustedUrls) ? (
          <a
            key={i}
            href={part.value}
            target="_blank"
            rel="noopener noreferrer"
            // 別タブで開くことは aria-label で伝える。sr-only の文字を <a> の中へ足さないのは、
            // 段落のテキストがAPIの回答本文と1文字も違わない状態を保つため(表示文面は不変)。
            // 見えている文字列(URL)を先頭に含めるので WCAG 2.5.3(Label in Name)も満たす。
            aria-label={`${part.value}（別タブで開きます）`}
            // tap-target-inline: 地の文に混ざるリンクの当たり判定を24pxにする(WCAG 2.2 SC 2.5.8)。
            // 行送りは変わらない(index.css の注記を参照)。
            className="tap-target-inline break-all font-medium text-brand-700 underline decoration-brand-300 underline-offset-2 hover:text-brand-800 hover:decoration-brand-500"
          >
            {part.value}
          </a>
        ) : (
          <Fragment key={i}>{part.value}</Fragment>
        ),
      )}
    </p>
  );
}
