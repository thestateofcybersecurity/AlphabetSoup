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
  const state = { query: '', group: '' };

  byId('hero-count').textContent = String(config.records.length);

  function card(record: FrameworkRecord): HTMLElement {
    const article = el('article', 'fw-card');
    article.id = frameworkSlug(record.id);
    const head = el('div', 'fw-head');
    head.appendChild(el('span', 'fw-id', record.id));
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
    const permalink = el('a', 'permalink', 'permalink');
    permalink.href = `${frameworkSlug(record.id)}.html`;
    links.appendChild(permalink);
    article.appendChild(links);
    return article;
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
    const results = searchFramework(config.records, state.query, state.group);
    const shown = results.slice(0, RESULT_CAP);
    byId('sotd').hidden = Boolean(state.query || state.group);
    byId('result-meta').textContent = state.query || state.group
      ? `${results.length} match${results.length === 1 ? '' : 'es'}${results.length > RESULT_CAP ? `, showing first ${RESULT_CAP}` : ''}`
      : `browsing all ${config.records.length} ${config.countNoun}`;

    const container = byId('results');
    container.innerHTML = '';
    if (results.length === 0) {
      const empty = el('div', 'empty-bowl');
      empty.appendChild(el('div', 'big', 'Empty bowl.'));
      empty.appendChild(el('div', undefined, 'Nothing matches that. Try an ID or a word from the control.'));
      container.appendChild(empty);
      return;
    }
    const fragment = document.createDocumentFragment();
    for (const record of shown) fragment.appendChild(card(record));
    container.appendChild(fragment);
  }

  // Filter pills
  const pillRow = byId('group-pills');
  const allPill = el('button', 'pill active', 'all');
  allPill.addEventListener('click', () => {
    state.group = '';
    syncPills();
    render();
  });
  pillRow.appendChild(allPill);
  for (const group of config.groups) {
    const pill = el('button', 'pill', group.label);
    pill.dataset.group = group.value;
    if (group.title) pill.title = group.title;
    pill.addEventListener('click', () => {
      state.group = state.group === group.value ? '' : group.value;
      syncPills();
      render();
    });
    pillRow.appendChild(pill);
  }
  function syncPills(): void {
    pillRow.querySelectorAll<HTMLButtonElement>('.pill').forEach((pill) => {
      pill.classList.toggle('active', (pill.dataset.group ?? '') === state.group);
    });
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
