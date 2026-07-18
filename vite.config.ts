/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the build works on the custom domain or any Pages path.
  base: './',
  build: {
    target: 'es2022',
    rollupOptions: {
      input: {
        main: 'index.html',
        nistcsf: 'frameworks/nist-csf/index.html',
        cis: 'frameworks/cis/index.html',
        quiz: 'quiz/index.html',
        assess: 'assess/index.html',
        roadmap: 'roadmap/index.html',
      },
    },
  },
  test: {
    // Playwright specs live in e2e/ and must not run under Vitest.
    include: ['tests/**/*.test.ts'],
  },
});
