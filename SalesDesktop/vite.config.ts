import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig(({ mode }) => {
  const isWallpaperBuild = mode === 'wallpaper';

  return {
  plugins: [react()],
  base: './',
  build: {
    outDir: isWallpaperBuild ? 'dist-wallpaper' : 'dist',
    rollupOptions: {
      input: isWallpaperBuild
        ? { wallpaper: path.resolve(__dirname, 'wallpaper.html') }
        : { main: path.resolve(__dirname, 'index.html') },
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
            || packagePath.startsWith('@tanstack/react-query/')
          ) return 'react';
          if (
            packagePath.startsWith('antd/')
            || packagePath.startsWith('@ant-design/')
            || packagePath.startsWith('@rc-component/')
            || packagePath.startsWith('rc-')
          ) return 'antd';
          if (packagePath.startsWith('echarts-for-react/')) return 'echarts-react';
          if (packagePath.startsWith('zrender/')) return 'zrender';
          if (packagePath.startsWith('echarts/')) return 'echarts';
          if (packagePath.startsWith('three/examples/')) return 'three-addons';
          if (packagePath.startsWith('three/')) return 'three';
          if (
            packagePath.startsWith('axios/')
            || packagePath.startsWith('dayjs/')
            || packagePath.startsWith('i18next/')
            || packagePath.startsWith('react-i18next/')
          ) return 'platform';
          return undefined;
        },
      },
    },
    chunkSizeWarningLimit: 1200,
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  server: { port: 5173 },
  root: '.',
  index: 'index.html',
  };
});
