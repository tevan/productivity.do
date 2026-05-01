import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [svelte()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        book: resolve(__dirname, 'book.html'),
      },
      output: {
        manualChunks(id) {
          // Pull markdown rendering deps into their own chunk so the main
          // bundle stays lean. They're only used when a note editor or
          // notes view actually renders. Loaded eagerly today since notes
          // load on app boot, but isolating makes future code-split easier.
          if (id.includes('node_modules/marked') ||
              id.includes('node_modules/highlight.js') ||
              id.includes('node_modules/dompurify')) {
            return 'markdown';
          }
        },
      },
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3020',
        changeOrigin: true,
      },
    },
  },
});
