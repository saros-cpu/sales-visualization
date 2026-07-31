import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, '../shared'),
    },
  },
  server: {
    port: 5173,
    fs: {
      allow: ['..'],
    },
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
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalized = id.replace(/\\/g, '/');
          if (!normalized.includes('/node_modules/')) return undefined;
          const packagePath = normalized.split('/node_modules/').pop() || '';
          if (
            packagePath.startsWith('react/')
            || packagePath.startsWith('react-dom/')
            || packagePath.startsWith('react-router/')
            || packagePath.startsWith('react-router-dom/')
            || packagePath.startsWith('scheduler/')
          ) return 'react';
          return undefined;
        },
      },
    },
  },
});
