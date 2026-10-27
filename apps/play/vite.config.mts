import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const relay = process.env.PLAY_RELAY ?? 'http://127.0.0.1:8787';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: '/',
  plugins: [react()],
  css: {
    preprocessorOptions: {
      scss: { quietDeps: true, silenceDeprecations: ['import', 'legacy-js-api'] },
    },
  },
  resolve: { dedupe: ['pixi.js', 'react', 'react-dom'] },
  server: {
    fs: { allow: ['../..'] },
    proxy: { '/api': { target: relay, ws: true } },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    modulePreload: { polyfill: false },
    sourcemap: false,
  },
});
