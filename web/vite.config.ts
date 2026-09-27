import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// The export is a plain static site: relative base so it works from an IPFS
// gateway subpath or an ENS name without server rewrites, output to the
// repository-root dist/ that the publisher pins as-is.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    assetsDir: 'assets',
    sourcemap: false,
    target: 'es2022',
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
  },
});
