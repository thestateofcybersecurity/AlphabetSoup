import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateData } from '../src/data/validate';
import { validateCis, validateCsf } from '../src/lib/frameworks';
import type { AcronymData } from '../src/lib/types';
import type { CisData, CsfData } from '../src/lib/frameworks';

const load = <T>(rel: string): T =>
  JSON.parse(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')) as T;

const acronyms = load<AcronymData>('../src/data/acronyms.json');
const csf = load<CsfData>('../src/data/nist-csf.json');
const cis = load<CisData>('../src/data/cis.json');

const problems = [
  ...validateData(acronyms).map((e) => `acronyms: ${e}`),
  ...validateCsf(csf).map((e) => `nist-csf: ${e}`),
  ...validateCis(cis).map((e) => `cis: ${e}`),
];

if (problems.length > 0) {
  console.error(`Data INVALID (${problems.length} problems):`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(
  `Data OK: ${Object.keys(acronyms).length} acronyms, ${Object.keys(csf).length} CSF subcategories, ${Object.keys(cis).length} CIS safeguards.`,
);
