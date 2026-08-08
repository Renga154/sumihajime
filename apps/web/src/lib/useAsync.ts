import { useCallback, useEffect, useState } from 'react';

/**
 * なぜ: GET系のデータ取得(読み込み中/エラー/成功)を各ページで統一的に扱う最小フック。
 * deps が変わるたびに再取得し、アンマウント後のsetStateを避ける。
 */
export interface AsyncState<T> {
  data: T | null;
  error: unknown;
  loading: boolean;
  /**
   * 同じ条件でもう一度取得する。
   *
   * なぜ必要か(独立点検 P1): 失敗したときの唯一の復帰手段がページ全体の再読み込みだった。
   * 区役所の弱い電波では一度で通らないほうが普通で、そのたびにアプリ全体を読み直させるのは
   * 通信量も待ち時間も無駄になる。失敗した取得だけをその場でやり直せるようにする。
   */
  reload: () => void;
}

export function useAsync<T>(fn: () => Promise<T>, deps: readonly unknown[]): AsyncState<T> {
  const [state, setState] = useState<Omit<AsyncState<T>, 'reload'>>({
    data: null,
    error: null,
    loading: true,
  });
  // 再試行のたびに増やす。deps に混ぜることで「同じ条件でもう一度」を1つの経路で表せる
  // (取得処理を二重に書かない = 再試行だけ挙動が違う、という食い違いが起きない)。
  const [attempt, setAttempt] = useState(0);
  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    let active = true;
    setState({ data: null, error: null, loading: true });
    fn().then(
      (data) => {
        if (active) setState({ data, error: null, loading: false });
      },
      (error) => {
        if (active) setState({ data: null, error, loading: false });
      },
    );
    return () => {
      active = false;
    };
  }, [...deps, attempt]);

  return { ...state, reload };
}
