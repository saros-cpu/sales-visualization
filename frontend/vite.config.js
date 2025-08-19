import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8900',
        changeOrigin: true,
      },
      '/assets': {
        target: 'http://127.0.0.1:8900',
        changeOrigin: true,
      },
      '/kgz-map': {
        target: 'http://127.0.0.1:8900',
        changeOrigin: true,
      },
      '/retail-app': {
        target: 'http://127.0.0.1:8900',
        changeOrigin: true,
      },
      '/legacy': {
        target: 'http://127.0.0.1:8900',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    assetsDir: '_next',
  },
});
