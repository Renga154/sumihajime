import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ErrorBoundary } from './ErrorBoundary';

/**
 * なぜ: 補助機能の描画時例外を、その部品の中だけで止めることを固定する(原則8)。
 * 併せて、例外の中身をコンソールへ書き出さないこと(原則7)も検査する。
 */

// React は境界が捕まえた例外を必ず console.error へ出す。テスト出力を汚さないよう抑える。
let consoleError: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => consoleError.mockRestore());

function Boom({ message = '描画で落ちた(テスト)' }: { message?: string }): never {
  throw new Error(message);
}

function Fine() {
  return <p>本体は無事です</p>;
}

describe('ErrorBoundary', () => {
  it('子の描画時例外を捕まえ、代替表示に差し替える', () => {
    render(
      <div>
        <Fine />
        <ErrorBoundary label="test" fallback={() => <p>代わりの案内</p>}>
          <Boom />
        </ErrorBoundary>
      </div>,
    );

    expect(screen.getByText('代わりの案内')).toBeInTheDocument();
    // 隣接する本体は巻き添えにならない。
    expect(screen.getByText('本体は無事です')).toBeInTheDocument();
  });

  it('例外が無ければ子をそのまま描画する', () => {
    render(
      <ErrorBoundary label="test" fallback={() => <p>代わりの案内</p>}>
        <Fine />
      </ErrorBoundary>,
    );
    expect(screen.getByText('本体は無事です')).toBeInTheDocument();
    expect(screen.queryByText('代わりの案内')).toBeNull();
  });

  it('再試行で子を作り直す(原因が解消していれば通常表示へ戻る)', async () => {
    // 「落ちる原因」を部品の外に置く。React は例外のあと自動で1度描画し直すため、
    // 部品自身に回数を数えさせると、利用者が押す前に勝手に復帰してしまい検査にならない。
    let broken = true;
    function Flaky() {
      if (broken) throw new Error('原因がまだ残っている');
      return <p>復帰しました</p>;
    }

    render(
      <ErrorBoundary
        label="test"
        fallback={(retry) => (
          <button
            type="button"
            onClick={() => {
              broken = false; // 通信が戻った、などの外的な回復を模す。
              retry();
            }}
          >
            もう一度読み込む
          </button>
        )}
      >
        <Flaky />
      </ErrorBoundary>,
    );

    expect(screen.queryByText('復帰しました')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'もう一度読み込む' }));
    expect(screen.getByText('復帰しました')).toBeInTheDocument();
  });

  it('原因が解消していなければ、再試行しても代替表示のまま(嘘の復帰をしない)', async () => {
    render(
      <ErrorBoundary
        label="test"
        fallback={(retry) => (
          <button type="button" onClick={retry}>
            もう一度読み込む
          </button>
        )}
      >
        <Boom />
      </ErrorBoundary>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'もう一度読み込む' }));
    expect(screen.getByRole('button', { name: 'もう一度読み込む' })).toBeInTheDocument();
  });

  it('例外メッセージをコンソールへ書き出さない(原則7: 画面の値がログへ流れない)', () => {
    render(
      <ErrorBoundary label="ChatPanel" fallback={() => <p>代わりの案内</p>}>
        <Boom message="住所は世田谷区◯◯1-2-3です" />
      </ErrorBoundary>,
    );

    const ours = consoleError.mock.calls.filter((args) =>
      String(args[0] ?? '').includes('[ErrorBoundary:'),
    );
    expect(ours).toHaveLength(1);
    // 種類と場所だけ。メッセージ本文は載せない。
    expect(String(ours[0]?.[0])).toBe('[ErrorBoundary:ChatPanel] Error');
    expect(JSON.stringify(ours[0])).not.toContain('世田谷区◯◯1-2-3');
  });
});
