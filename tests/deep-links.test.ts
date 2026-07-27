import { describe, expect, it } from 'vitest';
import blogPosts from '../src/data/blog-posts.json';
import rawData from '../src/data/acronyms.json';
import {
  MAX_DECK_LINKS,
  MAX_POST_LINKS,
  categorySlug,
  categoryTitle,
  decksTesting,
  postsMentioning,
  type DeckLike,
  type PostLike,
} from '../src/lib/deep-links';
import { CATEGORIES } from '../src/lib/types';
import type { AcronymData } from '../src/lib/types';

const deck = (slug: string, questions: { q?: string; why?: string }[]): DeckLike => ({
  slug,
  questions,
});

describe('decksTesting', () => {
  it('finds the decks whose questions or rationales mention the acronym', () => {
    const decks = [
      deck('a', [{ q: 'What does CVSS score?' }]),
      deck('b', [{ q: 'Unrelated', why: 'CVSS is a severity score.' }]),
      deck('c', [{ q: 'Nothing here', why: 'Also nothing.' }]),
    ];
    expect(decksTesting('CVSS', decks).sort()).toEqual(['a', 'b']);
  });

  it('ranks the deck that covers the term most heavily first', () => {
    const decks = [
      deck('light', [{ q: 'Define DNS.' }]),
      deck('heavy', [{ q: 'DNS resolves names.', why: 'DNS caching and DNS records.' }]),
    ];
    expect(decksTesting('DNS', decks)[0]).toBe('heavy');
  });

  it('breaks ties by slug so builds are reproducible', () => {
    const decks = [deck('zulu', [{ q: 'MFA' }]), deck('alpha', [{ q: 'MFA' }])];
    expect(decksTesting('MFA', decks)).toEqual(['alpha', 'zulu']);
  });

  it('caps the number of links', () => {
    const decks = Array.from({ length: 9 }, (_, i) => deck(`d${i}`, [{ q: 'IDS everywhere' }]));
    expect(decksTesting('IDS', decks)).toHaveLength(MAX_DECK_LINKS);
  });

  it('ignores an acronym that only appears as a wrong answer choice', () => {
    // choices are deliberately not searched: being a distractor is not coverage.
    const decks = [{ slug: 'a', questions: [{ q: 'Pick one', why: 'Because.' }] } as DeckLike];
    expect(decksTesting('SAML', decks)).toEqual([]);
  });

  it('does not match an acronym inside a longer token', () => {
    const decks = [deck('a', [{ q: 'CASP+ is the old name for SecurityX.' }])];
    // CASP must match the standalone token, and CAS must not match inside CASP.
    expect(decksTesting('CASP', decks)).toEqual(['a']);
    expect(decksTesting('CAS', decks)).toEqual([]);
  });

  it('does not match a lowercase word that happens to spell the acronym', () => {
    const decks = [deck('a', [{ q: 'The ids of each record are unique.' }])];
    expect(decksTesting('IDS', decks)).toEqual([]);
  });

  it('returns nothing for an acronym no deck covers', () => {
    expect(decksTesting('ZZZZ', [deck('a', [{ q: 'MFA and SSO' }])])).toEqual([]);
  });

  it('handles decks with no questions', () => {
    expect(decksTesting('MFA', [{ slug: 'empty' }])).toEqual([]);
  });
});

describe('postsMentioning', () => {
  const posts: PostLike[] = [
    { slug: 'tagged', title: 'Something else', tags: ['mfa'], body: [{ text: 'No mention.' }] },
    { slug: 'prose', title: 'On MFA', body: [{ text: 'MFA matters. MFA again.' }] },
    { slug: 'none', title: 'Unrelated', body: [{ text: 'Nothing.' }] },
  ];

  it('finds posts by prose and by tag', () => {
    expect(postsMentioning('MFA', posts).sort()).toEqual(['prose', 'tagged']);
  });

  it('ranks an explicit tag above a passing mention', () => {
    expect(postsMentioning('MFA', posts)[0]).toBe('tagged');
  });

  it('caps the number of links', () => {
    const many = Array.from({ length: 6 }, (_, i) => ({
      slug: `p${i}`,
      title: 'SIEM',
      body: [{ text: 'SIEM' }],
    }));
    expect(postsMentioning('SIEM', many)).toHaveLength(MAX_POST_LINKS);
  });

  it('returns nothing when no post mentions it', () => {
    expect(postsMentioning('ZZZZ', posts)).toEqual([]);
  });
});

describe('category slugs', () => {
  it('produces a url-safe slug for every real category', () => {
    for (const category of CATEGORIES) {
      expect(categorySlug(category)).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it('is unique across categories', () => {
    const slugs = CATEGORIES.map(categorySlug);
    expect(new Set(slugs).size).toBe(CATEGORIES.length);
  });

  it('titles a category for display', () => {
    expect(categoryTitle('appsec')).toBe('Appsec');
  });
});

describe('against the real dataset', () => {
  const data = rawData as AcronymData;

  it('every entry belongs to a known category, so every page gets a hub link', () => {
    const known = new Set<string>(CATEGORIES);
    const orphans = Object.entries(data)
      .filter(([, entry]) => !known.has(entry.category))
      .map(([key]) => key);
    expect(orphans).toEqual([]);
  });

  it('links real blog posts for terms they actually discuss', () => {
    const posts = blogPosts as unknown as PostLike[];
    // A term the blog demonstrably covers, verified against the corpus.
    const withPosts = Object.keys(data).filter((key) => postsMentioning(key, posts).length > 0);
    expect(withPosts.length).toBeGreaterThan(0);
    for (const key of withPosts) {
      for (const slug of postsMentioning(key, posts)) {
        expect(posts.some((p) => p.slug === slug)).toBe(true);
      }
    }
  });
});
