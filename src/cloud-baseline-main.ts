import dataRaw from './data/cloud-baseline.json';
import type {
  CloudBaselineData,
  ComplianceId,
  Control,
  ProviderId,
  Selection,
  WorkloadId,
} from './lib/cloud-baseline';
import { buildPlan, complianceCoverage, planCsv } from './lib/cloud-baseline';

const data = dataRaw as CloudBaselineData;

const STATE_KEY = 'alphabetsoup:cloud-baseline:state';
const DONE_KEY = 'alphabetsoup:cloud-baseline:done';

const providerIds = new Set(data.providers.map((p) => p.id));
const workloadIds = new Set(data.workloads.map((w) => w.id));
const complianceIds = new Set(data.compliance.map((c) => c.id));
const controlIds = new Set(data.controls.map((c) => c.id));
const domainName = new Map(data.domains.map((d) => [d.id, d.name]));
const providerName = new Map(data.providers.map((p) => [p.id, p.name]));

let providers = new Set<ProviderId>(['aws']);
let workload: WorkloadId | null = null;
let compliance = new Set<ComplianceId>();
let done = new Set<string>();

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;

function esc(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function selection(): Selection {
  return { providers, workload, compliance };
}

// ------------------------------- state --------------------------------

function persistState(): void {
  localStorage.setItem(STATE_KEY, JSON.stringify({ providers: [...providers], workload, compliance: [...compliance] }));
}
function persistDone(): void {
  localStorage.setItem(DONE_KEY, JSON.stringify([...done]));
}

function loadState(): void {
  try {
    const raw = JSON.parse(localStorage.getItem(STATE_KEY) ?? 'null') as {
      providers?: unknown;
      workload?: unknown;
      compliance?: unknown;
    } | null;
    if (raw && typeof raw === 'object') {
      if (Array.isArray(raw.providers)) {
        const next = raw.providers.filter((x): x is ProviderId => providerIds.has(x as ProviderId));
        providers = new Set(next.length ? next : ['aws']);
      }
      if (raw.workload === null || (typeof raw.workload === 'string' && workloadIds.has(raw.workload as WorkloadId))) {
        workload = (raw.workload as WorkloadId | null) ?? null;
      }
      if (Array.isArray(raw.compliance)) {
        compliance = new Set(raw.compliance.filter((x): x is ComplianceId => complianceIds.has(x as ComplianceId)));
      }
    }
  } catch {
    /* ignore */
  }
  try {
    const rawDone = JSON.parse(localStorage.getItem(DONE_KEY) ?? '[]') as unknown;
    if (Array.isArray(rawDone)) done = new Set(rawDone.filter((x): x is string => typeof x === 'string' && controlIds.has(x)));
  } catch {
    /* ignore */
  }
}

// ------------------------------ controls (config) ---------------------

function renderProviders(): void {
  const host = $('#providers');
  host.innerHTML = data.providers
    .map(
      (p) => `
      <label class="cb-opt${providers.has(p.id) ? ' selected' : ''}">
        <input type="checkbox" value="${p.id}" ${providers.has(p.id) ? 'checked' : ''} /> ${esc(p.name)}
      </label>`,
    )
    .join('');
  host.addEventListener('change', (event) => {
    const input = event.target as HTMLInputElement;
    if (input.type !== 'checkbox') return;
    const id = input.value as ProviderId;
    if (input.checked) providers.add(id);
    else providers.delete(id);
    input.closest('.cb-opt')?.classList.toggle('selected', input.checked);
    persistState();
    renderOutput();
  });
}

function renderWorkloads(): void {
  const host = $('#workloads');
  const opt = (value: string, label: string): string => {
    const on = (value === '' && workload === null) || value === workload;
    return `<label class="cb-opt${on ? ' selected' : ''}"><input type="radio" name="cb-workload" value="${value}" ${on ? 'checked' : ''} /> ${esc(label)}</label>`;
  };
  host.innerHTML = [opt('', 'All workloads'), ...data.workloads.map((w) => opt(w.id, w.name))].join('');
  host.addEventListener('change', (event) => {
    const input = event.target as HTMLInputElement;
    if (input.type !== 'radio') return;
    workload = input.value === '' ? null : (input.value as WorkloadId);
    for (const el of host.querySelectorAll('.cb-opt')) {
      el.classList.toggle('selected', (el.querySelector('input') as HTMLInputElement).checked);
    }
    renderWorkloadHint();
    persistState();
    renderOutput();
  });
}

function renderWorkloadHint(): void {
  const w = data.workloads.find((x) => x.id === workload);
  $('#workload-hint').textContent = w ? w.hint : 'Showing controls for every workload profile.';
}

function renderCompliance(): void {
  const host = $('#compliance');
  host.innerHTML = data.compliance
    .map(
      (c) => `
      <label class="cb-opt${compliance.has(c.id) ? ' selected' : ''}">
        <input type="checkbox" value="${c.id}" ${compliance.has(c.id) ? 'checked' : ''} /> ${esc(c.name)}
      </label>`,
    )
    .join('');
  host.addEventListener('change', (event) => {
    const input = event.target as HTMLInputElement;
    if (input.type !== 'checkbox') return;
    const id = input.value as ComplianceId;
    if (input.checked) compliance.add(id);
    else compliance.delete(id);
    input.closest('.cb-opt')?.classList.toggle('selected', input.checked);
    persistState();
    renderOutput();
  });
}

// ------------------------------- output -------------------------------

function controlCard(c: Control): string {
  const doneNow = done.has(c.id);
  const chips = data.compliance
    .map((t) => {
      const serves = c.compliance.includes(t.id);
      if (!serves) return '';
      return `<span class="cb-cmp${compliance.has(t.id) ? ' on' : ''}">${esc(t.name)}</span>`;
    })
    .join('');
  return `
    <li class="cb-control${doneNow ? ' done' : ''}" data-id="${c.id}">
      <input type="checkbox" ${doneNow ? 'checked' : ''} aria-label="Mark done: ${esc(c.title)}" />
      <div class="cb-control-body">
        <div class="cb-control-top">
          <span class="cb-control-title">${esc(c.title)}</span>
          <span class="cb-tag cb-prov">${esc(providerName.get(c.provider) ?? c.provider)}</span>
          <span class="cb-tag">${esc(domainName.get(c.domain) ?? c.domain)}</span>
          <span class="cb-tag pri-${c.priority}">${esc(c.priority)}</span>
        </div>
        <p class="cb-control-rationale">${esc(c.rationale)}</p>
        <div class="cb-chips">${chips}${c.cisRef ? `<span class="cb-cis">${esc(c.cisRef)}</span>` : ''}</div>
      </div>
    </li>`;
}

function renderOutput(): void {
  const panel = $('#output');
  if (providers.size === 0) {
    panel.innerHTML = '<p class="cb-empty">Select at least one cloud provider to generate a baseline.</p>';
    return;
  }
  const sel = selection();
  const plan = buildPlan(data, sel);
  if (plan.total === 0) {
    panel.innerHTML = '<p class="cb-empty">No controls match this provider and workload combination.</p>';
    return;
  }

  const coverage = complianceCoverage(data, sel);
  const covChips = coverage.map((c) => `<span class="cb-cov-chip">${c.count} for ${esc(c.name)}</span>`).join('');
  const doneCount = plan.windows.reduce((n, w) => n + w.controls.filter((c) => done.has(c.id)).length, 0);

  const windows = plan.windows
    .map((w) => {
      const total = w.controls.length;
      const doneN = w.controls.filter((c) => done.has(c.id)).length;
      const pct = total === 0 ? 0 : Math.round((doneN / total) * 100);
      const body =
        total === 0
          ? '<p class="cb-win-empty">Nothing scheduled in this window for your selection.</p>'
          : `<ul class="cb-controls">${w.controls.map(controlCard).join('')}</ul>`;
      return `
        <div class="cb-window">
          <div class="cb-window-head">
            <span class="cb-window-title">First ${w.window} days</span>
            <span class="cb-window-meta">${doneN} of ${total} done</span>
          </div>
          <div class="cb-window-bar"><div class="cb-window-fill" style="width:${pct}%"></div></div>
          ${body}
        </div>`;
    })
    .join('');

  panel.innerHTML = `
    <div class="cb-actions print-hide">
      <button type="button" class="cb-btn cb-btn-primary" id="cb-print">Print plan</button>
      <button type="button" class="cb-btn" id="cb-csv">Export as CSV</button>
    </div>
    <div class="cb-doc">
      <div class="cb-summary">
        <strong>${plan.total} controls</strong>
        ${covChips}
      </div>
      <p class="cb-progress-line">${doneCount} of ${plan.total} marked done</p>
      ${windows}
    </div>`;

  $('#cb-print').addEventListener('click', () => window.print());
  $('#cb-csv').addEventListener('click', () => {
    const blob = new Blob([planCsv(data, sel)], { type: 'text/csv' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'cloud-security-baseline.csv';
    link.click();
    URL.revokeObjectURL(link.href);
  });

  panel.querySelector('.cb-doc')!.addEventListener('change', (event) => {
    const input = event.target as HTMLInputElement;
    if (input.type !== 'checkbox') return;
    const li = input.closest('.cb-control') as HTMLElement;
    const id = li.dataset.id!;
    if (input.checked) done.add(id);
    else done.delete(id);
    persistDone();
    renderOutput();
  });
}

// -------------------------------- boot --------------------------------

loadState();
$('#control-count').textContent = String(data.controls.length);
renderProviders();
renderWorkloads();
renderWorkloadHint();
renderCompliance();
renderOutput();
