import csfRaw from './data/nist-csf.json';
import cisRaw from './data/cis.json';
import igsRaw from './data/cis-igs.json';
import vcisoRaw from './data/vciso-tasks.json';
import assessRaw from './data/assessment.json';
import cpgRaw from './data/assessment-cpg.json';
import programRaw from './data/security-program.json';
import roadmapKpisRaw from './data/roadmap-kpis.json';
import type { CisData, CsfData } from './lib/frameworks';
import { cisIg1Assessment } from './lib/assessment';
import type { Answers, AssessmentData } from './lib/assessment';
import {
  QUARTERS,
  cisPlan,
  csfPlan,
  gapsPlan,
  nextStatus,
  planLoad,
  planProgress,
  planToCsv,
  programMaturity,
  programPlan,
  quarterDateRange,
  statusCounts,
  totalHours,
  vcisoPlan,
} from './lib/roadmap';
import type { GoalDepth, ProgramGoal, PlanState, Quarter, RoadmapTask, StandardRef, TaskState, TaskStatus, VcisoTask } from './lib/roadmap';

const kpiDepth = roadmapKpisRaw as { csf: Record<string, GoalDepth>; cis: Record<string, GoalDepth> };

const csf = csfRaw as CsfData;
const cis = cisRaw as CisData;
const igs = igsRaw as Record<string, number>;
const vciso = vcisoRaw as VcisoTask[];

const byId = (id: string) => document.getElementById(id) as HTMLElement;
const sel = (id: string) => byId(id) as HTMLSelectElement;

type Source = 'program' | 'csf' | 'cis' | 'vciso' | 'gaps';

const program = programRaw as { goals: ProgramGoal[] };

/** Assessments that can seed a gap plan, and their data. */
const GAP_ASSESSMENTS: { id: string; name: string; data: AssessmentData }[] = [
  { id: 'ransomware', name: 'Ransomware readiness', data: assessRaw as AssessmentData },
  { id: 'cpg', name: 'CISA Performance Goals', data: cpgRaw as AssessmentData },
  { id: 'cis-ig1', name: 'CIS IG1 essentials', data: cisIg1Assessment(cis, igs) },
];

function gapsAssessmentId(): string {
  // Return an id from the known list (never the raw DOM value), so downstream
  // uses in hrefs and storage keys can never carry an untrusted string.
  const value = sel('plan-gaps-assessment')?.value;
  const match = GAP_ASSESSMENTS.find((a) => a.id === value);
  return match ? match.id : 'ransomware';
}

function assessmentAnswers(id: string): Answers {
  try {
    const raw =
      localStorage.getItem(`alphabetsoup:assessment:${id}`) ??
      (id === 'ransomware' ? localStorage.getItem('alphabetsoup:assessment') : null);
    return raw ? (JSON.parse(raw) as Answers) : {};
  } catch {
    return {};
  }
}

function source(): Source {
  return sel('plan-source').value as Source;
}

function storageKey(): string {
  const s = source();
  if (s === 'program') return 'alphabetsoup:roadmap:program';
  if (s === 'cis') return `alphabetsoup:roadmap:cis:ig${sel('plan-ig').value}`;
  if (s === 'vciso') return `alphabetsoup:roadmap:vciso:${sel('plan-pkg').value}`;
  if (s === 'gaps') return `alphabetsoup:roadmap:gaps:${gapsAssessmentId()}`;
  return 'alphabetsoup:roadmap:csf';
}

const metaKey = () => `${storageKey()}:meta`;

let state: PlanState = {};
let startMonth = '';

function thisMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function loadState(): void {
  try {
    state = JSON.parse(localStorage.getItem(storageKey()) ?? '{}') as PlanState;
  } catch {
    state = {};
  }
  try {
    startMonth = (JSON.parse(localStorage.getItem(metaKey()) ?? '{}') as { start?: string }).start ?? thisMonth();
  } catch {
    startMonth = thisMonth();
  }
  (byId('plan-start') as HTMLInputElement).value = startMonth;
}

function saveState(): void {
  try {
    localStorage.setItem(storageKey(), JSON.stringify(state));
    localStorage.setItem(metaKey(), JSON.stringify({ start: startMonth }));
  } catch {
    // Private browsing: in-memory only.
  }
}

function currentTasks(): RoadmapTask[] {
  const s = source();
  if (s === 'program') return programPlan(program);
  if (s === 'cis') return cisPlan(cis, igs, Number(sel('plan-ig').value) as 1 | 2 | 3, kpiDepth.cis);
  if (s === 'vciso') return vcisoPlan(vciso, sel('plan-pkg').value as 'Small' | 'Medium' | 'Large');
  if (s === 'gaps') {
    const assessment = GAP_ASSESSMENTS.find((a) => a.id === gapsAssessmentId());
    if (!assessment) return [];
    const answers = assessmentAnswers(assessment.id);
    return Object.keys(answers).length === 0 ? [] : gapsPlan(assessment.data, answers);
  }
  return csfPlan(csf, kpiDepth.csf);
}

function taskState(task: RoadmapTask): TaskState {
  return state[task.id] ?? { quarter: task.defaultQuarter, status: 'planned' };
}

function setTaskState(task: RoadmapTask, patch: Partial<TaskState>): void {
  state[task.id] = { ...taskState(task), ...patch };
  saveState();
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

/* ------------------------------ dashboard ----------------------------- */

function renderSummary(tasks: RoadmapTask[]): void {
  const summary = byId('plan-summary');
  summary.innerHTML = '';

  const progress = planProgress(tasks, state);
  const hours = totalHours(tasks);
  const counts = statusCounts(tasks, state);

  const line = el('div', 'plan-summary-line');
  line.textContent = `${progress.done}/${progress.total} done` + (hours > 0 ? ` · ${hours} estimated hours` : '');
  summary.appendChild(line);

  // One-line program maturity, rolled up from goal status.
  const maturity = programMaturity(tasks, state);
  const maturityLine = el('div', 'plan-maturity');
  maturityLine.appendChild(el('span', 'plan-maturity-level', maturity.level));
  maturityLine.appendChild(el('span', 'deck-sub', `program maturity · ${maturity.percent}%`));
  const mTrack = el('div', 'plan-maturity-track');
  const mFill = el('div', 'plan-maturity-fill');
  mFill.style.width = `${maturity.percent}%`;
  mTrack.appendChild(mFill);
  maturityLine.appendChild(mTrack);
  summary.appendChild(maturityLine);

  // Progress bar.
  const track = el('div', 'plan-progress-track');
  const fill = el('div', 'plan-progress-fill');
  fill.style.width = `${progress.total ? (progress.done / progress.total) * 100 : 0}%`;
  track.appendChild(fill);
  summary.appendChild(track);

  // Status breakdown.
  const chips = el('div', 'plan-status-row');
  const statusLabel: Record<TaskStatus, string> = { planned: 'planned', 'in-progress': 'in progress', done: 'done' };
  for (const status of ['planned', 'in-progress', 'done'] as TaskStatus[]) {
    const chip = el('span', `plan-stat plan-stat-${status}`);
    chip.appendChild(el('span', 'plan-stat-dot'));
    chip.appendChild(document.createTextNode(`${counts[status]} ${statusLabel[status]}`));
    chips.appendChild(chip);
  }
  summary.appendChild(chips);

  // Per-quarter load, to reveal an overloaded quarter at a glance.
  const load = planLoad(tasks, state);
  const quarters = source() === 'vciso' ? QUARTERS : QUARTERS.filter((q) => q !== 'Onboarding');
  const maxCount = Math.max(1, ...quarters.map((q) => load[q].count));
  const loadWrap = el('div', 'plan-load');
  for (const quarter of quarters) {
    const cell = el('div', 'plan-load-cell');
    const barWrap = el('div', 'plan-load-bar');
    const bar = el('div', 'plan-load-fill');
    bar.style.height = `${(load[quarter].count / maxCount) * 100}%`;
    barWrap.appendChild(bar);
    cell.appendChild(barWrap);
    cell.appendChild(el('div', 'plan-load-label', quarter));
    const detail = load[quarter].hours > 0 ? `${load[quarter].count} · ${load[quarter].hours}h` : String(load[quarter].count);
    cell.appendChild(el('div', 'plan-load-count', detail));
    loadWrap.appendChild(cell);
  }
  summary.appendChild(loadWrap);
}

/* -------------------------------- board ------------------------------- */

function groupsPresent(tasks: RoadmapTask[]): string[] {
  return [...new Set(tasks.map((t) => t.group))];
}

function refreshGroupFilter(tasks: RoadmapTask[]): void {
  const groupSel = sel('plan-group');
  const previous = groupSel.value;
  const groups = groupsPresent(tasks);
  groupSel.innerHTML = '';
  const all = document.createElement('option');
  all.value = '';
  all.textContent = 'all groups';
  groupSel.appendChild(all);
  for (const group of groups) {
    const option = document.createElement('option');
    option.value = group;
    option.textContent = group;
    groupSel.appendChild(option);
  }
  groupSel.value = groups.includes(previous) ? previous : '';
}

function standardChip(ref: StandardRef): HTMLElement {
  const isCsf = /csf/i.test(ref.framework);
  const isCis = /cis\b/i.test(ref.framework) && !/cpg/i.test(ref.framework);
  if (isCsf) {
    const a = el('a', 'std-chip', `${ref.framework} ${ref.ref}`);
    a.href = `../frameworks/nist-csf/?q=${ref.ref.toLowerCase()}`;
    return a;
  }
  if (isCis) {
    const num = ref.ref.match(/\d+/)?.[0];
    const a = el('a', 'std-chip', `${ref.framework} ${ref.ref}`);
    a.href = num ? `../frameworks/cis/?q=${num}.` : '../frameworks/cis/';
    return a;
  }
  return el('span', 'std-chip', `${ref.framework} ${ref.ref}`);
}

/** Expandable depth for a curated program goal: why, standards, KPIs, milestones. */
function depthNode(task: RoadmapTask): HTMLElement | null {
  const has = task.objective || task.why || (task.kpis && task.kpis.length) || (task.milestones && task.milestones.length) || (task.standards && task.standards.length);
  if (!has) return null;
  const details = el('details', 'task-depth');
  details.appendChild(el('summary', undefined, 'Objective, KPIs, and standards'));
  const body = el('div', 'task-depth-body');
  // Show the objective here when the card's detail line is not already it.
  if (task.objective && task.objective !== task.detail) {
    const p = el('p');
    p.appendChild(el('strong', undefined, 'Objective: '));
    p.appendChild(document.createTextNode(task.objective));
    body.appendChild(p);
  }
  if (task.why) {
    const p = el('p');
    p.appendChild(el('strong', undefined, 'Why: '));
    p.appendChild(document.createTextNode(task.why));
    body.appendChild(p);
  }
  if (task.standards && task.standards.length) {
    body.appendChild(el('div', 'depth-label', 'Aligns to'));
    const chips = el('div', 'std-chips');
    for (const ref of task.standards) chips.appendChild(standardChip(ref));
    body.appendChild(chips);
  }
  if (task.kpis && task.kpis.length) {
    body.appendChild(el('div', 'depth-label', 'Measure with'));
    const list = el('ul', 'depth-list');
    for (const kpi of task.kpis) list.appendChild(el('li', undefined, kpi));
    body.appendChild(list);
  }
  if (task.milestones && task.milestones.length) {
    body.appendChild(el('div', 'depth-label', 'Milestones'));
    const list = el('ul', 'depth-list depth-milestones');
    for (const step of task.milestones) list.appendChild(el('li', undefined, step));
    body.appendChild(list);
  }
  details.appendChild(body);
  return details;
}

function taskCard(task: RoadmapTask, quarters: Quarter[]): HTMLElement {
  const card = el('article', 'task-card');
  const status = taskState(task).status;
  card.classList.add(`is-${status}`);
  card.draggable = true;
  card.dataset.taskId = task.id;
  card.addEventListener('dragstart', (event) => {
    event.dataTransfer?.setData('text/plain', task.id);
    card.classList.add('dragging');
  });
  card.addEventListener('dragend', () => card.classList.remove('dragging'));

  const chip = el('button', 'status-chip', status.replace('-', ' '));
  chip.addEventListener('click', () => {
    setTaskState(task, { status: nextStatus(status) });
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

  card.appendChild(
    el(
      'div',
      'task-detail',
      task.hours != null
        ? `${task.detail.slice(0, 120)}${task.detail.length > 120 ? '...' : ''} (${task.hours}h)`
        : task.detail,
    ),
  );

  const depth = depthNode(task);
  if (depth) card.appendChild(depth);

  // Owner, target date, and a note toggle.
  const meta = el('div', 'task-meta');
  const owner = el('input', 'task-owner') as HTMLInputElement;
  owner.type = 'text';
  owner.placeholder = 'owner';
  owner.value = taskState(task).owner ?? '';
  owner.addEventListener('input', () => setTaskState(task, { owner: owner.value }));
  meta.appendChild(owner);

  const date = el('input', 'task-date') as HTMLInputElement;
  date.type = 'date';
  date.value = taskState(task).date ?? '';
  date.addEventListener('change', () => setTaskState(task, { date: date.value }));
  meta.appendChild(date);

  const move = el('select', 'quarter-select') as HTMLSelectElement;
  for (const q of quarters) {
    const option = document.createElement('option');
    option.value = q;
    option.textContent = q;
    option.selected = q === taskState(task).quarter;
    move.appendChild(option);
  }
  move.addEventListener('change', () => {
    setTaskState(task, { quarter: move.value as Quarter });
    render();
  });
  meta.appendChild(move);
  card.appendChild(meta);

  const noteBtn = el('button', 'task-note-btn', taskState(task).note ? '✎ note•' : '✎ note');
  const note = el('textarea', 'task-note') as HTMLTextAreaElement;
  note.placeholder = 'Note (stays in this browser)';
  note.value = taskState(task).note ?? '';
  note.hidden = !taskState(task).note;
  noteBtn.addEventListener('click', () => {
    note.hidden = !note.hidden;
    if (!note.hidden) note.focus();
  });
  note.addEventListener('input', () => {
    setTaskState(task, { note: note.value });
    noteBtn.textContent = note.value ? '✎ note•' : '✎ note';
  });
  card.appendChild(noteBtn);
  card.appendChild(note);

  return card;
}

function render(): void {
  const s = source();
  byId('ig-wrap').hidden = s !== 'cis';
  byId('pkg-wrap').hidden = s !== 'vciso';
  byId('gaps-wrap').hidden = s !== 'gaps';

  const tasks = currentTasks();
  const board = byId('plan-board');
  board.innerHTML = '';

  if (s === 'gaps' && tasks.length === 0) {
    byId('plan-summary').innerHTML = '';
    const started = Object.keys(assessmentAnswers(gapsAssessmentId())).length > 0;
    const wrap = el('div', 'plan-summary-line');
    wrap.append(started ? 'No gaps: nothing left to plan. ' : 'No answers found for this assessment yet. ');
    const link = document.createElement('a');
    link.href = `../assess/?a=${gapsAssessmentId()}`;
    link.textContent = started ? 'Review your assessment →' : 'Take this assessment first →';
    wrap.appendChild(link);
    byId('plan-summary').appendChild(wrap);
    return;
  }

  refreshGroupFilter(tasks);
  renderSummary(tasks);

  const groupFilter = sel('plan-group').value;
  const hideDone = (byId('plan-hide-done') as HTMLInputElement).checked;
  const visible = tasks.filter((task) => {
    if (groupFilter && task.group !== groupFilter) return false;
    if (hideDone && taskState(task).status === 'done') return false;
    return true;
  });

  const quarters = s === 'vciso' ? QUARTERS : QUARTERS.filter((q) => q !== 'Onboarding');
  for (const quarter of quarters) {
    const column = el('section', 'board-col');
    column.dataset.quarter = quarter;
    const inQuarter = visible.filter((task) => taskState(task).quarter === quarter);
    const head = el('h2', 'board-col-head');
    head.appendChild(el('span', undefined, `${quarter} · ${inQuarter.length}`));
    const range = quarterDateRange(startMonth, quarter);
    if (range) head.appendChild(el('span', 'board-col-date', range));
    column.appendChild(head);

    // Drop target.
    column.addEventListener('dragover', (event) => {
      event.preventDefault();
      column.classList.add('drop-hover');
    });
    column.addEventListener('dragleave', () => column.classList.remove('drop-hover'));
    column.addEventListener('drop', (event) => {
      event.preventDefault();
      column.classList.remove('drop-hover');
      const id = event.dataTransfer?.getData('text/plain');
      const task = tasks.find((t) => t.id === id);
      if (task && taskState(task).quarter !== quarter) {
        setTaskState(task, { quarter });
        render();
      }
    });

    for (const task of inQuarter) column.appendChild(taskCard(task, quarters));
    board.appendChild(column);
  }
}

/* ---------------------------- import / export ------------------------- */

function download(name: string, content: string, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

function exportJson(): void {
  const payload = {
    source: source(),
    ig: sel('plan-ig').value,
    pkg: sel('plan-pkg').value,
    gaps: gapsAssessmentId(),
    start: startMonth,
    state,
  };
  download(`roadmap-${source()}.json`, JSON.stringify(payload, null, 2), 'application/json');
}

function importJson(file: File): void {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(String(reader.result)) as {
        source?: Source;
        ig?: string;
        pkg?: string;
        gaps?: string;
        start?: string;
        state?: PlanState;
      };
      if (parsed.source) sel('plan-source').value = parsed.source;
      if (parsed.ig) sel('plan-ig').value = parsed.ig;
      if (parsed.pkg) sel('plan-pkg').value = parsed.pkg;
      if (parsed.gaps) sel('plan-gaps-assessment').value = parsed.gaps;
      state = parsed.state ?? {};
      startMonth = parsed.start ?? thisMonth();
      (byId('plan-start') as HTMLInputElement).value = startMonth;
      saveState();
      render();
    } catch {
      alert('That file could not be read as a saved roadmap.');
    }
  };
  reader.readAsText(file);
}

/* -------------------------------- boot -------------------------------- */

function main(): void {
  const params = new URLSearchParams(location.search);
  const requested = params.get('source');
  if (requested && ['program', 'csf', 'cis', 'vciso', 'gaps'].includes(requested)) {
    sel('plan-source').value = requested;
  }
  const requestedAssessment = params.get('a');
  if (requestedAssessment && GAP_ASSESSMENTS.some((a) => a.id === requestedAssessment)) {
    sel('plan-gaps-assessment').value = requestedAssessment;
  }

  loadState();
  render();

  for (const id of ['plan-source', 'plan-ig', 'plan-pkg', 'plan-gaps-assessment']) {
    byId(id).addEventListener('change', () => {
      loadState();
      render();
    });
  }
  for (const id of ['plan-group', 'plan-hide-done']) {
    byId(id).addEventListener('change', render);
  }
  (byId('plan-start') as HTMLInputElement).addEventListener('change', () => {
    startMonth = (byId('plan-start') as HTMLInputElement).value || thisMonth();
    saveState();
    render();
  });

  byId('plan-export').addEventListener('click', () => download('roadmap.csv', planToCsv(currentTasks(), state), 'text/csv'));
  byId('plan-export-json').addEventListener('click', exportJson);
  const importInput = byId('plan-import') as HTMLInputElement;
  importInput.addEventListener('change', () => {
    if (importInput.files && importInput.files[0]) importJson(importInput.files[0]);
  });
  byId('plan-print').addEventListener('click', () => window.print());
  byId('plan-reset').addEventListener('click', () => {
    if (!confirm('Reset this plan? Statuses, owners, dates, and notes for this plan will be cleared.')) return;
    state = {};
    saveState();
    render();
  });
}

main();
