import { allData, sortedKeys } from './data';
import { searchEntries, suggest } from './lib/search';
import { relatedFor } from './lib/related';
import type { SearchFilter } from './lib/search';
import { dayNumber, localDateString, soupIndex } from './lib/daily';
import { detectFrameworkQuery } from './lib/framework-search';
import { slugForKey } from './lib/slug';
import { CATEGORIES } from './lib/types';
import type { Category, Difficulty } from './lib/types';

const data = allData();
const byId = (id: string) => document.getElementById(id) as HTMLElement;

const state: { query: string; category: Category | ''; letter: string; difficulty: Difficulty | '' } = {
  query: '',
  category: '',
  letter: '',
  difficulty: '',
};

const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];

const PAGE_SIZE = 60;
/** How many results are currently revealed; grows via "Show more". */
let shownCount = PAGE_SIZE;

/** Reset paging to the first page whenever the result set changes. */
function resetPaging(): void {
  shownCount = PAGE_SIZE;
}

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

/* Floating letter "croutons" in the hero, seeded deterministically. */
function renderCroutons(): void {
  const field = byId('crouton-field');
  const letters = 'SIEMZTNAPKIXDRC2FAWAF';
  const positions = [
    [4, 12], [90, 8], [8, 62], [88, 58], [16, 30], [82, 32], [4, 86], [93, 82],
    [24, 6], [72, 4], [30, 88], [68, 86],
  ];
  positions.forEach(([x, y], i) => {
    const tile = el('span', 'crouton', letters[i % letters.length]);
    const size = 26 + ((i * 7) % 14);
    tile.style.cssText = `left:${x}%;top:${y}%;width:${size}px;height:${size}px;font-size:${size * 0.55}px;--tilt:${((i * 13) % 21) - 10}deg;animation-delay:${(i % 6) * -1.1}s`;
    field.appendChild(tile);
  });
}

function renderPills(): void {
  const row = byId('category-pills');
  row.setAttribute('role', 'group');
  row.setAttribute('aria-label', 'Filter by category');
  const all = el('button', 'pill active', 'all');
  all.dataset.category = '';
  all.addEventListener('click', () => {
    state.category = '';
    resetPaging();
    syncPills();
    render();
  });
  row.appendChild(all);
  for (const category of CATEGORIES) {
    const pill = el('button', 'pill', category);
    pill.dataset.category = category;
    pill.addEventListener('click', () => {
      state.category = state.category === category ? '' : category;
      resetPaging();
      syncPills();
      render();
    });
    row.appendChild(pill);
  }
  syncPills();
}

function syncPills(): void {
  byId('category-pills')
    .querySelectorAll<HTMLButtonElement>('.pill')
    .forEach((pill) => {
      const category = pill.dataset.category ?? '';
      const active = category === state.category;
      pill.classList.toggle('active', active);
      pill.setAttribute('aria-pressed', String(active));
    });
}

function renderDifficulty(): void {
  const row = byId('difficulty-pills');
  if (!row) return;
  row.setAttribute('role', 'group');
  row.setAttribute('aria-label', 'Filter by difficulty');
  for (const level of ['', ...DIFFICULTIES] as (Difficulty | '')[]) {
    const pill = el('button', 'pill', level === '' ? 'any level' : level);
    pill.dataset.difficulty = level;
    pill.addEventListener('click', () => {
      state.difficulty = level;
      resetPaging();
      syncDifficulty();
      render();
    });
    row.appendChild(pill);
  }
  syncDifficulty();
}

function syncDifficulty(): void {
  const row = byId('difficulty-pills');
  if (!row) return;
  row.querySelectorAll<HTMLButtonElement>('.pill').forEach((pill) => {
    const active = (pill.dataset.difficulty ?? '') === state.difficulty;
    pill.classList.toggle('active', active);
    pill.setAttribute('aria-pressed', String(active));
  });
}

function renderAzStrip(): void {
  const strip = byId('az-strip');
  strip.setAttribute('role', 'group');
  strip.setAttribute('aria-label', 'Jump to first letter');
  const present = new Set(sortedKeys().map((key) => key[0]));
  for (const ch of '0ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
    const label = ch === '0' ? '#' : ch;
    const btn = el('button', 'az', label);
    btn.setAttribute('aria-label', ch === '0' ? 'Numbers' : ch);
    btn.setAttribute('aria-pressed', 'false');
    const hasAny = ch === '0' ? [...present].some((c) => /[0-9]/.test(c)) : present.has(ch);
    btn.disabled = !hasAny;
    btn.addEventListener('click', () => {
      state.letter = state.letter === ch ? '' : ch;
      resetPaging();
      strip.querySelectorAll('.az').forEach((b) => {
        b.classList.remove('active');
        b.setAttribute('aria-pressed', 'false');
      });
      if (state.letter) {
        btn.classList.add('active');
        btn.setAttribute('aria-pressed', 'true');
      }
      render();
    });
    strip.appendChild(btn);
  }
}

function renderSoupOfTheDay(): void {
  const keys = sortedKeys();
  const key = keys[soupIndex(dayNumber(localDateString(new Date())), keys.length)];
  const entry = data[key];
  const box = byId('sotd');
  box.innerHTML = '';
  box.appendChild(el('p', 'sotd-label', 'Soup of the day'));
  const row = el('div', 'sotd-row');
  const link = el('a', 'sotd-key', entry.display);
  link.href = `definitions/${slugForKey(key)}.html`;
  row.appendChild(link);
  row.appendChild(el('span', 'sotd-expansion', entry.expansion));
  box.appendChild(row);
  box.appendChild(el('p', 'sotd-blurb', entry.explanation));
}

function letterFilter(): SearchFilter {
  // '#' bucket: any digit-leading key
  if (state.letter === '0') return { category: state.category, difficulty: state.difficulty };
  return { category: state.category, letter: state.letter, difficulty: state.difficulty };
}

type CrossSearchModule = typeof import('./lib/global-search') & {
  csf: import('./lib/frameworks').CsfData;
  cis: import('./lib/frameworks').CisData;
  decks: import('./lib/quiz').DeckMeta[];
};

let crossModule: CrossSearchModule | null = null;
let crossLoading: Promise<CrossSearchModule> | null = null;

function loadCrossSearch(): Promise<CrossSearchModule> {
  if (crossModule) return Promise.resolve(crossModule);
  crossLoading ??= Promise.all([
    import('./lib/global-search'),
    import('./data/nist-csf.json'),
    import('./data/cis.json'),
    import('./data/quiz/index.json'),
  ]).then(([module, csfData, cisData, deckData]) => {
    crossModule = {
      ...module,
      csf: csfData.default as CrossSearchModule['csf'],
      cis: cisData.default as CrossSearchModule['cis'],
      decks: deckData.default as CrossSearchModule['decks'],
    };
    return crossModule;
  });
  return crossLoading;
}

function renderFrameworkHint(): void {
  const hint = byId('framework-hint');
  const query = state.query.trim();
  if (query.length < 2) {
    hint.hidden = true;
    return;
  }
  void loadCrossSearch().then((module) => {
    if (state.query.trim() !== query) return; // stale keystroke
    const hits = module.crossSearch(query, module.csf, module.cis, module.decks);
    if (hits.length === 0) {
      const detected = detectFrameworkQuery(query);
      if (!detected) {
        hint.hidden = true;
        return;
      }
      hint.innerHTML = '';
      hint.append('That looks like a framework control. ');
      const link = document.createElement('a');
      link.href = `frameworks/${detected === 'csf' ? 'nist-csf' : 'cis'}/?q=${encodeURIComponent(query)}`;
      link.textContent = `Look for "${query}" in the framework translations →`;
      hint.appendChild(link);
      hint.hidden = false;
      return;
    }
    hint.innerHTML = '';
    const label = document.createElement('div');
    label.className = 'hint-label';
    label.textContent = 'Elsewhere in the soup';
    hint.appendChild(label);
    for (const hit of hits) {
      const row = document.createElement('div');
      row.className = 'hint-row';
      const section = document.createElement('span');
      section.className = 'hint-section';
      section.textContent = hit.section;
      row.appendChild(section);
      const link = document.createElement('a');
      link.href = hit.href;
      link.textContent = `${hit.label}: ${hit.detail.length > 70 ? hit.detail.slice(0, 70) + '...' : hit.detail}`;
      row.appendChild(link);
      hint.appendChild(row);
    }
    hint.hidden = false;
  });
}

function render(): void {
  renderFrameworkHint();
  let keys = searchEntries(data, state.query, letterFilter());
  if (state.letter === '0') {
    keys = keys.filter((key) => /[0-9]/.test(key[0]));
  }
  const meta = byId('result-meta');
  const results = byId('results');
  const visible = Math.min(shownCount, keys.length);
  const shown = keys.slice(0, visible);
  const total = Object.keys(data).length;
  const filtering = Boolean(state.query || state.category || state.letter || state.difficulty);

  byId('sotd').hidden = filtering;
  const label = filtering
    ? `${keys.length} match${keys.length === 1 ? '' : 'es'}`
    : `browsing all ${total}`;
  meta.textContent = keys.length > visible ? `${label} · showing ${visible}` : label;

  results.innerHTML = '';
  if (keys.length === 0) {
    const empty = el('div', 'empty-bowl');
    empty.appendChild(el('div', 'big', 'Empty bowl.'));
    empty.appendChild(el('div', undefined, 'No acronym matches that. Try fewer letters, or a word from its expansion.'));
    const near = state.query ? suggest(data, state.query) : null;
    if (near) {
      const hint = el('div', 'did-you-mean');
      hint.appendChild(document.createTextNode('Did you mean '));
      const link = el('button', 'link-btn', data[near].display);
      link.addEventListener('click', () => {
        const input = byId('search') as HTMLInputElement;
        input.value = near;
        state.query = near;
        (byId('clear-search') as HTMLButtonElement).hidden = false;
        resetPaging();
        render();
      });
      hint.appendChild(link);
      hint.appendChild(document.createTextNode('?'));
      empty.appendChild(hint);
    }
    results.appendChild(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const key of shown) {
    const entry = data[key];
    const details = el('details', 'entry');
    const summary = el('summary');
    summary.appendChild(el('span', 'entry-key', entry.display));
    summary.appendChild(el('span', 'entry-expansion', entry.expansion));
    const chip = el('span', 'cat-dot', entry.category);
    chip.style.setProperty('--cat', `var(--cat-${entry.category})`);
    summary.appendChild(chip);
    details.appendChild(summary);

    const body = el('div', 'entry-body');
    body.appendChild(el('p', undefined, entry.explanation));
    const links = el('div', 'entry-links');
    for (const source of entry.sources) {
      const a = el('a', undefined, source.name + ' ↗');
      a.href = source.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      links.appendChild(a);
    }
    const permalink = el('a', 'permalink', 'permalink');
    permalink.href = `definitions/${slugForKey(key)}.html`;
    links.appendChild(permalink);
    body.appendChild(links);

    const related = relatedFor(key, data);
    if (related.length > 0) {
      const relatedRow = el('div', 'entry-related');
      relatedRow.appendChild(el('span', 'entry-related-label', 'See also'));
      for (const relKey of related) {
        const chip = el('a', 'related-chip', data[relKey].display);
        chip.href = `definitions/${slugForKey(relKey)}.html`;
        chip.title = data[relKey].expansion;
        relatedRow.appendChild(chip);
      }
      body.appendChild(relatedRow);
    }
    details.appendChild(body);
    fragment.appendChild(details);
  }
  results.appendChild(fragment);

  // Auto-open a lone exact match.
  if (shown.length === 1) {
    (results.firstElementChild as HTMLDetailsElement).open = true;
  }

  if (keys.length > visible) {
    const remaining = keys.length - visible;
    const more = el('button', 'show-more', `Show more (${remaining} more)`);
    more.addEventListener('click', () => {
      shownCount += PAGE_SIZE;
      render();
    });
    results.appendChild(more);
  }
}

function initSearch(): void {
  const input = byId('search') as HTMLInputElement;
  const clear = byId('clear-search') as HTMLButtonElement;
  const params = new URLSearchParams(location.search);
  const query = params.get('q');
  if (query) {
    input.value = query;
    state.query = query;
  }
  // Deep link to a category, e.g. /?category=governance (used by the career-paths page).
  const category = params.get('category');
  if (category && (CATEGORIES as readonly string[]).includes(category)) {
    state.category = category as Category;
    syncPills();
  }
  input.addEventListener('input', () => {
    state.query = input.value;
    clear.hidden = input.value === '';
    resetPaging();
    render();
  });
  clear.addEventListener('click', () => {
    input.value = '';
    state.query = '';
    clear.hidden = true;
    resetPaging();
    input.focus();
    render();
  });
  byId('search-form').addEventListener('submit', (event) => event.preventDefault());
  clear.hidden = input.value === '';
}

function main(): void {
  const total = Object.keys(data).length;
  byId('hero-count').textContent = String(total);
  byId('footer-count').textContent = String(total);
  renderCroutons();
  renderPills();
  renderDifficulty();
  renderAzStrip();
  renderSoupOfTheDay();
  initSearch();
  render();
}

main();
