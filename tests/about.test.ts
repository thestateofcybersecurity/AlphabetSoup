import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import acronymsRaw from '../src/data/acronyms.json';
import cisRaw from '../src/data/cis.json';
import csfRaw from '../src/data/nist-csf.json';
import postsRaw from '../src/data/blog-posts.json';
import { EXTERNAL_LINKS } from '../src/lib/site-nav';
import {
  ABOUT_LATEST_WRITING_MARKER,
  ABOUT_STATS_MARKER,
  LATEST_POST_COUNT,
  byDateDesc,
  formatPostDate,
  latestPosts,
  renderLatestWriting,
  renderProofStrip,
  withAboutSections,
  type AboutPost,
} from '../src/lib/about';

/**
 * The About page's proof strip and "Latest writing" section are injected at
 * build time (vite.config.ts) from the same data files asserted on here.
 * These tests pin the derivation: the markers must exist for the injection to
 * land, and the rendered numbers must be the data files' numbers, so the strip
 * cannot silently drift stale or lose a data source without CI noticing.
 */

const aboutHtml = readFileSync(new URL('../about/index.html', import.meta.url), 'utf8');
const posts = postsRaw as AboutPost[];

/** The same counts the vite plugin computes, from the same sources. */
function dataCounts() {
  const quizDir = fileURLToPath(new URL('../src/data/quiz', import.meta.url));
  const questions = readdirSync(quizDir)
    .filter((name) => name.endsWith('.json') && name !== 'index.json')
    .reduce((sum, name) => {
      const deck = JSON.parse(readFileSync(`${quizDir}/${name}`, 'utf8')) as { questions: unknown[] };
      return sum + deck.questions.length;
    }, 0);
  return {
    acronyms: Object.keys(acronymsRaw).length,
    controls: Object.keys(csfRaw).length + Object.keys(cisRaw).length,
    questions,
    apps: EXTERNAL_LINKS.length,
  };
}

describe('about page build-time sections', () => {
  it('carries both injection markers', () => {
    expect(aboutHtml).toContain(ABOUT_STATS_MARKER);
    expect(aboutHtml).toContain(ABOUT_LATEST_WRITING_MARKER);
  });

  it('proof strip shows the numbers the data files actually contain', () => {
    const counts = dataCounts();
    const strip = renderProofStrip(counts);
    expect(strip).toContain(`${counts.acronyms.toLocaleString('en-US')} acronyms explained`);
    expect(strip).toContain(`${counts.controls.toLocaleString('en-US')} framework controls translated`);
    expect(strip).toContain(`${counts.questions.toLocaleString('en-US')}+ practice questions`);
    expect(strip).toContain(`${counts.apps} companion apps`);
    expect(strip).toContain('100% free, no accounts');
  });

  it('counts never regress below the values the strip launched with', () => {
    const counts = dataCounts();
    expect(counts.acronyms).toBeGreaterThanOrEqual(545);
    // 106 NIST CSF subcategories + 153 CIS safeguards at launch.
    expect(counts.controls).toBeGreaterThanOrEqual(259);
    expect(counts.questions).toBeGreaterThanOrEqual(1230);
    expect(counts.apps).toBeGreaterThanOrEqual(3);
  });

  it('latest writing shows the newest posts in blog-index order', () => {
    const latest = latestPosts(posts);
    expect(latest).toHaveLength(LATEST_POST_COUNT);
    const sorted = [...posts].sort(byDateDesc);
    expect(latest.map((p) => p.slug)).toEqual(sorted.slice(0, LATEST_POST_COUNT).map((p) => p.slug));
  });

  it('latest writing links each post into /blog/ and ends with All posts', () => {
    const latest = latestPosts(posts);
    const section = renderLatestWriting(latest);
    for (const post of latest) {
      expect(section).toContain(`href="../blog/${post.slug}.html"`);
      expect(section).toContain(formatPostDate(post.date));
    }
    expect(section).toContain('href="../blog/"');
    expect(section).toContain('All posts');
  });

  it('formats dates the way the blog index does', () => {
    expect(formatPostDate('2026-08-03')).toBe('August 3, 2026');
  });

  it('withAboutSections resolves both markers and leaves other pages alone', () => {
    const out = withAboutSections(aboutHtml, dataCounts(), posts);
    expect(out).not.toContain(ABOUT_STATS_MARKER);
    expect(out).not.toContain(ABOUT_LATEST_WRITING_MARKER);
    expect(out).toContain('class="proof-strip"');
    expect(out).toContain('Latest writing');
    const untouched = '<html><body>no markers here</body></html>';
    expect(withAboutSections(untouched, dataCounts(), posts)).toBe(untouched);
  });

  it('every credential pill has a CRED_LINKS entry, and wired URLs are Credly badge pages', () => {
    const pills = [...aboutHtml.matchAll(/data-cred="([^"]+)"/g)].map((m) => m[1]);
    expect(pills.length).toBeGreaterThan(0);
    const mapping: Record<string, string> = {};
    for (const m of aboutHtml.matchAll(/'([A-Z-]+)':\s*'([^']*)'/g)) mapping[m[1]] = m[2];
    for (const pill of pills) {
      expect(mapping, `pill ${pill} missing from CRED_LINKS`).toHaveProperty(pill);
      const url = mapping[pill];
      if (url !== '') {
        expect(url).toMatch(/^https:\/\/www\.credly\.com\/badges\/[0-9a-f-]+$/);
      }
    }
  });

  it('renders with no em dashes, per the house style', () => {
    const out = withAboutSections(aboutHtml, dataCounts(), posts);
    expect(out).not.toContain('\u2014');
  });
});
