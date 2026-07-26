import csfRaw from './data/nist-csf.json';
import cisRaw from './data/cis.json';
import igsRaw from './data/cis-igs.json';
import vcisoRaw from './data/vciso-tasks.json';
import assessRaw from './data/assessment.json';
import cpgRaw from './data/assessment-cpg.json';
import cmmcRaw from './data/assessment-800171.json';
import ceRaw from './data/assessment-cyber-essentials.json';
import ztmmRaw from './data/assessment-ztmm.json';
import ssdfRaw from './data/assessment-ssdf.json';
import pciRaw from './data/assessment-pci-dss.json';
import programRaw from './data/security-program.json';
import roadmapKpisRaw from './data/roadmap-kpis.json';
import type { CisData, CsfData } from './lib/frameworks';
import { cisControlsAssessment, cisIg1Assessment, csfAssessment } from './lib/assessment';
import { copyWithToast } from './lib/share';
import type { Answers, AssessmentData } from './lib/assessment';
import {
  KPI_STATUS_CYCLE,
  QUARTERS,
  cisPlan,
  csfPlan,
  gapsPlan,
  kpiAttainmentCounts,
  milestoneProgress,
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
import type { GoalDepth, KpiStatus, ProgramGoal, PlanState, Quarter, RoadmapTask, StandardRef, TaskState, TaskStatus, VcisoTask } from './lib/roadmap';

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
  { id: 'cis-v8', name: 'CIS Controls v8 (all safeguards)', data: cisControlsAssessment(cis, igs) },
  { id: 'nist-csf', name: 'NIST CSF 2.0', data: csfAssessment(csf) },
  { id: 'nist-800171', name: 'NIST 800-171 / CMMC', data: cmmcRaw as AssessmentData },
  { id: 'cyber-essentials', name: 'CISA Cyber Essentials', data: ceRaw as AssessmentData },
  { id: 'zero-trust', name: 'CISA Zero Trust Maturity Model', data: ztmmRaw as AssessmentData },
  { id: 'ssdf', name: 'NIST SSDF (secure development)', data: ssdfRaw as AssessmentData },
  { id: 'pci-dss', name: 'PCI DSS v4.0', data: pciRaw as AssessmentData },
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

function kpiStatusOf(task: RoadmapTask, index: number): KpiStatus {
  return taskState(task).kpiStatus?.[String(index)] ?? 'unmet';
}

function setKpiStatus(task: RoadmapTask, index: number, value: KpiStatus): void {
  const current = taskState(task);
  setTaskState(task, { kpiStatus: { ...current.kpiStatus, [String(index)]: value } });
}

/** Re-render only the dashboard summary (used when a KPI mark changes, so open cards stay open). */
function refreshSummary(): void {
  renderSummary(currentTasks());
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
  const maturity = programMaturity(tasks, state);
  const kc = kpiAttainmentCounts(tasks, state);
  const mp = milestoneProgress(tasks, state);

  const metrics = el('div', 'plan-metrics');
  const tile = (label: string): HTMLElement => {
    const t = el('div', 'plan-tile');
    t.appendChild(el('div', 'plan-tile-label', label));
    metrics.appendChild(t);
    return t;
  };

  // Progress tile: headline percent, the count line (with any effort estimate), and a bar.
  const pctDone = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  const progTile = tile('Progress');
  progTile.appendChild(el('div', 'plan-tile-value', `${pctDone}%`));
  progTile.appendChild(
    el('div', 'plan-summary-line', `${progress.done}/${progress.total} done` + (hours > 0 ? ` · ${hours} estimated hours` : '')),
  );
  const track = el('div', 'plan-progress-track');
  const fill = el('div', 'plan-progress-fill');
  fill.style.width = `${pctDone}%`;
  track.appendChild(fill);
  progTile.appendChild(track);

  // Maturity tile: level word driven by KPI attainment where KPIs exist.
  const matTile = tile('Maturity');
  const maturityBox = el('div', 'plan-maturity');
  maturityBox.appendChild(el('div', 'plan-maturity-level', maturity.level));
  maturityBox.appendChild(
    el('div', 'deck-sub', `${kc.total > 0 ? 'maturity (KPI attainment)' : 'program maturity'} · ${maturity.percent}%`),
  );
  const mTrack = el('div', 'plan-maturity-track');
  const mFill = el('div', 'plan-maturity-fill');
  mFill.style.width = `${maturity.percent}%`;
  mTrack.appendChild(mFill);
  maturityBox.appendChild(mTrack);
  matTile.appendChild(maturityBox);

  // KPI attainment tile (only when the source carries KPIs).
  if (kc.total > 0) {
    const kpiTile = tile('KPIs met');
    kpiTile.appendChild(el('div', 'plan-tile-value', `${kc.met}/${kc.total}`));
    kpiTile.appendChild(
      el('div', 'deck-sub plan-kpi-counts', `KPIs: ${kc.met} met · ${kc.partial} partial · ${kc.unmet} unmet (of ${kc.total})`),
    );
  }

  // Milestone rollup tile (only when the source carries milestones).
  if (mp.total > 0) {
    const msTile = tile('Milestones');
    msTile.appendChild(el('div', 'plan-tile-value', `${mp.done}/${mp.total}`));
    msTile.appendChild(el('div', 'deck-sub plan-milestone-counts', `Milestones: ${mp.done} of ${mp.total} done`));
  }

  // Status breakdown tile: headline the active (in-progress) count, then the split.
  const statusTile = tile('Status');
  statusTile.appendChild(el('div', 'plan-tile-value', `${counts['in-progress']}`));
  const chips = el('div', 'plan-status-row');
  const statusLabel: Record<TaskStatus, string> = { planned: 'planned', 'in-progress': 'in progress', done: 'done' };
  for (const status of ['planned', 'in-progress', 'done'] as TaskStatus[]) {
    const chip = el('span', `plan-stat plan-stat-${status}`);
    chip.appendChild(el('span', 'plan-stat-dot'));
    chip.appendChild(document.createTextNode(`${counts[status]} ${statusLabel[status]}`));
    chips.appendChild(chip);
  }
  statusTile.appendChild(chips);

  summary.appendChild(metrics);

  // Capacity-by-quarter card: bars sized by hours when estimates exist, else by
  // task count, each labeled with its calendar range so it reads as a timeline.
  const load = planLoad(tasks, state);
  const quarters = source() === 'vciso' ? QUARTERS : QUARTERS.filter((q) => q !== 'Onboarding');
  const byHours = hours > 0;
  const value = (q: Quarter) => (byHours ? load[q].hours : load[q].count);
  const max = Math.max(1, ...quarters.map(value));

  const capCard = el('div', 'plan-capacity-card');
  const capHead = el('div', 'plan-capacity-head');
  capHead.appendChild(el('div', 'plan-tile-label', 'Capacity by quarter'));
  if (byHours) {
    const heaviest = quarters.reduce((a, b) => (load[b].hours > load[a].hours ? b : a), quarters[0]);
    capHead.appendChild(
      el('div', 'deck-sub plan-capacity', `Total effort: ${hours}h · heaviest quarter: ${heaviest} (${load[heaviest].hours}h)`),
    );
  }
  capCard.appendChild(capHead);

  const loadWrap = el('div', 'plan-load');
  for (const quarter of quarters) {
    const cell = el('div', 'plan-load-cell');
    const barWrap = el('div', 'plan-load-bar');
    const bar = el('div', 'plan-load-fill');
    bar.style.height = `${(value(quarter) / max) * 100}%`;
    barWrap.appendChild(bar);
    cell.appendChild(barWrap);
    cell.appendChild(el('div', 'plan-load-label', quarter));
    const detail = load[quarter].hours > 0 ? `${load[quarter].count} · ${load[quarter].hours}h` : String(load[quarter].count);
    cell.appendChild(el('div', 'plan-load-count', detail));
    const range = quarterDateRange(startMonth, quarter);
    if (range && range !== 'Setup') cell.appendChild(el('div', 'plan-load-date', range));
    loadWrap.appendChild(cell);
  }
  capCard.appendChild(loadWrap);
  summary.appendChild(capCard);
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

function milestoneCountText(task: RoadmapTask): string {
  const marks = taskState(task).milestonesDone ?? {};
  const done = (task.milestones ?? []).filter((_, i) => marks[String(i)]).length;
  return `${done}/${task.milestones?.length ?? 0} milestones`;
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
    body.appendChild(el('div', 'depth-label', 'KPIs to measure (mark attainment)'));
    const list = el('ul', 'depth-list kpi-list');
    task.kpis.forEach((kpi, index) => {
      const li = el('li', 'kpi-row');
      li.appendChild(el('span', 'kpi-text', kpi));
      const ctrl = el('div', 'kpi-ctrl');
      const current = kpiStatusOf(task, index);
      for (const value of KPI_STATUS_CYCLE) {
        const btn = el('button', `kpi-btn kpi-${value}`, value);
        btn.type = 'button';
        if (current === value) btn.classList.add('active');
        btn.addEventListener('click', () => {
          setKpiStatus(task, index, value);
          ctrl.querySelectorAll('.kpi-btn').forEach((b) => b.classList.remove('active'));
          btn.classList.add('active');
          refreshSummary();
        });
        ctrl.appendChild(btn);
      }
      li.appendChild(ctrl);
      list.appendChild(li);
    });
    body.appendChild(list);
  }
  if (task.milestones && task.milestones.length) {
    body.appendChild(el('div', 'depth-label', 'Milestones (check off as you go)'));
    const list = el('ul', 'depth-list depth-milestones');
    task.milestones.forEach((step, index) => {
      const li = el('li', 'milestone-row');
      const label = el('label', 'milestone-label');
      const cb = el('input') as HTMLInputElement;
      cb.type = 'checkbox';
      cb.checked = Boolean(taskState(task).milestonesDone?.[String(index)]);
      if (cb.checked) li.classList.add('done');
      cb.addEventListener('change', () => {
        setTaskState(task, { milestonesDone: { ...taskState(task).milestonesDone, [String(index)]: cb.checked } });
        li.classList.toggle('done', cb.checked);
        const card = cb.closest('.task-card');
        const count = card?.querySelector('.task-milestones');
        if (count) count.textContent = milestoneCountText(task);
        refreshSummary();
      });
      label.appendChild(cb);
      label.appendChild(el('span', undefined, step));
      li.appendChild(label);
      list.appendChild(li);
    });
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

  if (task.milestones?.length) {
    card.appendChild(el('div', 'task-milestones deck-sub', milestoneCountText(task)));
  }
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
  byId('plan-copy').addEventListener('click', () => {
    const tasks = currentTasks();
    const progress = planProgress(tasks, state);
    const maturity = programMaturity(tasks, state);
    const kc = kpiAttainmentCounts(tasks, state);
    const label = (sel('plan-source').selectedOptions[0]?.textContent ?? 'Roadmap').trim();
    const lines = [
      `${label} roadmap`,
      `Maturity: ${maturity.level} (${maturity.percent}%)`,
      `Progress: ${progress.done}/${progress.total} goals done`,
      ...(kc.total > 0 ? [`KPIs: ${kc.met} met, ${kc.partial} partial, ${kc.unmet} unmet`] : []),
      `cybersecurityalphabetsoup.com/roadmap/`,
    ];
    void copyWithToast(lines.join('\n'), 'Roadmap summary copied');
  });
  const importInput = byId('plan-import') as HTMLInputElement;
  importInput.addEventListener('change', () => {
    if (importInput.files && importInput.files[0]) importJson(importInput.files[0]);
  });
  // The visible control is a real button; the input stays hidden and is opened
  // programmatically, so the flow works by keyboard as well as by mouse.
  byId('plan-import-btn').addEventListener('click', () => importInput.click());
  byId('plan-print').addEventListener('click', () => window.print());
  byId('plan-reset').addEventListener('click', () => {
    if (!confirm('Reset this plan? Statuses, owners, dates, and notes for this plan will be cleared.')) return;
    state = {};
    saveState();
    render();
  });
}

main();
