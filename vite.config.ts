/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { renderSiteNav } from './src/lib/site-nav';
import { withAnalytics } from './src/lib/analytics';
import { withCanonicalFonts } from './src/lib/fonts';

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

/**
 * Serves `virtual:acronym-index`: the listing and search fields of every
 * acronym, derived from acronyms.json at build time.
 *
 * Deriving it rather than checking in a second file means the two can never
 * disagree about what exists. Adding an acronym stays a one-file edit.
 */
function acronymIndexPlugin(): Plugin {
  const VIRTUAL = 'virtual:acronym-index';
  const RESOLVED = `\0${VIRTUAL}`;
  const source = fileURLToPath(new URL('./src/data/acronyms.json', import.meta.url));
  return {
    name: 'acronym-index',
    resolveId: (id) => (id === VIRTUAL ? RESOLVED : undefined),
    load(id) {
      if (id !== RESOLVED) return undefined;
      this.addWatchFile(source);
      const raw = JSON.parse(readFileSync(source, 'utf8')) as Record<
        string,
        { display: string; expansion: string; category: string; difficulty: string }
      >;
      const index: Record<string, unknown> = {};
      for (const [key, entry] of Object.entries(raw)) {
        index[key] = {
          display: entry.display,
          expansion: entry.expansion,
          category: entry.category,
          difficulty: entry.difficulty,
        };
      }
      return `export default ${JSON.stringify(index)};`;
    },
  };
}

/**
 * Normalises the webfont request across every hand-written page. Runs in dev as
 * well as build so the fonts you develop against are the fonts you ship.
 */
function fontsPlugin(): Plugin {
  return {
    name: 'canonical-fonts',
    transformIndexHtml: {
      order: 'pre',
      handler: (html) => withCanonicalFonts(html),
    },
  };
}

export default defineConfig({
  plugins: [acronymIndexPlugin(), siteNavPlugin(), fontsPlugin(), analyticsPlugin()],
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
