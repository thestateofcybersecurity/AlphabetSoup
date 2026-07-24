import dataRaw from './data/trust-library.json';
import type { Entry, QuestionResult, TrustData } from './lib/trust-package';
import { matchBatch } from './lib/trust-package';

const base = dataRaw as TrustData;

const OVERRIDES_KEY = 'alphabetsoup:trust:overrides';
const FACTS_KEY = 'alphabetsoup:trust:facts';

const entryIds = new Set(base.entries.map((e) => e.id));
const categoryName = new Map(base.categories.map((c) => [c.id, c.name]));

interface Override {
  answer: string;
  updatedAt: string;
}
interface Facts {
  company: string;
  overview: string;
  certs: string;
  subs: string;
}

let overrides: Record<string, Override> = {};
let facts: Facts = { company: '', overview: '', certs: '', subs: '' };

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;

function esc(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// ------------------------------- state --------------------------------

const persistOverrides = (): void => localStorage.setItem(OVERRIDES_KEY, JSON.stringify(overrides));
const persistFacts = (): void => localStorage.setItem(FACTS_KEY, JSON.stringify(facts));

function loadState(): void {
  try {
    const raw = JSON.parse(localStorage.getItem(OVERRIDES_KEY) ?? '{}') as Record<string, unknown>;
    if (raw && typeof raw === 'object') {
      for (const [id, v] of Object.entries(raw)) {
        if (entryIds.has(id) && v && typeof v === 'object' && typeof (v as Override).answer === 'string') {
          overrides[id] = { answer: (v as Override).answer, updatedAt: (v as Override).updatedAt || '' };
        }
      }
    }
  } catch {
    /* ignore */
  }
  try {
    const raw = JSON.parse(localStorage.getItem(FACTS_KEY) ?? 'null') as Partial<Facts> | null;
    if (raw && typeof raw === 'object') {
      for (const k of ['company', 'overview', 'certs', 'subs'] as const) if (typeof raw[k] === 'string') facts[k] = raw[k] as string;
    }
  } catch {
    /* ignore */
  }
}

/** The library with any user edits applied, for both matching and export. */
function effectiveData(): TrustData {
  return {
    ...base,
    entries: base.entries.map((e) => (overrides[e.id] ? { ...e, answer: overrides[e.id].answer } : e)),
  };
}

// ------------------------------- match --------------------------------

function answerBlock(entry: Entry, confidence: string): string {
  return `
    <div class="tp-ans">
      <div class="tp-ans-top">
        <span class="tp-ans-cat">${esc(categoryName.get(entry.category) ?? entry.category)}</span>
        <span class="tp-conf ${confidence}">${confidence}</span>
        <span class="tp-copy"><button type="button" data-copy="${entry.id}">Copy</button></span>
      </div>
      <p class="tp-ans-text">${esc(overrides[entry.id]?.answer ?? entry.answer)}</p>
    </div>`;
}

function renderMatches(results: QuestionResult[]): void {
  const host = $('#match-results');
  if (results.length === 0) {
    host.innerHTML = '';
    return;
  }
  const cards = results
    .map((r) => {
      const body =
        r.matches.length === 0
          ? '<p class="tp-nomatch">No library answer yet. Added to the gap list below.</p>'
          : r.matches.map((m) => answerBlock(m.entry, m.confidence)).join('');
      return `<div class="tp-match"><p class="tp-match-q">${esc(r.question)}</p>${body}</div>`;
    })
    .join('');
  const gapList = results.filter((r) => r.matches.length === 0).map((r) => r.question);
  const gapHtml =
    gapList.length === 0
      ? ''
      : `<div class="tp-gaps"><h3>Gaps: ${gapList.length} question${gapList.length === 1 ? '' : 's'} with no answer yet</h3><ul>${gapList
          .map((q) => `<li>${esc(q)}</li>`)
          .join('')}</ul></div>`;
  host.innerHTML = cards + gapHtml;

  for (const btn of host.querySelectorAll<HTMLButtonElement>('button[data-copy]')) {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.copy!;
      const entry = base.entries.find((e) => e.id === id);
      if (!entry) return;
      await navigator.clipboard.writeText(overrides[id]?.answer ?? entry.answer);
      btn.textContent = 'Copied';
      setTimeout(() => (btn.textContent = 'Copy'), 1400);
    });
  }
}

function runMatch(): void {
  renderMatches(matchBatch(effectiveData(), ($('#query') as HTMLTextAreaElement).value));
}

// ------------------------------ library -------------------------------

function libCount(): void {
  const edited = Object.keys(overrides).length;
  $('#lib-count').textContent = `${base.entries.length} answers${edited > 0 ? `, ${edited} edited` : ''}`;
}

function renderLibrary(): void {
  const host = $('#library');
  host.innerHTML = base.categories
    .map((cat) => {
      const inCat = base.entries.filter((e) => e.category === cat.id);
      if (inCat.length === 0) return '';
      const rows = inCat
        .map((e) => {
          const ov = overrides[e.id];
          const answer = ov?.answer ?? e.answer;
          const fresh = ov?.updatedAt ? `Edited ${esc(ov.updatedAt)}` : 'Starter answer';
          return `
          <div class="tp-entry" data-id="${e.id}">
            <p class="tp-entry-q">${esc(e.question)}</p>
            <textarea rows="3" data-answer="${e.id}" aria-label="Answer">${esc(answer)}</textarea>
            <div class="tp-entry-meta">
              <span class="tp-fresh">${fresh}</span>
              ${ov ? '<span class="tp-edited">edited</span>' : ''}
            </div>
          </div>`;
        })
        .join('');
      return `<details class="tp-cat"><summary>${esc(cat.name)}<span class="tp-cat-n">${inCat.length}</span></summary>${rows}</details>`;
    })
    .join('');

  host.addEventListener('input', (event) => {
    const ta = event.target as HTMLTextAreaElement;
    const id = ta.dataset.answer;
    if (!id) return;
    overrides[id] = { answer: ta.value, updatedAt: today() };
    persistOverrides();
    const meta = ta.closest('.tp-entry')?.querySelector('.tp-entry-meta') as HTMLElement | null;
    if (meta) meta.innerHTML = `<span class="tp-fresh">Edited ${esc(today())}</span><span class="tp-edited">edited</span>`;
    libCount();
  });
}

function initLibraryTools(): void {
  $('#export-lib').addEventListener('click', () => {
    const payload = { exportedAt: new Date().toISOString(), version: base.meta.version, overrides, facts };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'trust-answer-library.json';
    link.click();
    URL.revokeObjectURL(link.href);
  });

  $('#import-lib').addEventListener('click', () => ($('#import-file') as HTMLInputElement).click());
  $('#import-file').addEventListener('change', (event) => {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as { overrides?: unknown; facts?: unknown };
        if (parsed.overrides && typeof parsed.overrides === 'object') {
          overrides = {};
          for (const [id, v] of Object.entries(parsed.overrides as Record<string, unknown>)) {
            if (entryIds.has(id) && v && typeof v === 'object' && typeof (v as Override).answer === 'string') {
              overrides[id] = { answer: (v as Override).answer, updatedAt: (v as Override).updatedAt || today() };
            }
          }
          persistOverrides();
        }
        if (parsed.facts && typeof parsed.facts === 'object') {
          for (const k of ['company', 'overview', 'certs', 'subs'] as const) {
            const val = (parsed.facts as Partial<Facts>)[k];
            if (typeof val === 'string') facts[k] = val;
          }
          persistFacts();
          syncFactFields();
        }
        renderLibrary();
        libCount();
        runMatch();
      } catch {
        alert('That file could not be read as a trust library export.');
      }
    };
    reader.readAsText(file);
    (event.target as HTMLInputElement).value = '';
  });

  $('#reset-lib').addEventListener('click', () => {
    if (!confirm('Reset all answers to the starter defaults? Your edits will be lost.')) return;
    overrides = {};
    persistOverrides();
    renderLibrary();
    libCount();
    runMatch();
  });
}

// --------------------------- trust package ----------------------------

function initFacts(): void {
  const map: [string, keyof Facts][] = [
    ['#tp-company', 'company'],
    ['#tp-overview', 'overview'],
    ['#tp-certs', 'certs'],
    ['#tp-subs', 'subs'],
  ];
  for (const [sel, key] of map) {
    const el = $(sel) as HTMLInputElement | HTMLTextAreaElement;
    el.addEventListener('input', () => {
      facts[key] = el.value;
      persistFacts();
    });
  }
}

function syncFactFields(): void {
  ($('#tp-company') as HTMLInputElement).value = facts.company;
  ($('#tp-overview') as HTMLTextAreaElement).value = facts.overview;
  ($('#tp-certs') as HTMLTextAreaElement).value = facts.certs;
  ($('#tp-subs') as HTMLTextAreaElement).value = facts.subs;
}

function buildTrustPackage(): void {
  const data = effectiveData();
  const title = facts.company.trim() ? `${facts.company.trim()} security trust package` : 'Security trust package';
  const section = (label: string, value: string): string =>
    value.trim() ? `<h3>${esc(label)}</h3><p>${esc(value.trim())}</p>` : '';

  const faq = data.categories
    .map((cat) => {
      const inCat = data.entries.filter((e) => e.category === cat.id);
      if (inCat.length === 0) return '';
      const items = inCat
        .map((e) => `<p class="tp-faq-q">${esc(e.question)}</p><p>${esc(e.answer)}</p>`)
        .join('');
      return `<h3>${esc(cat.name)}</h3>${items}`;
    })
    .join('');

  $('#trust-doc').innerHTML = `
    <div class="tp-doc">
      <h2>${esc(title)}</h2>
      ${section('Program overview', facts.overview)}
      ${section('Certifications and attestations', facts.certs)}
      ${section('Subprocessors', facts.subs)}
      <h3 style="margin-top:22px;">Security FAQ</h3>
      ${faq}
    </div>`;
  ($('#print-doc') as HTMLElement).hidden = false;
  $('#trust-doc').scrollIntoView({ behavior: 'smooth' });
}

// -------------------------------- boot --------------------------------

loadState();
$('#entry-count').textContent = String(base.entries.length);
renderLibrary();
libCount();
initLibraryTools();
syncFactFields();
initFacts();

$('#match-btn').addEventListener('click', runMatch);
$('#query').addEventListener('keydown', (event) => {
  if ((event as KeyboardEvent).key === 'Enter' && (event as KeyboardEvent).ctrlKey) runMatch();
});
$('#clear-query').addEventListener('click', () => {
  ($('#query') as HTMLTextAreaElement).value = '';
  renderMatches([]);
});
$('#build-btn').addEventListener('click', buildTrustPackage);
$('#print-doc').addEventListener('click', () => window.print());
