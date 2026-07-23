/**
 * Trust Package and Questionnaire Answer Library: client-side keyword matching
 * over the answer library in src/data/trust-library.json. A pasted questionnaire
 * question is tokenized and scored against each entry's question text and
 * keywords; the best matches come back with a confidence band. All pure, and
 * nothing about the matching leaves the browser.
 */

export type CategoryId =
  | 'governance'
  | 'access-control'
  | 'authentication'
  | 'encryption'
  | 'network-security'
  | 'application-security'
  | 'vulnerability-management'
  | 'incident-response'
  | 'business-continuity'
  | 'data-privacy'
  | 'subprocessors'
  | 'personnel-physical'
  | 'compliance-monitoring';

export interface Entry {
  id: string;
  category: CategoryId;
  question: string;
  keywords: string[];
  answer: string;
}

export interface TrustData {
  meta: { title: string; version: string; note: string; sources: { name: string; url: string }[] };
  categories: { id: CategoryId; name: string }[];
  entries: Entry[];
}

export type Confidence = 'high' | 'medium' | 'low';

export interface Match {
  entry: Entry;
  score: number;
  confidence: Confidence;
}

// Common question filler that carries no matching signal.
const STOPWORDS = new Set([
  'the', 'a', 'an', 'of', 'and', 'or', 'to', 'in', 'on', 'for', 'with', 'is', 'are', 'do', 'does', 'did', 'you',
  'your', 'we', 'our', 'have', 'has', 'how', 'what', 'which', 'that', 'this', 'these', 'those', 'please', 'describe',
  'provide', 'explain', 'list', 'any', 'all', 'be', 'can', 'will', 'would', 'if', 'as', 'at', 'by', 'from', 'it',
  'its', 'their', 'they', 'about', 'use', 'used', 'using', 'there', 'been', 'was', 'were', 'per', 'via',
]);

/** Lowercase alphanumeric tokens, stopwords and 1-char tokens removed. */
export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

function scoreEntry(query: string, queryTokens: string[], entry: Entry): number {
  if (queryTokens.length === 0) return 0;
  const querySet = new Set(queryTokens);
  const normQuery = ` ${query.toLowerCase()} `;

  // Bag of the entry's own significant tokens (question text + keywords).
  const bag = new Set<string>([...tokenize(entry.question), ...entry.keywords.flatMap((k) => tokenize(k))]);
  let overlap = 0;
  for (const token of querySet) if (bag.has(token)) overlap += 1;

  // Multi-word keyword phrases that appear verbatim in the query are strong signal.
  let phraseHits = 0;
  for (const keyword of entry.keywords) {
    const k = keyword.toLowerCase().trim();
    if (k.includes(' ') && normQuery.includes(` ${k} `)) phraseHits += 1;
  }

  return (overlap + 2 * phraseHits) / querySet.size;
}

function bandFor(score: number): Confidence {
  if (score >= 0.5) return 'high';
  if (score >= 0.28) return 'medium';
  return 'low';
}

// Below this, we treat the question as unmatched (a gap) rather than a weak guess.
export const MATCH_FLOOR = 0.16;

/** Ranked matches for one question, best first, above the match floor. */
export function matchQuestion(data: TrustData, query: string, limit = 3): Match[] {
  const queryTokens = tokenize(query);
  return data.entries
    .map((entry) => ({ entry, score: scoreEntry(query, queryTokens, entry) }))
    .filter((m) => m.score >= MATCH_FLOOR)
    .sort((a, b) => b.score - a.score || a.entry.id.localeCompare(b.entry.id))
    .slice(0, limit)
    .map((m) => ({ entry: m.entry, score: Math.round(m.score * 100) / 100, confidence: bandFor(m.score) }));
}

export interface QuestionResult {
  question: string;
  matches: Match[];
}

/** Split a pasted block into questions (one per line) and match each. */
export function matchBatch(data: TrustData, text: string, limit = 3): QuestionResult[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((question) => ({ question, matches: matchQuestion(data, question, limit) }));
}

/** Questions from a batch that found no answer above the floor. */
export function gaps(results: QuestionResult[]): string[] {
  return results.filter((r) => r.matches.length === 0).map((r) => r.question);
}
