import acronymIndexRaw from 'virtual:acronym-index';
import type { AcronymData, AcronymEntry, AcronymIndex } from '../lib/types';

/**
 * The listing/search slice of every acronym, derived from acronyms.json by the
 * `acronym-index` Vite plugin. ~10 KB gzipped, so it ships in the main bundle.
 */
const index = acronymIndexRaw as AcronymIndex;

/** Full records including prose and sources. Fetched as a separate chunk. */
let full: AcronymData | null = null;
let inFlight: Promise<AcronymData> | null = null;

export function acronymIndex(): AcronymIndex {
  return index;
}

/**
 * The full dataset if it has already arrived, otherwise null.
 *
 * Callers that can render something useful without prose should check this and
 * degrade gracefully, rather than awaiting and putting 92 KB back in front of
 * the first paint.
 */
export function loadedData(): AcronymData | null {
  return full;
}

/** Fetch the full records, reusing any in-flight request. */
export function loadFullData(): Promise<AcronymData> {
  if (full) return Promise.resolve(full);
  inFlight ??= import('./acronyms.json').then((module) => {
    full = module.default as AcronymData;
    return full;
  });
  return inFlight;
}

export async function getEntry(key: string): Promise<AcronymEntry> {
  const data = await loadFullData();
  const entry = data[key];
  if (!entry) throw new Error(`Unknown acronym: ${key}`);
  return entry;
}

/** Sorted keys; deterministic order for Soup of the Day. */
export function sortedKeys(): string[] {
  return Object.keys(index).sort();
}
