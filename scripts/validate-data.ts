import { validateThreatModel } from '../src/lib/ai-threat';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateData } from '../src/data/validate';
import { validateAi, validateCis, validateCsf } from '../src/lib/frameworks';
import { TIER_ORDER } from '../src/lib/assessment';
import type { AcronymData } from '../src/lib/types';
import type { AiData, CisData, CsfData } from '../src/lib/frameworks';
import type { AssessmentData } from '../src/lib/assessment';
import type { Soc2Data } from '../src/lib/soc2';

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

interface CrosswalkFramework {
  id: string;
  name: string;
  short: string;
  family: string;
  kind: string;
  unit: string;
  version: string;
  url: string;
  note: string;
  status: 'mapped' | 'pending';
  total: number;
}

interface CrosswalkSignal {
  id: string;
  name: string;
  short: string;
  status: 'public' | 'pending';
  url: string;
  what: string;
  domains: string[];
}

interface CrosswalkData {
  meta: {
    groups: { id: string; name: string }[];
    families: { id: string; name: string; blurb: string }[];
  };
  frameworks: CrosswalkFramework[];
  signals: CrosswalkSignal[];
  controls: {
    id: string;
    group: string;
    domain: string;
    summary: string;
    mappings: Record<string, string[]>;
  }[];
}

/**
 * Structural checks for the SOC 2 dataset.
 *
 * The criteria are paywalled and the freely published summaries disagree with
 * each other, so the family sizes here were derived: CC1 through CC5 are built
 * on the seventeen COSO principles, and the crosswalk corroborates the maxima
 * of the rest. The COSO total is asserted because it is the only support CC5
 * has, no crosswalk identifier reaching it.
 */
function validateSoc2(data: Soc2Data): string[] {
  const out: string[] = [];
  if (data.criteria.length !== data.meta.criterionCount) {
    out.push(`criterionCount ${data.meta.criterionCount} != ${data.criteria.length} criteria`);
  }
  const seen = new Set<string>();
  for (const c of data.criteria) {
    if (seen.has(c.id)) out.push(`duplicate criterion id ${c.id}`);
    seen.add(c.id);
    if (c.family !== c.id.split('.')[0]) out.push(`${c.id}: family ${c.family} does not match id`);
    for (const field of ['subject', 'metaphor', 'translation'] as const) {
      if (!c[field]?.trim()) out.push(`${c.id}: empty ${field}`);
      if (c[field]?.includes('—')) out.push(`${c.id}: em dash in ${field}`);
    }
  }
  for (const family of data.meta.families) {
    const members = data.criteria.filter((c) => c.family === family.code);
    if (members.length !== family.count) {
      out.push(`${family.code}: count ${family.count} != ${members.length} criteria`);
    }
    const numbers = members.map((c) => Number(c.id.split('.')[1])).sort((a, b) => a - b);
    const expected = Array.from({ length: family.count }, (_, i) => i + 1);
    if (numbers.join(',') !== expected.join(',')) {
      out.push(`${family.code}: numbering ${numbers.join(',')} is not 1..${family.count}`);
    }
  }
  const coso = data.meta.families.filter((f) => f.coso).reduce((s, f) => s + f.count, 0);
  if (coso !== 17) out.push(`COSO derived families total ${coso}, expected 17`);
  const declared = data.meta.categories.reduce((s, c) => s + c.count, 0);
  if (declared !== data.criteria.length) {
    out.push(`category counts total ${declared} != ${data.criteria.length} criteria`);
  }
  return out;
}

/**
 * Structural + reference checks for the control crosswalk.
 *
 * The crosswalk is the widest dataset on the site: 45 control domains against
 * 32 mapped frameworks. Its danger is quiet drift, an identifier that stops
 * existing or a framework total that no longer matches what is mapped, so every
 * framework whose identifiers this site independently holds is checked against
 * that dataset rather than against a pattern.
 */
function validateCrosswalk(
  data: CrosswalkData,
  csf: CsfData,
  cis: CisData,
  soc2: Soc2Data,
  ai: AiData,
  cpg: AssessmentData,
  hipaa: { standards: { slug: string }[] },
  n800171: AssessmentData,
  pci: AssessmentData,
): string[] {
  const out: string[] = [];
  const isoRe = /^A\.(5\.(3[0-7]|[12]?[0-9])|6\.[1-8]|7\.(1[0-4]|[1-9])|8\.(3[0-4]|[12]?[0-9]))$/;
  /**
   * SOC 2 identifiers are checked against the dataset rather than a pattern.
   * The previous regex accepted CC8.4 and CC9.3, which do not exist and which
   * public sources had invented, so the dataset is the authority instead.
   *
   * PI1.2 and PI1.3 are the documented exception: the crosswalk cites them, but
   * Processing Integrity is deliberately not enumerated. See src/lib/soc2.ts.
   */
  const soc2Ids = new Set([...soc2.criteria.map((c) => c.id), 'PI1.2', 'PI1.3']);
  const aiCodes = (code: string): Set<string> =>
    new Set(ai.filter((e) => e.frameworkCode === code).map((e) => e.code));

  /** Frameworks whose identifiers this site holds, so a dangling id is catchable. */
  const known: Record<string, Set<string>> = {
    csf: new Set(Object.keys(csf)),
    cis: new Set(Object.keys(cis)),
    soc2: soc2Ids,
    hipaa: new Set(hipaa.standards.map((h) => h.slug)),
    cpg: new Set(cpg.questions.map((q) => q.id)),
    n800171: new Set(n800171.categories.map((c) => c.id)),
    pci: new Set(pci.categories.map((c) => c.id)),
    atlas: aiCodes('ATLAS'),
    airmf: aiCodes('AIRMF'),
    iso42001: aiCodes('ISO42001'),
    owaspllm: aiCodes('OWASP-LLM'),
  };

  const groupIds = new Set(data.meta.groups.map((g) => g.id));
  const familyIds = new Set(data.meta.families.map((f) => f.id));
  const domainIds = new Set(data.controls.map((c) => c.id));
  const frameworkIds = new Set(data.frameworks.map((f) => f.id));

  const seenFramework = new Set<string>();
  for (const f of data.frameworks) {
    if (seenFramework.has(f.id)) out.push(`duplicate framework id ${f.id}`);
    seenFramework.add(f.id);
    if (!familyIds.has(f.family)) out.push(`${f.id}: unknown family ${f.family}`);
    if (f.status !== 'mapped' && f.status !== 'pending') out.push(`${f.id}: bad status ${f.status}`);
    for (const field of ['name', 'short', 'kind', 'note'] as const) {
      if (!f[field]?.trim()) out.push(`${f.id}: empty ${field}`);
    }
    if (JSON.stringify(f).includes('—')) out.push(`${f.id}: em dash in framework metadata`);
    if (f.status === 'mapped') {
      if (!f.url.startsWith('https://')) out.push(`${f.id}: no source url`);
      if (!f.unit.trim()) out.push(`${f.id}: no mapping unit stated`);
      if (f.total === 0) out.push(`${f.id}: mapped but maps nothing`);
    } else if (f.total !== 0) {
      out.push(`${f.id}: pending frameworks must map nothing`);
    }
    const distinct = new Set(data.controls.flatMap((c) => c.mappings[f.id] ?? []));
    if (distinct.size !== f.total) out.push(`${f.id}: total ${f.total} != ${distinct.size} distinct mapped ids`);
  }

  const seen = new Set<string>();
  for (const c of data.controls) {
    if (seen.has(c.id)) out.push(`duplicate domain id ${c.id}`);
    seen.add(c.id);
    if (!groupIds.has(c.group)) out.push(`${c.id}: unknown group ${c.group}`);
    const total = c.mappings.csf.length + c.mappings.cis.length + c.mappings.iso.length + c.mappings.soc2.length;
    if (total === 0) out.push(`${c.id}: no mappings`);
    for (const field of ['domain', 'summary'] as const) {
      if (c[field]?.includes('—')) out.push(`${c.id}: em dash in ${field}`);
    }
    for (const fid of frameworkIds) {
      if (!Array.isArray(c.mappings[fid])) out.push(`${c.id}: missing ${fid} mapping array`);
    }
    for (const [fid, ids] of Object.entries(c.mappings)) {
      if (!frameworkIds.has(fid)) out.push(`${c.id}: maps unknown framework ${fid}`);
      if (new Set(ids).size !== ids.length) out.push(`${c.id}: duplicate ${fid} ids`);
      const valid = known[fid];
      if (valid) {
        for (const id of ids) if (!valid.has(id)) out.push(`${c.id}: unknown ${fid} id ${id}`);
      }
    }
    for (const id of c.mappings.iso) if (!isoRe.test(id)) out.push(`${c.id}: invalid ISO id ${id}`);
  }

  for (const s of data.signals) {
    if (!s.what?.trim()) out.push(`signal ${s.id}: no description`);
    if (s.status === 'public' && !s.url.startsWith('https://')) out.push(`signal ${s.id}: no source url`);
    if (JSON.stringify(s).includes('—')) out.push(`signal ${s.id}: em dash`);
    for (const d of s.domains) if (!domainIds.has(d)) out.push(`signal ${s.id}: unknown domain ${d}`);
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

interface SsdlcPractice {
  id: string;
  name: string;
  phase: string;
  why: string;
  leverage: string;
  friction: string;
  ssdfRef: string;
  levels: { label: string; detail: string }[];
  engineerNote: string;
}

/** Structural checks for the secure SDLC maturity rubric. */
function validateSsdlc(data: { phases: { id: string }[]; practices: SsdlcPractice[] }): string[] {
  const out: string[] = [];
  const PHASES = new Set(data.phases.map((p) => p.id));
  const RATINGS = new Set(['high', 'medium', 'low']);
  const SSDF = /^(PO|PS|PW|RV)\.\d+$/;
  const seen = new Set<string>();
  for (const p of data.practices) {
    if (seen.has(p.id)) out.push(`duplicate practice id ${p.id}`);
    seen.add(p.id);
    if (!PHASES.has(p.phase)) out.push(`${p.id}: bad phase ${p.phase}`);
    if (!RATINGS.has(p.leverage)) out.push(`${p.id}: bad leverage`);
    if (!RATINGS.has(p.friction)) out.push(`${p.id}: bad friction`);
    if (!SSDF.test(p.ssdfRef)) out.push(`${p.id}: bad ssdfRef ${p.ssdfRef}`);
    if (!Array.isArray(p.levels) || p.levels.length !== 4) out.push(`${p.id}: needs 4 ladder levels`);
    else for (const [i, l] of p.levels.entries()) if (!l.label?.trim() || !l.detail?.trim()) out.push(`${p.id}: level ${i} incomplete`);
    for (const field of ['name', 'why', 'engineerNote'] as const) {
      if (!p[field]?.trim()) out.push(`${p.id}: empty ${field}`);
    }
    if (p.name.length > 60) out.push(`${p.id}: name too long`);
    if (JSON.stringify(p).includes('—')) out.push(`${p.id}: em dash`);
  }
  for (const phase of data.phases) if (!data.practices.some((p) => p.phase === phase.id)) out.push(`no practices in phase ${phase.id}`);
  return out;
}

interface AutomationRoi {
  categories: { id: string; name: string; defaultPattern: string; automatable: number }[];
  sensitivities: { id: string; name: string; autoRetain: number; note: string }[];
  patterns: { id: string; name: string; blurb: string; skeleton: string[] }[];
}

/** Structural checks for the automation ROI ruleset. */
function validateAutomationRoi(data: AutomationRoi): string[] {
  const out: string[] = [];
  const patternIds = new Set(data.patterns.map((p) => p.id));
  const seen = new Set<string>();
  for (const c of data.categories) {
    if (seen.has(c.id)) out.push(`duplicate category id ${c.id}`);
    seen.add(c.id);
    if (!patternIds.has(c.defaultPattern)) out.push(`${c.id}: unknown defaultPattern ${c.defaultPattern}`);
    if (!(c.automatable > 0 && c.automatable <= 1)) out.push(`${c.id}: automatable out of range`);
  }
  for (const s of data.sensitivities) {
    if (!(s.autoRetain > 0 && s.autoRetain <= 1)) out.push(`${s.id}: autoRetain out of range`);
  }
  for (const p of data.patterns) {
    if (!p.blurb?.trim()) out.push(`${p.id}: empty blurb`);
    if (!Array.isArray(p.skeleton) || p.skeleton.length < 3) out.push(`${p.id}: skeleton too short`);
  }
  if (JSON.stringify(data).includes('—')) out.push('em dash present');
  return out;
}

interface TrustEntry {
  id: string;
  category: string;
  question: string;
  keywords: string[];
  answer: string;
}

/** Structural checks for the trust answer library. */
function validateTrustLibrary(data: { categories: { id: string }[]; entries: TrustEntry[] }): string[] {
  const out: string[] = [];
  const catIds = new Set(data.categories.map((c) => c.id));
  const seen = new Set<string>();
  for (const e of data.entries) {
    if (seen.has(e.id)) out.push(`duplicate entry id ${e.id}`);
    seen.add(e.id);
    if (!catIds.has(e.category)) out.push(`${e.id}: unknown category ${e.category}`);
    if (!e.question?.trim()) out.push(`${e.id}: empty question`);
    if (!e.answer?.trim()) out.push(`${e.id}: empty answer`);
    if (!Array.isArray(e.keywords) || e.keywords.length < 3) out.push(`${e.id}: too few keywords`);
    else for (const k of e.keywords) if (k !== k.toLowerCase()) out.push(`${e.id}: non-lowercase keyword ${k}`);
    if (JSON.stringify(e).includes('—')) out.push(`${e.id}: em dash`);
  }
  for (const c of data.categories) if (!data.entries.some((e) => e.category === c.id)) out.push(`no entries in category ${c.id}`);
  return out;
}

interface RegData {
  questions: { id: string; label: string; options: { id: string; label: string }[] }[];
  regulations: {
    id: string;
    name: string;
    short: string;
    enforcer: string;
    appliesTo: string;
    triggers: { condition: Record<string, string[]>; because: string }[];
    obligations: string[];
    first90: string[];
    sources: { name: string; url: string }[];
    caveat: string;
  }[];
}

/** Structural + reference checks for the regulation applicability dataset. */
function validateRegulations(data: RegData): string[] {
  const out: string[] = [];
  const optsByQ = new Map(data.questions.map((q) => [q.id, new Set(q.options.map((o) => o.id))]));
  const seen = new Set<string>();
  for (const r of data.regulations) {
    if (seen.has(r.id)) out.push(`duplicate regulation id ${r.id}`);
    seen.add(r.id);
    for (const field of ['name', 'short', 'enforcer', 'appliesTo', 'caveat'] as const) {
      if (!r[field]?.trim()) out.push(`${r.id}: empty ${field}`);
    }
    if (!r.triggers?.length) out.push(`${r.id}: no triggers`);
    for (const t of r.triggers ?? []) {
      if (!t.because?.trim()) out.push(`${r.id}: trigger missing rationale`);
      for (const [qid, opts] of Object.entries(t.condition ?? {})) {
        const valid = optsByQ.get(qid);
        if (!valid) out.push(`${r.id}: trigger references unknown question ${qid}`);
        else for (const o of opts) if (!valid.has(o)) out.push(`${r.id}: trigger references unknown option ${qid}/${o}`);
      }
    }
    if (!r.obligations?.length) out.push(`${r.id}: no obligations`);
    if (!r.first90?.length) out.push(`${r.id}: no first90`);
    if (!r.sources?.length) out.push(`${r.id}: no sources`);
    for (const s of r.sources ?? []) if (!/^https:\/\//.test(s.url ?? '')) out.push(`${r.id}: non-https source`);
    if (JSON.stringify(r).includes('—')) out.push(`${r.id}: em dash`);
  }
  return out;
}

interface SkillsMatrix {
  levels: { value: number; label: string; hint: string }[];
  proficientLevel: number;
  competencies: { id: string; name: string; blurb: string; resources: { label: string; href: string }[] }[];
}

/** Structural checks for the team skills matrix, including scorecard alignment. */
function validateSkillsMatrix(data: SkillsMatrix, cardIds: Set<string>): string[] {
  const out: string[] = [];
  if (data.levels.length !== 5) out.push('level scale should have 5 rungs');
  if (typeof data.proficientLevel !== 'number') out.push('missing proficientLevel');
  const seen = new Set<string>();
  for (const c of data.competencies) {
    if (seen.has(c.id)) out.push(`duplicate competency id ${c.id}`);
    seen.add(c.id);
    if (!cardIds.has(c.id)) out.push(`${c.id}: not a scorecard card id`);
    if (!c.name?.trim()) out.push(`${c.id}: empty name`);
    if (!c.blurb?.trim()) out.push(`${c.id}: empty blurb`);
    if (!c.resources?.length) out.push(`${c.id}: no resources`);
    for (const r of c.resources ?? []) {
      if (!r.label?.trim()) out.push(`${c.id}: resource missing label`);
      if (!/^(\.\.\/|https:\/\/)/.test(r.href ?? '')) out.push(`${c.id}: bad resource href ${r.href}`);
    }
  }
  if (JSON.stringify(data).includes('—')) out.push('em dash present');
  return out;
}

interface BacklogTopic {
  slug: string;
  title: string;
  category: string;
  brief: string;
  links: string[];
}

interface BlogPost {
  slug: string;
  title: string;
  description: string;
  category: string;
  author: string;
  date: string;
  readingMinutes: number;
  tags: string[];
  body: { type: string; text?: string; items?: string[] }[];
  related: { label: string; href: string }[];
}

/**
 * Max blog title length. A published post and the backlog topic it comes from
 * share this cap, so an over-length backlog title is caught when it is written
 * rather than after a post has been drafted against it.
 */
const BLOG_TITLE_MAX = 70;
const BLOG_CATEGORIES = new Set(['Explainer', 'Career', 'Spotlight']);

/** Structural checks for backlog topics, which become blog posts verbatim. */
function validateBacklog(topics: BacklogTopic[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of topics) {
    const w = t.slug || '?';
    if (seen.has(t.slug)) out.push(`duplicate slug ${w}`);
    seen.add(t.slug);
    if (!/^[a-z0-9-]+$/.test(t.slug ?? '')) out.push(`${w}: bad slug`);
    if (!t.title?.trim() || t.title.length > BLOG_TITLE_MAX) {
      out.push(`${w}: title length ${t.title?.length ?? 0}, max ${BLOG_TITLE_MAX}`);
    }
    if (!BLOG_CATEGORIES.has(t.category)) out.push(`${w}: bad category ${t.category}`);
    if (!t.brief?.trim()) out.push(`${w}: missing brief`);
    if (!Array.isArray(t.links) || !t.links.length) out.push(`${w}: no links`);
    if (JSON.stringify(t).includes('\u2014')) out.push(`${w}: em dash`);
  }
  return out;
}

/** Structural checks for blog posts. */
function validateBlog(posts: BlogPost[]): string[] {
  const out: string[] = [];
  const cats = BLOG_CATEGORIES;
  const types = new Set(['p', 'h2', 'list', 'quote']);
  const seen = new Set<string>();
  for (const p of posts) {
    const w = p.slug || '?';
    if (seen.has(p.slug)) out.push(`duplicate slug ${w}`);
    seen.add(p.slug);
    if (!/^[a-z0-9-]+$/.test(p.slug)) out.push(`${w}: bad slug`);
    if (!p.title?.trim() || p.title.length > BLOG_TITLE_MAX) {
      out.push(`${w}: title length ${p.title?.length ?? 0}, max ${BLOG_TITLE_MAX}`);
    }
    if (!p.description || p.description.length < 100 || p.description.length > 170) out.push(`${w}: description length`);
    if (!cats.has(p.category)) out.push(`${w}: bad category ${p.category}`);
    if (!p.author?.trim()) out.push(`${w}: missing author`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.date)) out.push(`${w}: bad date`);
    if (!Number.isInteger(p.readingMinutes) || p.readingMinutes < 1) out.push(`${w}: bad readingMinutes`);
    if (!Array.isArray(p.tags) || p.tags.length < 2) out.push(`${w}: too few tags`);
    if (!Array.isArray(p.body) || p.body.length < 4) out.push(`${w}: body too short`);
    for (const b of p.body ?? []) if (!types.has(b.type)) out.push(`${w}: bad block type ${b.type}`);
    if (!Array.isArray(p.related) || !p.related.length) out.push(`${w}: no related links`);
    if (JSON.stringify(p).includes('—')) out.push(`${w}: em dash`);
  }
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
const cpg = load<AssessmentData>('../src/data/assessment-cpg.json');
const hipaaRule = load<{ standards: { slug: string }[] }>('../src/data/hipaa-security.json');
const crosswalk = load<CrosswalkData>('../src/data/crosswalk.json');
const soc2 = load<Soc2Data>('../src/data/soc2.json');
const boardMetrics = load<{ metrics: BoardMetric[] }>('../src/data/board-metrics.json');
const runbooks = load<{ scenarios: RunbookScenario[] }>('../src/data/runbooks.json');
const cloudBaseline = load<{ controls: CloudControl[] }>('../src/data/cloud-baseline.json');
const ssdlc = load<{ phases: { id: string }[]; practices: SsdlcPractice[] }>('../src/data/ssdlc.json');
const automationRoi = load<AutomationRoi>('../src/data/automation-roi.json');
const trustLibrary = load<{ categories: { id: string }[]; entries: TrustEntry[] }>('../src/data/trust-library.json');
const regulations = load<RegData>('../src/data/regulations.json');
const scorecard = load<{ cards: { id: string; onTheJobTool: { status: string } }[] }>(
  '../src/data/scorecard.json',
);
const skillsMatrix = load<SkillsMatrix>('../src/data/skills-matrix.json');
const threatModel = load<Parameters<typeof validateThreatModel>[0]>('../src/data/ai-threat-model.json');
const blogPosts = load<BlogPost[]>('../src/data/blog-posts.json');
const blogBacklog = load<{ topics: BacklogTopic[] }>('../src/data/blog-backlog.json');
const affiliates = load<{
  partners: Record<string, { name: string; url: string; network: string; blurb: string; direct?: boolean }>;
  placements: Record<string, string[]>;
}>('../src/data/affiliates.json');

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
  ...validateCrosswalk(crosswalk, csf, cis, soc2, ai, cpg, hipaaRule, cmmc, pci).map((e) => `crosswalk: ${e}`),
  ...validateSoc2(soc2).map((e) => `soc2: ${e}`),
  ...validateBoardMetrics(boardMetrics.metrics).map((e) => `board-metrics: ${e}`),
  ...validateRunbooks(runbooks.scenarios).map((e) => `runbooks: ${e}`),
  ...validateCloudBaseline(cloudBaseline.controls).map((e) => `cloud-baseline: ${e}`),
  ...validateSsdlc(ssdlc).map((e) => `ssdlc: ${e}`),
  ...validateAutomationRoi(automationRoi).map((e) => `automation-roi: ${e}`),
  ...validateTrustLibrary(trustLibrary).map((e) => `trust-library: ${e}`),
  ...validateRegulations(regulations).map((e) => `regulations: ${e}`),
  ...validateSkillsMatrix(skillsMatrix, new Set(scorecard.cards.map((c) => c.id))).map((e) => `skills-matrix: ${e}`),
  ...validateThreatModel(threatModel).map((e) => `ai-threat-model: ${e}`),
  ...validateBlog(blogPosts).map((e) => `blog: ${e}`),
  ...validateBacklog(blogBacklog.topics).map((e) => `blog backlog: ${e}`),
  ...(() => {
    // Affiliate placements point definition pages at partner /go/ redirects, so
    // a typo here would render a dead recommendation on a live page.
    const out: string[] = [];
    for (const [id, p] of Object.entries(affiliates.partners)) {
      if (!/^https:\/\//.test(p.url)) out.push(`affiliates: partner ${id} url is not https`);
      if (!p.name?.trim() || !p.blurb?.trim() || !p.network?.trim())
        out.push(`affiliates: partner ${id} missing name, network, or blurb`);
      if (p.blurb?.includes('—')) out.push(`affiliates: partner ${id} em dash in blurb`);
      // Amazon terms: links go direct (no /go/ stub) and must carry the tag.
      if (p.network === 'Amazon') {
        if (!p.direct) out.push(`affiliates: Amazon partner ${id} must set direct: true`);
        if (!p.url.includes('tag=thestateofc04-20'))
          out.push(`affiliates: Amazon partner ${id} url is missing the Associates tag`);
      }
    }
    for (const [key, ids] of Object.entries(affiliates.placements)) {
      if (!(key in acronyms)) out.push(`affiliates: placement key ${key} is not an acronym`);
      if (ids.length === 0) out.push(`affiliates: placement ${key} is empty`);
      if (new Set(ids).size !== ids.length) out.push(`affiliates: duplicate partner under ${key}`);
      for (const id of ids) {
        if (!(id in affiliates.partners)) out.push(`affiliates: placement ${key} references unknown partner ${id}`);
      }
    }
    return out;
  })(),
  ...(() => {
    // The /tools/ hub ships a static "N of M tools live" fallback that crawlers and
    // social previews see before JS runs. Assert it matches the data.
    const live = scorecard.cards.filter((c) => c.onTheJobTool.status === 'live').length;
    const html = readFileSync(fileURLToPath(new URL('../tools/index.html', import.meta.url)), 'utf8');
    const shown = /<span id="live-count">([^<]*)<\/span>/.exec(html)?.[1] ?? '(missing)';
    const want = `${live} of ${scorecard.cards.length}`;
    return shown === want ? [] : [`tools/index.html live-count is "${shown}", data says "${want}"`];
  })(),
];

if (problems.length > 0) {
  console.error(`Data INVALID (${problems.length} problems):`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

// Not a failure: a translation over 160 chars still builds, it just ships a
// meta description cut on a word boundary with an ellipsis. Print the count so
// the size of the backlog stays visible instead of being rediscovered from
// Search Console. Set a metaDescription on an entry to take it off this list.
{
  const truncated = (rows: { translation: string; metaDescription?: string }[]) =>
    rows.filter((r) => (r.metaDescription ?? r.translation).length > 160).length;
  const isoControls = load<{ controls: { translation: string; metaDescription?: string }[] }>(
    '../src/data/iso-27001.json',
  ).controls;
  const counts = [
    ['AI', truncated(ai), ai.length],
    ['CSF', truncated(Object.values(csf)), Object.keys(csf).length],
    ['CIS', truncated(Object.values(cis)), Object.keys(cis).length],
    ['ISO', truncated(isoControls), isoControls.length],
    ['SOC2', truncated(soc2.criteria), soc2.criteria.length],
  ] as [string, number, number][];
  const total = counts.reduce((sum, [, n]) => sum + n, 0);
  if (total > 0) {
    console.log(
      `Note: ${total} generated pages ship a truncated meta description (` +
        counts.map(([label, n, of]) => `${label} ${n}/${of}`).join(', ') +
        `). Set metaDescription to fix one.`,
    );
  }
}
console.log(
  `Data OK: ${Object.keys(acronyms).length} acronyms, ${Object.keys(csf).length} CSF subcategories, ${Object.keys(cis).length} CIS safeguards, ${ai.length} AI framework entries, ` +
    `${cmmc.questions.length} 800-171/CMMC, ${cyberEssentials.questions.length} Cyber Essentials, ${ztmm.questions.length} ZTMM, ${ssdf.questions.length} SSDF, ${pci.questions.length} PCI DSS, ${crosswalk.controls.length} crosswalk domains across ${crosswalk.frameworks.filter((f) => f.status === 'mapped').length} mapped frameworks, ${soc2.criteria.length} SOC 2 criteria, ${boardMetrics.metrics.length} board metrics, ${runbooks.scenarios.length} runbook scenarios, ${cloudBaseline.controls.length} cloud baseline controls, ${ssdlc.practices.length} SDLC practices, ${automationRoi.categories.length} automation categories, ${trustLibrary.entries.length} trust answers, ${regulations.regulations.length} regulations, ${skillsMatrix.competencies.length} team competencies, ${threatModel.threats.length} AI threats, ${blogPosts.length} blog posts, ${blogBacklog.topics.filter((t) => !blogPosts.some((p) => p.slug === t.slug)).length} unpublished backlog topics.`,
);
