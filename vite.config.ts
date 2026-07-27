/// <reference types="vitest/config" />
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { renderSiteNav } from './src/lib/site-nav';
import { withAnalytics } from './src/lib/analytics';
import { withCanonicalFonts } from './src/lib/fonts';
import { cisControlsAssessment, cisIg1Assessment, csfAssessment } from './src/lib/assessment';

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
 * Serves `virtual:assessment-counts`: how many questions each assessment has.
 *
 * The picker prints these counts before any assessment is chosen. Deferring the
 * datasets means they are no longer in memory at that point, and hardcoding the
 * numbers would drift, so they are computed here from the same sources and by
 * the same functions the app uses. Three of the assessments are generated from
 * cis.json and nist-csf.json rather than read from a file, which is why this
 * imports the real builders instead of just counting array lengths.
 */
function assessmentCountsPlugin(): Plugin {
  const VIRTUAL = 'virtual:assessment-counts';
  const RESOLVED = `\0${VIRTUAL}`;
  const dataDir = fileURLToPath(new URL('./src/data/', import.meta.url));
  const read = (name: string): unknown => JSON.parse(readFileSync(`${dataDir}${name}`, 'utf8'));
  const FILE_BACKED: Record<string, string> = {
    ransomware: 'assessment.json',
    cpg: 'assessment-cpg.json',
    'nist-800171': 'assessment-800171.json',
    'cyber-essentials': 'assessment-cyber-essentials.json',
    'zero-trust': 'assessment-ztmm.json',
    ssdf: 'assessment-ssdf.json',
    'pci-dss': 'assessment-pci-dss.json',
  };
  return {
    name: 'assessment-counts',
    resolveId: (id) => (id === VIRTUAL ? RESOLVED : undefined),
    load(id) {
      if (id !== RESOLVED) return undefined;
      for (const name of [...Object.values(FILE_BACKED), 'cis.json', 'cis-igs.json', 'nist-csf.json']) {
        this.addWatchFile(`${dataDir}${name}`);
      }
      const counts: Record<string, number> = {};
      for (const [id_, file] of Object.entries(FILE_BACKED)) {
        counts[id_] = (read(file) as { questions: unknown[] }).questions.length;
      }
      const cis = read('cis.json') as Parameters<typeof cisIg1Assessment>[0];
      const igs = read('cis-igs.json') as Record<string, number>;
      const csf = read('nist-csf.json') as Parameters<typeof csfAssessment>[0];
      counts['cis-ig1'] = cisIg1Assessment(cis, igs).questions.length;
      counts['cis-v8'] = cisControlsAssessment(cis, igs).questions.length;
      counts['nist-csf'] = csfAssessment(csf).questions.length;
      return `export default ${JSON.stringify(counts)};`;
    },
  };
}

/**
 * Serves `virtual:tool-slugs`: the directory name of every built tool.
 *
 * The dashboard uses it to recognise a storage key like
 * `alphabetsoup:skills-matrix:state` as belonging to a tool, and to link back
 * to it. Read from the filesystem for the same reason the sitemap is: adding a
 * tool should not require updating a second list.
 */
function toolSlugsPlugin(): Plugin {
  const VIRTUAL = 'virtual:tool-slugs';
  const RESOLVED = `\0${VIRTUAL}`;
  const toolsDir = fileURLToPath(new URL('./tools', import.meta.url));
  return {
    name: 'tool-slugs',
    resolveId: (id) => (id === VIRTUAL ? RESOLVED : undefined),
    load(id) {
      if (id !== RESOLVED) return undefined;
      const slugs = readdirSync(toolsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && existsSync(`${toolsDir}/${d.name}/index.html`))
        .map((d) => d.name)
        .sort();
      return `export default ${JSON.stringify(slugs)};`;
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
  plugins: [
    acronymIndexPlugin(),
    assessmentCountsPlugin(),
    toolSlugsPlugin(),
    siteNavPlugin(),
    fontsPlugin(),
    analyticsPlugin(),
  ],
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
        my: 'my/index.html',
      },
    },
  },
  test: {
    // Playwright specs live in e2e/ and must not run under Vitest.
    include: ['tests/**/*.test.ts'],
  },
});
