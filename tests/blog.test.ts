import { describe, expect, it } from 'vitest';
import shipped from '../src/data/blog-posts.json';
import { RESERVED_BLOG_SLUGS, validateBlogPosts } from '../src/lib/blog';
import { isSafeHref, renderInline } from '../src/lib/inline';

/**
 * Pentest 2026-11-22, finding N2. Scheduled posts are merged to main by
 * .github/workflows/blog-automerge.yml with no human review, so the data
 * validator is the security boundary for everything a post can carry. It
 * used to check that a post had "related" links, not where they pointed, and
 * the generator wrote the href after HTML-escaping only: a post with
 *   "related": [{ "label": "...", "href": "javascript:..." }]
 * passed every gate and published a chip that ran script on click.
 */

const post = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  slug: 'free-cissp-practice-questions-2027',
  title: 'Free CISSP Practice Questions for 2027',
  description:
    'A short list of free CISSP practice question sources for 2027, with notes on which domains each one covers best and where to start first.',
  category: 'Career',
  author: 'Parker Brissette',
  date: '2026-11-23',
  readingMinutes: 4,
  tags: ['CISSP', 'certification'],
  body: [
    { type: 'p', text: 'Practice questions find the domains you have not learned yet.' },
    { type: 'h2', text: 'Where to start' },
    { type: 'p', text: 'Start with the [glossary](/?q=CISSP) and work domain by domain.' },
    { type: 'list', items: ['Domain 1 first', 'Then the rest'] },
  ],
  related: [{ label: 'Practice questions', href: '/quiz/' }],
  ...overrides,
});

describe('isSafeHref', () => {
  it('accepts http(s), site-absolute, relative, and anchor targets', () => {
    for (const href of ['https://example.com/x', 'http://example.com/', '/quiz/', '/?q=MFA', './page.html', '../tools/', '#top', '  /tools/  ']) {
      expect(isSafeHref(href), href).toBe(true);
    }
  });

  it('refuses script, data, and other schemes, however they are dressed', () => {
    for (const href of [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      ' javascript:alert(1)',
      'java\tscript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'mailto:someone@example.com',
      'ftp://example.com/',
      'example.com',
      '',
    ]) {
      expect(isSafeHref(href), href).toBe(false);
    }
  });

  it('refuses protocol-relative targets disguised as site paths', () => {
    expect(isSafeHref('//evil.example/x')).toBe(false);
    expect(isSafeHref('/\\evil.example/x')).toBe(false);
  });

  it('refuses anything that is not a string', () => {
    for (const href of [null, undefined, 7, ['/quiz/'], { href: '/quiz/' }]) expect(isSafeHref(href)).toBe(false);
  });

  it('is the rule the inline renderer applies', () => {
    expect(renderInline('[x](javascript:alert(1))')).not.toContain('javascript:');
    expect(renderInline('[x](//evil.example/x)')).toContain('href="#"');
  });
});

describe('validateBlogPosts', () => {
  it('accepts a well-formed post', () => {
    expect(validateBlogPosts([post()])).toEqual([]);
  });

  it('accepts every post that ships today', () => {
    expect(validateBlogPosts(shipped)).toEqual([]);
  });

  it('refuses a javascript: related link (the N2 exploit)', () => {
    const errors = validateBlogPosts([
      post({ related: [{ label: 'Open the free question bank', href: "javascript:void(window.__pwned='x')" }] }),
    ]);
    expect(errors.join('\n')).toMatch(/unsafe related link target/);
  });

  it('refuses other unsafe related targets and malformed related entries', () => {
    for (const related of [
      [{ label: 'x', href: 'data:text/html,<script>1</script>' }],
      [{ label: 'x', href: '//evil.example/' }],
      [{ label: 'x', href: 'vbscript:1' }],
      [{ label: 'x', href: ['/quiz/'] }],
      [{ label: '', href: '/quiz/' }],
      [{ href: '/quiz/' }],
      ['/quiz/'],
      [],
      'nope',
    ]) {
      expect(validateBlogPosts([post({ related })]), JSON.stringify(related)).not.toEqual([]);
    }
  });

  it('refuses an unsafe link target inside the body', () => {
    const body = [
      { type: 'p', text: 'Read the [outline](javascript:alert(1)) first.' },
      { type: 'h2', text: 'Two' },
      { type: 'p', text: 'Three' },
      { type: 'list', items: ['Four'] },
    ];
    expect(validateBlogPosts([post({ body })]).join('\n')).toMatch(/unsafe link target in body/);
  });

  it('type-checks every field: JSON can put an array or object where a string belongs', () => {
    const cases: Record<string, unknown>[] = [
      { slug: ['free-cissp'] },
      { slug: 'Bad Slug' },
      { slug: '../escape' },
      { title: ['x'] },
      { title: 'x'.repeat(71) },
      { description: Array.from({ length: 120 }, () => 'x') },
      { category: 'Opinion' },
      { author: { name: 'x' } },
      { date: ['2026-11-23'] },
      { date: '23-11-2026' },
      { readingMinutes: '4' },
      { readingMinutes: 0 },
      { tags: ['one'] },
      { tags: ['one', { toString: 'x' }] },
      { body: [] },
      { body: [{ type: 'html', text: '<script>1</script>' }, { type: 'p', text: 'a' }, { type: 'p', text: 'b' }, { type: 'p', text: 'c' }] },
      { body: [{ type: 'p', text: ['a'] }, { type: 'p', text: 'a' }, { type: 'p', text: 'b' }, { type: 'p', text: 'c' }] },
      { body: [{ type: 'list', items: 'a' }, { type: 'p', text: 'a' }, { type: 'p', text: 'b' }, { type: 'p', text: 'c' }] },
      { body: [{ type: 'list', items: [{}] }, { type: 'p', text: 'a' }, { type: 'p', text: 'b' }, { type: 'p', text: 'c' }] },
      { body: ['p', 'p', 'p', 'p'] },
    ];
    for (const overrides of cases) {
      expect(validateBlogPosts([post(overrides)]), JSON.stringify(overrides).slice(0, 80)).not.toEqual([]);
    }
  });

  it('refuses a slug that would overwrite the blog index, and duplicates', () => {
    expect(RESERVED_BLOG_SLUGS.has('index')).toBe(true);
    expect(validateBlogPosts([post({ slug: 'index' })]).join('\n')).toMatch(/reserved slug/);
    expect(validateBlogPosts([post(), post()]).join('\n')).toMatch(/duplicate slug/);
  });

  it('refuses input that is not a list of post objects', () => {
    expect(validateBlogPosts({ 0: post() })).not.toEqual([]);
    expect(validateBlogPosts([null])).not.toEqual([]);
    expect(validateBlogPosts(['post'])).not.toEqual([]);
  });

  it('still refuses an em dash', () => {
    expect(validateBlogPosts([post({ title: 'CISSP — practice questions' })]).join('\n')).toMatch(/em dash/);
  });
});
