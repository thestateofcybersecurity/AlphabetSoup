import { allData, sortedKeys } from './data';
import { searchEntries } from './lib/search';
import type { SearchFilter } from './lib/search';
import { dailyIndex, dayNumber, localDateString } from './lib/daily';
import { detectFrameworkQuery } from './lib/framework-search';
import { slugForKey } from './lib/slug';
import { CATEGORIES } from './lib/types';
import type { Category, Difficulty } from './lib/types';

const data = allData();
const byId = (id: string) => document.getElementById(id) as HTMLElement;

const state: { query: string; category: Category | ''; difficulty: Difficulty | ''; letter: string } = {
  query: '',
  category: '',
  difficulty: '',
  letter: '',
};

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
  const all = el('button', 'pill active', 'all');
  all.addEventListener('click', () => {
    state.category = '';
    syncPills();
    render();
  });
  row.appendChild(all);
  for (const category of CATEGORIES) {
    const pill = el('button', 'pill', category);
    pill.dataset.category = category;
    pill.addEventListener('click', () => {
      state.category = state.category === category ? '' : category;
      syncPills();
      render();
    });
    row.appendChild(pill);
  }
}

function syncPills(): void {
  byId('category-pills')
    .querySelectorAll<HTMLButtonElement>('.pill')
    .forEach((pill) => {
      const category = pill.dataset.category ?? '';
      pill.classList.toggle('active', category === state.category);
    });
}

function renderAzStrip(): void {
  const strip = byId('az-strip');
  const present = new Set(sortedKeys().map((key) => key[0]));
  for (const ch of '0ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
    const label = ch === '0' ? '#' : ch;
    const btn = el('button', 'az', label);
    const hasAny = ch === '0' ? [...present].some((c) => /[0-9]/.test(c)) : present.has(ch);
    btn.disabled = !hasAny;
    btn.addEventListener('click', () => {
      state.letter = state.letter === ch ? '' : ch;
      strip.querySelectorAll('.az').forEach((b) => b.classList.remove('active'));
      if (state.letter) btn.classList.add('active');
      render();
    });
    strip.appendChild(btn);
  }
}

function renderSoupOfTheDay(): void {
  const keys = sortedKeys();
  const key = keys[dailyIndex(dayNumber(localDateString(new Date())), keys.length)];
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
  return { category: state.category, difficulty: state.difficulty, letter: state.letter };
}

function renderFrameworkHint(): void {
  const hint = byId('framework-hint');
  const detected = detectFrameworkQuery(state.query);
  if (!detected) {
    hint.hidden = true;
    return;
  }
  const href = `frameworks/${detected === 'csf' ? 'nist-csf' : 'cis'}/?q=${encodeURIComponent(state.query.trim())}`;
  const label = detected === 'csf' ? 'NIST CSF 2.0' : 'CIS Controls v8';
  hint.innerHTML = '';
  hint.append('That looks like a framework control. ');
  const link = document.createElement('a');
  link.href = href;
  link.textContent = `See "${state.query.trim()}" translated in plain English in ${label} →`;
  hint.appendChild(link);
  hint.hidden = false;
}

function render(): void {
  renderFrameworkHint();
  let keys = searchEntries(data, state.query, letterFilter());
  if (state.letter === '0') {
    keys = keys.filter((key) => /[0-9]/.test(key[0]));
  }
  const meta = byId('result-meta');
  const results = byId('results');
  const shown = keys.slice(0, RESULT_CAP);
  const total = Object.keys(data).length;

  byId('sotd').hidden = Boolean(state.query || state.category || state.difficulty || state.letter);
  meta.textContent = state.query || state.category || state.difficulty || state.letter
    ? `${keys.length} match${keys.length === 1 ? '' : 'es'}${keys.length > RESULT_CAP ? `, showing first ${RESULT_CAP}` : ''}`
    : `browsing all ${total}`;

  results.innerHTML = '';
  if (keys.length === 0) {
    const empty = el('div', 'empty-bowl');
    empty.appendChild(el('div', 'big', 'Empty bowl.'));
    empty.appendChild(el('div', undefined, 'No acronym matches that. Try fewer letters, or a word from its expansion.'));
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
    details.appendChild(body);
    fragment.appendChild(details);
  }
  results.appendChild(fragment);

  // Auto-open a lone exact match.
  if (shown.length === 1) {
    (results.firstElementChild as HTMLDetailsElement).open = true;
  }
}

function initSearch(): void {
  const input = byId('search') as HTMLInputElement;
  const clear = byId('clear-search') as HTMLButtonElement;
  const query = new URLSearchParams(location.search).get('q');
  if (query) {
    input.value = query;
    state.query = query;
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
}

function main(): void {
  const total = Object.keys(data).length;
  byId('hero-count').textContent = String(total);
  byId('footer-count').textContent = String(total);
  renderCroutons();
  renderPills();
  renderAzStrip();
  renderSoupOfTheDay();
  initSearch();
  render();
}

main();
