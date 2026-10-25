import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  // In development the Vite server proxies /api to the Express backend, so the browser only ever
  // talks to one origin (cookies just work, no CORS needed).
  const apiTarget = env.VITE_DEV_API_TARGET || 'http://127.0.0.1:8000';
  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: { '/api': { target: apiTarget, changeOrigin: false } },
    },
    preview: {
      port: 4173,
      proxy: { '/api': { target: apiTarget, changeOrigin: false } },
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: './src/test/setup.js',
      css: false,
    },
  };
});
