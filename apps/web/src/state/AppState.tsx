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
}

const AppStateContext = createContext<AppState | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [municipalityCode, setCode] = useState<string | null>(() => loadMunicipalityCode());

  const setMunicipalityCode = useCallback((code: string) => {
    saveMunicipalityCode(code);
    setCode(code);
  }, []);

  const value = useMemo<AppState>(
    () => ({ municipalityCode, setMunicipalityCode }),
    [municipalityCode, setMunicipalityCode],
  );

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState(): AppState {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error('useAppState must be used within AppStateProvider');
  return ctx;
}
