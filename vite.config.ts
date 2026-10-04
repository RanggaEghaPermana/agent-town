import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  optimizeDeps: { include: ['react-markdown', 'remark-gfm'] },
  server: {
    proxy: {
      '/gpt/api': { target: 'http://127.0.0.1:4318', rewrite: path => path.replace(/^\/gpt/, '') },
      '/gpt/ws': { target: 'ws://127.0.0.1:4318', ws: true, rewrite: path => path.replace(/^\/gpt/, '') },
      '/api': 'http://127.0.0.1:4317',
      '/ws': { target: 'ws://127.0.0.1:4317', ws: true },
    },
  },
  build: { chunkSizeWarningLimit: 1800 },
});
