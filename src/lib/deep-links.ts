/**
 * Derives the onward links on a definition page from the content itself.
 *
 * The 580 definition pages carry most of the organic search traffic, and only
 * 25 of them offered anywhere to go next: the "Go deeper" block was driven by
 * three hand-maintained maps covering 26 keys. Everything else ended at a list
 * of sources.
 *
 * Matching the acronym against quiz questions and blog prose finds the same
 * relationships without anyone maintaining a list, so the block appears on the
 * pages that have earned it and keeps up as decks and posts are added.
 */

export interface DeckLike {
  slug: string;
  questions?: { q?: string; why?: string }[];
}

export interface PostLike {
  slug: string;
  title: string;
  body?: { text?: string }[];
  tags?: string[];
}

/**
 * Whole-token match for an acronym.
 *
 * `\b` is wrong here: it treats `-` and `+` as boundaries, so CASP would match
 * inside "CASP+" and SOC inside "SOC-2". Requiring a non-alphanumeric neighbour
 * keeps CVE out of "CVE-2024-1234" only when intended and, more importantly,
 * stops short keys matching the middle of longer ones.
 */
function mentions(text: string, key: string): number {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`, 'g');
  return (text.match(pattern) ?? []).length;
}

/** How many decks a definition page will link to at most. */
export const MAX_DECK_LINKS = 3;

/**
 * Quiz decks that actually test this acronym, most relevant first.
 *
 * Only question text and answer rationales count. An acronym appearing solely
 * as a wrong answer choice is a weaker signal, and including those added 18
 * acronyms while diluting the ones that were already good.
 *
 * Ranked by how often the deck mentions the term so the strongest deck leads,
 * with the slug as a tiebreak so the output is stable across builds. Broad
 * terms like DNS and IDS appear in many decks; the cap keeps the block useful
 * rather than turning it into a list of every deck on the site.
 */
export function decksTesting(key: string, decks: DeckLike[]): string[] {
  const scored: { slug: string; count: number }[] = [];
  for (const deck of decks) {
    let count = 0;
    for (const question of deck.questions ?? []) {
      count += mentions(question.q ?? '', key) + mentions(question.why ?? '', key);
    }
    if (count > 0) scored.push({ slug: deck.slug, count });
  }
  scored.sort((a, b) => b.count - a.count || a.slug.localeCompare(b.slug));
  return scored.slice(0, MAX_DECK_LINKS).map((d) => d.slug);
}

/** How many posts a definition page will link to at most. */
export const MAX_POST_LINKS = 2;

/**
 * Blog posts that discuss this acronym, most relevant first.
 *
 * A tag match is a deliberate signal from the author, so it outranks a passing
 * mention in the prose.
 */
export function postsMentioning(key: string, posts: PostLike[]): string[] {
  const lower = key.toLowerCase();
  const scored: { slug: string; score: number }[] = [];
  for (const post of posts) {
    const prose = (post.body ?? []).map((b) => b.text ?? '').join(' ');
    const count = mentions(prose, key) + mentions(post.title, key);
    const tagged = (post.tags ?? []).some((t) => t.toLowerCase() === lower);
    const score = count + (tagged ? 10 : 0);
    if (score > 0) scored.push({ slug: post.slug, score });
  }
  scored.sort((a, b) => b.score - a.score || a.slug.localeCompare(b.slug));
  return scored.slice(0, MAX_POST_LINKS).map((p) => p.slug);
}

/** URL slug for a category hub page. */
export function categorySlug(category: string): string {
  return category.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

/** Human-readable title for a category hub page. */
export function categoryTitle(category: string): string {
  return category.charAt(0).toUpperCase() + category.slice(1);
}
