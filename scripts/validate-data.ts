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
const map = load<Record<string, string[]>>('../src/data/csf-cis-map.json');

const mapProblems: string[] = [];
for (const csfId of Object.keys(csf)) {
  if (!(csfId in map)) mapProblems.push(`missing CSF id ${csfId}`);
}
for (const [csfId, cisIds] of Object.entries(map)) {
  if (!(csfId in csf)) mapProblems.push(`unknown CSF id ${csfId}`);
  if (new Set(cisIds).size !== cisIds.length) mapProblems.push(`duplicates under ${csfId}`);
  for (const cisId of cisIds) {
    if (!(cisId in cis)) mapProblems.push(`unknown CIS id ${cisId} under ${csfId}`);
  }
}

const problems = [
  ...validateData(acronyms).map((e) => `acronyms: ${e}`),
  ...validateCsf(csf).map((e) => `nist-csf: ${e}`),
  ...validateCis(cis).map((e) => `cis: ${e}`),
  ...mapProblems.map((e) => `csf-cis-map: ${e}`),
];

if (problems.length > 0) {
  console.error(`Data INVALID (${problems.length} problems):`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(
  `Data OK: ${Object.keys(acronyms).length} acronyms, ${Object.keys(csf).length} CSF subcategories, ${Object.keys(cis).length} CIS safeguards.`,
);
