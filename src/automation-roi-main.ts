import dataRaw from './data/automation-roi.json';
import type { AutomationData, ScoredTask, Task } from './lib/automation-roi';
import { backlogCsv, capacityModel, rankBacklog } from './lib/automation-roi';

const data = dataRaw as AutomationData;

const STATE_KEY = 'alphabetsoup:automation-roi:tasks';

const categoryIds = new Set(data.categories.map((c) => c.id));
const sensitivityIds = new Set(data.sensitivities.map((s) => s.id));

const EXAMPLES: Omit<Task, 'id'>[] = [
  { name: 'Phishing report triage', category: 'phishing', volume: 120, minutes: 12, sensitivity: 'medium' },
  { name: 'Weekly metrics report', category: 'reporting', volume: 4, minutes: 180, sensitivity: 'low' },
  { name: 'SOC 2 evidence collection', category: 'evidence', volume: 30, minutes: 20, sensitivity: 'medium' },
];

let seq = 0;
const newId = (): string => `t-${seq++}-${Math.round(performance.now())}`;

let tasks: Task[] = [];

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;

function esc(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ------------------------------- state --------------------------------

function persist(): void {
  localStorage.setItem(STATE_KEY, JSON.stringify(tasks));
}

function loadState(): void {
  try {
    const raw = JSON.parse(localStorage.getItem(STATE_KEY) ?? 'null') as unknown;
    if (Array.isArray(raw)) {
      tasks = raw
        .filter((t): t is Task => !!t && typeof t === 'object')
        .map((t) => ({
          id: typeof t.id === 'string' ? t.id : newId(),
          name: typeof t.name === 'string' ? t.name : '',
          category: categoryIds.has(t.category) ? t.category : data.categories[0].id,
          volume: Number.isFinite(t.volume) ? t.volume : 0,
          minutes: Number.isFinite(t.minutes) ? t.minutes : 0,
          sensitivity: sensitivityIds.has(t.sensitivity) ? t.sensitivity : 'medium',
        }));
      return;
    }
  } catch {
    /* ignore */
  }
  // First visit: seed with example tasks so the output is populated.
  tasks = EXAMPLES.map((e) => ({ id: newId(), ...e }));
}

// ------------------------------- rows ---------------------------------

const options = (items: { id: string; name: string }[], selected: string): string =>
  items.map((i) => `<option value="${i.id}"${i.id === selected ? ' selected' : ''}>${esc(i.name)}</option>`).join('');

function rowHtml(task: Task): string {
  return `
    <div class="ar-row" data-id="${task.id}">
      <div class="ar-cell-name"><span class="ar-row-labels">Task</span><input type="text" data-field="name" value="${esc(task.name)}" placeholder="e.g. Alert triage" aria-label="Task name" /></div>
      <div><span class="ar-row-labels">Category</span><select data-field="category" aria-label="Category">${options(data.categories, task.category)}</select></div>
      <div><span class="ar-row-labels">Volume/mo</span><input type="number" min="0" step="1" data-field="volume" value="${task.volume}" aria-label="Monthly volume" /></div>
      <div><span class="ar-row-labels">Min each</span><input type="number" min="0" step="1" data-field="minutes" value="${task.minutes}" aria-label="Minutes each" /></div>
      <div><span class="ar-row-labels">Error risk</span><select data-field="sensitivity" aria-label="Error sensitivity">${options(data.sensitivities, task.sensitivity)}</select></div>
      <button type="button" class="ar-del" data-action="delete" aria-label="Remove task">&times;</button>
    </div>`;
}

function renderRows(): void {
  $('#rows').innerHTML = tasks.map(rowHtml).join('');
}

function initRows(): void {
  const host = $('#rows');
  const onEdit = (event: Event): void => {
    const el = event.target as HTMLInputElement | HTMLSelectElement;
    const field = (el as HTMLElement).dataset?.field as keyof Task | undefined;
    if (!field) return;
    const task = tasks.find((t) => t.id === (el.closest('.ar-row') as HTMLElement).dataset.id);
    if (!task) return;
    if (field === 'volume' || field === 'minutes') {
      task[field] = Math.max(0, Number((el as HTMLInputElement).value) || 0);
    } else if (field === 'name') {
      task.name = (el as HTMLInputElement).value;
    } else if (field === 'category') {
      task.category = (el as HTMLSelectElement).value;
    } else if (field === 'sensitivity') {
      task.sensitivity = (el as HTMLSelectElement).value;
    }
    persist();
    renderOutput();
  };
  host.addEventListener('input', onEdit);
  host.addEventListener('change', onEdit);
  host.addEventListener('click', (event) => {
    const btn = (event.target as HTMLElement).closest('[data-action="delete"]');
    if (!btn) return;
    const id = (btn.closest('.ar-row') as HTMLElement).dataset.id;
    tasks = tasks.filter((t) => t.id !== id);
    persist();
    renderRows();
    renderOutput();
  });

  $('#add-row').addEventListener('click', () => {
    const task: Task = { id: newId(), name: '', category: data.categories[0].id, volume: 0, minutes: 0, sensitivity: 'medium' };
    tasks.push(task);
    persist();
    renderRows();
    renderOutput();
    const input = $('#rows').querySelector(`.ar-row[data-id="${task.id}"] input[data-field="name"]`) as HTMLInputElement | null;
    input?.focus();
  });
}

// ------------------------------- output -------------------------------

function itemHtml(s: ScoredTask, index: number): string {
  const name = s.task.name.trim() || 'Untitled task';
  const pct = Math.round(s.automatableFraction * 100);
  return `
    <li class="ar-item">
      <span class="ar-item-num">${index + 1}</span>
      <div>
        <div class="ar-item-top">
          <span class="ar-item-name">${esc(name)}</span>
          <span class="ar-tag">${esc(s.category.name)}</span>
          ${s.humanGate ? '<span class="ar-tag gate">human gate</span>' : ''}
          <span class="ar-hours">${s.hoursSaved} hrs/mo saved</span>
        </div>
        <p class="ar-math">${s.task.volume}/mo &times; ${s.task.minutes} min &divide; 60 = ${s.rawHours} hrs now &middot; &times; ${pct}% automatable = ${s.hoursSaved} hrs saved</p>
        <p class="ar-pattern"><b>${esc(s.pattern.name)}:</b> ${esc(s.pattern.blurb)}</p>
        <details class="ar-skeleton">
          <summary>Playbook skeleton</summary>
          <ol>${s.pattern.skeleton.map((step) => `<li>${esc(step)}</li>`).join('')}</ol>
        </details>
      </div>
    </li>`;
}

function renderOutput(): void {
  const panel = $('#output');
  const scored = rankBacklog(data, tasks);
  const withHours = scored.filter((s) => s.rawHours > 0);

  if (withHours.length === 0) {
    panel.innerHTML =
      '<p class="ar-empty">Add at least one task with a monthly volume and handle time to see the ranked backlog.</p>';
    return;
  }

  const cap = capacityModel(data, withHours);
  panel.innerHTML = `
    <div class="ar-actions print-hide">
      <button type="button" class="ar-btn ar-btn-primary" id="ar-print">Print backlog</button>
      <button type="button" class="ar-btn" id="ar-csv">Export as CSV</button>
    </div>
    <div class="ar-doc">
      <h3 class="ar-section-head" style="margin-top:0;">Capacity model</h3>
      <div class="ar-capacity">
        <div class="ar-stat"><div class="ar-stat-num">${cap.currentHours}</div><div class="ar-stat-lbl">hours/month on this work today</div></div>
        <div class="ar-stat"><div class="ar-stat-num">${cap.savedHours}</div><div class="ar-stat-lbl">hours/month automation could return</div></div>
        <div class="ar-stat"><div class="ar-stat-num">${cap.savedFte}</div><div class="ar-stat-lbl">full-time equivalents returned</div></div>
      </div>
      <p class="ar-cap-note">Based on ${cap.fteHours} productive hours per person-month. Currently about ${cap.currentFte} FTE of effort; automating the backlog frees roughly ${cap.savedFte} of that for higher-value work.</p>

      <h3 class="ar-block-head">Ranked automation backlog</h3>
      <ol class="ar-backlog">${withHours.map(itemHtml).join('')}</ol>
    </div>`;

  $('#ar-print').addEventListener('click', () => window.print());
  $('#ar-csv').addEventListener('click', () => {
    const blob = new Blob([backlogCsv(withHours)], { type: 'text/csv' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'automation-backlog.csv';
    link.click();
    URL.revokeObjectURL(link.href);
  });
}

// -------------------------------- boot --------------------------------

loadState();
renderRows();
initRows();
renderOutput();
