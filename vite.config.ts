/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import { renderSiteNav } from './src/lib/site-nav';
import { withAnalytics } from './src/lib/analytics';

/**
 * Replaces the `<!--site-nav-->` marker in every hand-written page with the nav
 * rendered from src/lib/site-nav.ts, so the link list lives in exactly one
 * place. Runs in dev and build, so the two can never diverge.
 */
function siteNavPlugin(): Plugin {
  return {
    name: 'site-nav',
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        if (!html.includes('<!--site-nav-->')) return html;
        // ctx.path is like '/index.html' or '/tools/crosswalk/index.html'.
        const rel = ctx.path.replace(/^\//, '').replace(/index\.html$/, '');
        const depth = rel ? rel.split('/').filter(Boolean).length : 0;
        const prefix = '../'.repeat(depth);
        return html.replace('<!--site-nav-->', renderSiteNav(prefix, rel));
      },
    },
  };
}

/**
 * Injects the Plausible snippet into the hand-written pages at build time.
 * Build-only (`apply: 'build'`) so `npm run dev` never sends events.
 */
function analyticsPlugin(): Plugin {
  return {
    name: 'analytics',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler: (html) => withAnalytics(html),
    },
  };
}

export default defineConfig({
  plugins: [siteNavPlugin(), analyticsPlugin()],
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
