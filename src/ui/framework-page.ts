import { searchFramework } from '../lib/framework-search';
import type { FrameworkRecord } from '../lib/framework-search';
import { dailyIndex, dayNumber, localDateString } from '../lib/daily';
import { frameworkSlug } from '../lib/frameworks';

export interface RelatedLink {
  label: string;
  href: string;
  title?: string;
}

export interface FrameworkPageConfig {
  /** Records in canonical order. */
  records: FrameworkRecord[];
  /** Filter pills: value matches record.group. */
  groups: Array<{ value: string; label: string; title?: string }>;
  /** Per-record kicker line, e.g. "Govern / Organizational Context". */
  kicker: (record: FrameworkRecord) => string;
  countNoun: string;
  /** Cross-framework links shown on each card (unofficial mapping). */
  related?: (record: FrameworkRecord) => RelatedLink[];
  relatedLabel?: string;
  /** Section id used for the coverage-tracking storage key. */
  section: string;
  /** Optional secondary filter (e.g. CIS implementation group). */
  secondary?: {
    label: string;
    pills: Array<{ value: string; label: string; title?: string }>;
    match: (record: FrameworkRecord, value: string) => boolean;
  };
}

const RESULT_CAP = 60;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function initFrameworkPage(config: FrameworkPageConfig): void {
  const byId = (id: string) => document.getElementById(id) as HTMLElement;
  const state = { query: '', group: '', secondary: '' };

  byId('hero-count').textContent = String(config.records.length);

  // Coverage tracking: a set of ids the user has marked reviewed.
  const coverageKey = `alphabetsoup:framework-reviewed:${config.section}`;
  let reviewed = new Set<string>();
  try {
    reviewed = new Set(JSON.parse(localStorage.getItem(coverageKey) ?? '[]') as string[]);
  } catch {
    reviewed = new Set();
  }
  function saveReviewed(): void {
    try {
      localStorage.setItem(coverageKey, JSON.stringify([...reviewed]));
    } catch {
      // private mode: session-only
    }
  }

  function filtered(): FrameworkRecord[] {
    let results = searchFramework(config.records, state.query, state.group);
    if (config.secondary && state.secondary) {
      results = results.filter((r) => config.secondary!.match(r, state.secondary));
    }
    return results;
  }

  function card(record: FrameworkRecord): HTMLElement {
    const article = el('article', 'fw-card');
    article.id = frameworkSlug(record.id);
    const head = el('div', 'fw-head');
    head.appendChild(el('span', 'fw-id', record.id));
    for (const badge of record.badges ?? []) {
      head.appendChild(el('span', `fw-badge ig-${badge.toLowerCase()}`, badge));
    }
    head.appendChild(el('span', 'fw-kicker', config.kicker(record)));
    article.appendChild(head);
    article.appendChild(el('p', 'fw-heading', record.heading));
    const quote = el('blockquote', 'metaphor-quote');
    quote.appendChild(el('span', 'metaphor-label', 'Think of it like'));
    quote.appendChild(el('p', undefined, record.metaphor));
    article.appendChild(quote);
    article.appendChild(el('p', 'fw-translation', record.translation));
    const relatedLinks = config.related?.(record) ?? [];
    if (relatedLinks.length > 0) {
      const map = el('div', 'map-links');
      map.appendChild(el('span', 'map-label', config.relatedLabel ?? 'Related'));
      for (const rel of relatedLinks) {
        const link = el('a', 'map-chip', rel.label);
        link.href = rel.href;
        if (rel.title) link.title = rel.title;
        map.appendChild(link);
      }
      article.appendChild(map);
    }
    const links = el('div', 'entry-links');
    const review = el('button', 'fw-review', reviewed.has(record.id) ? '✓ reviewed' : 'mark reviewed');
    review.setAttribute('aria-pressed', String(reviewed.has(record.id)));
    if (reviewed.has(record.id)) review.classList.add('on');
    review.addEventListener('click', () => {
      if (reviewed.has(record.id)) reviewed.delete(record.id);
      else reviewed.add(record.id);
      saveReviewed();
      const on = reviewed.has(record.id);
      review.classList.toggle('on', on);
      review.textContent = on ? '✓ reviewed' : 'mark reviewed';
      review.setAttribute('aria-pressed', String(on));
      article.classList.toggle('is-reviewed', on);
      updateCoverage();
    });
    if (reviewed.has(record.id)) article.classList.add('is-reviewed');
    links.appendChild(review);
    const permalink = el('a', 'permalink', 'permalink');
    permalink.href = `${frameworkSlug(record.id)}.html`;
    links.appendChild(permalink);
    article.appendChild(links);
    return article;
  }

  function updateCoverage(): void {
    const scope = filtered();
    const done = scope.filter((r) => reviewed.has(r.id)).length;
    const bar = byId('fw-coverage');
    if (!bar) return;
    const pct = scope.length ? Math.round((done / scope.length) * 100) : 0;
    bar.querySelector<HTMLElement>('.fw-coverage-fill')!.style.width = `${pct}%`;
    bar.querySelector<HTMLElement>('.fw-coverage-text')!.textContent =
      `${done} of ${scope.length} reviewed (${pct}%)`;
    bar.hidden = scope.length === 0;
  }

  function renderSotd(): void {
    const record = config.records[dailyIndex(dayNumber(localDateString(new Date())), config.records.length)];
    const box = byId('sotd');
    box.innerHTML = '';
    box.appendChild(el('p', 'sotd-label', 'Soup of the day'));
    const row = el('div', 'sotd-row');
    const link = el('a', 'sotd-key', record.id);
    link.href = `${frameworkSlug(record.id)}.html`;
    row.appendChild(link);
    row.appendChild(el('span', 'sotd-expansion', record.heading));
    box.appendChild(row);
    box.appendChild(el('p', 'sotd-blurb', record.translation));
  }

  function render(): void {
    const results = filtered();
    const shown = results.slice(0, RESULT_CAP);
    const filtering = Boolean(state.query || state.group || state.secondary);
    byId('sotd').hidden = filtering;
    byId('result-meta').textContent = filtering
      ? `${results.length} match${results.length === 1 ? '' : 'es'}${results.length > RESULT_CAP ? `, showing first ${RESULT_CAP}` : ''}`
      : `browsing all ${config.records.length} ${config.countNoun}`;

    const container = byId('results');
    container.innerHTML = '';
    if (results.length === 0) {
      const empty = el('div', 'empty-bowl');
      empty.appendChild(el('div', 'big', 'Empty bowl.'));
      empty.appendChild(el('div', undefined, 'Nothing matches that. Try an ID, a control name, or a word from the description.'));
      container.appendChild(empty);
      updateCoverage();
      return;
    }
    const fragment = document.createDocumentFragment();
    for (const record of shown) fragment.appendChild(card(record));
    container.appendChild(fragment);
    updateCoverage();
  }

  function buildPillRow(
    rowId: string,
    key: 'group' | 'secondary',
    dataAttr: string,
    ariaLabel: string,
    pills: Array<{ value: string; label: string; title?: string }>,
  ): void {
    const row = byId(rowId);
    if (!row) return;
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', ariaLabel);
    const all = el('button', 'pill active', 'all');
    all.dataset[dataAttr] = '';
    all.addEventListener('click', () => {
      state[key] = '';
      sync();
      render();
    });
    row.appendChild(all);
    for (const p of pills) {
      const pill = el('button', 'pill', p.label);
      pill.dataset[dataAttr] = p.value;
      if (p.title) {
        pill.title = p.title;
        pill.setAttribute('aria-label', p.title);
      }
      pill.addEventListener('click', () => {
        state[key] = state[key] === p.value ? '' : p.value;
        sync();
        render();
      });
      row.appendChild(pill);
    }
    function sync(): void {
      row.querySelectorAll<HTMLButtonElement>('.pill').forEach((pill) => {
        const active = (pill.dataset[dataAttr] ?? '') === state[key];
        pill.classList.toggle('active', active);
        pill.setAttribute('aria-pressed', String(active));
      });
    }
    sync();
  }

  buildPillRow('group-pills', 'group', 'group', 'Filter', config.groups);
  if (config.secondary) {
    buildPillRow('secondary-pills', 'secondary', 'secondary', config.secondary.label, config.secondary.pills);
  }

  // Search box
  const input = byId('search') as HTMLInputElement;
  const clear = byId('clear-search') as HTMLButtonElement;
  const initial = new URLSearchParams(location.search).get('q');
  if (initial) {
    input.value = initial;
    state.query = initial;
  }
  input.addEventListener('input', () => {
    state.query = input.value;
    clear.hidden = input.value === '';
    render();
  });
  clear.addEventListener('click', () => {
    input.value = '';
    state.query = '';
    clear.hidden = true;
    input.focus();
    render();
  });
  byId('search-form').addEventListener('submit', (event) => event.preventDefault());
  clear.hidden = input.value === '';

  renderSotd();
  render();
}
