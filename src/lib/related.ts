import type { AcronymData } from './types';

const STOP = new Set([
  'and', 'the', 'of', 'for', 'a', 'an', 'to', 'in', 'on', 'with', 'or', 'as', 'by',
  'system', 'systems', 'security', 'protocol', 'protocols', 'service', 'services',
  'access', 'control', 'management', 'data', 'network', 'information', 'standard',
]);

function significantWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length > 2 && !STOP.has(word)),
  );
}

/**
 * Up to `limit` related acronym keys for an entry: curated relations first
 * (validated against the dataset), then same-category entries that share
 * significant expansion words, then alphabetical same-category neighbors.
 */
export function relatedFor(key: string, data: AcronymData, limit = 4): string[] {
  const entry = data[key];
  if (!entry) return [];
  const curated = (entry.related ?? []).filter((k) => k !== key && k in data);
  const result = [...new Set(curated)];
  if (result.length >= limit) return result.slice(0, limit);

  const mine = significantWords(`${entry.expansion} ${entry.explanation}`);
  const sameCategory = Object.keys(data).filter(
    (k) => k !== key && !result.includes(k) && data[k].category === entry.category,
  );

  const scored = sameCategory
    .map((k) => {
      const other = significantWords(data[k].expansion);
      let overlap = 0;
      for (const word of other) if (mine.has(word)) overlap += 1;
      return { k, overlap };
    })
    .filter((item) => item.overlap > 0)
    .sort((a, b) => b.overlap - a.overlap || a.k.localeCompare(b.k));
  result.push(...scored.map((item) => item.k));

  if (result.length < limit) {
    const alpha = sameCategory.filter((k) => !result.includes(k)).sort();
    result.push(...alpha);
  }
  return result.slice(0, limit);
}
