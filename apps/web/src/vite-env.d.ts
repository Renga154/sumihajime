/// <reference types="vite/client" />

// なぜ: Vite の環境アンビエント型(import.meta.env や CSSの副作用importの型宣言 `*.css` 等)を
// TypeScript に取り込む。tsconfig の types 配列は vite/client を含まないため、標準的な
// vite-env.d.ts の参照ディレクティブで明示的に読み込む(FacilityMap の maplibre-gl CSS import
// と main.tsx の index.css import を型解決するため)。
