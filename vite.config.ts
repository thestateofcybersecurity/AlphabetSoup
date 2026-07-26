/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the build works on the custom domain or any Pages path.
  base: './',
  // Large datasets parse ~6x faster via JSON.parse than as JS object literals.
  json: { stringify: true },
  build: {
    target: 'es2022',
    rollupOptions: {
      input: {
        main: 'index.html',
        nistcsf: 'frameworks/nist-csf/index.html',
        cis: 'frameworks/cis/index.html',
        ai: 'frameworks/ai/index.html',
        quiz: 'quiz/index.html',
        careers: 'careers/index.html',
        assess: 'assess/index.html',
        cmmc: 'assess/cmmc/index.html',
        tools: 'tools/index.html',
        aiRisk: 'tools/ai-risk/index.html',
        crosswalk: 'tools/crosswalk/index.html',
        boardMetrics: 'tools/board-metrics/index.html',
        runbook: 'tools/runbook/index.html',
        cloudBaseline: 'tools/cloud-baseline/index.html',
        ssdlc: 'tools/ssdlc/index.html',
        automationRoi: 'tools/automation-roi/index.html',
        trustPackage: 'tools/trust-package/index.html',
        regMapper: 'tools/reg-mapper/index.html',
        skillsMatrix: 'tools/skills-matrix/index.html',
        roadmap: 'roadmap/index.html',
        about: 'about/index.html',
        privacy: 'privacy/index.html',
        disclosure: 'disclosure/index.html',
      },
    },
  },
  test: {
    // Playwright specs live in e2e/ and must not run under Vitest.
    include: ['tests/**/*.test.ts'],
  },
});
