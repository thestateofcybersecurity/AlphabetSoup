import dataRaw from './data/board-metrics.json';
import type { BoardMetricsData, Metric, MetricReading, Status } from './lib/board-metrics';
import { formatValue, prioritize, read, STATUS_LABEL, talkTrack, tally } from './lib/board-metrics';
import { escAttr } from './lib/escape';

const data = dataRaw as BoardMetricsData;

const STATE_KEY = 'alphabetsoup:board-metrics:state';
const REGISTER_KEY = 'alphabetsoup:board-metrics:register';

// Spec starter set: coverage, MTTR, phishing, patch latency, vendor risk, audit aging.
const DEFAULT_SELECTED = [
  'edr-critical-coverage',
  'mttr-critical-incidents',
  'phishing-failure-rate',
  'critical-patch-latency',
  'high-risk-vendors-unremediated',
  'overdue-audit-findings',
];

interface ReportMeta {
  org: string;
  period: string;
  highlight: string;
  ask: string;
}
interface ValuePair {
  current?: number;
  prior?: number;
}

const byId = new Map(data.metrics.map((m) => [m.id, m]));
const validDefault = DEFAULT_SELECTED.filter((id) => byId.has(id));

let selected = new Set<string>(validDefault);
let values: Record<string, ValuePair> = {};
let meta: ReportMeta = { org: '', period: '', highlight: '', ask: '' };

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;

/** Numbers only in the value attribute; localStorage is user-editable. */
function numAttr(v: unknown): string {
  return typeof v === 'number' && Number.isFinite(v) ? String(v) : '';
}

function esc(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

const num = (raw: string): number | undefined => {
  if (raw.trim() === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
};

// ------------------------------- state --------------------------------

function persistState(): void {
  localStorage.setItem(STATE_KEY, JSON.stringify({ selected: [...selected], values, meta }));
}

function loadState(): void {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STATE_KEY) ?? 'null');
    if (!raw || typeof raw !== 'object') return;
    const s = raw as { selected?: unknown; values?: unknown; meta?: unknown };
    if (Array.isArray(s.selected)) {
      selected = new Set(s.selected.filter((x): x is string => typeof x === 'string' && byId.has(x)));
    }
    if (s.values && typeof s.values === 'object') {
      values = {};
      for (const [id, v] of Object.entries(s.values as Record<string, unknown>)) {
        if (!byId.has(id) || !v || typeof v !== 'object') continue;
        const pair = v as ValuePair;
        values[id] = {
          current: typeof pair.current === 'number' ? pair.current : undefined,
          prior: typeof pair.prior === 'number' ? pair.prior : undefined,
        };
      }
    }
    if (s.meta && typeof s.meta === 'object') {
      const m = s.meta as Partial<ReportMeta>;
      meta = {
        org: typeof m.org === 'string' ? m.org : '',
        period: typeof m.period === 'string' ? m.period : '',
        highlight: typeof m.highlight === 'string' ? m.highlight : '',
        ask: typeof m.ask === 'string' ? m.ask : '',
      };
    }
  } catch {
    /* ignore malformed state */
  }
}

// ------------------------------- picker -------------------------------

function renderPicker(): void {
  const host = $('#picker');
  const categories = [...new Set(data.metrics.map((m) => m.category))];
  host.innerHTML = categories
    .map((cat) => {
      const opts = data.metrics
        .filter((m) => m.category === cat)
        .map(
          (m) => `
          <label class="bm-pick${selected.has(m.id) ? ' selected' : ''}" title="${escAttr(m.definition)}">
            <input type="checkbox" value="${m.id}" ${selected.has(m.id) ? 'checked' : ''} />
            ${esc(m.short)}
          </label>`,
        )
        .join('');
      return `<div class="bm-pick-group"><p class="bm-pick-cat">${esc(cat)}</p><div class="bm-pick-opts">${opts}</div></div>`;
    })
    .join('');

  host.addEventListener('change', (event) => {
    const input = event.target as HTMLInputElement;
    if (input.type !== 'checkbox') return;
    if (input.checked) selected.add(input.value);
    else selected.delete(input.value);
    input.closest('.bm-pick')?.classList.toggle('selected', input.checked);
    persistState();
    renderInputs();
    renderReport();
  });
}

// ------------------------------- inputs -------------------------------

function selectedMetrics(): Metric[] {
  return data.metrics.filter((m) => selected.has(m.id));
}

function renderInputs(): void {
  const host = $('#inputs');
  const metrics = selectedMetrics();
  if (metrics.length === 0) {
    host.innerHTML = '<li class="bm-empty">Pick at least one metric above to enter values.</li>';
    return;
  }
  host.innerHTML = metrics
    .map((m) => {
      const v = values[m.id] ?? {};
      const unit = m.unit === '%' ? '%' : m.unit;
      return `
      <li class="bm-input-row" data-id="${m.id}">
        <div class="bm-input-name">${esc(m.name)}<small>${esc(m.question)}</small></div>
        <div class="bm-num"><span>This period (${esc(unit)})</span><input type="number" step="any" data-field="current" value="${numAttr(v.current)}" aria-label="${escAttr(m.name)} this period" /></div>
        <div class="bm-num"><span>Last period</span><input type="number" step="any" data-field="prior" value="${numAttr(v.prior)}" aria-label="${escAttr(m.name)} last period" /></div>
      </li>`;
    })
    .join('');

  host.addEventListener('input', (event) => {
    const input = event.target as HTMLInputElement;
    if (input.type !== 'number') return;
    const id = (input.closest('.bm-input-row') as HTMLElement).dataset.id!;
    const field = input.dataset.field as 'current' | 'prior';
    values[id] = { ...values[id], [field]: num(input.value) };
    persistState();
    renderReport();
  });
}

// ------------------------------- report -------------------------------

const STATUS_CLASS: Record<Status, string> = { good: 'st-b-good', watch: 'st-b-watch', act: 'st-b-act' };

function bandNote(m: Metric): string {
  const g = formatValue(m, m.thresholds.good);
  const a = formatValue(m, m.thresholds.act);
  return m.direction === 'higher-better'
    ? `Good ≥ ${g} · Act ≤ ${a}`
    : `Good ≤ ${g} · Act ≥ ${a}`;
}

function sparkline(reading: MetricReading): string {
  if (reading.prior === undefined) return '';
  const cur = reading.current;
  const prev = reading.prior;
  const max = Math.max(Math.abs(cur), Math.abs(prev), 1);
  const h = (v: number) => Math.max(2, Math.round((Math.abs(v) / max) * 22));
  const cls = STATUS_CLASS[reading.status];
  // Two bars: last period (muted) then this period (status-colored).
  return `<svg class="bm-spark" width="40" height="26" viewBox="0 0 40 26" role="img" aria-label="prior versus current">
    <rect x="4" y="${24 - h(prev)}" width="14" height="${h(prev)}" rx="2" fill="var(--line)"></rect>
    <rect class="${cls}" x="22" y="${24 - h(cur)}" width="14" height="${h(cur)}" rx="2"></rect>
  </svg>`.replace(/\s+/g, ' ');
}

// Status-colored bar via allowlisted class, not inline user data.
const barFill: Record<Status, string> = { good: 'st-good', watch: 'st-watch', act: 'st-act' };

function renderReport(): void {
  const panel = $('#report');
  const readings: MetricReading[] = selectedMetrics()
    .map((m) => {
      const v = values[m.id] ?? {};
      return v.current === undefined ? null : read(m, v.current, v.prior);
    })
    .filter((r): r is MetricReading => r !== null);

  if (readings.length === 0) {
    panel.innerHTML = '<p class="bm-empty">Enter at least one current value to build the board summary.</p>';
    return;
  }

  const ordered = prioritize(readings);
  const counts = tally(readings);
  const total = readings.length;
  const seg = (s: Status): string =>
    counts[s] > 0 ? `<span class="${barFill[s]}" style="width:${(counts[s] / total) * 100}%"></span>` : '';
  const chip = (s: Status): string =>
    counts[s] > 0 ? `<span class="bm-tally-chip ${barFill[s]}">${counts[s]} ${STATUS_LABEL[s]}</span>` : '';

  const title = meta.org.trim() || 'Security posture summary';
  const sub = [meta.period.trim(), `${total} metric${total === 1 ? '' : 's'}`].filter(Boolean).join('  ·  ');

  const cards = ordered
    .map((r) => {
      const cls = STATUS_CLASS[r.status];
      const trendHtml =
        r.trend && r.prior !== undefined
          ? `<div class="bm-trend tr-${r.trend.movement}">
               <span aria-hidden="true">${r.trend.arrow === 'up' ? '↑' : r.trend.arrow === 'down' ? '↓' : '→'}</span>
               ${r.trend.movement === 'flat' ? 'Flat vs last period' : `${r.trend.movement === 'improving' ? 'Improving' : 'Worsening'}, ${formatValue(r.metric, Math.abs(r.trend.delta))} vs last period`}
               ${sparkline(r)}
             </div>`
          : '';
      return `
      <article class="bm-card ${cls}">
        <div class="bm-card-top">
          <span class="bm-card-name">${esc(r.metric.name)}</span>
          <span class="bm-status ${cls}">${STATUS_LABEL[r.status]}</span>
          <span class="bm-card-val">${esc(formatValue(r.metric, r.current))}</span>
        </div>
        ${trendHtml}
        <p class="bm-talk">${esc(talkTrack(r))}<span class="bm-note">${bandNote(r.metric)}</span></p>
      </article>`;
    })
    .join('');

  const highlight = meta.highlight.trim();
  const ask = meta.ask.trim();
  const callouts = [
    highlight ? `<div class="bm-callout"><h4>Highlight</h4><p>${esc(highlight)}</p></div>` : '',
    ask ? `<div class="bm-callout"><h4>The ask</h4><p>${esc(ask)}</p></div>` : '',
  ].join('');

  panel.innerHTML = `
    <h2 class="bm-report-title">${esc(title)}</h2>
    <p class="bm-report-sub">${esc(sub)}</p>
    <div class="bm-tally">${chip('act')}${chip('watch')}${chip('good')}</div>
    <div class="bm-bar">${seg('good')}${seg('watch')}${seg('act')}</div>
    <div class="bm-cards">${cards}</div>
    ${callouts}
    <div class="bm-actions print-hide">
      <input id="report-name" type="text" placeholder="Name this report (e.g. Q3 board pack)" aria-label="Report name" style="flex:1 1 220px;font:inherit;font-size:0.9rem;padding:8px 12px;border:1.5px solid var(--line);border-radius:10px;background:var(--paper);color:var(--ink);" />
      <button type="button" class="bm-btn bm-btn-primary" id="save-report">Save report</button>
      <button type="button" class="bm-btn" id="print-report">Print one-pager</button>
    </div>`;

  $('#print-report').addEventListener('click', () => window.print());
  $('#save-report').addEventListener('click', () => {
    const name = ($('#report-name') as HTMLInputElement).value.trim() || 'Untitled report';
    const entries = loadRegister();
    entries.unshift({
      id: `bm-${Date.now().toString(36)}`,
      name,
      selected: [...selected],
      values,
      meta,
      savedAt: new Date().toISOString(),
    });
    saveRegister(entries);
    renderRegister();
    ($('#report-name') as HTMLInputElement).value = '';
  });
}

// ------------------------------ register ------------------------------

interface RegisterEntry {
  id: string;
  name: string;
  selected: string[];
  values: Record<string, ValuePair>;
  meta: ReportMeta;
  savedAt: string;
}

function loadRegister(): RegisterEntry[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(REGISTER_KEY) ?? '[]');
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (e): e is RegisterEntry =>
        !!e && typeof e === 'object' && typeof (e as RegisterEntry).name === 'string' && Array.isArray((e as RegisterEntry).selected),
    );
  } catch {
    return [];
  }
}

function saveRegister(entries: RegisterEntry[]): void {
  localStorage.setItem(REGISTER_KEY, JSON.stringify(entries));
}

function renderRegister(): void {
  const entries = loadRegister();
  const host = $('#register');
  $('#register-section').hidden = entries.length === 0;
  if (entries.length === 0) return;

  const span = (className: string, text: string): HTMLSpanElement => {
    const el = document.createElement('span');
    el.className = className;
    el.textContent = text;
    return el;
  };
  host.textContent = '';
  entries.forEach((entry, index) => {
    const count = Array.isArray(entry.selected) ? entry.selected.length : 0;
    const saved = new Date(entry.savedAt);
    const savedText = Number.isNaN(saved.getTime()) ? '' : ` · ${saved.toLocaleDateString()}`;
    const item = document.createElement('li');
    item.className = 'bm-reg-item';
    item.dataset.index = String(index);
    item.append(span('bm-reg-name', entry.name), span('bm-reg-meta', `${count} metrics${savedText}`));

    const actions = span('bm-reg-actions', '');
    for (const [action, label, className] of [
      ['load', 'Load', 'bm-btn'],
      ['delete', 'Delete', 'bm-btn bm-btn-quiet'],
    ] as const) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = className;
      button.dataset.action = action;
      button.textContent = label;
      actions.append(button);
    }
    item.append(actions);
    host.append(item);
  });
}

function initRegister(): void {
  $('#register').addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest('button[data-action]') as HTMLButtonElement | null;
    if (!button) return;
    const index = Number((button.closest('.bm-reg-item') as HTMLElement).dataset.index);
    const entries = loadRegister();
    const entry = entries[index];
    if (!entry) return;
    if (button.dataset.action === 'delete') {
      saveRegister(entries.filter((_, i) => i !== index));
      renderRegister();
      return;
    }
    selected = new Set(entry.selected.filter((id) => byId.has(id)));
    values = {};
    for (const [id, v] of Object.entries(entry.values ?? {})) {
      if (byId.has(id) && v && typeof v === 'object') values[id] = v;
    }
    meta = {
      org: entry.meta?.org ?? '',
      period: entry.meta?.period ?? '',
      highlight: entry.meta?.highlight ?? '',
      ask: entry.meta?.ask ?? '',
    };
    persistState();
    syncMetaFields();
    renderPickerSelection();
    renderInputs();
    renderReport();
    $('#report').scrollIntoView({ behavior: 'smooth' });
  });

  $('#export-register').addEventListener('click', () => {
    const payload = { exportedAt: new Date().toISOString(), catalogVersion: data.meta.version, entries: loadRegister() };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'board-metrics-reports.json';
    link.click();
    URL.revokeObjectURL(link.href);
  });
}

function renderPickerSelection(): void {
  for (const input of $('#picker').querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) {
    input.checked = selected.has(input.value);
    input.closest('.bm-pick')?.classList.toggle('selected', input.checked);
  }
}

// ------------------------------- meta ---------------------------------

function initMeta(): void {
  for (const field of ['org', 'period', 'highlight', 'ask'] as const) {
    const el = $(`#${field}`) as HTMLInputElement | HTMLTextAreaElement;
    el.addEventListener('input', () => {
      meta[field] = el.value;
      persistState();
      renderReport();
    });
  }
}

function syncMetaFields(): void {
  for (const field of ['org', 'period', 'highlight', 'ask'] as const) {
    ($(`#${field}`) as HTMLInputElement | HTMLTextAreaElement).value = meta[field];
  }
}

// -------------------------------- boot --------------------------------

loadState();
$('#metric-count').textContent = String(data.metrics.length);
renderPicker();
syncMetaFields();
renderInputs();
renderReport();
renderRegister();
initRegister();
initMeta();
