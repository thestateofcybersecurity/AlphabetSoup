import crosswalkRaw from './data/crosswalk.json';
import type { CrosswalkData, FrameworkId } from './lib/crosswalk';
import { coverage, gapCsv, gapRegister } from './lib/crosswalk';

const data = crosswalkRaw as CrosswalkData;

const STATE_KEY = 'alphabetsoup:crosswalk:state';
const REGISTER_KEY = 'alphabetsoup:crosswalk:register';

// Framework pages exist on the site for CSF and CIS, so their IDs deep-link;
// ISO and SOC 2 have no on-site pages and render as plain chips.
const FRAMEWORK_LINK: Partial<Record<FrameworkId, string>> = {
  csf: '../../frameworks/nist-csf/',
  cis: '../../frameworks/cis/',
};

interface RegisterEntry {
  id: string;
  name: string;
  implemented: string[];
  scope: FrameworkId[];
  savedAt: string;
}

const allFrameworkIds = data.frameworks.map((f) => f.id);
let implemented = new Set<string>();
let scope = new Set<FrameworkId>(allFrameworkIds);

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;

function esc(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ------------------------------- state --------------------------------

function persistState(): void {
  localStorage.setItem(
    STATE_KEY,
    JSON.stringify({ implemented: [...implemented], scope: [...scope] }),
  );
}

function loadState(): void {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STATE_KEY) ?? 'null');
    if (!raw || typeof raw !== 'object') return;
    const validIds = new Set(data.controls.map((c) => c.id));
    const storedImpl = (raw as { implemented?: unknown }).implemented;
    const storedScope = (raw as { scope?: unknown }).scope;
    if (Array.isArray(storedImpl)) {
      implemented = new Set(storedImpl.filter((x): x is string => typeof x === 'string' && validIds.has(x)));
    }
    if (Array.isArray(storedScope)) {
      const next = storedScope.filter((x): x is FrameworkId => allFrameworkIds.includes(x as FrameworkId));
      if (next.length > 0) scope = new Set(next);
    }
  } catch {
    /* ignore malformed state */
  }
}

// ------------------------------- scope --------------------------------

function renderScope(): void {
  const host = $('#scope');
  host.innerHTML = data.frameworks
    .map(
      (f) => `
      <label class="cw-scope-opt${scope.has(f.id) ? ' selected' : ''}">
        <input type="checkbox" value="${f.id}" ${scope.has(f.id) ? 'checked' : ''} />
        ${esc(f.short)} <span class="cw-scope-name">${f.total}</span>
      </label>`,
    )
    .join('');
  host.addEventListener('change', (event) => {
    const input = event.target as HTMLInputElement;
    if (input.type !== 'checkbox') return;
    const id = input.value as FrameworkId;
    if (input.checked) scope.add(id);
    else scope.delete(id);
    input.closest('.cw-scope-opt')?.classList.toggle('selected', input.checked);
    persistState();
    renderResult();
    syncControlChips();
  });
}

// ------------------------------ controls ------------------------------

function chipFor(fid: FrameworkId, code: string): string {
  const base = FRAMEWORK_LINK[fid];
  if (base) {
    return `<a class="cw-chip" href="${base}?q=${encodeURIComponent(code)}" title="Read ${esc(code)} in plain English">${esc(code)}</a>`;
  }
  return `<span class="cw-chip">${esc(code)}</span>`;
}

function mapsHtml(control: CrosswalkData['controls'][number]): string {
  return data.frameworks
    .filter((f) => scope.has(f.id))
    .map((f) => {
      const codes = control.mappings[f.id] ?? [];
      if (codes.length === 0) return '';
      return `
        <div class="cw-map-row">
          <span class="cw-map-label">${esc(f.short)}</span>
          ${codes.map((c) => chipFor(f.id, c)).join(' ')}
        </div>`;
    })
    .join('');
}

function renderControls(): void {
  const host = $('#controls');
  host.innerHTML = data.controls
    .map((c) => {
      const done = implemented.has(c.id);
      return `
      <li class="cw-control${done ? ' done' : ''}" data-id="${c.id}">
        <input type="checkbox" ${done ? 'checked' : ''} aria-label="We run: ${esc(c.domain)}" />
        <div class="cw-control-body">
          <label class="cw-control-title">${esc(c.domain)}</label>
          <p class="cw-control-summary">${esc(c.summary)}</p>
          <div class="cw-maps">${mapsHtml(c)}</div>
        </div>
      </li>`;
    })
    .join('');

  host.addEventListener('change', (event) => {
    const input = event.target as HTMLInputElement;
    if (input.type !== 'checkbox') return;
    const li = input.closest('.cw-control') as HTMLElement;
    const id = li.dataset.id!;
    if (input.checked) implemented.add(id);
    else implemented.delete(id);
    li.classList.toggle('done', input.checked);
    persistState();
    renderResult();
  });
  // Clicking the title toggles its checkbox.
  host.addEventListener('click', (event) => {
    const label = (event.target as HTMLElement).closest('.cw-control-title');
    if (!label) return;
    const box = label.closest('.cw-control')?.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
    box?.click();
  });
}

function syncControlChips(): void {
  // Scope changed: re-render the per-control chip rows (checkbox state is kept).
  for (const li of $('#controls').querySelectorAll<HTMLElement>('.cw-control')) {
    const control = data.controls.find((c) => c.id === li.dataset.id);
    if (control) (li.querySelector('.cw-maps') as HTMLElement).innerHTML = mapsHtml(control);
  }
}

// ------------------------------- result -------------------------------

function renderResult(): void {
  $('#controls-sub').textContent = `${implemented.size} of ${data.controls.length} domains implemented`;
  const panel = $('#result');

  if (scope.size === 0) {
    panel.innerHTML = '<p class="cw-empty">Select at least one framework above to see coverage.</p>';
    return;
  }

  const cov = coverage(data, implemented, scope);
  const gaps = gapRegister(data, implemented, scope);
  const topGap = gaps[0];

  const lead = topGap
    ? `Closing <strong>${esc(topGap.control.domain)}</strong> would add the most: <strong>${topGap.leverage}</strong> mapped requirement${topGap.leverage === 1 ? '' : 's'} across the frameworks you selected.`
    : implemented.size > 0
      ? 'Every mapped domain is checked off. Nothing is left in the gap register for the frameworks you selected.'
      : 'Check off the domains you run above to see your coverage climb.';

  const covRows = cov
    .map(
      (row) => `
      <div class="cw-cov-row">
        <div class="cw-cov-top">
          <span class="cw-cov-name">${esc(row.framework.name)}</span>
          <span class="cw-cov-num">${row.covered} / ${row.total} &middot; ${row.pct}%</span>
        </div>
        <div class="cw-cov-track"><div class="cw-cov-fill" style="width:${row.pct}%"></div></div>
      </div>`,
    )
    .join('');

  const scoped = data.frameworks.filter((f) => scope.has(f.id));
  const gapTable =
    gaps.length === 0
      ? '<p class="cw-empty">No gaps for the selected frameworks.</p>'
      : `
      <table class="cw-gap-table">
        <thead>
          <tr>
            <th>Missing domain</th>
            <th class="num">Unlocks</th>
            ${scoped.map((f) => `<th class="num">${esc(f.short)}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${gaps
            .map(
              (row) => `
            <tr>
              <td>${esc(row.control.domain)}</td>
              <td class="num cw-gap-lever">${row.leverage}</td>
              ${scoped.map((f) => `<td class="num">${row.perFramework[f.id] ?? 0}</td>`).join('')}
            </tr>`,
            )
            .join('')}
        </tbody>
      </table>`;

  panel.innerHTML = `
    <h3 class="cw-section-head" style="margin-top:0;">Coverage</h3>
    <p class="cw-lead">${lead}</p>
    <div class="cw-cov">${covRows}</div>
    <p class="cw-controls-sub">Coverage is out of the requirements this crosswalk maps for each framework, not every clause of the standard.</p>
    <h3 class="cw-section-head">Gap register</h3>
    ${gapTable}
    <div class="cw-actions print-hide">
      <input id="profile-name" type="text" placeholder="Name this program (e.g. Acme prod environment)" aria-label="Program name" />
      <button type="button" class="cw-btn cw-btn-primary" id="save-profile">Save profile</button>
      <button type="button" class="cw-btn" id="export-gaps"${gaps.length === 0 ? ' disabled' : ''}>Export gaps as CSV</button>
      <button type="button" class="cw-btn" id="print-result">Print</button>
    </div>`;

  $('#export-gaps').addEventListener('click', () => {
    if (gaps.length === 0) return;
    download(gapCsv(data, gaps, scope), 'crosswalk-gap-register.csv', 'text/csv');
  });
  $('#print-result').addEventListener('click', () => window.print());
  $('#save-profile').addEventListener('click', () => {
    const name = ($('#profile-name') as HTMLInputElement).value.trim() || 'Untitled program';
    const entries = loadRegister();
    entries.unshift({
      id: `cw-${Date.now().toString(36)}`,
      name,
      implemented: [...implemented],
      scope: [...scope],
      savedAt: new Date().toISOString(),
    });
    saveRegister(entries);
    renderRegister();
    ($('#profile-name') as HTMLInputElement).value = '';
  });
}

function download(text: string, filename: string, type: string): void {
  const blob = new Blob([text], { type });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

// ------------------------------ register ------------------------------

function loadRegister(): RegisterEntry[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(REGISTER_KEY) ?? '[]');
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (e): e is RegisterEntry =>
        !!e &&
        typeof e === 'object' &&
        typeof (e as RegisterEntry).name === 'string' &&
        Array.isArray((e as RegisterEntry).implemented),
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

  // localStorage is user-editable, so values go in via textContent (never
  // innerHTML) and entries are addressed by index.
  const span = (className: string, text: string): HTMLSpanElement => {
    const el = document.createElement('span');
    el.className = className;
    el.textContent = text;
    return el;
  };
  host.textContent = '';
  entries.forEach((entry, index) => {
    const count = Array.isArray(entry.implemented) ? entry.implemented.length : 0;
    const saved = new Date(entry.savedAt);
    const savedText = Number.isNaN(saved.getTime()) ? '' : ` · ${saved.toLocaleDateString()}`;

    const item = document.createElement('li');
    item.className = 'cw-reg-item';
    item.dataset.index = String(index);
    item.append(
      span('cw-reg-name', entry.name),
      span('cw-reg-meta', `${count} domains${savedText}`),
    );

    const actions = span('cw-reg-actions', '');
    for (const [action, label, className] of [
      ['load', 'Load', 'cw-btn'],
      ['delete', 'Delete', 'cw-btn cw-btn-quiet'],
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
    const index = Number((button.closest('.cw-reg-item') as HTMLElement).dataset.index);
    const entries = loadRegister();
    const entry = entries[index];
    if (!entry) return;
    if (button.dataset.action === 'delete') {
      saveRegister(entries.filter((_, i) => i !== index));
      renderRegister();
      return;
    }
    const validIds = new Set(data.controls.map((c) => c.id));
    implemented = new Set(entry.implemented.filter((x) => validIds.has(x)));
    const nextScope = entry.scope?.filter((x) => allFrameworkIds.includes(x)) ?? allFrameworkIds;
    scope = new Set(nextScope.length > 0 ? nextScope : allFrameworkIds);
    persistState();
    renderScopeSelection();
    renderControlsSelection();
    syncControlChips();
    renderResult();
    $('#main').scrollIntoView({ behavior: 'smooth' });
  });

  $('#export-register').addEventListener('click', () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      crosswalkVersion: data.meta.version,
      entries: loadRegister(),
    };
    download(JSON.stringify(payload, null, 2), 'crosswalk-profiles.json', 'application/json');
  });
}

function renderScopeSelection(): void {
  for (const input of $('#scope').querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) {
    input.checked = scope.has(input.value as FrameworkId);
    input.closest('.cw-scope-opt')?.classList.toggle('selected', input.checked);
  }
}

function renderControlsSelection(): void {
  for (const li of $('#controls').querySelectorAll<HTMLElement>('.cw-control')) {
    const done = implemented.has(li.dataset.id!);
    (li.querySelector('input[type="checkbox"]') as HTMLInputElement).checked = done;
    li.classList.toggle('done', done);
  }
}

// -------------------------------- boot --------------------------------

loadState();
$('#domain-count').textContent = String(data.controls.length);
renderScope();
renderControls();
renderResult();
renderRegister();
initRegister();
