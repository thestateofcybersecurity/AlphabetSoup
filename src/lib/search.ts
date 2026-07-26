import type { AcronymData, AcronymIndex, Category, Difficulty } from './types';

export interface SearchFilter {
  category?: Category | '';
  difficulty?: Difficulty | '';
  letter?: string;
}

/**
 * Rank-ordered search over the dataset. Rank buckets:
 * exact key/display match > key prefix > expansion word-start >
 * display/expansion contains > explanation contains.
 * With an empty query, returns the filtered set alphabetically.
 *
 * Accepts either the lightweight index or the full records. The only rank that
 * needs prose is the last one, so searching the index gives identical results
 * for every query that matches a key or an expansion, and the homepage upgrades
 * to full-text once the prose chunk arrives.
 */
export function searchEntries(
  data: AcronymData | AcronymIndex,
  query: string,
  filter: SearchFilter = {},
): string[] {
  const term = query.trim().toLowerCase();
  const normalizedTerm = term.replace(/[^a-z0-9]/g, '');
  const scored: Array<[string, number]> = [];

  for (const key of Object.keys(data)) {
    const entry = data[key];
    if (filter.category && entry.category !== filter.category) continue;
    if (filter.difficulty && entry.difficulty !== filter.difficulty) continue;
    if (filter.letter && !key.startsWith(filter.letter.toUpperCase())) continue;

    if (!term) {
      scored.push([key, 0]);
      continue;
    }

    const keyLower = key.toLowerCase();
    const displayNorm = entry.display.toLowerCase().replace(/[^a-z0-9]/g, '');
    const expansion = entry.expansion.toLowerCase();

    let rank: number | null = null;
    if (keyLower === normalizedTerm || displayNorm === normalizedTerm) {
      rank = 0;
    } else if (normalizedTerm && keyLower.startsWith(normalizedTerm)) {
      rank = 1;
    } else if (new RegExp(`\\b${escapeRegExp(term)}`).test(expansion)) {
      rank = 2;
    } else if (displayNorm.includes(normalizedTerm) && normalizedTerm.length >= 2) {
      rank = 3;
    } else if (expansion.includes(term)) {
      rank = 3;
    } else if ('explanation' in entry && entry.explanation.toLowerCase().includes(term)) {
      rank = 4;
    }
    if (rank !== null) {
      scored.push([key, rank]);
    }
  }

  scored.sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));
  return scored.map(([key]) => key);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Levenshtein edit distance between two short strings. */
function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array<number>(n + 1);
  for (let i = 1; i <= m; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

/**
 * The single closest acronym key to a mistyped query, or null if nothing is
 * close enough. Powers the "did you mean" hint on an empty result set.
 */
export function suggest(data: AcronymData | AcronymIndex, query: string): string | null {
  const q = query.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  if (q.length < 2) return null;
  let best: { key: string; dist: number } | null = null;
  for (const key of Object.keys(data)) {
    const k = key.toLowerCase();
    // Skip obviously-unrelated lengths to keep it cheap and precise.
    if (Math.abs(k.length - q.length) > 3) continue;
    const dist = editDistance(q, k);
    if (best === null || dist < best.dist) best = { key, dist };
  }
  const threshold = Math.min(3, Math.max(2, Math.ceil(q.length * 0.4)));
  return best && best.dist > 0 && best.dist <= threshold ? best.key : null;
}
