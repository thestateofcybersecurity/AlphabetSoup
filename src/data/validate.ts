import { CATEGORIES, MAX_ANSWER_LENGTH, MIN_ANSWER_LENGTH } from '../lib/types';
import type { AcronymData } from '../lib/types';

const KEY_PATTERN = new RegExp(`^[A-Z0-9]{${MIN_ANSWER_LENGTH},${MAX_ANSWER_LENGTH}}$`);
const DIFFICULTIES = ['easy', 'medium', 'hard'];
const EXPLANATION_MIN = 80;
const EXPLANATION_MAX = 900;

/** Validate the dataset; returns a list of human-readable problems (empty = valid). */
export function validateData(data: AcronymData): string[] {
  const errors: string[] = [];
  const expansionsSeen = new Map<string, string>();
  const entries = Object.entries(data);

  if (entries.length < 400) {
    errors.push(`Expected at least 400 entries, found ${entries.length}`);
  }

  for (const [key, entry] of entries) {
    const where = `[${key}]`;
    if (!KEY_PATTERN.test(key)) {
      errors.push(`${where} key must match ${KEY_PATTERN}`);
    }
    if (!entry.expansion?.trim()) {
      errors.push(`${where} missing expansion`);
    } else {
      const normalized = entry.expansion.trim().toLowerCase();
      const dup = expansionsSeen.get(normalized);
      if (dup) {
        errors.push(`${where} duplicate expansion of [${dup}]: "${entry.expansion}"`);
      } else {
        expansionsSeen.set(normalized, key);
      }
    }
    if (!entry.display?.trim()) {
      errors.push(`${where} missing display`);
    } else if (entry.display.toUpperCase().replace(/[^A-Z0-9]/g, '') !== key) {
      errors.push(`${where} display "${entry.display}" does not normalize to the key`);
    }
    if (!CATEGORIES.includes(entry.category)) {
      errors.push(`${where} invalid category "${entry.category}"`);
    }
    if (!DIFFICULTIES.includes(entry.difficulty)) {
      errors.push(`${where} invalid difficulty "${entry.difficulty}"`);
    }
    const explanation = entry.explanation?.trim() ?? '';
    if (explanation.length < EXPLANATION_MIN || explanation.length > EXPLANATION_MAX) {
      errors.push(`${where} explanation length ${explanation.length} outside ${EXPLANATION_MIN}-${EXPLANATION_MAX}`);
    }
    if (/—/.test(explanation + entry.expansion)) {
      errors.push(`${where} contains an em dash`);
    }
    if (!Array.isArray(entry.sources) || entry.sources.length === 0) {
      errors.push(`${where} needs at least one source`);
    } else {
      for (const source of entry.sources) {
        if (!source.name?.trim()) {
          errors.push(`${where} source missing name`);
        }
        if (!source.url?.startsWith('https://')) {
          errors.push(`${where} source url must be https: ${source.url}`);
        }
      }
    }
  }
  return errors;
}
