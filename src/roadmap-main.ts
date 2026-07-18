import csfRaw from './data/nist-csf.json';
import cisRaw from './data/cis.json';
import igsRaw from './data/cis-igs.json';
import vcisoRaw from './data/vciso-tasks.json';
import assessRaw from './data/assessment.json';
import type { CisData, CsfData } from './lib/frameworks';
import type { Answers, AssessmentData } from './lib/assessment';
import {
  QUARTERS,
  cisPlan,
  csfPlan,
  gapsPlan,
  nextStatus,
  planProgress,
  planToCsv,
  totalHours,
  vcisoPlan,
} from './lib/roadmap';
import type { PlanState, Quarter, RoadmapTask, TaskStatus, VcisoTask } from './lib/roadmap';

const csf = csfRaw as CsfData;
const cis = cisRaw as CisData;
const igs = igsRaw as Record<string, number>;
const vciso = vcisoRaw as VcisoTask[];
const assessment = assessRaw as AssessmentData;

const byId = (id: string) => document.getElementById(id) as HTMLElement;

type Source = 'csf' | 'cis' | 'vciso' | 'gaps';

function assessmentAnswers(): Answers {
  try {
    const raw =
      localStorage.getItem('alphabetsoup:assessment:ransomware') ??
      localStorage.getItem('alphabetsoup:assessment');
    return raw ? (JSON.parse(raw) as Answers) : {};
  } catch {
    return {};
  }
}

function storageKey(): string {
  const source = (byId('plan-source') as HTMLSelectElement).value as Source;
  if (source === 'cis') return `alphabetsoup:roadmap:cis:ig${(byId('plan-ig') as HTMLSelectElement).value}`;
  if (source === 'vciso') return `alphabetsoup:roadmap:vciso:${(byId('plan-pkg') as HTMLSelectElement).value}`;
  if (source === 'gaps') return 'alphabetsoup:roadmap:gaps';
  return 'alphabetsoup:roadmap:csf';
}

let state: PlanState = {};

function loadState(): void {
  try {
    state = JSON.parse(localStorage.getItem(storageKey()) ?? '{}') as PlanState;
  } catch {
    state = {};
  }
}

function saveState(): void {
  try {
    localStorage.setItem(storageKey(), JSON.stringify(state));
  } catch {
    // Private browsing: in-memory only.
  }
}

function currentTasks(): RoadmapTask[] {
  const source = (byId('plan-source') as HTMLSelectElement).value as Source;
  if (source === 'cis') {
    return cisPlan(cis, igs, Number((byId('plan-ig') as HTMLSelectElement).value) as 1 | 2 | 3);
  }
  if (source === 'vciso') {
    return vcisoPlan(vciso, (byId('plan-pkg') as HTMLSelectElement).value as 'Small' | 'Medium' | 'Large');
  }
  if (source === 'gaps') {
    const answers = assessmentAnswers();
    return Object.keys(answers).length === 0 ? [] : gapsPlan(assessment, answers);
  }
  return csfPlan(csf);
}

function taskState(task: RoadmapTask): { quarter: Quarter; status: TaskStatus } {
  return state[task.id] ?? { quarter: task.defaultQuarter, status: 'planned' };
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

function render(): void {
  const source = (byId('plan-source') as HTMLSelectElement).value as Source;
  byId('ig-wrap').hidden = source !== 'cis';
  byId('pkg-wrap').hidden = source !== 'vciso';

  const tasks = currentTasks();
  const progress = planProgress(tasks, state);
  const hours = totalHours(tasks);
  const summary = byId('plan-summary');
  summary.innerHTML = '';

  const board = byId('plan-board');
  board.innerHTML = '';

  if (source === 'gaps' && tasks.length === 0) {
    const started = Object.keys(assessmentAnswers()).length > 0;
    summary.append(started ? 'No gaps: every question is a yes. ' : 'No assessment answers found yet. ');
    const link = document.createElement('a');
    link.href = '../assess/?a=ransomware';
    link.textContent = started ? 'Review your assessment →' : 'Take the readiness assessment first →';
    summary.appendChild(link);
    return;
  }
  summary.textContent =
    `${progress.done}/${progress.total} done` + (hours > 0 ? ` · ${hours} estimated hours` : '');
  const quarters = source === 'vciso' ? QUARTERS : QUARTERS.filter((q) => q !== 'Onboarding');
  for (const quarter of quarters) {
    const column = el('section', 'board-col');
    const inQuarter = tasks.filter((task) => taskState(task).quarter === quarter);
    column.appendChild(el('h2', 'board-col-head', `${quarter} · ${inQuarter.length}`));
    for (const task of inQuarter) {
      const card = el('article', 'task-card');
      const status = taskState(task).status;
      card.classList.add(`is-${status}`);

      const chip = el('button', 'status-chip', status.replace('-', ' '));
      chip.addEventListener('click', () => {
        state[task.id] = { ...taskState(task), status: nextStatus(status) };
        saveState();
        render();
      });
      card.appendChild(chip);

      const label = el('div', 'task-label');
      if (task.link) {
        const link = el('a', undefined, task.label);
        link.href = task.link;
        label.appendChild(link);
      } else {
        label.textContent = task.label;
      }
      card.appendChild(label);
      card.appendChild(el('div', 'task-detail', task.hours != null ? `${task.detail.slice(0, 120)}${task.detail.length > 120 ? '...' : ''} (${task.hours}h)` : task.detail));

      const move = el('select', 'quarter-select') as HTMLSelectElement;
      for (const q of quarters) {
        const option = document.createElement('option');
        option.value = q;
        option.textContent = q;
        option.selected = q === quarter;
        move.appendChild(option);
      }
      move.addEventListener('change', () => {
        state[task.id] = { ...taskState(task), quarter: move.value as Quarter };
        saveState();
        render();
      });
      card.appendChild(move);
      column.appendChild(card);
    }
    board.appendChild(column);
  }
}

function download(name: string, content: string): void {
  const blob = new Blob([content], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

function main(): void {
  const requested = new URLSearchParams(location.search).get('source');
  if (requested && ['csf', 'cis', 'vciso', 'gaps'].includes(requested)) {
    (byId('plan-source') as HTMLSelectElement).value = requested;
  }
  loadState();
  render();
  for (const id of ['plan-source', 'plan-ig', 'plan-pkg']) {
    byId(id).addEventListener('change', () => {
      loadState();
      render();
    });
  }
  byId('plan-export').addEventListener('click', () => {
    download('roadmap.csv', planToCsv(currentTasks(), state));
  });
  byId('plan-print').addEventListener('click', () => window.print());
  byId('plan-reset').addEventListener('click', () => {
    state = {};
    saveState();
    render();
  });
}

main();
