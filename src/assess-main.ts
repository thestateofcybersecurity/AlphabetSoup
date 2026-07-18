import rawData from './data/assessment.json';
import cisRaw from './data/cis.json';
import igsRaw from './data/cis-igs.json';
import {
  cisControlFromReference,
  cisIg1Assessment,
  cisSafeguardFromReference,
  readinessBand,
  scoreAssessment,
} from './lib/assessment';
import type { Answers, AssessmentData, Tier } from './lib/assessment';
import type { CisData } from './lib/frameworks';
import { frameworkSlug } from './lib/frameworks';

const byId = (id: string) => document.getElementById(id) as HTMLElement;

interface AssessmentDef {
  id: string;
  name: string;
  blurb: string;
  data: AssessmentData;
  planGaps: boolean;
}

const ASSESSMENTS: AssessmentDef[] = [
  {
    id: 'ransomware',
    name: 'Ransomware readiness',
    blurb:
      'Forty-eight questions across ten goals and three maturity tiers, from backups and patching to incident response. Every question cites the NIST and CIS guidance behind it.',
    data: rawData as AssessmentData,
    planGaps: true,
  },
  {
    id: 'cis-ig1',
    name: 'CIS IG1 essentials',
    blurb:
      'All 56 Implementation Group 1 safeguards from CIS Controls v8 as yes/no checks. IG1 is essential cyber hygiene, the floor every organization should reach. Gaps link to plain-English safeguard pages.',
    data: cisIg1Assessment(cisRaw as CisData, igsRaw as Record<string, number>),
    planGaps: false,
  },
];

let current: AssessmentDef = ASSESSMENTS[0];
let answers: Answers = {};

const storageKey = () => `alphabetsoup:assessment:${current.id}`;
const LEGACY_KEY = 'alphabetsoup:assessment';

function loadAnswers(): void {
  try {
    const raw =
      localStorage.getItem(storageKey()) ??
      (current.id === 'ransomware' ? localStorage.getItem(LEGACY_KEY) : null);
    answers = raw ? (JSON.parse(raw) as Answers) : {};
  } catch {
    answers = {};
  }
}

function saveAnswers(): void {
  try {
    localStorage.setItem(storageKey(), JSON.stringify(answers));
  } catch {
    // Private mode: the assessment still works within the session.
  }
}

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

function show(view: 'intro' | 'form' | 'results'): void {
  byId('assess-intro').hidden = view !== 'intro';
  byId('assess-form').hidden = view !== 'form';
  byId('assess-results').hidden = view !== 'results';
  window.scrollTo({ top: 0 });
}

function renderIntro(): void {
  const intro = byId('assess-intro');
  intro.innerHTML = '';
  for (const def of ASSESSMENTS) {
    const card = el('div', 'assess-card');
    card.dataset.assessment = def.id;
    card.appendChild(el('h2', 'assess-h', def.name));
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
        saveAnswers();
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

function updateFormProgress(): void {
  const total = current.data.questions.length;
  const answered = current.data.questions.filter((q) => answers[q.id]).length;
  byId('assess-progress').textContent = `${answered}/${total} answered`;
  const done = byId('assess-done') as HTMLButtonElement;
  done.disabled = answered === 0;
  done.textContent = answered === total ? 'See results' : `See results (${total - answered} unanswered count as no)`;
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

  for (const category of current.data.categories) {
    const section = el('section', 'assess-group');
    section.appendChild(el('h2', 'assess-h', category.name));
    for (const question of current.data.questions.filter((q) => q.group === category.id)) {
      const row = el('div', 'assess-row');
      const text = el('div', 'assess-q');
      text.appendChild(el('span', undefined, question.text));
      if (tiersPresent().size > 1) text.appendChild(el('span', 'chip', question.tier));
      row.appendChild(text);
      const toggle = el('div', 'yesno');
      for (const value of ['yes', 'no'] as const) {
        const btn = el('button', 'yesno-btn', value);
        if (answers[question.id] === value) btn.classList.add('active');
        btn.addEventListener('click', () => {
          answers[question.id] = value;
          saveAnswers();
          toggle.querySelectorAll('.yesno-btn').forEach((b) => b.classList.remove('active'));
          btn.classList.add('active');
          updateFormProgress();
        });
        toggle.appendChild(btn);
      }
      row.appendChild(toggle);
      section.appendChild(row);
    }
    form.appendChild(section);
  }
  updateFormProgress();
}

function tiersPresent(): Set<Tier> {
  return new Set(current.data.questions.map((q) => q.tier));
}

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
  return el('span', undefined, reference);
}

function renderResults(): void {
  const results = byId('assess-results');
  results.innerHTML = '';
  const result = scoreAssessment(current.data, answers);
  const band = readinessBand(result.overallPercent);

  const top = el('div', 'quiz-top');
  const back = el('button', 'ghost-btn', 'edit answers');
  back.addEventListener('click', () => {
    renderForm();
    show('form');
  });
  top.appendChild(back);
  const print = el('button', 'ghost-btn', 'print report');
  print.addEventListener('click', () => window.print());
  top.appendChild(print);
  results.appendChild(top);

  const headline = el('div', 'assess-card');
  const score = el('div', 'quiz-score');
  score.appendChild(el('span', 'quiz-score-big', `${result.overallPercent}%`));
  const bandBox = el('div');
  bandBox.appendChild(el('div', 'assess-band', band.label));
  bandBox.appendChild(el('div', 'deck-sub', `${result.answered} of ${result.total} questions answered`));
  score.appendChild(bandBox);
  headline.appendChild(score);
  headline.appendChild(el('p', undefined, band.blurb));

  const gapCount = current.data.questions.filter((q) => answers[q.id] !== 'yes').length;
  if (current.planGaps && gapCount > 0) {
    const actions = el('div', 'deck-actions');
    const plan = el('a', 'primary-btn', `Plan these ${gapCount} gaps →`);
    plan.id = 'plan-gaps';
    plan.href = '../roadmap/?source=gaps';
    actions.appendChild(plan);
    headline.appendChild(actions);
  }
  results.appendChild(headline);

  if (tiersPresent().size > 1) {
    const tiers = el('div', 'assess-card');
    tiers.appendChild(el('h2', 'assess-h', 'By maturity tier'));
    for (const tier of ['basic', 'intermediate', 'advanced'] as Tier[]) {
      tiers.appendChild(bar(tier, result.tierPercents[tier], `${result.tierPercents[tier]}%`));
    }
    results.appendChild(tiers);
  }

  const groups = el('div', 'assess-card');
  groups.appendChild(el('h2', 'assess-h', current.id === 'cis-ig1' ? 'By control' : 'By goal'));
  for (const group of [...result.groups].sort((a, b) => a.percent - b.percent)) {
    groups.appendChild(bar(group.name, group.percent, `${group.yes}/${group.total}`));
  }
  results.appendChild(groups);

  const gaps = current.data.questions.filter((q) => answers[q.id] !== 'yes');
  if (gaps.length > 0) {
    const todo = el('div', 'assess-card');
    todo.appendChild(el('h2', 'assess-h', `Where to start (${gaps.length} gaps)`));
    todo.appendChild(el('p', 'deck-sub', 'Each item cites the guidance that covers it.'));
    const rank: Record<string, number> = { basic: 0, intermediate: 1, advanced: 2 };
    for (const question of [...gaps].sort((a, b) => rank[a.tier] - rank[b.tier])) {
      const item = el('div', 'gap-item');
      const head = el('div', 'assess-q');
      head.appendChild(el('span', undefined, question.text));
      if (tiersPresent().size > 1) head.appendChild(el('span', 'chip', question.tier));
      item.appendChild(head);
      const refs = el('div', 'gap-refs');
      for (const reference of question.references) {
        refs.appendChild(referenceNode(reference));
      }
      item.appendChild(refs);
      todo.appendChild(item);
    }
    results.appendChild(todo);
  }
}

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
