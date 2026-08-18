import threatRaw from './data/ai-threat-model.json';
import type { RiskLevel, SystemProfile, ThreatModelData, ThreatVerdict } from './lib/ai-threat';
import { boundaries, candidateThreats, diagramLayout, registerCsv, riskFor, summarize, threatDragonModel } from './lib/ai-threat';

const data = threatRaw as ThreatModelData;

const DRAFT_KEY = 'alphabetsoup:ai-threat:draft';
const MODELS_KEY = 'alphabetsoup:ai-threat:models';

interface ModelState {
  profile: SystemProfile;
  verdicts: Record<string, ThreatVerdict>;
  savedAt?: string;
}

type Step = 1 | 2 | 3 | 4;

let state: ModelState = {
  profile: { name: '', components: [], exposure: 'internal', dataClass: 'internal' },
  verdicts: {},
};
let step: Step = 1;

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;

function esc(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function loadDraft(): void {
  try {
    const raw = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null') as ModelState | null;
    if (raw && typeof raw === 'object' && raw.profile && Array.isArray(raw.profile.components)) {
      state = { profile: raw.profile, verdicts: raw.verdicts ?? {} };
    }
  } catch {
    /* fresh start */
  }
}

function saveDraft(): void {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(state));
  } catch {
    /* private browsing */
  }
}

const candidates = () => candidateThreats(data, state.profile);
const verdictFor = (id: string): ThreatVerdict => state.verdicts[id] ?? { status: 'unreviewed' };

// ------------------------------- stepper -------------------------------

const STEPS: { n: Step; label: string }[] = [
  { n: 1, label: 'What are we building?' },
  { n: 2, label: 'What can go wrong?' },
  { n: 3, label: 'What will we do about it?' },
  { n: 4, label: 'Did we do a good job?' },
];

function stepReachable(n: Step): boolean {
  if (n === 1) return true;
  return state.profile.components.length > 0;
}

function renderStepper(): void {
  $('#stepper').innerHTML = STEPS.map(({ n, label }) => {
    const current = n === step ? ' aria-current="step"' : '';
    const disabled = stepReachable(n) ? '' : ' disabled';
    return `<button type="button" class="tm-step${n === step ? ' current' : ''}" data-step="${n}"${current}${disabled}><span class="tm-step-n">${n}</span> ${esc(label)}</button>`;
  }).join('');
}

function goTo(next: Step): void {
  if (!stepReachable(next)) return;
  step = next;
  render();
  $('#stepper').scrollIntoView({ block: 'nearest' });
}

// ------------------------------- step 1 --------------------------------

function renderStep1(host: HTMLElement): void {
  const p = state.profile;
  host.innerHTML = `
    <p class="tm-lede">Describe the system first. Nothing is concluded from an empty form: the candidate threat list is derived from exactly what you select here, and each proposal will tell you which answer surfaced it.</p>
    <label class="tm-field"><span class="tm-label">System name</span>
      <input id="tm-name" type="text" placeholder="e.g. Support ticket summarizer" value="${esc(p.name)}" />
    </label>
    <div class="tm-two">
      <label class="tm-field"><span class="tm-label">Owner</span>
        <input id="tm-owner-field" type="text" placeholder="Accountable for the system" value="${esc(p.owner ?? '')}" />
      </label>
      <label class="tm-field"><span class="tm-label">Reviewer</span>
        <input id="tm-reviewer-field" type="text" placeholder="Who reviews this model" value="${esc(p.reviewer ?? '')}" />
      </label>
    </div>
    <fieldset class="tm-group"><legend>Which elements exist? Select all that apply.</legend>
      <div class="tm-options">
        ${data.components.map((c) => `
          <label class="tm-check${p.components.includes(c.id) ? ' selected' : ''}">
            <input type="checkbox" name="component" value="${c.id}" ${p.components.includes(c.id) ? 'checked' : ''} />
            <span class="tm-check-label">${esc(c.label)}</span>
            <span class="tm-check-detail">${esc(c.detail)}</span>
          </label>`).join('')}
      </div>
    </fieldset>
    <fieldset class="tm-group"><legend>Who can reach it?</legend>
      <div class="tm-options tm-options-row">
        ${data.exposures.map((e) => `
          <label class="tm-check${p.exposure === e.id ? ' selected' : ''}">
            <input type="radio" name="exposure" value="${e.id}" ${p.exposure === e.id ? 'checked' : ''} />
            <span class="tm-check-label">${esc(e.label)}</span>
            <span class="tm-check-detail">${esc(e.detail)}</span>
          </label>`).join('')}
      </div>
    </fieldset>
    <fieldset class="tm-group"><legend>Most sensitive data it touches?</legend>
      <div class="tm-options tm-options-row">
        ${data.dataClasses.map((d) => `
          <label class="tm-check${p.dataClass === d.id ? ' selected' : ''}">
            <input type="radio" name="dataClass" value="${d.id}" ${p.dataClass === d.id ? 'checked' : ''} />
            <span class="tm-check-label">${esc(d.label)}</span>
            <span class="tm-check-detail">${esc(d.detail)}</span>
          </label>`).join('')}
      </div>
    </fieldset>
    <div class="tm-boundaries" id="tm-boundaries"></div>
    <div class="tm-actions">
      <button type="button" class="tm-btn tm-btn-primary" id="tm-to-2" ${p.components.length ? '' : 'disabled'}>Enumerate what can go wrong &rarr;</button>
    </div>`;

  renderBoundaryPreview();

  host.addEventListener('change', (event) => {
    const input = event.target as HTMLInputElement;
    if (input.name === 'component') {
      const set = new Set(state.profile.components);
      input.checked ? set.add(input.value) : set.delete(input.value);
      state.profile.components = data.components.map((c) => c.id).filter((id) => set.has(id));
    }
    if (input.name === 'exposure') state.profile.exposure = input.value;
    if (input.name === 'dataClass') state.profile.dataClass = input.value;
    input.closest('.tm-options')?.querySelectorAll('.tm-check').forEach((label) => {
      label.classList.toggle('selected', (label.querySelector('input') as HTMLInputElement).checked);
    });
    saveDraft();
    renderBoundaryPreview();
    ($('#tm-to-2') as HTMLButtonElement).disabled = state.profile.components.length === 0;
    renderStepper();
  });
  host.querySelector('#tm-name')?.addEventListener('input', (event) => {
    state.profile.name = (event.target as HTMLInputElement).value;
    saveDraft();
  });
  host.querySelector('#tm-owner-field')?.addEventListener('input', (event) => {
    state.profile.owner = (event.target as HTMLInputElement).value;
    saveDraft();
  });
  host.querySelector('#tm-reviewer-field')?.addEventListener('input', (event) => {
    state.profile.reviewer = (event.target as HTMLInputElement).value;
    saveDraft();
  });
  $('#tm-to-2').addEventListener('click', () => goTo(2));
}

function renderBoundaryPreview(): void {
  const host = $('#tm-boundaries');
  const list = boundaries(data, state.profile);
  if (list.length === 0) {
    host.innerHTML = '<p class="tm-hint">Select the elements above and the trust boundaries of your system appear here.</p>';
    return;
  }
  host.innerHTML = `<h3 class="tm-h">Trust boundaries in this system</h3>
    <ul class="tm-boundary-list">${list.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>
    ${diagramSvg()}
    <p class="tm-hint">${candidates().length} candidate threats will be proposed across these boundaries, each for you to judge. The badges show where they attach.</p>`;
}

/** The derived data flow diagram: zones, nodes, flows, and threat badges. */
function diagramSvg(): string {
  const layout = diagramLayout(state.profile, candidates());
  if (!layout) return '';
  const zones = layout.zones
    .map(
      (z) => `<rect x="${z.x}" y="${z.y}" width="${z.w}" height="${z.h}" rx="10" fill="none" stroke="var(--line)" stroke-width="1.5" stroke-dasharray="6 4"/>` +
        `<text x="${z.x + 10}" y="${z.y - 9}" class="tmd-zone">${esc(z.label)}</text>`,
    )
    .join('');
  const nodes = layout.nodes
    .map(
      (n) => `<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="8" fill="var(--paper-raised)" stroke="var(--tomato)" stroke-width="1"/>` +
        `<text x="${n.x + 10}" y="${n.y + 19}" class="tmd-title">${esc(n.label)}</text>` +
        `<text x="${n.x + 10}" y="${n.y + 35}" class="tmd-sub">${esc(n.sub)}</text>`,
    )
    .join('');
  const flows = layout.flows
    .map((f) => {
      const mx = (f.x1 + f.x2) / 2;
      const my = (f.y1 + f.y2) / 2;
      const label = data.components.find((c) => c.id === f.componentId)?.label ?? f.componentId;
      const badge = f.badge > 0
        ? `<g><title>${esc(`${f.badge} candidate threats where "${label}" crosses a boundary`)}</title>` +
          `<circle cx="${mx}" cy="${my}" r="11" fill="var(--paper)" stroke="var(--status-bad)" stroke-width="1.5"/>` +
          `<text x="${mx}" y="${my + 4}" text-anchor="middle" class="tmd-badge">${f.badge}</text></g>`
        : '';
      return `<line x1="${f.x1}" y1="${f.y1}" x2="${f.x2}" y2="${f.y2}" stroke="var(--ink-soft)" stroke-width="1.2" marker-end="url(#tmd-arrow)"/>${badge}`;
    })
    .join('');
  return `<figure class="tm-diagram"><svg width="100%" viewBox="0 0 ${layout.width} ${layout.height}" role="img" aria-label="Data flow diagram derived from the described system">` +
    `<defs><marker id="tmd-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">` +
    `<path d="M2 1L8 5L2 9" fill="none" stroke="var(--ink-soft)" stroke-width="1.5" stroke-linecap="round"/></marker></defs>` +
    `${zones}${flows}${nodes}</svg>` +
    `<figcaption class="tm-hint">Derived from your answers, never drawn by hand. Badges: candidate threats at that flow.</figcaption></figure>`;
}

// ------------------------------- step 2 --------------------------------

function renderStep2(host: HTMLElement): void {
  const list = candidates();
  const byBoundary = new Map<string, typeof list>();
  for (const candidate of list) {
    const group = byBoundary.get(candidate.boundary) ?? [];
    group.push(candidate);
    byBoundary.set(candidate.boundary, group);
  }

  const reviewed = list.filter(({ threat }) => verdictFor(threat.id).status !== 'unreviewed').length;
  host.innerHTML = `
    <p class="tm-lede">These are candidates, not conclusions: each is proposed because of something you said in step one, and it needs your judgment. Mark each one, and rate the ones that apply with the anchored scales.</p>
    <p class="tm-progress" id="tm-progress">${reviewed} of ${list.length} judged</p>
    ${[...byBoundary.entries()].map(([boundary, group]) => `
      <section class="tm-boundary-group">
        <h3 class="tm-h">${esc(boundary)}</h3>
        ${group.map(({ threat, because }) => threatCard(threat.id, esc(threat.title), threat, because)).join('')}
      </section>`).join('')}
    <div class="tm-actions">
      <button type="button" class="tm-btn" data-step-nav="1">&larr; Back to the system</button>
      <button type="button" class="tm-btn tm-btn-primary" data-step-nav="3">Decide what to do &rarr;</button>
    </div>`;

  host.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest('button[data-verdict]') as HTMLButtonElement | null;
    if (!button) return;
    const card = button.closest('[data-threat]') as HTMLElement;
    const id = card.dataset.threat!;
    const current = verdictFor(id);
    const status = button.dataset.verdict as ThreatVerdict['status'];
    state.verdicts[id] = { ...current, status: current.status === status ? 'unreviewed' : status };
    saveDraft();
    render();
  });
  host.addEventListener('change', (event) => {
    const input = event.target as HTMLInputElement;
    const card = input.closest('[data-threat]') as HTMLElement | null;
    if (!card) return;
    const id = card.dataset.threat!;
    const verdict = verdictFor(id);
    if (input.name === `lik-${id}`) verdict.likelihood = input.value;
    if (input.name === `imp-${id}`) verdict.impact = input.value;
    state.verdicts[id] = verdict;
    saveDraft();
    render();
  });
  host.addEventListener('input', (event) => {
    const input = event.target as HTMLInputElement;
    const card = input.closest('[data-threat]') as HTMLElement | null;
    if (card && input.classList.contains('tm-note')) {
      state.verdicts[card.dataset.threat!] = { ...verdictFor(card.dataset.threat!), note: input.value };
      saveDraft();
    }
  });
  host.querySelectorAll('button[data-step-nav]').forEach((b) =>
    b.addEventListener('click', () => goTo(Number((b as HTMLElement).dataset.stepNav) as Step)),
  );
}

function refChips(refs: string[]): string {
  return refs
    .map((code) => `<a class="tm-ref" href="../../frameworks/ai/?q=${encodeURIComponent(code)}" title="Read ${esc(code)} in plain English">${esc(code)}</a>`)
    .join('');
}

function threatCard(id: string, title: string, threat: (typeof data.threats)[number], because: string): string {
  const verdict = verdictFor(id);
  const risk = riskFor(data, verdict.likelihood, verdict.impact);
  const pick = (kind: 'lik' | 'imp', options: typeof data.likelihood, chosen?: string) => `
    <div class="tm-scale" role="radiogroup" aria-label="${kind === 'lik' ? 'Likelihood' : 'Impact'}">
      <span class="tm-scale-label">${kind === 'lik' ? 'Likelihood' : 'Impact'}</span>
      ${options.map((o) => `
        <label class="tm-scale-opt${chosen === o.id ? ' selected' : ''}" title="${esc(o.detail)}">
          <input type="radio" name="${kind}-${id}" value="${o.id}" ${chosen === o.id ? 'checked' : ''} />${esc(o.label)}
        </label>`).join('')}
    </div>`;
  return `
    <article class="tm-card${verdict.status !== 'unreviewed' ? ` tm-${verdict.status}` : ''}" data-threat="${id}">
      <header class="tm-card-head">
        <span class="tm-id">${id}</span>
        <h4 class="tm-card-title">${title}</h4>
        <span class="tm-stride">${esc(threat.stride)}</span>
      </header>
      <p class="tm-because">Proposed because ${esc(because)}.</p>
      <p class="tm-desc">${esc(threat.description)} <span class="tm-refs">${refChips(threat.refs)}</span></p>
      <div class="tm-verdict-row">
        <button type="button" class="tm-vbtn${verdict.status === 'applies' ? ' on' : ''}" data-verdict="applies">Applies</button>
        <button type="button" class="tm-vbtn${verdict.status === 'mitigated' ? ' on' : ''}" data-verdict="mitigated">Already mitigated</button>
        <button type="button" class="tm-vbtn${verdict.status === 'not-applicable' ? ' on' : ''}" data-verdict="not-applicable">Not applicable</button>
      </div>
      ${verdict.status === 'applies' ? `
        <div class="tm-rating">
          ${pick('lik', data.likelihood, verdict.likelihood)}
          ${pick('imp', data.impact, verdict.impact)}
          ${risk ? `<span class="tm-risk tm-risk-${risk}">${risk}</span>` : '<span class="tm-hint">Pick both scales to rate this threat.</span>'}
        </div>` : ''}
      ${verdict.status === 'mitigated' || verdict.status === 'not-applicable' ? `
        <input class="tm-note" type="text" placeholder="${verdict.status === 'mitigated' ? 'How is it mitigated?' : 'Why does it not apply?'}" value="${esc(verdict.note ?? '')}" />` : ''}
    </article>`;
}

// ------------------------------- step 3 --------------------------------

function renderStep3(host: HTMLElement): void {
  const applying = candidates().filter(({ threat }) => verdictFor(threat.id).status === 'applies');
  host.innerHTML = `
    <p class="tm-lede">For each threat you said applies: here are the mitigations this library suggests, linked to the plain-English frameworks. Decide the treatment and name an owner; an unowned decision is a wish.</p>
    ${applying.length === 0 ? '<p class="tm-hint">No threats are marked as applying yet. Go back to step two and judge the candidates.</p>' : ''}
    ${applying.map(({ threat }) => {
      const verdict = verdictFor(threat.id);
      const risk = riskFor(data, verdict.likelihood, verdict.impact);
      return `
      <article class="tm-card" data-threat="${threat.id}">
        <header class="tm-card-head">
          <span class="tm-id">${threat.id}</span>
          <h4 class="tm-card-title">${esc(threat.title)}</h4>
          ${risk ? `<span class="tm-risk tm-risk-${risk}">${risk}</span>` : ''}
        </header>
        <ul class="tm-mitigations">
          ${threat.mitigations.map((m) => `<li>${esc(m.text)} <span class="tm-refs">${refChips(m.refs)}</span></li>`).join('')}
        </ul>
        <div class="tm-treat-row">
          <button type="button" class="tm-vbtn${verdict.treatment === 'mitigate' ? ' on' : ''}" data-treat="mitigate">Mitigate now</button>
          <button type="button" class="tm-vbtn${verdict.treatment === 'accept' ? ' on' : ''}" data-treat="accept">Accept for now</button>
          <input class="tm-owner" type="text" placeholder="Owner" value="${esc(verdict.owner ?? '')}" aria-label="Owner for ${threat.id}" />
        </div>
        ${verdict.treatment ? residualRow(threat.id, verdict) : ''}
      </article>`;
    }).join('')}
    <div class="tm-actions">
      <button type="button" class="tm-btn" data-step-nav="2">&larr; Back to judgments</button>
      <button type="button" class="tm-btn tm-btn-primary" data-step-nav="4">Review the model &rarr;</button>
    </div>`;

  host.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest('button[data-treat]') as HTMLButtonElement | null;
    if (!button) return;
    const id = (button.closest('[data-threat]') as HTMLElement).dataset.threat!;
    const verdict = verdictFor(id);
    const treatment = button.dataset.treat as 'mitigate' | 'accept';
    state.verdicts[id] = { ...verdict, treatment: verdict.treatment === treatment ? undefined : treatment };
    saveDraft();
    render();
  });
  host.addEventListener('input', (event) => {
    const input = event.target as HTMLInputElement;
    const card = input.closest('[data-threat]') as HTMLElement | null;
    if (card && input.classList.contains('tm-owner')) {
      state.verdicts[card.dataset.threat!] = { ...verdictFor(card.dataset.threat!), owner: input.value };
      saveDraft();
    }
  });
  host.addEventListener('change', (event) => {
    const input = event.target as HTMLInputElement;
    const card = input.closest('[data-threat]') as HTMLElement | null;
    if (!card || input.type !== 'radio') return;
    const id = card.dataset.threat!;
    const verdict = verdictFor(id);
    if (input.name === `rlik-${id}`) verdict.residualLikelihood = input.value;
    if (input.name === `rimp-${id}`) verdict.residualImpact = input.value;
    state.verdicts[id] = verdict;
    saveDraft();
    render();
  });
  host.querySelectorAll('button[data-step-nav]').forEach((b) =>
    b.addEventListener('click', () => goTo(Number((b as HTMLElement).dataset.stepNav) as Step)),
  );
}

/** Residual re-rating: same anchored scales, after the treatment lands. */
function residualRow(id: string, verdict: import('./lib/ai-threat').ThreatVerdict): string {
  const residual = riskFor(data, verdict.residualLikelihood, verdict.residualImpact);
  const pick = (kind: 'rlik' | 'rimp', options: typeof data.likelihood, chosen?: string) => `
    <div class="tm-scale" role="radiogroup" aria-label="Residual ${kind === 'rlik' ? 'likelihood' : 'impact'}">
      <span class="tm-scale-label">${kind === 'rlik' ? 'Likelihood' : 'Impact'}</span>
      ${options.map((o) => `
        <label class="tm-scale-opt${chosen === o.id ? ' selected' : ''}" title="${esc(o.detail)}">
          <input type="radio" name="${kind}-${id}" value="${o.id}" ${chosen === o.id ? 'checked' : ''} />${esc(o.label)}
        </label>`).join('')}
    </div>`;
  return `
    <div class="tm-rating tm-residual">
      <span class="tm-scale-label">After treatment:</span>
      ${pick('rlik', data.likelihood, verdict.residualLikelihood)}
      ${pick('rimp', data.impact, verdict.residualImpact)}
      ${residual ? `<span class="tm-risk tm-risk-${residual}">residual ${residual}</span>` : '<span class="tm-hint">Re-rate to show the residual risk.</span>'}
    </div>`;
}

// ------------------------------- step 4 --------------------------------

function renderStep4(host: HTMLElement): void {
  const list = candidates();
  const summary = summarize(data, list, state.verdicts);
  const warnings: string[] = [];
  if (summary.reviewed < summary.total) warnings.push(`${summary.total - summary.reviewed} candidate threats have not been judged yet.`);
  if (summary.unrated > 0) warnings.push(`${summary.unrated} applying threats have no likelihood or impact rating.`);
  if (summary.untreated > 0) warnings.push(`${summary.untreated} applying threats have no treatment decision.`);
  if (summary.mitigatedNoResidual > 0) warnings.push(`${summary.mitigatedNoResidual} mitigate decisions have no residual re-rating.`);

  const tile = (label: string, value: number, cls = '') => `<div class="tm-tile ${cls}"><span class="tm-tile-n">${value}</span>${label}</div>`;
  host.innerHTML = `
    <p class="tm-lede">The fourth question is honesty about the first three. This register is only as done as its weakest row; the warnings below are the work remaining.</p>
    ${warnings.length ? `<div class="tm-warnings">${warnings.map((w) => `<p>${esc(w)}</p>`).join('')}</div>` : '<p class="tm-complete">Every candidate judged, every applying threat rated and owned. This model is presentable.</p>'}
    <div class="tm-meta-line">${state.profile.owner ? `Owner: ${esc(state.profile.owner)}. ` : ''}${state.profile.reviewer ? `Reviewer: ${esc(state.profile.reviewer)}.` : ''}</div>
    ${diagramSvg()}
    <div class="tm-tiles">
      ${tile('candidates', summary.total)}
      ${tile('apply', summary.applies)}
      ${(['critical', 'high', 'medium', 'low'] as RiskLevel[]).map((r) => tile(r, summary.byRisk[r], `tm-tile-${r}`)).join('')}
    </div>
    ${Object.values(summary.byResidualRisk).some((n) => n > 0) ? `
    <div class="tm-tiles">
      ${(['critical', 'high', 'medium', 'low'] as RiskLevel[]).map((r) => tile(`residual ${r}`, summary.byResidualRisk[r], `tm-tile-${r}`)).join('')}
    </div>` : ''}
    <table class="tm-table">
      <thead><tr><th>ID</th><th>Threat</th><th>Boundary</th><th>Status</th><th>Risk</th><th>Residual</th><th>Treatment</th><th>Owner</th></tr></thead>
      <tbody>
        ${list.map(({ threat, boundary }) => {
          const v = verdictFor(threat.id);
          const risk = riskFor(data, v.likelihood, v.impact);
          return `<tr class="tm-row-${v.status}">
            <td>${threat.id}</td><td>${esc(threat.title)}</td><td>${esc(boundary)}</td>
            <td>${v.status === 'unreviewed' ? '<em>unreviewed</em>' : esc(v.status)}</td>
            <td>${risk ? `<span class="tm-risk tm-risk-${risk}">${risk}</span>` : ''}</td>
            <td>${(() => { const res = riskFor(data, v.residualLikelihood, v.residualImpact); return res ? `<span class="tm-risk tm-risk-${res}">${res}</span>` : ''; })()}</td>
            <td>${esc(v.treatment ?? '')}</td><td>${esc(v.owner ?? '')}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
    <div class="tm-actions print-hide">
      <button type="button" class="tm-btn" data-step-nav="3">&larr; Back to treatment</button>
      <button type="button" class="tm-btn" id="tm-csv">Export register CSV</button>
      <button type="button" class="tm-btn" id="tm-json">Export model JSON</button>
      <button type="button" class="tm-btn" id="tm-td">Export for Threat Dragon</button>
      <a class="tm-btn" href="../../roadmap/?source=threat">Send mitigations to the roadmap &rarr;</a>
      <button type="button" class="tm-btn" id="tm-print">Print</button>
      <button type="button" class="tm-btn tm-btn-primary" id="tm-save">Save model</button>
    </div>
    <section id="tm-models" class="print-hide"></section>`;

  host.querySelectorAll('button[data-step-nav]').forEach((b) =>
    b.addEventListener('click', () => goTo(Number((b as HTMLElement).dataset.stepNav) as Step)),
  );
  $('#tm-csv').addEventListener('click', () => {
    download(`${slug()}-threat-register.csv`, registerCsv(data, state.profile, list, state.verdicts), 'text/csv');
  });
  $('#tm-json').addEventListener('click', () => {
    download(`${slug()}-threat-model.json`, JSON.stringify({ ...state, datasetVersion: data.meta.version }, null, 2), 'application/json');
  });
  $('#tm-print').addEventListener('click', () => window.print());
  $('#tm-td').addEventListener('click', () => {
    const model = threatDragonModel(data, state.profile, list, state.verdicts, () => crypto.randomUUID());
    download(`${slug()}-threat-dragon.json`, JSON.stringify(model, null, 2), 'application/json');
  });
  host.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest('#tm-models button[data-action]') as HTMLButtonElement | null;
    if (!button) return;
    const index = Number((button.closest('li') as HTMLElement).dataset.index);
    const models = loadModels();
    if (button.dataset.action === 'delete') {
      models.splice(index, 1);
      localStorage.setItem(MODELS_KEY, JSON.stringify(models));
      renderModels();
    } else if (models[index]) {
      state = { profile: models[index].profile, verdicts: models[index].verdicts ?? {} };
      saveDraft();
      render();
    }
  });
  $('#tm-save').addEventListener('click', () => {
    const models = loadModels();
    models.unshift({ ...structuredClone(state), savedAt: new Date().toISOString() });
    localStorage.setItem(MODELS_KEY, JSON.stringify(models.slice(0, 20)));
    renderModels();
  });
  renderModels();
}

function slug(): string {
  return (state.profile.name || 'system').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'system';
}

function download(filename: string, content: string, type: string): void {
  const blob = new Blob([content], { type });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

function loadModels(): ModelState[] {
  try {
    const raw = JSON.parse(localStorage.getItem(MODELS_KEY) ?? '[]');
    return Array.isArray(raw)
      ? raw.filter((m): m is ModelState => !!m && typeof m === 'object' && !!(m as ModelState).profile)
      : [];
  } catch {
    return [];
  }
}

function renderModels(): void {
  const host = document.querySelector('#tm-models');
  if (!host) return;
  const models = loadModels();
  if (models.length === 0) {
    host.innerHTML = '';
    return;
  }
  host.innerHTML = `<h3 class="tm-h">Saved models</h3>
    <ul class="tm-model-list">
      ${models.map((m, index) => {
        const saved = new Date(m.savedAt ?? '');
        return `<li data-index="${index}">
          <span class="tm-model-name"></span>
          <span class="tm-model-meta">${Number.isNaN(saved.getTime()) ? '' : saved.toLocaleDateString()}</span>
          <button type="button" class="tm-btn tm-btn-sm" data-action="load">Load</button>
          <button type="button" class="tm-btn tm-btn-sm tm-btn-quiet" data-action="delete">Delete</button>
        </li>`;
      }).join('')}
    </ul>`;
  // Names come from stored, user-editable data: set via textContent, never markup.
  host.querySelectorAll('li').forEach((li, index) => {
    (li.querySelector('.tm-model-name') as HTMLElement).textContent = models[index]?.profile.name || 'Untitled system';
  });
}

// -------------------------------- shell --------------------------------

function render(): void {
  renderStepper();
  const host = $('#tm-body');
  const fresh = host.cloneNode(false) as HTMLElement;
  host.replaceWith(fresh);
  if (step === 1) renderStep1(fresh);
  if (step === 2) renderStep2(fresh);
  if (step === 3) renderStep3(fresh);
  if (step === 4) renderStep4(fresh);
}

$('#stepper').addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest('button[data-step]') as HTMLButtonElement | null;
  if (button && !button.disabled) goTo(Number(button.dataset.step) as Step);
});

loadDraft();
$('#threat-count').textContent = String(data.threats.length);
$('#component-count').textContent = String(data.components.length);
render();
