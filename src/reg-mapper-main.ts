import dataRaw from './data/regulations.json';
import type { ApplicableRegulation, RegData } from './lib/reg-mapper';
import { applicable, combinedPlan, planCsv, profileSize } from './lib/reg-mapper';

const data = dataRaw as RegData;

const STATE_KEY = 'alphabetsoup:reg-mapper:profile';

const validOptions = new Map(data.questions.map((q) => [q.id, new Set(q.options.map((o) => o.id))]));

let profile: Record<string, string[]> = {};

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;

function esc(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ------------------------------- state --------------------------------

const persist = (): void => localStorage.setItem(STATE_KEY, JSON.stringify(profile));

function loadState(): void {
  try {
    const raw = JSON.parse(localStorage.getItem(STATE_KEY) ?? '{}') as Record<string, unknown>;
    if (raw && typeof raw === 'object') {
      for (const [qid, arr] of Object.entries(raw)) {
        const valid = validOptions.get(qid);
        if (valid && Array.isArray(arr)) profile[qid] = arr.filter((x): x is string => typeof x === 'string' && valid.has(x));
      }
    }
  } catch {
    /* ignore */
  }
}

// ------------------------------ questions -----------------------------

function renderQuestions(): void {
  const host = $('#questions');
  host.innerHTML = data.questions
    .map((q) => {
      const chosen = new Set(profile[q.id] ?? []);
      const opts = q.options
        .map(
          (o) => `
          <label class="rm-opt${chosen.has(o.id) ? ' selected' : ''}">
            <input type="checkbox" data-q="${q.id}" value="${o.id}" ${chosen.has(o.id) ? 'checked' : ''} />
            ${esc(o.label)}
          </label>`,
        )
        .join('');
      return `<div class="rm-question">
        <p class="rm-q-label">${esc(q.label)}</p>
        ${q.help ? `<p class="rm-q-help">${esc(q.help)}</p>` : ''}
        <div class="rm-opts">${opts}</div>
      </div>`;
    })
    .join('');

  host.addEventListener('change', (event) => {
    const input = event.target as HTMLInputElement;
    if (input.type !== 'checkbox') return;
    const qid = input.dataset.q!;
    const current = new Set(profile[qid] ?? []);
    if (input.checked) current.add(input.value);
    else current.delete(input.value);
    profile[qid] = [...current];
    input.closest('.rm-opt')?.classList.toggle('selected', input.checked);
    persist();
    renderOutput();
  });
}

// ------------------------------- output -------------------------------

function regCard(item: ApplicableRegulation): string {
  const r = item.regulation;
  const reasons = item.reasons.map((why) => `<li>${esc(why)}</li>`).join('');
  const obligations = r.obligations.map((o) => `<li>${esc(o)}</li>`).join('');
  const first90 = r.first90.map((a) => `<li>${esc(a)}</li>`).join('');
  const sources = r.sources
    .map((s) => `<a href="${esc(s.url)}" rel="noopener" target="_blank">${esc(s.name)}</a>`)
    .join(' &middot; ');
  return `
    <article class="rm-reg">
      <div class="rm-reg-top">
        <span class="rm-reg-name">${esc(r.name)}</span>
        <span class="rm-reg-short">${esc(r.short)}</span>
      </div>
      <p class="rm-reg-enforcer"><strong>Enforced by:</strong> ${esc(r.enforcer)} &middot; ${esc(r.appliesTo)}</p>
      <div class="rm-why">
        <p class="rm-why-label">Why this likely applies to you</p>
        <ul>${reasons}</ul>
      </div>
      <p class="rm-sub">Core obligations</p>
      <ul class="rm-list">${obligations}</ul>
      <p class="rm-sub">First 90 days</p>
      <ul class="rm-list">${first90}</ul>
      <p class="rm-caveat">Nuance: ${esc(r.caveat)}</p>
      <p class="rm-sources">Sources: ${sources}</p>
    </article>`;
}

function renderOutput(): void {
  const panel = $('#output');
  if (profileSize(profile) === 0) {
    panel.innerHTML = '<p class="rm-empty">Answer the questions above to see the regulations that likely apply.</p>';
    return;
  }
  const regs = applicable(data, profile);
  if (regs.length === 0) {
    panel.innerHTML =
      '<p class="rm-empty">Nothing in this curated set matched your selections. That does not mean you are unregulated: contract terms, state laws, and sector rules this tool does not model may still apply. Confirm with counsel.</p>';
    return;
  }

  const plan = combinedPlan(regs);
  const planItems = plan
    .map(
      (item) => `
      <li class="rm-plan-item">
        <div class="rm-plan-action">${esc(item.action)}</div>
        <div class="rm-plan-tags">${item.regulations.map((s) => `<span class="rm-plan-tag">${esc(s)}</span>`).join('')}</div>
      </li>`,
    )
    .join('');

  panel.innerHTML = `
    <div class="rm-actions print-hide">
      <button type="button" class="rm-btn rm-btn-primary" id="rm-print">Print</button>
      <button type="button" class="rm-btn" id="rm-csv">Export action plan as CSV</button>
    </div>
    <div class="rm-doc">
      <p class="rm-count">${regs.length} regulation${regs.length === 1 ? '' : 's'} likely apply to this profile. This is educational, not a legal determination.</p>
      ${regs.map(regCard).join('')}
      <h3 class="rm-block-head">Combined first-90-days action plan</h3>
      <p class="rm-q-help">Merged across the regulations above; actions serving more of them are listed first.</p>
      <ol class="rm-plan">${planItems}</ol>
    </div>`;

  $('#rm-print').addEventListener('click', () => window.print());
  $('#rm-csv').addEventListener('click', () => {
    const blob = new Blob([planCsv(plan)], { type: 'text/csv' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'regulatory-action-plan.csv';
    link.click();
    URL.revokeObjectURL(link.href);
  });
}

// -------------------------------- boot --------------------------------

loadState();
$('#reg-count').textContent = String(data.regulations.length);
renderQuestions();
renderOutput();
