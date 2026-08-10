import dataRaw from './data/ai-cloud-controls.json';
import type { AiCloudControlsData, Control, PhaseId, ProviderId, Selection, TierId } from './lib/ai-cloud-controls';
import { controlsCsv, groupByLayer, refFramework, referenceGroups, selectedControls, serviceFor, tierBreakdown } from './lib/ai-cloud-controls';

const data = dataRaw as AiCloudControlsData;

const STATE_KEY = 'alphabetsoup:ai-cloud-controls:state';
const DONE_KEY = 'alphabetsoup:ai-cloud-controls:done';

const providerIds = new Set(data.providers.map((p) => p.id));
const tierIds = new Set(data.tiers.map((t) => t.id));
const phaseIds = new Set(data.phases.map((p) => p.id));
const controlIds = new Set(data.controls.map((c) => c.id));
const phaseName = new Map(data.phases.map((p) => [p.id, p.name]));
const tierName = new Map(data.tiers.map((t) => [t.id, t.name]));

let provider: ProviderId = 'aws';
let tier: TierId = 'connects';
let phases = new Set<PhaseId>();
let done = new Set<string>();

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;

function esc(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function selection(): Selection {
  return { provider, tier, phases };
}

function save(): void {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify({ provider, tier, phases: [...phases] }));
    localStorage.setItem(DONE_KEY, JSON.stringify([...done]));
  } catch {
    /* storage unavailable, the tool still works for this session */
  }
}

function restore(): void {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { provider?: string; tier?: string; phases?: string[] };
      if (parsed.provider && providerIds.has(parsed.provider as ProviderId)) provider = parsed.provider as ProviderId;
      if (parsed.tier && tierIds.has(parsed.tier as TierId)) tier = parsed.tier as TierId;
      if (Array.isArray(parsed.phases)) {
        phases = new Set(parsed.phases.filter((p): p is PhaseId => phaseIds.has(p as PhaseId)));
      }
    }
    const rawDone = localStorage.getItem(DONE_KEY);
    if (rawDone) {
      const parsed = JSON.parse(rawDone) as string[];
      if (Array.isArray(parsed)) done = new Set(parsed.filter((id) => controlIds.has(id)));
    }
  } catch {
    /* ignore malformed state */
  }
}

function renderIntake(): void {
  const providerHtml = data.providers
    .map(
      (p) => `<label class="ac-chip${p.id === provider ? ' selected' : ''}">
        <input type="radio" name="provider" value="${p.id}"${p.id === provider ? ' checked' : ''} />
        <span>${esc(p.name)}</span>
      </label>`,
    )
    .join('');

  const tierHtml = [...data.tiers]
    .sort((a, b) => a.order - b.order)
    .map(
      (t) => `<label class="ac-option${t.id === tier ? ' selected' : ''}">
        <input type="radio" name="tier" value="${t.id}"${t.id === tier ? ' checked' : ''} />
        <span class="ac-option-label">${esc(t.name)}</span>
        <span class="ac-option-detail">${esc(t.hint)} <em>${esc(t.example)}</em></span>
      </label>`,
    )
    .join('');

  const phaseHtml = [...data.phases]
    .sort((a, b) => a.order - b.order)
    .map(
      (p) => `<label class="ac-chip${phases.has(p.id) ? ' selected' : ''}">
        <input type="checkbox" name="phase" value="${p.id}"${phases.has(p.id) ? ' checked' : ''} />
        <span>${esc(p.name)}</span>
      </label>`,
    )
    .join('');

  $('#intake').innerHTML = `
    <fieldset class="ac-field">
      <legend>Which cloud?</legend>
      <div class="ac-chips">${providerHtml}</div>
    </fieldset>
    <fieldset class="ac-field">
      <legend>What kind of AI workload?</legend>
      <p class="ac-help">Controls are cumulative. Each tier includes everything from the tiers above it.</p>
      <div class="ac-options">${tierHtml}</div>
    </fieldset>
    <fieldset class="ac-field">
      <legend>Filter by maturity phase <span class="ac-optional">optional</span></legend>
      <p class="ac-help">Leave all unchecked to see the full control set.</p>
      <div class="ac-chips">${phaseHtml}</div>
    </fieldset>`;
}

/**
 * Ref chips deep-link into the plain-English translation of that identifier on
 * /frameworks/ai/, the same way the AI risk tiering tool does. The title names
 * the framework, because "Clause 6" and "AML.TA0010" mean nothing on their own.
 */
function refChips(codes: string[]): string {
  return codes
    .map((code) => {
      const framework = refFramework(code);
      const title = framework ? `${framework.name} ${code}, in plain English` : `See ${code} in plain English`;
      return `<a class="ac-ref" href="../../frameworks/ai/?q=${encodeURIComponent(code)}" title="${esc(title)}">${esc(code)}</a>`;
    })
    .join('');
}

function controlHtml(control: Control): string {
  const refs = refChips(control.refs);
  const checked = done.has(control.id);
  return `<li class="ac-control${checked ? ' is-done' : ''}" data-control="${control.id}">
    <label class="ac-control-head">
      <input type="checkbox" class="ac-done" data-control="${control.id}"${checked ? ' checked' : ''} />
      <span class="ac-objective">${esc(control.objective)}</span>
    </label>
    <p class="ac-rationale">${esc(control.rationale)}</p>
    <p class="ac-service"><span class="ac-service-tag">service</span> ${esc(serviceFor(control, provider))}</p>
    <p class="ac-meta">
      <span class="ac-phase ac-phase-${control.phase}">${esc(phaseName.get(control.phase) ?? control.phase)}</span>
      <span class="ac-tier-note">introduced at ${esc(tierName.get(control.tier) ?? control.tier)}</span>
      <span class="ac-refs">${refs}</span>
    </p>
  </li>`;
}

function providerLabel(): string {
  return data.providers.find((p) => p.id === provider)?.name ?? provider;
}

function renderResult(): void {
  const sel = selection();
  const groups = groupByLayer(data, sel);
  const all = selectedControls(data, sel);
  const breakdown = tierBreakdown(data, sel);
  const doneCount = all.filter((c) => done.has(c.id)).length;

  if (all.length === 0) {
    $('#result').innerHTML = `<p class="ac-empty">No controls match that combination. Clear the phase filter to see the full set.</p>`;
    return;
  }

  const summary = breakdown
    .map((b) => `<li>${esc(b.name)}: <strong>${b.count}</strong>${b.inherited ? ' <span class="ac-inherited">inherited</span>' : ''}</li>`)
    .join('');

  const groupsHtml = groups
    .map(
      (g) => `<section class="ac-layer" aria-label="${esc(g.name)} controls">
        <h3>${esc(g.name)} <span class="ac-layer-count">${g.controls.length}</span></h3>
        <p class="ac-layer-hint">${esc(g.hint)}</p>
        <ul class="ac-list">${g.controls.map(controlHtml).join('')}</ul>
      </section>`,
    )
    .join('');

  const groupedRefs = referenceGroups(data, sel);

  $('#result').innerHTML = `
    <div class="ac-summary">
      <p class="ac-count"><strong>${all.length}</strong> controls for <strong>${esc(providerLabel())}</strong>, <strong>${doneCount}</strong> marked in place</p>
      <ul class="ac-breakdown">${summary}</ul>
    </div>
    ${groupsHtml}
    <div class="ac-frameworks">
      <p class="ac-frameworks-head">Mapped to ${groupedRefs.reduce((sum, g) => sum + g.codes.length, 0)} references across ${groupedRefs.length} frameworks:</p>
      <ul class="ac-frameworks-list">${groupedRefs
        .map((group) => `<li><span class="ac-ref-framework">${esc(group.framework.name)}</span> ${refChips(group.codes)}</li>`)
        .join('')}</ul>
      <p class="ac-verified">Provider service names checked against vendor documentation on ${esc(data.meta.servicesVerified)}. Treat the objective as durable and re-check the service before you ship it.</p>
    </div>
    <div class="ac-actions print-hide">
      <button type="button" class="ac-btn ac-btn-primary" id="export-csv">Export as CSV</button>
      <button type="button" class="ac-btn" id="print">Print</button>
      <button type="button" class="ac-btn ac-btn-quiet" id="reset-done">Clear progress</button>
    </div>`;
}

function render(): void {
  renderIntake();
  renderResult();
}

function download(name: string, body: string, type: string): void {
  const blob = new Blob([body], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function bind(): void {
  document.addEventListener('change', (event) => {
    const target = event.target as HTMLInputElement;
    if (target.name === 'provider' && providerIds.has(target.value as ProviderId)) {
      provider = target.value as ProviderId;
      save();
      render();
    } else if (target.name === 'tier' && tierIds.has(target.value as TierId)) {
      tier = target.value as TierId;
      save();
      render();
    } else if (target.name === 'phase' && phaseIds.has(target.value as PhaseId)) {
      const id = target.value as PhaseId;
      if (target.checked) phases.add(id);
      else phases.delete(id);
      save();
      render();
    } else if (target.classList.contains('ac-done')) {
      const id = target.dataset.control;
      if (id && controlIds.has(id)) {
        if (target.checked) done.add(id);
        else done.delete(id);
        save();
        renderResult();
      }
    }
  });

  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    if (target.id === 'export-csv') {
      download(`ai-controls-${provider}-${tier}.csv`, controlsCsv(data, selection()), 'text/csv');
    } else if (target.id === 'print') {
      window.print();
    } else if (target.id === 'reset-done') {
      done = new Set();
      save();
      renderResult();
    }
  });
}

// The hero advertises the size of the catalogue, so it comes from the data
// rather than from a number in the markup that goes stale on the next commit.
function renderCounts(): void {
  const controls = document.getElementById('control-count');
  if (controls) controls.textContent = String(data.controls.length);
  const clouds = document.getElementById('cloud-count');
  if (clouds) clouds.textContent = String(data.providers.length);
}

renderCounts();
restore();
render();
bind();
