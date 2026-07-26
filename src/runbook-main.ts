import dataRaw from './data/runbooks.json';
import type { OrgProfile, ProfileKey, RunbookData, Scenario } from './lib/runbook';
import { emptyProfile, fillScenario, PROFILE_FIELDS, toMarkdown, usedFields } from './lib/runbook';
import { escAttr } from './lib/escape';

const data = dataRaw as RunbookData;

const STATE_KEY = 'alphabetsoup:runbook:state';

const byId = new Map(data.scenarios.map((s) => [s.id, s]));
let selectedId: string = data.scenarios[0]?.id ?? '';
let profile: OrgProfile = emptyProfile();

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;

function esc(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ------------------------------- state --------------------------------

function persistState(): void {
  localStorage.setItem(STATE_KEY, JSON.stringify({ selectedId, profile }));
}

function loadState(): void {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STATE_KEY) ?? 'null');
    if (!raw || typeof raw !== 'object') return;
    const s = raw as { selectedId?: unknown; profile?: unknown };
    if (typeof s.selectedId === 'string' && byId.has(s.selectedId)) selectedId = s.selectedId;
    if (s.profile && typeof s.profile === 'object') {
      const p = s.profile as Partial<OrgProfile>;
      for (const { key } of PROFILE_FIELDS) {
        if (typeof p[key] === 'string') profile[key] = p[key] as string;
      }
    }
  } catch {
    /* ignore malformed state */
  }
}

// ----------------------------- scenarios ------------------------------

function renderScenarios(): void {
  const host = $('#scenarios');
  host.innerHTML = data.scenarios
    .map(
      (s) => `
      <button type="button" class="rb-scenario-opt${s.id === selectedId ? ' selected' : ''}" data-id="${s.id}" aria-pressed="${s.id === selectedId}">
        <span class="rb-scenario-name">${esc(s.name)}</span>
        <span class="rb-scenario-tag">${esc(s.tagline)}</span>
      </button>`,
    )
    .join('');
  host.addEventListener('click', (event) => {
    const btn = (event.target as HTMLElement).closest('.rb-scenario-opt') as HTMLElement | null;
    if (!btn) return;
    selectedId = btn.dataset.id!;
    for (const el of host.querySelectorAll('.rb-scenario-opt')) {
      const on = (el as HTMLElement).dataset.id === selectedId;
      el.classList.toggle('selected', on);
      el.setAttribute('aria-pressed', String(on));
    }
    persistState();
    renderProfile();
    renderOutput();
  });
}

// ------------------------------ profile -------------------------------

function renderProfile(): void {
  const host = $('#profile');
  const scenario = byId.get(selectedId);
  const used = scenario ? new Set<ProfileKey>(usedFields(scenario)) : new Set<ProfileKey>();
  host.innerHTML = PROFILE_FIELDS.map(
    (f) => `
    <div class="rb-field">
      <label for="rb-${f.key}">${esc(f.label)}${used.has(f.key) ? '<span class="rb-used">used here</span>' : ''}</label>
      <input id="rb-${f.key}" type="text" data-key="${f.key}" value="${escAttr(profile[f.key])}" placeholder="${escAttr(f.placeholder)}" />
    </div>`,
  ).join('');
  host.addEventListener('input', (event) => {
    const input = event.target as HTMLInputElement;
    const key = input.dataset.key as ProfileKey | undefined;
    if (!key) return;
    profile[key] = input.value;
    persistState();
    renderOutput();
  });
}

// ------------------------------- output -------------------------------

function list(items: string[]): string {
  return `<ul class="rb-list">${items.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`;
}

function renderOutput(): void {
  const panel = $('#output');
  const raw = byId.get(selectedId);
  if (!raw) {
    panel.innerHTML = '<p class="rb-empty">Pick a scenario above to generate its runbook and tabletop.</p>';
    return;
  }
  const s: Scenario = fillScenario(raw, profile);
  const forWhom = profile.org.trim() ? `Prepared for ${esc(profile.org.trim())}` : 'Fill in your organization details above to tailor this';

  const roles = `<ul class="rb-roles">${s.roles
    .map((r) => `<li class="rb-role"><b>${esc(r.role)}:</b> ${esc(r.focus)}</li>`)
    .join('')}</ul>`;

  const phases = s.phases
    .map((ph) => `<div class="rb-phase"><p class="rb-phase-name">${esc(ph.name)}</p>${list(ph.steps)}</div>`)
    .join('');

  const comms = `<div class="rb-comms">${s.commsTemplates
    .map((c) => `<div class="rb-comm"><p class="rb-comm-aud">${esc(c.audience)}</p><p class="rb-comm-draft">${esc(c.draft)}</p></div>`)
    .join('')}</div>`;

  const injects = `<ul class="rb-injects">${s.injects
    .map(
      (i) => `
      <li class="rb-inject">
        <div class="rb-inject-top"><span class="rb-inject-time">${esc(i.time)}</span><span class="rb-inject-title">${esc(i.title)}</span></div>
        <p class="rb-inject-detail">${esc(i.detail)}</p>
        <p class="rb-inject-meta"><b>Facilitator:</b> ${esc(i.facilitatorNote)}</p>
        <p class="rb-inject-meta"><b>Strong response:</b> ${esc(i.expectedAction)}</p>
      </li>`,
    )
    .join('')}</ul>`;

  panel.innerHTML = `
    <div class="rb-actions print-hide">
      <button type="button" class="rb-btn rb-btn-primary" id="rb-print">Print</button>
      <button type="button" class="rb-btn" id="rb-copy">Copy as Markdown</button>
      <button type="button" class="rb-btn" id="rb-download">Download .md</button>
    </div>
    <article class="rb-doc">
      <h2 class="rb-doc-title">${esc(s.name)} runbook and tabletop</h2>
      <p class="rb-doc-for">${forWhom}</p>
      <p class="rb-doc-summary">${esc(s.summary)}</p>

      <h3 class="rb-block-head">Response runbook</h3>
      <p class="rb-sub">Roles</p>${roles}
      <p class="rb-sub">Escalation ladder</p>${list(s.escalation)}
      <p class="rb-sub">Phases</p>${phases}
      <p class="rb-sub">Decision points</p>${list(s.decisionPoints)}
      <p class="rb-sub">Communications drafts</p>${comms}

      <h3 class="rb-block-head">Tabletop exercise</h3>
      <p class="rb-sub">${s.injects.length} timed injects with facilitator notes</p>${injects}

      <h3 class="rb-block-head">Gap questions to answer first</h3>${list(s.gapQuestions)}
    </article>`;

  $('#rb-print').addEventListener('click', () => window.print());
  $('#rb-copy').addEventListener('click', async () => {
    await navigator.clipboard.writeText(toMarkdown(s, profile));
    const btn = $('#rb-copy');
    btn.textContent = 'Copied';
    setTimeout(() => (btn.textContent = 'Copy as Markdown'), 1500);
  });
  $('#rb-download').addEventListener('click', () => {
    const blob = new Blob([toMarkdown(s, profile)], { type: 'text/markdown' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${s.id}-runbook-tabletop.md`;
    link.click();
    URL.revokeObjectURL(link.href);
  });
}

// -------------------------------- boot --------------------------------

loadState();
$('#scenario-count').textContent = String(data.scenarios.length);
renderScenarios();
renderProfile();
renderOutput();
