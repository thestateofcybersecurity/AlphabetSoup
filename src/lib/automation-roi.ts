/**
 * Automation ROI Ranker: transparent, deterministic math over a user-entered
 * task inventory. Hours saved per month = monthly volume * minutes / 60,
 * discounted by how automatable the category is and how much human oversight
 * the error sensitivity demands. Everything is pure and shown on screen.
 */

export interface Category {
  id: string;
  name: string;
  defaultPattern: string;
  automatable: number;
}
export interface Sensitivity {
  id: string;
  name: string;
  autoRetain: number;
  note: string;
}
export interface Pattern {
  id: string;
  name: string;
  blurb: string;
  skeleton: string[];
}
export interface AutomationData {
  meta: { title: string; version: string; note: string; fteHoursPerMonth: number; sources: { name: string; url: string }[] };
  categories: Category[];
  sensitivities: Sensitivity[];
  patterns: Pattern[];
}

/** One row of the inventory as entered by the user. */
export interface Task {
  id: string;
  name: string;
  category: string;
  volume: number;
  minutes: number;
  sensitivity: string;
}

export interface ScoredTask {
  task: Task;
  category: Category;
  sensitivity: Sensitivity;
  pattern: Pattern;
  humanGate: boolean;
  rawHours: number;
  automatableFraction: number;
  hoursSaved: number;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

// Categories where a high-sensitivity task is best handled by AI-assisted triage
// behind a human gate rather than its default unattended pattern.
const TRIAGE_LIKE = new Set(['alert-triage', 'enrichment', 'vuln-triage', 'phishing']);

function pickPattern(data: AutomationData, category: Category, sensitivityId: string): { pattern: Pattern; humanGate: boolean } {
  const patternById = new Map(data.patterns.map((p) => [p.id, p]));
  let patternId = category.defaultPattern;
  if (sensitivityId === 'high' && TRIAGE_LIKE.has(category.id)) patternId = 'ai-triage';
  const pattern = patternById.get(patternId) ?? data.patterns[0];
  const humanGate = sensitivityId === 'high' || pattern.id === 'ai-triage';
  return { pattern, humanGate };
}

/** Score a single task; unknown category/sensitivity ids yield zero hours saved. */
export function scoreTask(data: AutomationData, task: Task): ScoredTask | null {
  const category = data.categories.find((c) => c.id === task.category);
  const sensitivity = data.sensitivities.find((s) => s.id === task.sensitivity);
  if (!category || !sensitivity) return null;
  const volume = Math.max(0, task.volume) || 0;
  const minutes = Math.max(0, task.minutes) || 0;
  const rawHours = (volume * minutes) / 60;
  const automatableFraction = category.automatable * sensitivity.autoRetain;
  const { pattern, humanGate } = pickPattern(data, category, task.sensitivity);
  return {
    task,
    category,
    sensitivity,
    pattern,
    humanGate,
    rawHours: round1(rawHours),
    automatableFraction: Math.round(automatableFraction * 100) / 100,
    hoursSaved: round1(rawHours * automatableFraction),
  };
}

/** All scorable tasks ranked by monthly hours saved (highest first). */
export function rankBacklog(data: AutomationData, tasks: Task[]): ScoredTask[] {
  return tasks
    .map((t) => scoreTask(data, t))
    .filter((s): s is ScoredTask => s !== null)
    .sort((a, b) => b.hoursSaved - a.hoursSaved || a.task.name.localeCompare(b.task.name));
}

export interface Capacity {
  currentHours: number;
  savedHours: number;
  remainingHours: number;
  fteHours: number;
  currentFte: number;
  savedFte: number;
}

/** Before/after capacity: total manual load, hours returned, and FTE equivalents. */
export function capacityModel(data: AutomationData, scored: ScoredTask[]): Capacity {
  const fteHours = data.meta.fteHoursPerMonth || 140;
  const currentHours = scored.reduce((n, s) => n + s.rawHours, 0);
  const savedHours = scored.reduce((n, s) => n + s.hoursSaved, 0);
  return {
    currentHours: round1(currentHours),
    savedHours: round1(savedHours),
    remainingHours: round1(currentHours - savedHours),
    fteHours,
    currentFte: Math.round((currentHours / fteHours) * 100) / 100,
    savedFte: Math.round((savedHours / fteHours) * 100) / 100,
  };
}

/** CSV of the ranked backlog for export. */
export function backlogCsv(scored: ScoredTask[]): string {
  const header = ['Rank', 'Task', 'Category', 'Volume/mo', 'Min each', 'Sensitivity', 'Hours now', 'Hours saved', 'Pattern'];
  const cell = (v: string): string => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [header.join(',')];
  scored.forEach((s, i) => {
    lines.push(
      [
        String(i + 1),
        s.task.name,
        s.category.name,
        String(s.task.volume),
        String(s.task.minutes),
        s.sensitivity.name,
        String(s.rawHours),
        String(s.hoursSaved),
        s.pattern.name,
      ]
        .map(cell)
        .join(','),
    );
  });
  return lines.join('\n');
}
