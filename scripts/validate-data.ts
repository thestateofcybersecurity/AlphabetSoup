import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateData } from '../src/data/validate';
import { validateAi, validateCis, validateCsf } from '../src/lib/frameworks';
import { TIER_ORDER } from '../src/lib/assessment';
import type { AcronymData } from '../src/lib/types';
import type { AiData, CisData, CsfData } from '../src/lib/frameworks';
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

interface CrosswalkData {
  frameworks: { id: 'csf' | 'cis' | 'iso' | 'soc2'; total: number }[];
  controls: { id: string; domain: string; summary: string; mappings: Record<string, string[]> }[];
}

/** Structural + reference checks for the control crosswalk. */
function validateCrosswalk(data: CrosswalkData, csf: CsfData, cis: CisData): string[] {
  const out: string[] = [];
  const isoRe = /^A\.(5\.(3[0-7]|[12]?[0-9])|6\.[1-8]|7\.(1[0-4]|[1-9])|8\.(3[0-4]|[12]?[0-9]))$/;
  const soc2Re = /^(CC[1-9]\.[1-9]|A1\.[1-3]|C1\.[1-2]|PI1\.[1-5]|P[1-8]\.[1-9])$/;
  const seen = new Set<string>();
  for (const c of data.controls) {
    if (seen.has(c.id)) out.push(`duplicate domain id ${c.id}`);
    seen.add(c.id);
    const total = c.mappings.csf.length + c.mappings.cis.length + c.mappings.iso.length + c.mappings.soc2.length;
    if (total === 0) out.push(`${c.id}: no mappings`);
    for (const field of ['domain', 'summary'] as const) {
      if (c[field]?.includes('—')) out.push(`${c.id}: em dash in ${field}`);
    }
    for (const id of c.mappings.csf) if (!(id in csf)) out.push(`${c.id}: unknown CSF id ${id}`);
    for (const id of c.mappings.cis) if (!(id in cis)) out.push(`${c.id}: unknown CIS id ${id}`);
    for (const id of c.mappings.iso) if (!isoRe.test(id)) out.push(`${c.id}: invalid ISO id ${id}`);
    for (const id of c.mappings.soc2) if (!soc2Re.test(id)) out.push(`${c.id}: invalid SOC2 id ${id}`);
  }
  for (const f of data.frameworks) {
    const distinct = new Set(data.controls.flatMap((c) => c.mappings[f.id]));
    if (distinct.size !== f.total) out.push(`${f.id}: total ${f.total} != ${distinct.size} distinct mapped ids`);
  }
  return out;
}

interface BoardMetric {
  id: string;
  name: string;
  short: string;
  unit: string;
  direction: string;
  thresholds: { good: number; act: number };
  question: string;
  definition: string;
  boardFraming: string;
}

/** Structural checks for the board metrics catalog. */
function validateBoardMetrics(metrics: BoardMetric[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of metrics) {
    if (seen.has(m.id)) out.push(`duplicate metric id ${m.id}`);
    seen.add(m.id);
    if (!['higher-better', 'lower-better'].includes(m.direction)) out.push(`${m.id}: bad direction ${m.direction}`);
    if (!['%', 'days', 'count', 'hours'].includes(m.unit)) out.push(`${m.id}: bad unit ${m.unit}`);
    const { good, act } = m.thresholds;
    if (m.direction === 'higher-better' && !(good >= act)) out.push(`${m.id}: higher-better needs good>=act (${good}/${act})`);
    if (m.direction === 'lower-better' && !(good <= act)) out.push(`${m.id}: lower-better needs good<=act (${good}/${act})`);
    for (const field of ['name', 'short', 'question', 'definition', 'boardFraming'] as const) {
      if (!m[field]?.trim()) out.push(`${m.id}: empty ${field}`);
      if (m[field]?.includes('—')) out.push(`${m.id}: em dash in ${field}`);
    }
    if (m.name.length > 42) out.push(`${m.id}: name too long`);
    if (m.short.length > 18) out.push(`${m.id}: short too long`);
  }
  return out;
}

interface RunbookScenario {
  id: string;
  name: string;
  tagline: string;
  summary: string;
  phases: { name: string; steps: string[] }[];
  roles: { role: string; focus: string }[];
  escalation: string[];
  decisionPoints: string[];
  commsTemplates: { audience: string; draft: string }[];
  injects: { time: string; title: string; detail: string; facilitatorNote: string; expectedAction: string }[];
  gapQuestions: string[];
}

/** Structural checks for the runbook scenario library. */
function validateRunbooks(scenarios: RunbookScenario[]): string[] {
  const out: string[] = [];
  const PHASES = ['Detect and triage', 'Contain', 'Eradicate', 'Recover', 'Post-incident review'];
  const AUDIENCES = ['Employees', 'Customers', 'Executives and board', 'Regulators'];
  const KNOWN = new Set(['org', 'size', 'cloud', 'mdr', 'dataTypes', 'process']);
  const seen = new Set<string>();
  for (const s of scenarios) {
    if (seen.has(s.id)) out.push(`duplicate scenario id ${s.id}`);
    seen.add(s.id);
    if (s.phases.map((p) => p.name).join('|') !== PHASES.join('|')) out.push(`${s.id}: phases must be ${PHASES.join(', ')}`);
    if (s.commsTemplates.map((c) => c.audience).join('|') !== AUDIENCES.join('|')) out.push(`${s.id}: comms audiences must be ${AUDIENCES.join(', ')}`);
    if (s.injects.length < 5 || s.injects.length > 7) out.push(`${s.id}: injects ${s.injects.length} (need 5 to 7)`);
    if (s.tagline.length > 70) out.push(`${s.id}: tagline too long`);
    const blob = JSON.stringify(s);
    if (blob.includes('—')) out.push(`${s.id}: em dash present`);
    for (const token of blob.match(/\{(\w+)\}/g) ?? []) {
      if (!KNOWN.has(token.slice(1, -1))) out.push(`${s.id}: unknown placeholder ${token}`);
    }
  }
  return out;
}

interface CloudControl {
  id: string;
  provider: string;
  domain: string;
  title: string;
  rationale: string;
  priority: string;
  workloads: string[];
  compliance: string[];
  cisRef?: string;
}

/** Structural checks for the cloud security baseline ruleset. */
function validateCloudBaseline(controls: CloudControl[]): string[] {
  const out: string[] = [];
  const PROVIDERS = new Set(['aws', 'azure', 'gcp']);
  const DOMAINS = new Set(['identity', 'logging', 'network', 'workload', 'data']);
  const PRIORITIES = new Set(['critical', 'high', 'standard']);
  const WORKLOADS = new Set(['saas', 'corp-it', 'data-platform']);
  const COMPLIANCE = new Set(['soc2', 'hipaa', 'cmmc', 'pci']);
  const seen = new Set<string>();
  for (const c of controls) {
    if (seen.has(c.id)) out.push(`duplicate control id ${c.id}`);
    seen.add(c.id);
    if (!PROVIDERS.has(c.provider)) out.push(`${c.id}: bad provider ${c.provider}`);
    if (!DOMAINS.has(c.domain)) out.push(`${c.id}: bad domain ${c.domain}`);
    if (!PRIORITIES.has(c.priority)) out.push(`${c.id}: bad priority ${c.priority}`);
    if (!c.workloads?.length || !c.workloads.every((w) => WORKLOADS.has(w))) out.push(`${c.id}: bad workloads`);
    if (!c.compliance?.every((x) => COMPLIANCE.has(x))) out.push(`${c.id}: bad compliance`);
    for (const field of ['title', 'rationale', 'cisRef'] as const) {
      if (!c[field]?.trim()) out.push(`${c.id}: empty ${field}`);
      if (c[field]?.includes('—')) out.push(`${c.id}: em dash in ${field}`);
    }
    if (c.title.length > 95) out.push(`${c.id}: title too long`);
  }
  for (const p of PROVIDERS) if (!controls.some((c) => c.provider === p)) out.push(`no controls for provider ${p}`);
  return out;
}

const acronyms = load<AcronymData>('../src/data/acronyms.json');
const csf = load<CsfData>('../src/data/nist-csf.json');
const cis = load<CisData>('../src/data/cis.json');
const ai = load<AiData>('../src/data/ai-frameworks.json');
const map = load<Record<string, string[]>>('../src/data/csf-cis-map.json');
const cmmc = load<AssessmentData>('../src/data/assessment-800171.json');
const cyberEssentials = load<AssessmentData>('../src/data/assessment-cyber-essentials.json');
const ztmm = load<AssessmentData>('../src/data/assessment-ztmm.json');
const ssdf = load<AssessmentData>('../src/data/assessment-ssdf.json');
const pci = load<AssessmentData>('../src/data/assessment-pci-dss.json');
const crosswalk = load<CrosswalkData>('../src/data/crosswalk.json');
const boardMetrics = load<{ metrics: BoardMetric[] }>('../src/data/board-metrics.json');
const runbooks = load<{ scenarios: RunbookScenario[] }>('../src/data/runbooks.json');
const cloudBaseline = load<{ controls: CloudControl[] }>('../src/data/cloud-baseline.json');

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
  ...validateAi(ai).map((e) => `ai-frameworks: ${e}`),
  ...mapProblems.map((e) => `csf-cis-map: ${e}`),
  ...validateAssessment(cmmc).map((e) => `800-171: ${e}`),
  ...validateAssessment(cyberEssentials).map((e) => `cyber-essentials: ${e}`),
  ...validateAssessment(ztmm).map((e) => `ztmm: ${e}`),
  ...validateAssessment(ssdf).map((e) => `ssdf: ${e}`),
  ...validateAssessment(pci).map((e) => `pci-dss: ${e}`),
  ...validateCrosswalk(crosswalk, csf, cis).map((e) => `crosswalk: ${e}`),
  ...validateBoardMetrics(boardMetrics.metrics).map((e) => `board-metrics: ${e}`),
  ...validateRunbooks(runbooks.scenarios).map((e) => `runbooks: ${e}`),
  ...validateCloudBaseline(cloudBaseline.controls).map((e) => `cloud-baseline: ${e}`),
];

if (problems.length > 0) {
  console.error(`Data INVALID (${problems.length} problems):`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(
  `Data OK: ${Object.keys(acronyms).length} acronyms, ${Object.keys(csf).length} CSF subcategories, ${Object.keys(cis).length} CIS safeguards, ${ai.length} AI framework entries, ` +
    `${cmmc.questions.length} 800-171/CMMC, ${cyberEssentials.questions.length} Cyber Essentials, ${ztmm.questions.length} ZTMM, ${ssdf.questions.length} SSDF, ${pci.questions.length} PCI DSS, ${crosswalk.controls.length} crosswalk domains, ${boardMetrics.metrics.length} board metrics, ${runbooks.scenarios.length} runbook scenarios, ${cloudBaseline.controls.length} cloud baseline controls.`,
);
