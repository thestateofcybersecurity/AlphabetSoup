import rawData from './data/assessment.json';
import cpgRaw from './data/assessment-cpg.json';
import cisRaw from './data/cis.json';
import igsRaw from './data/cis-igs.json';
import csfRaw from './data/nist-csf.json';
import cmmcRaw from './data/assessment-800171.json';
import ceRaw from './data/assessment-cyber-essentials.json';
import ztmmRaw from './data/assessment-ztmm.json';
import ssdfRaw from './data/assessment-ssdf.json';
import pciRaw from './data/assessment-pci-dss.json';
import {
  cisControlFromReference,
  cisControlsAssessment,
  cisIg1Assessment,
  csfAssessment,
  cisSafeguardFromReference,
  concerns,
  defaultAnswerConfig,
  latestDelta,
  readinessBand,
  recordSnapshot,
  scoreAssessment,
  TIER_ORDER,
} from './lib/assessment';
import type {
  Annotation,
  Annotations,
  AnswerConfig,
  Answers,
  AnswerState,
  AssessmentData,
  AssessmentResult,
  GroupScore,
  Snapshot,
  Tier,
} from './lib/assessment';
import type { CisData, CsfData } from './lib/frameworks';
import { frameworkSlug } from './lib/frameworks';
import { copyWithToast } from './lib/share';

const byId = (id: string) => document.getElementById(id) as HTMLElement;

interface AssessmentDef {
  id: string;
  name: string;
  blurb: string;
  data: AssessmentData;
  planGaps: boolean;
  config: AnswerConfig;
}

const ASSESSMENTS: AssessmentDef[] = [
  {
    id: 'ransomware',
    name: 'Ransomware readiness',
    blurb:
      'Forty-eight practices across ten goals and three maturity tiers, from backups and patching to incident response. Modeled on the CISA Ransomware Readiness Assessment; every practice links the guidance behind it.',
    data: rawData as AssessmentData,
    planGaps: true,
    config: defaultAnswerConfig,
  },
  {
    id: 'cpg',
    name: 'CISA Performance Goals (CPG)',
    blurb:
      'The 34 CISA Cross-Sector Cybersecurity Performance Goals (v2.0), a prioritized baseline of the highest-impact practices for organizations of any size. Grouped by the six NIST CSF 2.0 functions; every goal cites its CPG id and CSF outcome.',
    data: cpgRaw as AssessmentData,
    planGaps: true,
    config: defaultAnswerConfig,
  },
  {
    id: 'cis-ig1',
    name: 'CIS IG1 essentials',
    blurb:
      'All 56 Implementation Group 1 safeguards from CIS Controls v8 as checks. IG1 is essential cyber hygiene, the floor every organization should reach. Gaps link to plain-English safeguard pages.',
    data: cisIg1Assessment(cisRaw as CisData, igsRaw as Record<string, number>),
    planGaps: false,
    config: defaultAnswerConfig,
  },
  {
    id: 'cis-v8',
    name: 'CIS Controls v8 (all safeguards)',
    blurb:
      'The full CIS Controls v8: all 153 safeguards across 18 controls. Each safeguard sits in a maturity tier by its Implementation Group, so tier attainment reads as IG progress (basic = IG1, intermediate = IG2, advanced = IG3). Gaps link to plain-English safeguard pages.',
    data: cisControlsAssessment(cisRaw as CisData, igsRaw as Record<string, number>),
    planGaps: false,
    config: defaultAnswerConfig,
  },
  {
    id: 'nist-csf',
    name: 'NIST CSF 2.0',
    blurb:
      'A self-assessment across all 106 subcategory outcomes of NIST CSF 2.0, grouped by the six functions (Govern, Identify, Protect, Detect, Respond, Recover). Each outcome uses verbatim NIST wording and links to its plain-English framework page.',
    data: csfAssessment(csfRaw as CsfData),
    planGaps: true,
    config: defaultAnswerConfig,
  },
  {
    id: 'nist-800171',
    name: 'NIST 800-171 / CMMC',
    blurb:
      'The full CMMC 2.0 ladder for defense contractors handling CUI: all 110 NIST SP 800-171 Rev 2 requirements plus the 24 NIST SP 800-172 enhancements CMMC selected for Level 3. Tiered by CMMC level (basic = the 17 Level 1 practices, intermediate = Level 2, advanced = Level 3), so tier attainment reads as CMMC progress.',
    data: cmmcRaw as AssessmentData,
    planGaps: true,
    config: defaultAnswerConfig,
  },
  {
    id: 'cyber-essentials',
    name: 'CISA Cyber Essentials',
    blurb:
      'A starting-point self-assessment built on the six CISA Cyber Essentials elements (leadership, staff, systems, surroundings, data, and crisis response). Plain-language actions for small organizations taking their first structured steps.',
    data: ceRaw as AssessmentData,
    planGaps: true,
    config: defaultAnswerConfig,
  },
  {
    id: 'zero-trust',
    name: 'CISA Zero Trust Maturity Model',
    blurb:
      'A maturity self-assessment across the five ZTMM v2.0 pillars (identity, devices, networks, applications, data) and three cross-cutting capabilities. Each tier is a maturity stage (basic = Initial, intermediate = Advanced, advanced = Optimal), so tier attainment charts your progress off the traditional perimeter model.',
    data: ztmmRaw as AssessmentData,
    planGaps: true,
    config: defaultAnswerConfig,
  },
  {
    id: 'ssdf',
    name: 'NIST SSDF (secure development)',
    blurb:
      'All 42 tasks of the NIST Secure Software Development Framework (SP 800-218) across its four groups: prepare the organization, protect the software, produce well-secured software, and respond to vulnerabilities. For teams that build or ship software.',
    data: ssdfRaw as AssessmentData,
    planGaps: true,
    config: defaultAnswerConfig,
  },
  {
    id: 'pci-dss',
    name: 'PCI DSS v4.0',
    blurb:
      'A plain-English self-assessment across the 12 PCI DSS v4.0 requirements for any organization that stores, processes, or transmits payment card data. Questions are original wording that captures each requirement; the official standard remains the authority for compliance.',
    data: pciRaw as AssessmentData,
    planGaps: true,
    config: defaultAnswerConfig,
  },
];

let current: AssessmentDef = ASSESSMENTS[0];
let answers: Answers = {};
let annotations: Annotations = {};

/* ------------------------------ storage ------------------------------- */

const storageKey = () => `alphabetsoup:assessment:${current.id}`;
const notesKey = () => `alphabetsoup:assessment-notes:${current.id}`;
const historyKey = () => `alphabetsoup:assessment-history:${current.id}`;
const LEGACY_KEY = 'alphabetsoup:assessment';

function loadAnswers(): void {
  try {
    const raw =
      localStorage.getItem(storageKey()) ??
      (current.id === 'ransomware' ? localStorage.getItem(LEGACY_KEY) : null);
    answers = raw ? migrateAnswers(JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    answers = {};
  }
  try {
    annotations = JSON.parse(localStorage.getItem(notesKey()) ?? '{}') as Annotations;
  } catch {
    annotations = {};
  }
}

/** Old data stored only 'yes' | 'no'; both remain valid AnswerStates. */
function migrateAnswers(raw: Record<string, string>): Answers {
  const out: Answers = {};
  const valid: AnswerState[] = ['yes', 'no', 'na', 'alt'];
  for (const [id, value] of Object.entries(raw)) {
    if ((valid as string[]).includes(value)) out[id] = value as AnswerState;
  }
  return out;
}

function saveAnswers(): void {
  try {
    localStorage.setItem(storageKey(), JSON.stringify(answers));
  } catch {
    // Private mode: the assessment still works within the session.
  }
}

function saveAnnotations(): void {
  try {
    localStorage.setItem(notesKey(), JSON.stringify(annotations));
  } catch {
    // ignore
  }
}

function annotationFor(id: string): Annotation {
  return (annotations[id] ??= {});
}

function loadHistory(): Snapshot[] {
  try {
    return JSON.parse(localStorage.getItem(historyKey()) ?? '[]') as Snapshot[];
  } catch {
    return [];
  }
}

function todayString(): string {
  const now = new Date();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${m}-${d}`;
}

/* ------------------------------- helpers ------------------------------ */

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const ANSWER_LABELS: Record<AnswerState, string> = {
  yes: 'Yes',
  alt: 'Other control',
  na: 'N/A',
  no: 'No',
};
const ANSWER_TITLES: Record<AnswerState, string> = {
  yes: 'We do this',
  alt: 'We meet the intent through a compensating control',
  na: 'Not applicable to us (excluded from the score)',
  no: 'We do not do this',
};

function tiersPresent(): Set<Tier> {
  return new Set(current.data.questions.map((q) => q.tier));
}

function show(view: 'intro' | 'form' | 'results'): void {
  byId('assess-intro').hidden = view !== 'intro';
  byId('assess-form').hidden = view !== 'form';
  byId('assess-results').hidden = view !== 'results';
  window.scrollTo({ top: 0 });
}

/* -------------------------------- intro ------------------------------- */

/** Read a given assessment's stored answers (used for the posture overview). */
function answersFor(id: string): Answers {
  try {
    const raw =
      localStorage.getItem(`alphabetsoup:assessment:${id}`) ??
      (id === 'ransomware' ? localStorage.getItem(LEGACY_KEY) : null);
    return raw ? migrateAnswers(JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function historyFor(id: string): Snapshot[] {
  try {
    return JSON.parse(localStorage.getItem(`alphabetsoup:assessment-history:${id}`) ?? '[]') as Snapshot[];
  } catch {
    return [];
  }
}

/** Whole days since a YYYY-MM-DD date, in local time. */
function daysSince(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  const then = Date.UTC(y, m - 1, d);
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(0, Math.round((today - then) / 86_400_000));
}

const REVIEW_AFTER_DAYS = 90;

interface Posture {
  started: boolean;
  result: ReturnType<typeof scoreAssessment>;
  history: Snapshot[];
}

function postureFor(def: AssessmentDef): Posture {
  const a = answersFor(def.id);
  return {
    started: Object.keys(a).length > 0,
    result: scoreAssessment(def.data, a, def.config),
    history: historyFor(def.id),
  };
}

/** A compact posture strip for an assessment card: score, band, coverage, trend, cadence. */
function postureStrip(def: AssessmentDef): HTMLElement {
  const { started, result, history } = postureFor(def);
  const strip = el('div', 'posture-strip');
  if (!started) {
    strip.appendChild(el('span', 'posture-score muted', 'not started'));
    return strip;
  }
  strip.appendChild(
    el('span', 'posture-score', result.insufficient ? '—' : `${result.overallPercent}%`),
  );
  const meta = el('div', 'posture-meta');
  meta.appendChild(
    el('span', 'deck-sub', result.insufficient ? 'not enough answered' : readinessBand(result.overallPercent).label),
  );
  meta.appendChild(el('span', 'deck-sub', `${result.answered}/${result.total} answered`));
  const delta = latestDelta(history);
  if (delta && delta.delta !== 0) {
    meta.appendChild(el('span', `deck-sub trend-${delta.delta > 0 ? 'up' : 'down'}`, `${delta.delta > 0 ? '▲' : '▼'} ${Math.abs(delta.delta)} pts`));
  }
  const last = history[history.length - 1];
  if (last) {
    const days = daysSince(last.date);
    const due = days >= REVIEW_AFTER_DAYS;
    meta.appendChild(el('span', due ? 'posture-due' : 'deck-sub', due ? `due for review (${days}d)` : `assessed ${days === 0 ? 'today' : `${days}d ago`}`));
  }
  strip.appendChild(meta);
  return strip;
}

function renderPostureSummary(): HTMLElement | null {
  const postures = ASSESSMENTS.map((def) => ({ def, ...postureFor(def) }));
  const done = postures.filter((p) => p.started && !p.result.insufficient);
  const summary = el('div', 'posture-summary');
  if (done.length === 0) {
    summary.appendChild(el('span', undefined, 'Pick an assessment below to see where you stand. Nothing leaves your browser.'));
    return summary;
  }
  const weakest = [...done].sort((a, b) => a.result.overallPercent - b.result.overallPercent)[0];
  const overdue = done.filter((p) => {
    const last = p.history[p.history.length - 1];
    return last && daysSince(last.date) >= REVIEW_AFTER_DAYS;
  });
  summary.appendChild(el('strong', undefined, `${done.length} of ${ASSESSMENTS.length} assessed`));
  summary.appendChild(el('span', undefined, ` · weakest area: ${weakest.def.name} at ${weakest.result.overallPercent}%`));
  if (overdue.length > 0) {
    summary.appendChild(el('span', 'posture-due', ` · ${overdue.length} due for review`));
  }
  return summary;
}

function renderIntro(): void {
  const intro = byId('assess-intro');
  intro.innerHTML = '';
  const summary = renderPostureSummary();
  if (summary) intro.appendChild(summary);
  for (const def of ASSESSMENTS) {
    const card = el('div', 'assess-card');
    card.dataset.assessment = def.id;
    card.appendChild(el('h2', 'assess-h', def.name));
    card.appendChild(postureStrip(def));
    card.appendChild(el('p', undefined, def.blurb));
    card.appendChild(el('p', 'deck-sub', `${def.data.questions.length} questions. Answers stay in this browser.`));
    const actions = el('div', 'deck-actions');
    let started = false;
    try {
      started = Boolean(
        localStorage.getItem(`alphabetsoup:assessment:${def.id}`) ??
          (def.id === 'ransomware' ? localStorage.getItem(LEGACY_KEY) : null),
      );
    } catch {
      // ignore
    }
    const start = el('button', 'primary-btn', started ? 'Resume' : 'Start');
    start.addEventListener('click', () => {
      selectAssessment(def);
      renderForm();
      show('form');
    });
    actions.appendChild(start);
    if (started) {
      const reset = el('button', 'ghost-btn', 'Start over');
      reset.addEventListener('click', () => {
        selectAssessment(def);
        answers = {};
        annotations = {};
        saveAnswers();
        saveAnnotations();
        renderIntro();
      });
      actions.appendChild(reset);
    }
    card.appendChild(actions);
    intro.appendChild(card);
  }
}

function selectAssessment(def: AssessmentDef): void {
  current = def;
  loadAnswers();
  const url = new URL(location.href);
  url.searchParams.set('a', def.id);
  history.replaceState(null, '', url);
}

/* -------------------------------- form -------------------------------- */

function updateFormProgress(): void {
  const total = current.data.questions.length;
  const answered = current.data.questions.filter((q) => answers[q.id] !== undefined).length;
  byId('assess-progress').textContent = `${answered}/${total} answered`;
  const done = byId('assess-done') as HTMLButtonElement;
  done.disabled = answered === 0;
  done.textContent = answered === total ? 'See results' : `See results (${total - answered} unanswered count as no)`;
}

function guidanceNode(question: AssessmentData['questions'][number]): HTMLElement | null {
  const hasGuidance = question.why || question.fix || (question.links && question.links.length > 0);
  if (!hasGuidance) return null;
  const details = el('details', 'q-guidance');
  const summary = el('summary', undefined, 'Why it matters and how to close it');
  details.appendChild(summary);
  const body = el('div', 'q-guidance-body');
  if (question.why) {
    const p = el('p');
    p.appendChild(el('strong', undefined, 'Why: '));
    p.appendChild(document.createTextNode(question.why));
    body.appendChild(p);
  }
  if (question.fix) {
    const p = el('p');
    p.appendChild(el('strong', undefined, 'First step: '));
    p.appendChild(document.createTextNode(question.fix));
    body.appendChild(p);
  }
  if (question.links && question.links.length > 0) {
    const links = el('div', 'q-links');
    for (const link of question.links) {
      const a = el('a', undefined, `${link.label} ↗`);
      a.href = link.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      links.appendChild(a);
    }
    body.appendChild(links);
  }
  details.appendChild(body);
  return details;
}

function toolsNode(id: string): HTMLElement {
  const note = annotationFor(id);
  const tools = el('div', 'q-tools');

  const flag = el('button', 'q-tool', '⚑ Flag');
  flag.type = 'button';
  flag.setAttribute('aria-pressed', String(Boolean(note.flagged)));
  if (note.flagged) flag.classList.add('on');
  flag.addEventListener('click', () => {
    note.flagged = !note.flagged;
    flag.classList.toggle('on', note.flagged);
    flag.setAttribute('aria-pressed', String(note.flagged));
    saveAnnotations();
  });
  tools.appendChild(flag);

  const reviewed = el('button', 'q-tool', '✓ Reviewed');
  reviewed.type = 'button';
  reviewed.setAttribute('aria-pressed', String(Boolean(note.reviewed)));
  if (note.reviewed) reviewed.classList.add('on');
  reviewed.addEventListener('click', () => {
    note.reviewed = !note.reviewed;
    reviewed.classList.toggle('on', note.reviewed);
    reviewed.setAttribute('aria-pressed', String(note.reviewed));
    saveAnnotations();
  });
  tools.appendChild(reviewed);

  const noteBtn = el('button', 'q-tool', note.note ? '✎ Note•' : '✎ Note');
  noteBtn.type = 'button';
  const area = el('textarea', 'q-note') as HTMLTextAreaElement;
  area.placeholder = 'Private note (stays in this browser)';
  area.value = note.note ?? '';
  area.hidden = !note.note;
  noteBtn.addEventListener('click', () => {
    area.hidden = !area.hidden;
    if (!area.hidden) area.focus();
  });
  area.addEventListener('input', () => {
    note.note = area.value;
    noteBtn.textContent = note.note ? '✎ Note•' : '✎ Note';
    saveAnnotations();
  });
  tools.appendChild(noteBtn);

  const wrap = el('div', 'q-tools-wrap');
  wrap.appendChild(tools);
  wrap.appendChild(area);
  return wrap;
}

function renderForm(): void {
  const form = byId('assess-form');
  form.innerHTML = '';

  const top = el('div', 'quiz-top sticky-progress');
  const back = el('button', 'ghost-btn', 'all assessments');
  back.addEventListener('click', () => {
    renderIntro();
    show('intro');
  });
  top.appendChild(back);
  top.appendChild(el('div', 'quiz-title', current.name));
  const progress = el('div', 'quiz-progress');
  progress.id = 'assess-progress';
  top.appendChild(progress);
  const done = el('button', 'primary-btn');
  done.id = 'assess-done';
  done.addEventListener('click', () => {
    renderResults();
    show('results');
  });
  top.appendChild(done);
  form.appendChild(top);

  const multiTier = tiersPresent().size > 1;

  for (const category of current.data.categories) {
    const section = el('section', 'assess-group');
    section.appendChild(el('h2', 'assess-h', category.name));
    if (category.blurb) section.appendChild(el('p', 'deck-sub', category.blurb));
    for (const question of current.data.questions.filter((q) => q.group === category.id)) {
      const row = el('div', 'assess-row');
      const text = el('div', 'assess-q');
      text.appendChild(el('span', undefined, question.text));
      if (multiTier) text.appendChild(el('span', 'chip', question.tier));
      row.appendChild(text);

      const toggle = el('div', 'yesno');
      toggle.setAttribute('role', 'radiogroup');
      toggle.setAttribute('aria-label', `Answer: ${question.text}`);
      for (const value of current.config.states) {
        const btn = el('button', `yesno-btn state-${value}`, ANSWER_LABELS[value]);
        btn.type = 'button';
        btn.title = ANSWER_TITLES[value];
        btn.setAttribute('role', 'radio');
        btn.setAttribute('aria-label', ANSWER_TITLES[value]);
        const selected = answers[question.id] === value;
        btn.setAttribute('aria-checked', String(selected));
        if (selected) btn.classList.add('active');
        btn.addEventListener('click', () => {
          answers[question.id] = value;
          saveAnswers();
          toggle.querySelectorAll('.yesno-btn').forEach((b) => {
            b.classList.remove('active');
            b.setAttribute('aria-checked', 'false');
          });
          btn.classList.add('active');
          btn.setAttribute('aria-checked', 'true');
          updateFormProgress();
        });
        toggle.appendChild(btn);
      }
      row.appendChild(toggle);
      section.appendChild(row);

      const guidance = guidanceNode(question);
      if (guidance) section.appendChild(guidance);
      section.appendChild(toolsNode(question.id));
    }
    form.appendChild(section);
  }
  updateFormProgress();
}

/* ------------------------------ results ------------------------------- */

function bar(label: string, percent: number, detail: string): HTMLElement {
  const wrap = el('div', 'score-bar');
  const head = el('div', 'score-bar-head');
  head.appendChild(el('span', undefined, label));
  head.appendChild(el('span', 'deck-sub', detail));
  wrap.appendChild(head);
  const track = el('div', 'score-track');
  const fill = el('div', 'score-fill');
  fill.style.width = `${Math.max(2, percent)}%`;
  track.appendChild(fill);
  wrap.appendChild(track);
  return wrap;
}

function referenceNode(reference: string): HTMLElement {
  const safeguard = cisSafeguardFromReference(reference);
  if (safeguard) {
    const link = el('a', undefined, reference + ' →');
    link.href = `../frameworks/cis/${frameworkSlug(safeguard)}.html`;
    return link;
  }
  const control = cisControlFromReference(reference);
  if (control) {
    const link = el('a', undefined, reference + ' →');
    link.href = `../frameworks/cis/?q=${control}.`;
    return link;
  }
  // NIST CSF 2.0 subcategory, e.g. "NIST CSF GV.RR-02".
  const csf = reference.match(/\b([A-Z]{2}\.[A-Z]{2}-\d{2})\b/);
  if (csf) {
    const link = el('a', undefined, reference + ' →');
    link.href = `../frameworks/nist-csf/${frameworkSlug(csf[1])}.html`;
    return link;
  }
  return el('span', undefined, reference);
}

const SVG_NS = 'http://www.w3.org/2000/svg';
function svgEl(tag: string, attrs: Record<string, string>): SVGElement {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

function sparkline(history: Snapshot[]): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 120 36');
  svg.setAttribute('class', 'spark');
  svg.setAttribute('aria-label', 'Score history');
  const points = history
    .map((snapshot, index) => {
      const x = history.length === 1 ? 60 : (index / (history.length - 1)) * 112 + 4;
      const y = 32 - (snapshot.overall / 100) * 28;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const line = svgEl('polyline', {
    points,
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '2',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
  });
  svg.appendChild(line);
  return svg;
}

/** Inline radar/spider chart of goal percentages, no charting dependency. */
function radarChart(groups: GroupScore[]): SVGSVGElement {
  const size = 240;
  const cx = size / 2;
  const cy = size / 2;
  const r = 88;
  const n = groups.length;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('class', 'radar');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Coverage by goal');
  const angle = (i: number) => (Math.PI * 2 * i) / n - Math.PI / 2;

  for (const ring of [0.25, 0.5, 0.75, 1]) {
    const pts = groups
      .map((_, i) => `${(cx + Math.cos(angle(i)) * r * ring).toFixed(1)},${(cy + Math.sin(angle(i)) * r * ring).toFixed(1)}`)
      .join(' ');
    svg.appendChild(svgEl('polygon', { points: pts, class: 'radar-ring' }));
  }
  groups.forEach((_, i) => {
    svg.appendChild(
      svgEl('line', {
        x1: String(cx),
        y1: String(cy),
        x2: (cx + Math.cos(angle(i)) * r).toFixed(1),
        y2: (cy + Math.sin(angle(i)) * r).toFixed(1),
        class: 'radar-axis',
      }),
    );
  });
  const dataPts = groups
    .map((g, i) => {
      const rr = (r * g.percent) / 100;
      return `${(cx + Math.cos(angle(i)) * rr).toFixed(1)},${(cy + Math.sin(angle(i)) * rr).toFixed(1)}`;
    })
    .join(' ');
  svg.appendChild(svgEl('polygon', { points: dataPts, class: 'radar-area' }));
  groups.forEach((g, i) => {
    const lx = cx + Math.cos(angle(i)) * (r + 12);
    const ly = cy + Math.sin(angle(i)) * (r + 12);
    const label = svgEl('text', {
      x: lx.toFixed(1),
      y: ly.toFixed(1),
      class: 'radar-label',
      'text-anchor': lx < cx - 5 ? 'end' : lx > cx + 5 ? 'start' : 'middle',
      'dominant-baseline': 'middle',
    });
    label.textContent = g.id;
    svg.appendChild(label);
  });
  return svg;
}

/** Inline stacked bar of the yes/alt/na/no/unanswered mix. */
function distributionBar(result: AssessmentResult): HTMLElement {
  const wrap = el('div', 'dist');
  const total = result.total || 1;
  const segs: { key: keyof AssessmentResult['distribution']; label: string }[] = [
    { key: 'yes', label: 'Yes' },
    { key: 'alt', label: 'Other control' },
    { key: 'no', label: 'No' },
    { key: 'unanswered', label: 'Unanswered' },
    { key: 'na', label: 'N/A' },
  ];
  const track = el('div', 'dist-track');
  for (const seg of segs) {
    const count = result.distribution[seg.key];
    if (count === 0) continue;
    const cell = el('div', `dist-cell dist-${seg.key}`);
    cell.style.width = `${(count / total) * 100}%`;
    cell.title = `${seg.label}: ${count}`;
    track.appendChild(cell);
  }
  wrap.appendChild(track);
  const legend = el('div', 'dist-legend');
  for (const seg of segs) {
    const count = result.distribution[seg.key];
    if (count === 0) continue;
    const item = el('span', 'dist-key');
    item.appendChild(el('span', `dist-dot dist-${seg.key}`));
    item.appendChild(document.createTextNode(`${seg.label} ${count}`));
    legend.appendChild(item);
  }
  wrap.appendChild(legend);
  return wrap;
}

function exportPayload(): string {
  return JSON.stringify(
    { assessment: current.id, exported: todayString(), answers, annotations },
    null,
    2,
  );
}

function downloadExport(): void {
  const blob = new Blob([exportPayload()], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `alphabetsoup-${current.id}-${todayString()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function importFromFile(file: File): void {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(String(reader.result)) as {
        assessment?: string;
        answers?: Record<string, string>;
        annotations?: Annotations;
      };
      if (parsed.assessment && parsed.assessment !== current.id) {
        alert(`That file is for "${parsed.assessment}", not this assessment.`);
        return;
      }
      if (parsed.answers) answers = migrateAnswers(parsed.answers);
      if (parsed.annotations) annotations = parsed.annotations;
      saveAnswers();
      saveAnnotations();
      renderResults();
      show('results');
    } catch {
      alert('That file could not be read as a saved assessment.');
    }
  };
  reader.readAsText(file);
}

function renderResults(): void {
  const results = byId('assess-results');
  results.innerHTML = '';
  const result = scoreAssessment(current.data, answers, current.config);
  const band = readinessBand(result.overallPercent);
  const multiTier = tiersPresent().size > 1;

  const top = el('div', 'quiz-top');
  const back = el('button', 'ghost-btn', 'edit answers');
  back.addEventListener('click', () => {
    renderForm();
    show('form');
  });
  top.appendChild(back);
  const copyBtn = el('button', 'ghost-btn', 'copy summary');
  copyBtn.addEventListener('click', () => {
    const gaps = concerns(current.data, answers, current.config);
    const headline = result.insufficient
      ? 'Not enough answered to score'
      : `${result.overallPercent}% (${band.label})`;
    const topGoals = gaps.goals.slice(0, 3).map((g) => `- ${g.name}: ${g.percent}%`);
    const lines = [
      `${current.name} self-assessment`,
      `Score: ${headline}`,
      `Answered: ${result.answered} of ${result.total}, ${result.applicable} count toward the score`,
      gaps.questions.length > 0 ? `Gaps to close: ${gaps.questions.length}` : 'No open gaps',
      ...(topGoals.length ? ['Weakest areas:', ...topGoals] : []),
      `Assessed ${todayString()} at cybersecurityalphabetsoup.com/assess/`,
    ];
    void copyWithToast(lines.join('\n'), 'Summary copied to clipboard');
  });
  top.appendChild(copyBtn);
  const exportBtn = el('button', 'ghost-btn', 'export JSON');
  exportBtn.addEventListener('click', downloadExport);
  top.appendChild(exportBtn);
  // A real button, not a <label>: a label is not focusable and the input is
  // hidden (display:none), so the previous markup was unreachable by keyboard.
  const importBtn = el('button', 'ghost-btn', 'import') as HTMLButtonElement;
  importBtn.type = 'button';
  const importInput = el('input') as HTMLInputElement;
  importInput.type = 'file';
  importInput.accept = 'application/json,.json';
  importInput.hidden = true;
  importInput.addEventListener('change', () => {
    if (importInput.files && importInput.files[0]) importFromFile(importInput.files[0]);
  });
  importBtn.addEventListener('click', () => importInput.click());
  top.appendChild(importBtn);
  top.appendChild(importInput);
  const print = el('button', 'ghost-btn', 'print report');
  print.addEventListener('click', () => window.print());
  top.appendChild(print);
  results.appendChild(top);

  // Auto-snapshot once per day for trend tracking.
  const history = recordSnapshot(loadHistory(), result.overallPercent, todayString());
  try {
    localStorage.setItem(historyKey(), JSON.stringify(history));
  } catch {
    // ignore
  }

  // Headline: score, band, attainment, trend.
  const headline = el('div', 'assess-card');
  const score = el('div', 'quiz-score');
  score.appendChild(el('span', 'quiz-score-big', result.insufficient ? '—' : `${result.overallPercent}%`));
  const bandBox = el('div');
  bandBox.appendChild(el('div', 'assess-band', result.insufficient ? 'Not enough to score' : band.label));
  bandBox.appendChild(
    el('div', 'deck-sub', `${result.answered} of ${result.total} answered · ${result.applicable} count toward the score`),
  );
  if (multiTier && !result.insufficient) {
    const badge = el(
      'div',
      'attain-badge',
      result.attainedTier ? `Reached the ${result.attainedTier} tier` : 'No tier fully met yet',
    );
    badge.classList.add(result.attainedTier ? `attain-${result.attainedTier}` : 'attain-none');
    bandBox.appendChild(badge);
  }
  score.appendChild(bandBox);
  if (history.length >= 2) {
    const trend = el('div', 'trend');
    trend.appendChild(sparkline(history));
    const delta = latestDelta(history);
    if (delta) {
      const sign = delta.delta > 0 ? 'up' : delta.delta < 0 ? 'down' : 'even';
      trend.appendChild(
        el(
          'div',
          'deck-sub trend-delta',
          sign === 'even'
            ? `unchanged since ${delta.since}`
            : `${sign} ${Math.abs(delta.delta)} since ${delta.since}`,
        ),
      );
    }
    score.appendChild(trend);
  }
  headline.appendChild(score);
  headline.appendChild(
    el(
      'p',
      undefined,
      result.insufficient
        ? 'Nothing applicable was answered yet. Answer the questions that apply to you, and mark N/A only where a control genuinely does not apply.'
        : band.blurb,
    ),
  );
  headline.appendChild(distributionBar(result));

  const gapCount = concerns(current.data, answers, current.config).questions.length;
  if (current.planGaps && gapCount > 0) {
    const actions = el('div', 'deck-actions');
    const plan = el('a', 'primary-btn', `Plan these ${gapCount} gaps →`);
    plan.id = 'plan-gaps';
    plan.href = `../roadmap/?source=gaps&a=${current.id}`;
    actions.appendChild(plan);
    headline.appendChild(actions);
  }
  results.appendChild(headline);

  // Radar of goal coverage.
  if (result.groups.length >= 3) {
    const radar = el('div', 'assess-card');
    radar.appendChild(el('h2', 'assess-h', 'Coverage at a glance'));
    radar.appendChild(el('p', 'deck-sub', 'Each spoke is a goal; the further out, the stronger the coverage.'));
    radar.appendChild(radarChart(result.groups));
    results.appendChild(radar);
  }

  // Tier bars (only tiers this assessment actually uses; a two-tier module has no advanced bar).
  if (multiTier) {
    const present = tiersPresent();
    const tiers = el('div', 'assess-card');
    tiers.appendChild(el('h2', 'assess-h', 'By maturity tier'));
    for (const tier of TIER_ORDER) {
      if (!present.has(tier)) continue;
      const attained = result.tierAttained[tier];
      tiers.appendChild(bar(tier, result.tierPercents[tier], attained ? `${result.tierPercents[tier]}% · met` : `${result.tierPercents[tier]}%`));
    }
    results.appendChild(tiers);
  }

  // Goal bars.
  const groups = el('div', 'assess-card');
  groups.appendChild(el('h2', 'assess-h', current.id === 'cis-ig1' ? 'By control' : 'By goal'));
  for (const group of [...result.groups].sort((a, b) => a.percent - b.percent)) {
    const detail = group.na > 0 ? `${group.yes}/${group.total} · ${group.na} n/a` : `${group.yes}/${group.total}`;
    groups.appendChild(bar(group.name, group.percent, detail));
  }
  results.appendChild(groups);

  // Areas of concern: ranked goals + deficient practices with guidance.
  const { goals, questions: gaps } = concerns(current.data, answers, current.config);
  if (gaps.length > 0) {
    const todo = el('div', 'assess-card');
    todo.appendChild(el('h2', 'assess-h', `Suggested areas for improvement`));
    if (goals.length > 0) {
      const ranked = el('ol', 'ranked-goals');
      for (const g of goals.slice(0, 5)) {
        const li = el('li');
        li.appendChild(el('span', 'ranked-name', g.name));
        li.appendChild(el('span', 'deck-sub', `${g.percent}% · ${g.total - g.yes} to close`));
        ranked.appendChild(li);
      }
      todo.appendChild(ranked);
    }
    todo.appendChild(el('p', 'deck-sub', `${gaps.length} practices to work through, basics first. Each cites the guidance that covers it.`));
    for (const question of gaps) {
      const item = el('div', 'gap-item');
      const head = el('div', 'assess-q');
      head.appendChild(el('span', undefined, question.text));
      if (multiTier) head.appendChild(el('span', 'chip', question.tier));
      item.appendChild(head);
      if (question.fix) item.appendChild(el('p', 'gap-fix', question.fix));
      const refs = el('div', 'gap-refs');
      for (const link of question.links ?? []) {
        const a = el('a', undefined, `${link.label} ↗`);
        a.href = link.url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        refs.appendChild(a);
      }
      for (const reference of question.references) refs.appendChild(referenceNode(reference));
      item.appendChild(refs);
      todo.appendChild(item);
    }
    results.appendChild(todo);
  }

  // Flagged for review.
  const flagged = current.data.questions.filter((q) => annotations[q.id]?.flagged);
  if (flagged.length > 0) {
    const box = el('div', 'assess-card');
    box.appendChild(el('h2', 'assess-h', `Flagged for review (${flagged.length})`));
    for (const question of flagged) {
      const item = el('div', 'gap-item');
      item.appendChild(el('div', 'assess-q', question.text));
      const note = annotations[question.id]?.note;
      if (note) item.appendChild(el('p', 'gap-note', note));
      box.appendChild(item);
    }
    results.appendChild(box);
  }
}

/* -------------------------------- boot -------------------------------- */

function main(): void {
  const requested = new URLSearchParams(location.search).get('a');
  const def = ASSESSMENTS.find((a) => a.id === requested);
  renderIntro();
  if (def) {
    selectAssessment(def);
    renderForm();
    show('form');
  } else {
    loadAnswers();
    show('intro');
  }
}

main();
