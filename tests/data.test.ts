import { describe, expect, it } from 'vitest';
import rawData from '../src/data/acronyms.json';
import type { AcronymData } from '../src/lib/types';

const allData = (): AcronymData => rawData as AcronymData;
import { validateData } from '../src/data/validate';

describe('acronym dataset', () => {
  it('passes all validation rules', () => {
    expect(validateData(allData())).toEqual([]);
  });

  it('has at least 500 entries', () => {
    expect(Object.keys(allData()).length).toBeGreaterThanOrEqual(500);
  });
});
