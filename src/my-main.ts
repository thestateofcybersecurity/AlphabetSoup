import toolSlugs from 'virtual:tool-slugs';
import { announce } from './lib/announce';
import {
  assessmentSummaries,
  buildBundle,
  bundleFilename,
  collectStored,
  formatBytes,
  groupBySection,
  humanize,
  parseBundle,
  quizSummary,
  sectionLabel,
  PREFIX,
  type StoredItem,
} from './lib/my-data';

const byId = (id: string) => document.getElementById(id) as HTMLElement;

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

/** Read storage defensively: a blocked or full store must not blank the page. */
function readAll(): StoredItem[] {
  try {
    return collectStored(localStorage);
  } catch {
    return [];
  }
}

function message(text: string, bad = false): void {
  const box = byId('my-message');
  box.innerHTML = '';
  const note = el('p', `my-msg${bad ? ' bad' : ''}`, text);
  box.appendChild(note);
  announce(text);
}

function stat(value: string, label: string): HTMLElement {
  const box = el('div', 'my-stat');
  box.appendChild(el('b', undefined, value));
  box.appendChild(el('span', undefined, label));
  return box;
}

function renderSummary(items: StoredItem[]): void {
  const host = byId('my-summary');
  host.innerHTML = '';
  const row = el('div', 'my-stats');

  const quiz = quizSummary(items.find((i) => i.key === `${PREFIX}quiz`)?.value ?? null);
  if (quiz) {
    row.appendChild(stat(String(quiz.decksStarted), quiz.decksStarted === 1 ? 'deck started' : 'decks started'));
    row.appendChild(stat(String(quiz.totalRounds), quiz.totalRounds === 1 ? 'round played' : 'rounds played'));
    row.appendChild(stat(`${quiz.bestAverage}%`, 'average best'));
    if (quiz.dueForReview > 0) row.appendChild(stat(String(quiz.dueForReview), 'to review'));
  }

  const scores = assessmentSummaries(items);
  if (scores.length > 0) {
    row.appendChild(stat(String(scores.length), scores.length === 1 ? 'assessment scored' : 'assessments scored'));
  }
  row.appendChild(stat(formatBytes(items.reduce((n, i) => n + i.bytes, 0)), 'stored here'));
  host.appendChild(row);

  if (scores.length === 0) return;
  const section = el('section', 'my-section');
  section.appendChild(el('h2', 'my-h2', 'Assessment scores'));
  const list = el('ul', 'my-rows');
  for (const score of scores) {
    const li = el('li', 'my-row');
    const what = el('div', 'what');
    const line = el('div', 'score-row');
    line.appendChild(el('span', 'pct', `${score.latest}%`));
    line.appendChild(el('span', undefined, humanize(score.id)));
    if (score.delta !== null && score.delta !== 0) {
      const up = score.delta > 0;
      line.appendChild(
        el('span', up ? 'trend-up' : 'trend-down', `${up ? '▲' : '▼'} ${Math.abs(score.delta)} pts`),
      );
    }
    what.appendChild(line);
    what.appendChild(el('div', 'size', `last scored ${score.date}`));
    li.appendChild(what);
    const link = el('a', undefined, 'Open');
    link.href = `../assess/?a=${encodeURIComponent(score.id)}`;
    li.appendChild(link);
    list.appendChild(li);
  }
  section.appendChild(list);
  byId('my-summary').appendChild(section);
}

function renderSections(items: StoredItem[]): void {
  const host = byId('my-sections');
  host.innerHTML = '';
  for (const group of groupBySection(items, toolSlugs)) {
    const section = el('section', 'my-section');
    section.appendChild(el('h2', 'my-h2', `${sectionLabel(group.section)} · ${formatBytes(group.bytes)}`));
    const list = el('ul', 'my-rows');
    for (const { item, info } of group.items) {
      const li = el('li', 'my-row');
      const what = el('div', 'what');
      what.appendChild(el('div', undefined, info.label));
      what.appendChild(el('div', 'size', item.key));
      li.appendChild(what);
      li.appendChild(el('span', 'size', formatBytes(item.bytes)));
      if (info.href) {
        const link = el('a', undefined, 'Open');
        link.href = `../${info.href}`;
        li.appendChild(link);
      }
      list.appendChild(li);
    }
    section.appendChild(list);
    host.appendChild(section);
  }
}

function renderEmpty(): void {
  const host = byId('my-summary');
  host.innerHTML = '';
  const box = el('div', 'my-empty');
  box.appendChild(el('div', 'big', 'Nothing saved yet.'));
  box.appendChild(
    el(
      'p',
      undefined,
      'Take a quiz, run a self-assessment, or open a tool, and your progress will show up here. It stays on this device.',
    ),
  );
  const links = el('div', 'deck-actions');
  for (const [label, href] of [
    ['Take a quiz', '../quiz/'],
    ['Run an assessment', '../assess/'],
    ['Browse the tools', '../tools/'],
  ] as const) {
    const a = el('a', 'ghost-btn', label);
    a.href = href;
    links.appendChild(a);
  }
  box.appendChild(links);
  host.appendChild(box);
}

function render(): void {
  const items = readAll();
  byId('my-sections').innerHTML = '';
  const hasData = items.length > 0;
  byId('my-actions').hidden = !hasData;
  byId('my-note').hidden = !hasData;
  if (!hasData) {
    renderEmpty();
    return;
  }
  renderSummary(items);
  renderSections(items);
}

/* -------------------------------- actions ------------------------------- */

function download(): void {
  const items = readAll();
  if (items.length === 0) return;
  const exportedAt = new Date().toISOString();
  const bundle = buildBundle(items, exportedAt);
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = bundleFilename(exportedAt);
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  message(`Downloaded a backup of ${items.length} ${items.length === 1 ? 'item' : 'items'}.`);
}

function restore(text: string): void {
  const result = parseBundle(text);
  if (result.error || !result.items) {
    message(result.error ?? 'That backup could not be read.', true);
    return;
  }
  let written = 0;
  try {
    for (const [key, value] of Object.entries(result.items)) {
      localStorage.setItem(key, value);
      written += 1;
    }
  } catch {
    message('Ran out of space partway through restoring. Some data may be missing.', true);
    render();
    return;
  }
  render();
  message(`Restored ${written} ${written === 1 ? 'item' : 'items'} from the backup.`);
}

function eraseEverything(): void {
  const items = readAll();
  if (items.length === 0) return;
  const ok = confirm(
    `Permanently erase all ${items.length} saved items? Quiz progress, assessment answers and scores, plans, and tool data will be gone. This cannot be undone.`,
  );
  if (!ok) return;
  try {
    // Collected first, then removed: mutating while iterating the live Storage
    // object skips entries as indexes shift.
    for (const item of items) localStorage.removeItem(item.key);
  } catch {
    // Fall through: render will show whatever survived.
  }
  render();
  message('Erased everything this site had saved on this device.');
}

function main(): void {
  render();
  byId('export-btn').addEventListener('click', download);
  byId('erase-btn').addEventListener('click', eraseEverything);

  const file = byId('import-file') as HTMLInputElement;
  byId('import-btn').addEventListener('click', () => file.click());
  file.addEventListener('change', () => {
    const chosen = file.files?.[0];
    if (!chosen) return;
    void chosen
      .text()
      .then(restore)
      .catch(() => message('That file could not be read.', true))
      .finally(() => {
        // Reset so choosing the same file twice fires change again.
        file.value = '';
      });
  });
}

main();
