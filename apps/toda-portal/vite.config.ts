import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  build: {
    // Panel comment (D-P7): nothing of the source is shipped to the browser. No source maps, and no console.* / debugger in the production bundle.
    sourcemap: false,
    rolldownOptions: { output: { minify: { compress: { dropConsole: true, dropDebugger: true } } } },
  },
  server: {
    port: 5175,
    host: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@sakay/shared': path.resolve(__dirname, '../../packages/shared/src'),
    },
  },
});
