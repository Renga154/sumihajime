import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * 補助機能の描画時例外を、その部品の中だけで止める境界。
 *
 * なぜ必要か(独立点検 P1): ルータの errorElement は画面全体の受け皿なので、チャットのような
 * 付随機能が描画中に投げると、チェックリスト本体と公式リンクごと「画面を表示できませんでした」に
 * 置き換わる。白画面にはならないものの、利用者が本当に必要としているもの — 手続きの一覧と
 * 公式ページへの導線 — が、補助機能の不具合で消える。CLAUDE.md 原則8 が求めているのは
 * まさにこの逆で、付随機能が落ちても本体は使えることである。
 *
 * 使い方: 落ちてもよい部品だけを包む。ページ全体を包む用途には使わない
 * (それはルータの errorElement = AppErrorPage の仕事)。
 *
 * 注意: React の error boundary が捕まえるのは**描画中**の例外だけで、イベントハンドラや
 * 非同期処理の中で投げられたものは届かない。それらは各部品が try/catch で受け、
 * エラー表示へ落とす(ChatPanel の onSubmit がそうしている)。
 */

interface Props {
  children: ReactNode;
  /** 再描画をやり直す関数を受け取り、代替表示を返す。 */
  fallback: (retry: () => void) => ReactNode;
  /** ログ識別用の短い名前。利用者には表示しない。 */
  label: string;
}

interface State {
  failed: boolean;
  /** 再試行のたびに増やす。子を作り直して、壊れた状態を持ち越さないようにする。 */
  attempt: number;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { failed: false, attempt: 0 };

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // なぜ error.message も stack も出さないのか(原則7): 例外メッセージには、その時点で
    // 描画していた値がそのまま載ることがある(チャットの回答本文など)。障害の切り分けに
    // 要るのは「どこが・どの種類で落ちたか」までで、中身は要らない。componentStack は
    // 部品名の連なりで利用者データを含まないため、これだけ残す。
    console.error(
      `[ErrorBoundary:${this.props.label}] ${error.name}`,
      info.componentStack?.trim().split('\n').slice(0, 5).join('\n'),
    );
  }

  private retry = (): void => {
    this.setState((s) => ({ failed: false, attempt: s.attempt + 1 }));
  };

  override render(): ReactNode {
    if (this.state.failed) return this.props.fallback(this.retry);
    // key を変えて子を作り直す。同じ要素のまま再描画すると、例外の原因になった内部状態が
    // 残ったままで、再試行が即座に同じ失敗を繰り返す。
    return <div key={this.state.attempt}>{this.props.children}</div>;
  }
}
