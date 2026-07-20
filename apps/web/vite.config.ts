import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Build output goes to apps/web/dist, which the API Worker serves as static
// assets (see apps/api/wrangler.jsonc).
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
  },
});
