import { useEffect, useState } from 'react';

/**
 * なぜ: GET系のデータ取得(読み込み中/エラー/成功)を各ページで統一的に扱う最小フック。
 * deps が変わるたびに再取得し、アンマウント後のsetStateを避ける。
 */
export interface AsyncState<T> {
  data: T | null;
  error: unknown;
  loading: boolean;
}

export function useAsync<T>(fn: () => Promise<T>, deps: readonly unknown[]): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T>>({ data: null, error: null, loading: true });

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
  }, deps);

  return state;
}
