import rawData from './acronyms.json';
import type { AcronymData, AcronymEntry } from '../lib/types';

const data = rawData as AcronymData;

export function allData(): AcronymData {
  return data;
}

export function getEntry(key: string): AcronymEntry {
  const entry = data[key];
  if (!entry) throw new Error(`Unknown acronym: ${key}`);
  return entry;
}

/** Sorted keys; deterministic order for Soup of the Day. */
export function sortedKeys(): string[] {
  return Object.keys(data).sort();
}
