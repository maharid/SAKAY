import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'

export default defineConfig({
  build: {
    // Panel comment (D-P7): nothing of the source is shipped to the browser. No source maps, and no console.* / debugger in the production bundle.
    sourcemap: false,
    rolldownOptions: { output: { minify: { compress: { dropConsole: true, dropDebugger: true } } } },
  },
  resolve: {
    alias: {
      '@sakay/shared/src': path.resolve(__dirname, '../../packages/shared/src'),
      '@sakay/shared': path.resolve(__dirname, '../../packages/shared/src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: [
        'icons/icon-192.png',
        'icons/icon-512.png',
        'icons/icon-512-maskable.png'
      ],
      manifest: {
        name: 'SAKAY',
        short_name: 'SAKAY',
        description: 'Smart Tricycle Transportation Management System',
        theme_color: '#FF6600',
        background_color: '#FFFFFF',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          {
            src: 'icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png'
          },
          {
            src: 'icons/icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          }
        ]
      }
    })
  ]
})