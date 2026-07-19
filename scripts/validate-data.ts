import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateData } from '../src/data/validate';
import { validateCis, validateCsf } from '../src/lib/frameworks';
import { TIER_ORDER } from '../src/lib/assessment';
import type { AcronymData } from '../src/lib/types';
import type { CisData, CsfData } from '../src/lib/frameworks';
import type { AssessmentData } from '../src/lib/assessment';

const load = <T>(rel: string): T =>
  JSON.parse(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')) as T;

/** Structural checks for an authored assessment module. */
function validateAssessment(data: AssessmentData): string[] {
  const out: string[] = [];
  const catIds = new Set(data.categories.map((c) => c.id));
  if (catIds.size !== data.categories.length) out.push('duplicate category id');
  const seen = new Set<string>();
  for (const q of data.questions) {
    if (seen.has(q.id)) out.push(`duplicate question id ${q.id}`);
    seen.add(q.id);
    if (!catIds.has(q.group)) out.push(`${q.id}: group ${q.group} is not a category`);
    if (!TIER_ORDER.includes(q.tier)) out.push(`${q.id}: invalid tier ${q.tier}`);
    if (!q.text?.trim()) out.push(`${q.id}: empty text`);
    if (!q.why?.trim()) out.push(`${q.id}: missing why`);
    if (!q.fix?.trim()) out.push(`${q.id}: missing fix`);
    if (!q.links || q.links.length === 0) out.push(`${q.id}: missing links`);
    for (const field of ['text', 'why', 'fix'] as const) {
      if (q[field]?.includes('—')) out.push(`${q.id}: em dash in ${field}`);
    }
  }
  return out;
}

const acronyms = load<AcronymData>('../src/data/acronyms.json');
const csf = load<CsfData>('../src/data/nist-csf.json');
const cis = load<CisData>('../src/data/cis.json');
const map = load<Record<string, string[]>>('../src/data/csf-cis-map.json');
const cmmc = load<AssessmentData>('../src/data/assessment-800171.json');
const cyberEssentials = load<AssessmentData>('../src/data/assessment-cyber-essentials.json');
const ztmm = load<AssessmentData>('../src/data/assessment-ztmm.json');
const ssdf = load<AssessmentData>('../src/data/assessment-ssdf.json');
const pci = load<AssessmentData>('../src/data/assessment-pci-dss.json');

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
  ...validateAssessment(cmmc).map((e) => `800-171: ${e}`),
  ...validateAssessment(cyberEssentials).map((e) => `cyber-essentials: ${e}`),
  ...validateAssessment(ztmm).map((e) => `ztmm: ${e}`),
  ...validateAssessment(ssdf).map((e) => `ssdf: ${e}`),
  ...validateAssessment(pci).map((e) => `pci-dss: ${e}`),
];

if (problems.length > 0) {
  console.error(`Data INVALID (${problems.length} problems):`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(
  `Data OK: ${Object.keys(acronyms).length} acronyms, ${Object.keys(csf).length} CSF subcategories, ${Object.keys(cis).length} CIS safeguards, ` +
    `${cmmc.questions.length} 800-171/CMMC, ${cyberEssentials.questions.length} Cyber Essentials, ${ztmm.questions.length} ZTMM, ${ssdf.questions.length} SSDF, ${pci.questions.length} PCI DSS.`,
);
