import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { loadMunicipalityCode, saveMunicipalityCode } from '../lib/storage';

/**
 * なぜ: 選択中の自治体コードを画面間で共有する最小の状態。プロフィール・完了状態は
 * localStorage(storage.ts)を直接読む方式にして状態を分散させないため、ここでは
 * 自治体選択のみを扱う。重い状態管理ライブラリは使わない。
 */

interface AppState {
  municipalityCode: string | null;
  setMunicipalityCode: (code: string) => void;
  /**
   * メモリ上の状態だけを空へ戻す(storage への書き込みはしない)。
   *
   * なぜ setMunicipalityCode と分けるか: 「この端末に保存した入力を消去」操作は
   * storage.clearAllAppData() で localStorage を先に消し終えている。その後で
   * setMunicipalityCode(null相当)を呼ぶと再び書き込みが走ってしまうため、
   * メモリ上の状態だけを落とす専用の関数を用意する。
   */
  resetMunicipalityCode: () => void;
}

const AppStateContext = createContext<AppState | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [municipalityCode, setCode] = useState<string | null>(() => loadMunicipalityCode());

  const setMunicipalityCode = useCallback((code: string) => {
    saveMunicipalityCode(code);
    setCode(code);
  }, []);

  const resetMunicipalityCode = useCallback(() => {
    setCode(null);
  }, []);

  const value = useMemo<AppState>(
    () => ({ municipalityCode, setMunicipalityCode, resetMunicipalityCode }),
    [municipalityCode, setMunicipalityCode, resetMunicipalityCode],
  );

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState(): AppState {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error('useAppState must be used within AppStateProvider');
  return ctx;
}
