import dataRaw from './data/ssdlc.json';
import type { Practice, SsdlcData } from './lib/ssdlc';
import { adoptionPlan, currentLevel, overallScore, planCsv, scoreByPhase } from './lib/ssdlc';

const data = dataRaw as SsdlcData;

const STATE_KEY = 'alphabetsoup:ssdlc:state';
const STACK_FIELDS = ['langs', 'ci', 'cloud', 'deploy'] as const;
type StackField = (typeof STACK_FIELDS)[number];

const practiceIds = new Set(data.practices.map((p) => p.id));

let levels: Record<string, number> = {};
let stack: Record<StackField, string> = { langs: '', ci: '', cloud: '', deploy: '' };

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;

function esc(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ------------------------------- state --------------------------------

function persistState(): void {
  localStorage.setItem(STATE_KEY, JSON.stringify({ levels, stack }));
}

function loadState(): void {
  try {
    const raw = JSON.parse(localStorage.getItem(STATE_KEY) ?? 'null') as { levels?: unknown; stack?: unknown } | null;
    if (!raw || typeof raw !== 'object') return;
    if (raw.levels && typeof raw.levels === 'object') {
      levels = {};
      for (const [id, v] of Object.entries(raw.levels as Record<string, unknown>)) {
        if (practiceIds.has(id) && typeof v === 'number') levels[id] = v;
      }
    }
    if (raw.stack && typeof raw.stack === 'object') {
      const s = raw.stack as Partial<Record<StackField, string>>;
      for (const f of STACK_FIELDS) if (typeof s[f] === 'string') stack[f] = s[f] as string;
    }
  } catch {
    /* ignore */
  }
}

// -------------------------------- stack -------------------------------

function initStack(): void {
  for (const f of STACK_FIELDS) {
    const el = $(`#sd-${f}`) as HTMLInputElement;
    el.value = stack[f];
    el.addEventListener('input', () => {
      stack[f] = el.value;
      persistState();
      renderOutput();
    });
  }
}

// ------------------------------- rubric -------------------------------

function ladderHtml(p: Practice): string {
  const cur = currentLevel(p, levels);
  const rungs = p.levels
    .map(
      (lvl, i) => `
      <button type="button" class="sd-rung${i === cur ? ' on' : ''}" data-level="${i}" aria-pressed="${i === cur}">
        <span class="sd-rung-idx">L${i}</span>
        <span class="sd-rung-label">${esc(lvl.label)}</span>
      </button>`,
    )
    .join('');
  return `<div class="sd-ladder">${rungs}</div><p class="sd-rung-detail">${esc(p.levels[cur].detail)}</p>`;
}

function practiceHtml(p: Practice): string {
  return `
    <div class="sd-practice" data-id="${p.id}">
      <div class="sd-practice-top">
        <span class="sd-practice-name">${esc(p.name)}</span>
        <span class="sd-lf lev-${p.leverage}">leverage ${esc(p.leverage)}</span>
        <span class="sd-lf">friction ${esc(p.friction)}</span>
        <span class="sd-ref">${esc(p.ssdfRef)}</span>
      </div>
      <p class="sd-practice-why">${esc(p.why)}</p>
      ${ladderHtml(p)}
    </div>`;
}

function renderRubric(): void {
  const host = $('#rubric');
  host.innerHTML = data.phases
    .map((phase) => {
      const inPhase = data.practices.filter((p) => p.phase === phase.id);
      if (inPhase.length === 0) return '';
      return `<div class="sd-phase-group"><h3 class="sd-phase-name">${esc(phase.name)}</h3>${inPhase.map(practiceHtml).join('')}</div>`;
    })
    .join('');

  host.addEventListener('click', (event) => {
    const btn = (event.target as HTMLElement).closest('.sd-rung') as HTMLElement | null;
    if (!btn) return;
    const wrap = btn.closest('.sd-practice') as HTMLElement;
    const id = wrap.dataset.id!;
    const practice = data.practices.find((p) => p.id === id)!;
    levels[id] = Number(btn.dataset.level);
    // Update just this practice's ladder to keep scroll position stable.
    const cur = currentLevel(practice, levels);
    for (const rung of wrap.querySelectorAll('.sd-rung')) {
      const on = Number((rung as HTMLElement).dataset.level) === cur;
      rung.classList.toggle('on', on);
      rung.setAttribute('aria-pressed', String(on));
    }
    (wrap.querySelector('.sd-rung-detail') as HTMLElement).textContent = practice.levels[cur].detail;
    persistState();
    renderOutput();
  });
}

// ------------------------------- output -------------------------------

function renderOutput(): void {
  const panel = $('#output');
  const overall = overallScore(data, levels);
  const phases = scoreByPhase(data, levels);
  const plan = adoptionPlan(data, levels);

  const phaseRows = phases
    .map(
      (ph) => `
      <div class="sd-phase-row">
        <span class="sd-phase-lbl">${esc(ph.name)}</span>
        <span class="sd-phase-track"><span class="sd-phase-fill" style="width:${ph.pct}%"></span></span>
        <span class="sd-phase-pct">${ph.pct}%</span>
      </div>`,
    )
    .join('');

  const stackLine = STACK_FIELDS.map((f) => stack[f].trim())
    .filter(Boolean)
    .join('  ·  ');

  let planBlock: string;
  let onePager: string;
  if (plan.length === 0) {
    planBlock = '<p class="sd-done">Every practice is at the top of its ladder. Nothing left to sequence.</p>';
    onePager = '';
  } else {
    planBlock = `<ol class="sd-plan">${plan
      .map(
        (item, index) => `
        <li class="sd-step">
          <span class="sd-step-num">${index + 1}</span>
          <div>
            <div class="sd-step-top">
              <span class="sd-step-name">${esc(item.practice.name)}</span>
              <span class="sd-lf lev-${item.practice.leverage}">leverage ${esc(item.practice.leverage)}</span>
              <span class="sd-lf">friction ${esc(item.practice.friction)}</span>
              <span class="sd-ref">${esc(item.practice.ssdfRef)}</span>
            </div>
            <p class="sd-move">Move from <b>${esc(item.from.label)}</b> to <b>${esc(item.to.label)}</b>: ${esc(item.to.detail)}</p>
            <p class="sd-step-why">${esc(item.practice.why)}</p>
          </div>
        </li>`,
      )
      .join('')}</ol>`;
    onePager = `
      <h3 class="sd-block-head">For engineering: what changes, and why it will not slow you down</h3>
      ${stackLine ? `<p class="sd-block-sub">${esc(stackLine)}</p>` : ''}
      <ul class="sd-onepager">${plan
        .map((item) => `<li class="sd-op-item"><b>${esc(item.practice.name)}:</b> ${esc(item.practice.engineerNote)}</li>`)
        .join('')}</ul>`;
  }

  panel.innerHTML = `
    <div class="sd-actions print-hide">
      <button type="button" class="sd-btn sd-btn-primary" id="sd-print">Print scorecard and plan</button>
      <button type="button" class="sd-btn" id="sd-csv"${plan.length === 0 ? ' disabled' : ''}>Export plan as CSV</button>
    </div>
    <div class="sd-doc">
      <div class="sd-overall">
        <span class="sd-overall-pct">${overall}%</span>
        <span class="sd-overall-label">overall secure-SDLC maturity${stackLine ? `<br />${esc(stackLine)}` : ''}</span>
      </div>
      <div class="sd-phases">${phaseRows}</div>

      <h3 class="sd-block-head">Sequenced adoption plan</h3>
      <p class="sd-block-sub">Ordered by leverage-to-friction: the highest-impact, lowest-friction moves first.</p>
      ${planBlock}
      ${onePager}
    </div>`;

  $('#sd-print').addEventListener('click', () => window.print());
  const csvBtn = document.querySelector('#sd-csv') as HTMLButtonElement | null;
  csvBtn?.addEventListener('click', () => {
    if (plan.length === 0) return;
    const blob = new Blob([planCsv(plan)], { type: 'text/csv' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'secure-sdlc-adoption-plan.csv';
    link.click();
    URL.revokeObjectURL(link.href);
  });
}

// -------------------------------- boot --------------------------------

loadState();
$('#practice-count').textContent = String(data.practices.length);
renderRubric();
initStack();
renderOutput();
