export interface ChoiceQuestion {
  q: string;
  choices: string[];
  correctIndex: number;
  /** One or two sentences explaining the correct answer. */
  why?: string;
}

export interface FlipQuestion {
  q: string;
  a: string;
}

export interface ChoiceDeck {
  name: string;
  mode: 'choice';
  certKey: string | null;
  retired: boolean;
  questions: ChoiceQuestion[];
}

export interface FlipDeck {
  name: string;
  mode: 'flip';
  certKey: string | null;
  retired: boolean;
  questions: FlipQuestion[];
}

export type Deck = ChoiceDeck | FlipDeck;

export interface DeckMeta {
  slug: string;
  name: string;
  mode: 'choice' | 'flip';
  certKey: string | null;
  retired: boolean;
  count: number;
}

export interface QuizSession {
  /** Question order as indexes into the deck. */
  order: number[];
  position: number;
  correct: number;
  missed: number[];
}

/** Fisher-Yates using a caller-provided RNG for testability. */
export function shuffle<T>(items: T[], random: () => number = Math.random): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function createSession(
  deckSize: number,
  questionCount: number,
  random: () => number = Math.random,
): QuizSession {
  const order = shuffle(
    Array.from({ length: deckSize }, (_, i) => i),
    random,
  ).slice(0, Math.min(questionCount, deckSize));
  return { order, position: 0, correct: 0, missed: [] };
}

/** Record an answer for the current question and advance. Pure. */
export function answerCurrent(session: QuizSession, wasCorrect: boolean): QuizSession {
  if (session.position >= session.order.length) return session;
  return {
    order: session.order,
    position: session.position + 1,
    correct: session.correct + (wasCorrect ? 1 : 0),
    missed: wasCorrect ? session.missed : [...session.missed, session.order[session.position]],
  };
}

export function isDone(session: QuizSession): boolean {
  return session.position >= session.order.length;
}

export function scorePercent(session: QuizSession): number {
  return session.position === 0 ? 0 : Math.round((session.correct / session.position) * 100);
}

/** A session replaying only the missed questions from a finished session. */
export function reviewSession(previous: QuizSession, random: () => number = Math.random): QuizSession {
  return { order: shuffle(previous.missed, random), position: 0, correct: 0, missed: [] };
}

/* ----------------------- persistent deck progress ---------------------- */

export interface DeckProgress {
  attempts: number;
  best: number;
  /** Question text -> consecutive-miss count. */
  missed: Record<string, number>;
}

export type QuizProgress = Record<string, DeckProgress>;

export interface RoundOutcome {
  /** Percent score; omit for review-only rounds. */
  percent?: number;
  missedQuestions: string[];
  correctQuestions: string[];
}

/** Fold a finished round into stored progress. Pure. */
export function recordRound(progress: QuizProgress, slug: string, outcome: RoundOutcome): QuizProgress {
  const previous: DeckProgress = progress[slug] ?? { attempts: 0, best: 0, missed: {} };
  const missed = { ...previous.missed };
  for (const question of outcome.missedQuestions) {
    missed[question] = (missed[question] ?? 0) + 1;
  }
  for (const question of outcome.correctQuestions) {
    delete missed[question];
  }
  const isFullRound = outcome.percent !== undefined;
  return {
    ...progress,
    [slug]: {
      attempts: previous.attempts + (isFullRound ? 1 : 0),
      best: isFullRound ? Math.max(previous.best, outcome.percent!) : previous.best,
      missed,
    },
  };
}

/** Missed questions for a deck, most-missed first. */
export function missedBank(progress: QuizProgress, slug: string): string[] {
  const missed = progress[slug]?.missed ?? {};
  return Object.keys(missed).sort((a, b) => missed[b] - missed[a] || a.localeCompare(b));
}

/**
 * Shuffled view of a choice question's options, remembering where the
 * correct answer landed.
 */
export function shuffledChoices(
  question: ChoiceQuestion,
  random: () => number = Math.random,
): { choices: string[]; correctIndex: number } {
  const indexes = shuffle(
    question.choices.map((_, i) => i),
    random,
  );
  return {
    choices: indexes.map((i) => question.choices[i]),
    correctIndex: indexes.indexOf(question.correctIndex),
  };
}
