import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';

export default defineConfig({
  plugins: [
    react(),
    // Same service worker setup as the Passenger app: the app shell is precached and a new deployment takes over by itself. The manifest stays the hand-written
    // public/manifest.webmanifest (start_url /driver/home, dark background), which index.html already links, so the plugin does not generate or inject one.
    VitePWA({
      registerType: 'autoUpdate',
      manifest: false,
      includeAssets: ['favicon.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-512-maskable.png'],
    }),
  ],
  build: {
    // Panel comment (D-P7): nothing of the source is shipped to the browser. No source maps, and no console.* / debugger in the production bundle.
    sourcemap: false,
    rolldownOptions: { output: { minify: { compress: { dropConsole: true, dropDebugger: true } } } },
  },
  server: {
    port: 5176,
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@sakay/shared/src': path.resolve(__dirname, '../../packages/shared/src'),
      '@sakay/shared': path.resolve(__dirname, '../../packages/shared/src'),
    },
  },
});
