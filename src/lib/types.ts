export type Difficulty = 'easy' | 'medium' | 'hard';

export const CATEGORIES = [
  'certifications',
  'protocols',
  'attacks',
  'crypto',
  'governance',
  'cloud',
  'operations',
  'identity',
  'appsec',
  'network',
] as const;

export type Category = (typeof CATEGORIES)[number];

export interface Source {
  name: string;
  url: string;
}

/**
 * The fields needed to list, filter, and search an acronym without reading its
 * prose. This slice is 10 KB gzipped across all 545 entries; the full records
 * are 103 KB, almost all of it `explanation`. The homepage ships only this and
 * fetches the rest alongside, so first paint no longer waits on the prose.
 */
export interface AcronymIndexEntry {
  expansion: string;
  display: string;
  category: Category;
  difficulty: Difficulty;
}

export type AcronymIndex = Record<string, AcronymIndexEntry>;

export interface AcronymEntry extends AcronymIndexEntry {
  explanation: string;
  sources: Source[];
  /** Curated related / commonly-confused acronym keys. */
  related?: string[];
}

export type AcronymData = Record<string, AcronymEntry>;

export const MIN_ANSWER_LENGTH = 3;
export const MAX_ANSWER_LENGTH = 8;
