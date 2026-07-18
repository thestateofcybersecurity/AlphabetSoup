import type { AcronymData, Category, Difficulty } from './types';

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
 */
export function searchEntries(data: AcronymData, query: string, filter: SearchFilter = {}): string[] {
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
    } else if (entry.explanation.toLowerCase().includes(term)) {
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
