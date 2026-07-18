import rawData from './data/assessment.json';
import {
  cisControlFromReference,
  readinessBand,
  scoreAssessment,
} from './lib/assessment';
import type { Answers, AssessmentData, Tier } from './lib/assessment';

const data = rawData as AssessmentData;
const byId = (id: string) => document.getElementById(id) as HTMLElement;
const STORAGE_KEY = 'alphabetsoup:assessment';

let answers: Answers = loadAnswers();

function loadAnswers(): Answers {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Answers;
  } catch {
    return {};
  }
}

function saveAnswers(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(answers));
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
  const card = el('div', 'assess-card');
  card.appendChild(el('h2', 'assess-h', 'How ready are you for a ransomware incident?'));
  card.appendChild(
    el('p', undefined, 'Forty-eight yes/no questions across ten goals, from backups and patching to incident response. Questions are tiered basic, intermediate, and advanced, and every one cites the NIST and CIS guidance behind it.'),
  );
  card.appendChild(
    el('p', 'deck-sub', 'Answers are saved only in this browser. Nothing is uploaded, ever.'),
  );
  const actions = el('div', 'deck-actions');
  const started = Object.keys(answers).length > 0;
  const start = el('button', 'primary-btn', started ? 'Resume assessment' : 'Start assessment');
  start.addEventListener('click', () => {
    renderForm();
    show('form');
  });
  actions.appendChild(start);
  if (started) {
    const reset = el('button', 'ghost-btn', 'Start over');
    reset.addEventListener('click', () => {
      answers = {};
      saveAnswers();
      renderIntro();
    });
    actions.appendChild(reset);
  }
  card.appendChild(actions);
  intro.appendChild(card);
}

function updateFormProgress(): void {
  const answered = data.questions.filter((q) => answers[q.id]).length;
  byId('assess-progress').textContent = `${answered}/${data.questions.length} answered`;
  const done = byId('assess-done') as HTMLButtonElement;
  done.disabled = answered === 0;
  done.textContent = answered === data.questions.length ? 'See results' : `See results (${data.questions.length - answered} unanswered count as no)`;
}

function renderForm(): void {
  const form = byId('assess-form');
  form.innerHTML = '';

  const top = el('div', 'quiz-top sticky-progress');
  const back = el('button', 'ghost-btn', 'intro');
  back.addEventListener('click', () => show('intro'));
  top.appendChild(back);
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

  for (const category of data.categories) {
    const section = el('section', 'assess-group');
    section.appendChild(el('h2', 'assess-h', category.name));
    for (const question of data.questions.filter((q) => q.group === category.id)) {
      const row = el('div', 'assess-row');
      const text = el('div', 'assess-q');
      text.appendChild(el('span', undefined, question.text));
      text.appendChild(el('span', 'chip', question.tier));
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

function renderResults(): void {
  const results = byId('assess-results');
  results.innerHTML = '';
  const result = scoreAssessment(data, answers);
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
  results.appendChild(headline);

  const tiers = el('div', 'assess-card');
  tiers.appendChild(el('h2', 'assess-h', 'By maturity tier'));
  for (const tier of ['basic', 'intermediate', 'advanced'] as Tier[]) {
    tiers.appendChild(bar(tier, result.tierPercents[tier], `${result.tierPercents[tier]}%`));
  }
  results.appendChild(tiers);

  const groups = el('div', 'assess-card');
  groups.appendChild(el('h2', 'assess-h', 'By goal'));
  for (const group of [...result.groups].sort((a, b) => a.percent - b.percent)) {
    groups.appendChild(bar(group.name, group.percent, `${group.yes}/${group.total}`));
  }
  results.appendChild(groups);

  const gaps = data.questions.filter((q) => answers[q.id] !== 'yes');
  if (gaps.length > 0) {
    const todo = el('div', 'assess-card');
    todo.appendChild(el('h2', 'assess-h', `Where to start (${gaps.length} gaps)`));
    todo.appendChild(el('p', 'deck-sub', 'Basic-tier gaps first. Each item cites the guidance that covers it.'));
    const ordered = [...gaps].sort((a, b) => {
      const rank: Record<string, number> = { basic: 0, intermediate: 1, advanced: 2 };
      return rank[a.tier] - rank[b.tier];
    });
    for (const question of ordered) {
      const item = el('div', 'gap-item');
      const head = el('div', 'assess-q');
      head.appendChild(el('span', undefined, question.text));
      head.appendChild(el('span', 'chip', question.tier));
      item.appendChild(head);
      const refs = el('div', 'gap-refs');
      for (const reference of question.references) {
        const control = cisControlFromReference(reference);
        if (control) {
          const link = el('a', undefined, reference + ' →');
          link.href = `../frameworks/cis/?q=${control}.`;
          refs.appendChild(link);
        } else {
          refs.appendChild(el('span', undefined, reference));
        }
      }
      item.appendChild(refs);
      todo.appendChild(item);
    }
    results.appendChild(todo);
  }
}

renderIntro();
show('intro');
