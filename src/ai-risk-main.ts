import rubricRaw from './data/ai-risk-tiering.json';
import type { Answers, Rubric, TierId } from './lib/ai-risk';
import { controlsForTier, isComplete, scoreUseCase, tierRank } from './lib/ai-risk';
import { escAttr } from './lib/escape';

const rubric = rubricRaw as Rubric;

const REGISTER_KEY = 'alphabetsoup:ai-risk:register';

interface RegisterEntry {
  id: string;
  name: string;
  answers: Answers;
  score: number;
  tier: TierId;
  savedAt: string;
}

let answers: Answers = {};

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;

function esc(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ------------------------------ register ------------------------------

function loadRegister(): RegisterEntry[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(REGISTER_KEY) ?? '[]');
    if (!Array.isArray(raw)) return [];
    // localStorage is user-editable; keep only well-formed entries.
    return raw.filter(
      (e): e is RegisterEntry =>
        !!e &&
        typeof e === 'object' &&
        typeof (e as RegisterEntry).name === 'string' &&
        typeof (e as RegisterEntry).answers === 'object',
    );
  } catch {
    return [];
  }
}

function saveRegister(entries: RegisterEntry[]): void {
  localStorage.setItem(REGISTER_KEY, JSON.stringify(entries));
}

// ------------------------------- intake -------------------------------

function renderIntake(): void {
  const host = $('#questions');
  host.innerHTML = rubric.questions
    .map(
      (q, index) => `
      <fieldset class="rt-question" data-question="${q.id}">
        <legend><span class="rt-qnum">${index + 1}</span> ${esc(q.prompt)}</legend>
        <p class="rt-help">${esc(q.help)}</p>
        <div class="rt-options" role="radiogroup" aria-label="${escAttr(q.prompt)}">
          ${q.options
            .map(
              (o) => `
            <label class="rt-option${answers[q.id] === o.value ? ' selected' : ''}">
              <input type="radio" name="${q.id}" value="${o.value}" ${answers[q.id] === o.value ? 'checked' : ''} />
              <span class="rt-option-label">${esc(o.label)}</span>
              <span class="rt-option-detail">${esc(o.detail)}</span>
            </label>`,
            )
            .join('')}
        </div>
      </fieldset>`,
    )
    .join('');

  host.addEventListener('change', (event) => {
    const input = event.target as HTMLInputElement;
    if (input.type !== 'radio') return;
    answers[input.name] = input.value;
    for (const label of host.querySelectorAll(`fieldset[data-question="${input.name}"] .rt-option`)) {
      label.classList.toggle('selected', (label.querySelector('input') as HTMLInputElement).checked);
    }
    renderResult();
  });
}

function syncIntakeSelection(): void {
  for (const input of $('#questions').querySelectorAll<HTMLInputElement>('input[type="radio"]')) {
    input.checked = answers[input.name] === input.value;
    input.closest('.rt-option')?.classList.toggle('selected', input.checked);
  }
}

// ------------------------------- result -------------------------------

function refChips(refs: string[]): string {
  return refs
    .map(
      (code) =>
        `<a class="rt-ref" href="../../frameworks/ai/?q=${encodeURIComponent(code)}" title="Read ${esc(code)} in plain English">${esc(code)}</a>`,
    )
    .join('');
}

function renderResult(): void {
  const answered = rubric.questions.filter((q) => answers[q.id]).length;
  const meta = $('#progress');
  const panel = $('#result');

  if (!isComplete(rubric, answers)) {
    meta.textContent = `${answered} of ${rubric.questions.length} answered`;
    panel.hidden = true;
    return;
  }

  const result = scoreUseCase(rubric, answers);
  meta.textContent = 'All questions answered';
  panel.hidden = false;

  const { tier, scoreTier, score, maxScore, gateReasons } = result;
  const gated = tier.id !== scoreTier.id;

  const rationale = [
    `Scored <strong>${score} of ${maxScore}</strong>, which lands in the ${esc(scoreTier.label)} band.`,
    ...(gated ? [`Raised to <strong>${esc(tier.label)}</strong> by a gating answer.`] : []),
    ...gateReasons.map((reason) => esc(reason)),
  ];

  const groups = controlsForTier(rubric, tier.id);
  const controlsHtml = groups
    .map((group, index) => {
      const heading =
        groups.length === 1
          ? 'Required controls'
          : index === 0
            ? `${esc(group.tier.label)} baseline`
            : `${esc(group.tier.label)}: everything above, plus`;
      return `
        <h4 class="rt-controls-head">${heading}</h4>
        <ul class="rt-controls">
          ${group.controls
            .map((c) => `<li>${esc(c.text)} <span class="rt-refs">${refChips(c.refs)}</span></li>`)
            .join('')}
        </ul>`;
    })
    .join('');

  panel.innerHTML = `
    <div class="rt-verdict tier-${tier.id}">
      <div class="rt-badge">${esc(tier.label)}</div>
      <div class="rt-score">${score} / ${maxScore}</div>
    </div>
    <p class="rt-summary">${esc(tier.summary)}</p>
    <div class="rt-rationale">
      <h3>Why this tier</h3>
      <ul>${rationale.map((line) => `<li>${line}</li>`).join('')}</ul>
    </div>
    <div class="rt-path">
      <h3>Review path: ${esc(tier.reviewPath.name)}</h3>
      <p>${esc(tier.reviewPath.description)}</p>
      <ol>${tier.reviewPath.steps.map((step) => `<li>${esc(step)}</li>`).join('')}</ol>
    </div>
    <div class="rt-controls-wrap">
      <h3>Required controls</h3>
      ${controlsHtml}
      <p class="rt-refs-note">Codes link to the plain-English NIST AI RMF and OWASP LLM Top 10 translations on this site.</p>
    </div>
    <div class="rt-snippet">
      <h3>Policy snippet</h3>
      <pre id="snippet-text">${esc(tier.policySnippet)}</pre>
      <button type="button" class="rt-btn" id="copy-snippet">Copy snippet</button>
    </div>
    <div class="rt-actions print-hide">
      <input id="usecase-name" type="text" placeholder="Name this use case (e.g. Support ticket summarizer)" aria-label="Use case name" />
      <button type="button" class="rt-btn rt-btn-primary" id="save-entry">Save to register</button>
      <button type="button" class="rt-btn" id="print-result">Print</button>
    </div>`;

  $('#copy-snippet').addEventListener('click', async () => {
    await navigator.clipboard.writeText(tier.policySnippet);
    $('#copy-snippet').textContent = 'Copied';
    setTimeout(() => ($('#copy-snippet').textContent = 'Copy snippet'), 1500);
  });
  $('#print-result').addEventListener('click', () => window.print());
  $('#save-entry').addEventListener('click', () => {
    const name = ($('#usecase-name') as HTMLInputElement).value.trim() || 'Untitled use case';
    const entries = loadRegister();
    entries.unshift({
      id: `uc-${Date.now().toString(36)}`,
      name,
      answers: { ...answers },
      score,
      tier: tier.id,
      savedAt: new Date().toISOString(),
    });
    saveRegister(entries);
    renderRegister();
    ($('#usecase-name') as HTMLInputElement).value = '';
  });
}

// ------------------------------ register UI ---------------------------

function renderRegister(): void {
  const entries = loadRegister();
  const host = $('#register');
  const section = $('#register-section');
  section.hidden = entries.length === 0;
  if (entries.length === 0) return;

  const tierLabel = Object.fromEntries(rubric.tiers.map((t) => [t.id, t.label]));
  // localStorage is user-editable, so stored values are built into the list
  // with textContent (never innerHTML), the tier class is allowlisted against
  // the rubric, the score is coerced, and entries are addressed by index.
  const span = (className: string, text: string): HTMLSpanElement => {
    const el = document.createElement('span');
    el.className = className;
    el.textContent = text;
    return el;
  };
  host.textContent = '';
  entries.forEach((entry, index) => {
    const tier = tierLabel[entry.tier] ? entry.tier : 'low';
    const score = Number(entry.score) || 0;
    const saved = new Date(entry.savedAt);
    const savedText = Number.isNaN(saved.getTime()) ? '' : ` · ${saved.toLocaleDateString()}`;

    const item = document.createElement('li');
    item.className = 'rt-reg-item';
    item.dataset.index = String(index);
    item.append(
      span(`rt-reg-badge tier-${tier}`, tierLabel[tier]),
      span('rt-reg-name', entry.name),
      span('rt-reg-meta', `${score}/${rubric.meta.maxScore}${savedText}`),
    );

    const actions = span('rt-reg-actions', '');
    for (const [action, label, className] of [
      ['load', 'Load', 'rt-btn'],
      ['delete', 'Delete', 'rt-btn rt-btn-quiet'],
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
    const index = Number((button.closest('.rt-reg-item') as HTMLElement).dataset.index);
    const entries = loadRegister();
    const entry = entries[index];
    if (!entry) return;
    if (button.dataset.action === 'delete') {
      saveRegister(entries.filter((_, i) => i !== index));
      renderRegister();
    } else {
      answers = { ...entry.answers };
      syncIntakeSelection();
      renderResult();
      $('#result').scrollIntoView({ behavior: 'smooth' });
    }
  });

  $('#export-register').addEventListener('click', () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      rubricVersion: rubric.meta.version,
      entries: loadRegister(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'ai-use-case-register.json';
    link.click();
    URL.revokeObjectURL(link.href);
  });
}

// -------------------------------- boot --------------------------------

renderIntake();
renderResult();
renderRegister();
initRegister();

const highest = rubric.tiers.reduce((a, b) => (tierRank(a.id) > tierRank(b.id) ? a : b));
$('#tier-count').textContent = String(rubric.tiers.length);
$('#question-count').textContent = String(rubric.questions.length);
$('#max-tier-label').textContent = highest.label.toLowerCase();
