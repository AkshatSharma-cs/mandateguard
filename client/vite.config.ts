import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  base: '/app/',
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  plugins: [react(), tailwindcss()],
  server: { proxy: { '/api': { target: 'http://localhost:3000', changeOrigin: true }, '/attacks': { target: 'http://localhost:3000', changeOrigin: true } } },
  build: { outDir: '../public/app', emptyOutDir: true },
  test: { environment: 'jsdom', setupFiles: './src/test/setup.ts', restoreMocks: true },
});
