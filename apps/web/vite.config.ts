import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * @fontsource の @font-face は woff2 に加えて woff レガシーURLも書く。woff2 非対応の
 * ブラウザは実質存在せず、同梱すると woff 側もビルド成果物へ出力される(分割サブセットは
 * 3ウェイト×120スライスあるため、無視されるファイルが約370本・十数MB増える)。
 * ビルド前に woff のフォールバックURLだけを剥がし、woff2 のみを配信する
 * (この方針自体は分割サブセット化の前から index.css で取っていたものを引き継ぐ)。
 */
const FONTSOURCE_WOFF_FALLBACK = /,\s*url\([^)]*\.woff\)\s*format\('woff'\)/g;

function stripFontsourceWoffFallback(): Plugin {
  return {
    name: 'strip-fontsource-woff-fallback',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('@fontsource') || !id.split('?')[0]?.endsWith('.css')) return null;
      // lastIndex の持ち越しを避けるため test() は使わず、置換結果の差分で判定する。
      const stripped = code.replace(FONTSOURCE_WOFF_FALLBACK, '');
      return stripped === code ? null : { code: stripped, map: null };
    },
  };
}

// なぜ: 単一Worker構成(apps/api/wrangler.jsonc)がこのdist/を静的アセットとして配信する。
// dev時は /api を wrangler dev(:8787)へプロキシし、フロントは同一オリジンで叩ける。
export default defineConfig({
  plugins: [stripFontsourceWoffFallback(), react(), tailwindcss()],
  build: {
    outDir: 'dist',
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
