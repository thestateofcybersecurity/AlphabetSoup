/**
 * Reads back everything the site has saved in this browser.
 *
 * Every section stores its own state under its own key and nothing ever showed
 * you the whole picture: what you have in progress, how your scores are moving,
 * or what would actually be deleted if you cleared it. The privacy policy
 * promises the data is yours and stays on your device, and this is the page
 * that makes that inspectable rather than just stated.
 *
 * Keys are discovered by prefix rather than from a list. A tool added later
 * shows up here on its own, and more importantly export and erase cover it,
 * which is the failure mode that matters: a "delete my data" button that
 * silently misses a key is worse than not having one.
 */

export const PREFIX = 'alphabetsoup:';

export interface StoredItem {
  key: string;
  value: string;
  bytes: number;
}

/** The subset of the Storage API used here, so tests can pass a plain object. */
export interface StorageLike {
  length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  removeItem(key: string): void;
}

/** Every key this site owns, sorted for stable display. */
export function collectStored(storage: StorageLike): StoredItem[] {
  const items: StoredItem[] = [];
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (!key || !key.startsWith(PREFIX)) continue;
    const value = storage.getItem(key) ?? '';
    items.push({ key, value, bytes: value.length });
  }
  return items.sort((a, b) => a.key.localeCompare(b.key));
}

export type SectionId = 'quiz' | 'assessments' | 'roadmap' | 'tools' | 'other';

export interface KeyInfo {
  section: SectionId;
  /** Human label for this specific key. */
  label: string;
  /** Where to pick the work back up, relative to the site root. */
  href?: string;
}

const SECTION_LABELS: Record<SectionId, string> = {
  quiz: 'Quiz',
  assessments: 'Assessments',
  roadmap: 'Roadmap',
  tools: 'Tools',
  other: 'Other saved data',
};

export function sectionLabel(section: SectionId): string {
  return SECTION_LABELS[section];
}

/**
 * Slug parts that are acronyms or designators and should not be sentence-cased.
 *
 * Assessment ids are acronym-heavy, so the naive transform produced "Cis ig1"
 * and "Pci dss" on a site whose whole point is getting these names right.
 */
const UPPERCASE_PARTS = new Set([
  'cis',
  'csf',
  'cpg',
  'nist',
  'pci',
  'dss',
  'ssdf',
  'ig1',
  'ig2',
  'ig3',
  'roi',
  'ai',
  'bia',
  'ssdlc',
]);

/** Turn a slug like `skills-matrix` into `Skills matrix`, respecting acronyms. */
export function humanize(slug: string): string {
  const parts = slug.split('-').filter(Boolean);
  if (parts.length === 0) return slug;
  const shaped = parts.map((part, i) => {
    if (UPPERCASE_PARTS.has(part)) return part.toUpperCase();
    // Designators like v8 or 800171 keep their form rather than being capitalised.
    if (/^v?\d/.test(part)) return part;
    return i === 0 ? part.charAt(0).toUpperCase() + part.slice(1) : part;
  });
  return shaped.join(' ');
}

/**
 * Work out what a key is for.
 *
 * `toolSlugs` is passed in rather than hardcoded so the tool list stays derived
 * from the filesystem. Anything unrecognised still gets a row under "Other",
 * so nothing is invisible.
 */
export function describeKey(key: string, toolSlugs: readonly string[] = []): KeyInfo {
  const rest = key.slice(PREFIX.length);

  if (rest === 'quiz') return { section: 'quiz', label: 'Deck progress and review queue', href: 'quiz/' };
  if (rest === 'quiz-session') return { section: 'quiz', label: 'Round in progress', href: 'quiz/' };

  // Legacy single-assessment key, kept readable rather than dumped in "Other".
  if (rest === 'assessment') {
    return { section: 'assessments', label: 'Ransomware readiness (earlier format)', href: 'assess/' };
  }
  const assessment = /^assessment(-history|-notes)?:(.+)$/.exec(rest);
  if (assessment) {
    const kind = assessment[1];
    const id = assessment[2];
    const what = kind === '-history' ? 'score history' : kind === '-notes' ? 'notes' : 'answers';
    return { section: 'assessments', label: `${humanize(id)}: ${what}`, href: `assess/?a=${id}` };
  }

  const roadmap = /^roadmap:(.+)$/.exec(rest);
  if (roadmap) return { section: 'roadmap', label: `Plan: ${humanize(roadmap[1].replace(/:/g, ' '))}`, href: 'roadmap/' };

  const tool = /^([a-z0-9-]+):(.+)$/.exec(rest);
  if (tool && toolSlugs.includes(tool[1])) {
    return { section: 'tools', label: humanize(tool[1]), href: `tools/${tool[1]}/` };
  }

  return { section: 'other', label: rest };
}

export interface SectionGroup {
  section: SectionId;
  items: { item: StoredItem; info: KeyInfo }[];
  bytes: number;
}

/** Group stored keys by section, in a fixed display order, skipping empties. */
export function groupBySection(items: StoredItem[], toolSlugs: readonly string[] = []): SectionGroup[] {
  const order: SectionId[] = ['quiz', 'assessments', 'roadmap', 'tools', 'other'];
  const groups = new Map<SectionId, SectionGroup>();
  for (const item of items) {
    const info = describeKey(item.key, toolSlugs);
    const group = groups.get(info.section) ?? { section: info.section, items: [], bytes: 0 };
    group.items.push({ item, info });
    group.bytes += item.bytes;
    groups.set(info.section, group);
  }
  return order.filter((s) => groups.has(s)).map((s) => groups.get(s)!);
}

/* ------------------------------- summaries ------------------------------ */

export interface QuizSummary {
  decksStarted: number;
  totalRounds: number;
  bestAverage: number;
  dueForReview: number;
}

interface DeckProgressLike {
  attempts?: number;
  best?: number;
  missed?: Record<string, unknown>;
}

/** Headline quiz numbers, from stored progress alone. */
export function quizSummary(raw: string | null): QuizSummary | null {
  if (!raw) return null;
  let parsed: Record<string, DeckProgressLike>;
  try {
    parsed = JSON.parse(raw) as Record<string, DeckProgressLike>;
  } catch {
    return null;
  }
  const decks = Object.values(parsed).filter((d) => (d?.attempts ?? 0) > 0);
  if (decks.length === 0) return null;
  const bests = decks.map((d) => d.best ?? 0);
  return {
    decksStarted: decks.length,
    totalRounds: decks.reduce((sum, d) => sum + (d.attempts ?? 0), 0),
    bestAverage: Math.round(bests.reduce((a, b) => a + b, 0) / bests.length),
    dueForReview: Object.values(parsed).reduce(
      (sum, d) => sum + Object.keys(d?.missed ?? {}).length,
      0,
    ),
  };
}

export interface AssessmentSummary {
  id: string;
  latest: number;
  /** Change against the previous snapshot, null when there is only one. */
  delta: number | null;
  date: string;
}

/**
 * Latest score per assessment, read from the stored history snapshots.
 *
 * Deliberately not recomputed from the answers: that would need the assessment
 * datasets, which are ~330 KB and are now loaded on demand. The snapshots
 * already carry the scored result.
 */
export function assessmentSummaries(items: StoredItem[]): AssessmentSummary[] {
  const out: AssessmentSummary[] = [];
  for (const item of items) {
    const match = /^assessment-history:(.+)$/.exec(item.key.slice(PREFIX.length));
    if (!match) continue;
    let history: { date: string; overall: number }[];
    try {
      history = JSON.parse(item.value) as { date: string; overall: number }[];
    } catch {
      continue;
    }
    if (!Array.isArray(history) || history.length === 0) continue;
    const latest = history[history.length - 1];
    const previous = history.length > 1 ? history[history.length - 2] : null;
    out.push({
      id: match[1],
      latest: latest.overall,
      delta: previous ? latest.overall - previous.overall : null,
      date: latest.date,
    });
  }
  return out.sort((a, b) => a.latest - b.latest || a.id.localeCompare(b.id));
}

/* -------------------------------- export -------------------------------- */

export const BUNDLE_FORMAT = 'cybersecurity-alphabet-soup/backup';
export const BUNDLE_VERSION = 1;

export interface Bundle {
  format: string;
  version: number;
  exportedAt: string;
  items: Record<string, string>;
}

/** Everything, verbatim, so a restore is lossless. */
export function buildBundle(items: StoredItem[], exportedAt: string): Bundle {
  const bag: Record<string, string> = {};
  for (const item of items) bag[item.key] = item.value;
  return { format: BUNDLE_FORMAT, version: BUNDLE_VERSION, exportedAt, items: bag };
}

export interface ParseResult {
  items?: Record<string, string>;
  error?: string;
}

/**
 * Validate a pasted or uploaded backup before it touches storage.
 *
 * Keys outside this site's prefix are rejected rather than ignored: a restore
 * should never be able to write into another origin's data on a shared domain,
 * and silently dropping them would make a bad file look like a good one.
 */
export function parseBundle(json: string): ParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { error: 'That is not valid JSON.' };
  }
  if (typeof parsed !== 'object' || parsed === null) return { error: 'That file is not a backup.' };
  const bundle = parsed as Partial<Bundle>;
  if (bundle.format !== BUNDLE_FORMAT) {
    return { error: 'That file was not exported from this site.' };
  }
  if (typeof bundle.version !== 'number' || bundle.version > BUNDLE_VERSION) {
    return { error: 'That backup came from a newer version of the site.' };
  }
  if (typeof bundle.items !== 'object' || bundle.items === null) {
    return { error: 'That backup has no data in it.' };
  }
  const items: Record<string, string> = {};
  for (const [key, value] of Object.entries(bundle.items)) {
    if (!key.startsWith(PREFIX)) return { error: `That backup contains an unexpected key: ${key}` };
    if (typeof value !== 'string') return { error: `That backup has a bad value for ${key}.` };
    items[key] = value;
  }
  if (Object.keys(items).length === 0) return { error: 'That backup has no data in it.' };
  return { items };
}

/** A filename that sorts by date and says what it is. */
export function bundleFilename(exportedAt: string): string {
  return `alphabet-soup-backup-${exportedAt.slice(0, 10)}.json`;
}

/** Human-readable size for a byte count. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}
