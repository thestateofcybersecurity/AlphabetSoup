import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  answerCurrent,
  createSession,
  dueForReview,
  isDone,
  recordRound,
  reviewSession,
  scheduledCount,
  scorePercent,
  shuffledChoices,
} from '../src/lib/quiz';
import type { ChoiceDeck, Deck, DeckMeta, FlipDeck, QuizProgress } from '../src/lib/quiz';
import deckIndex from '../src/data/quiz/index.json';

const quizDir = fileURLToPath(new URL('../src/data/quiz', import.meta.url));

const rng = (sequence: number[]) => {
  let i = 0;
  return () => sequence[i++ % sequence.length];
};

describe('quiz datasets', () => {
  const metas = deckIndex as DeckMeta[];

  it('index matches the deck files on disk', () => {
    const files = readdirSync(quizDir).filter((f) => f.endsWith('.json') && f !== 'index.json');
    expect(files.sort()).toEqual(metas.map((m) => `${m.slug}.json`).sort());
  });

  it('every deck validates', () => {
    for (const meta of metas) {
      const deck = JSON.parse(readFileSync(`${quizDir}/${meta.slug}.json`, 'utf8')) as Deck;
      expect(deck.mode).toBe(meta.mode);
      expect(deck.questions.length).toBe(meta.count);
      expect(deck.questions.length).toBeGreaterThan(20);
      const seen = new Set<string>();
      for (const question of deck.questions) {
        expect(question.q.trim().length).toBeGreaterThan(5);
        expect(seen.has(question.q)).toBe(false);
        seen.add(question.q);
        if (deck.mode === 'choice') {
          const cq = question as ChoiceDeck['questions'][number];
          expect(cq.choices).toHaveLength(4);
          expect(new Set(cq.choices).size).toBe(4);
          expect(cq.correctIndex).toBeGreaterThanOrEqual(0);
          expect(cq.correctIndex).toBeLessThan(4);
          expect(cq.why, `missing rationale: ${cq.q.slice(0, 50)}`).toBeTruthy();
          expect(cq.why!.length).toBeGreaterThanOrEqual(40);
          expect(cq.why!.length).toBeLessThanOrEqual(300);
          expect(cq.why).not.toContain('—');
        } else {
          const fq = question as FlipDeck['questions'][number];
          expect(fq.a.trim().length).toBeGreaterThan(2);
        }
      }
    }
  });

  it('has the expected deck lineup', () => {
    const slugs = metas.map((m) => m.slug).sort();
    expect(slugs).toContain('cissp');
    expect(slugs).toContain('fundamentals');
    expect(metas.find((m) => m.slug === 'lpt')?.retired).toBe(true);
    expect(metas.find((m) => m.slug === 'cissp')?.certKey).toBe('CISSP');
  });
});

describe('quiz session', () => {
  it('runs a full session with scoring and missed tracking', () => {
    let session = createSession(10, 3, rng([0.1, 0.2, 0.3, 0.4, 0.5]));
    expect(session.order).toHaveLength(3);
    session = answerCurrent(session, true);
    session = answerCurrent(session, false);
    expect(isDone(session)).toBe(false);
    session = answerCurrent(session, true);
    expect(isDone(session)).toBe(true);
    expect(session.correct).toBe(2);
    expect(session.missed).toHaveLength(1);
    expect(scorePercent(session)).toBe(67);
  });

  it('ignores answers after completion', () => {
    let session = createSession(2, 2);
    session = answerCurrent(session, true);
    session = answerCurrent(session, true);
    const after = answerCurrent(session, false);
    expect(after).toEqual(session);
  });

  it('builds a review session from misses', () => {
    let session = createSession(5, 5, rng([0.9, 0.1, 0.5, 0.3, 0.7]));
    session = answerCurrent(session, false);
    session = answerCurrent(session, true);
    session = answerCurrent(session, false);
    session = answerCurrent(session, true);
    session = answerCurrent(session, true);
    const review = reviewSession(session, rng([0.2]));
    expect(review.order.sort()).toEqual(session.missed.sort());
    expect(review.position).toBe(0);
  });

  it('shuffles choices while tracking the correct index', () => {
    const question = { q: 'x', choices: ['a', 'b', 'c', 'd'], correctIndex: 2 };
    const { choices, correctIndex } = shuffledChoices(question, rng([0.9, 0.1, 0.6, 0.2]));
    expect([...choices].sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(choices[correctIndex]).toBe('c');
  });
});

describe('spaced repetition', () => {
  it('schedules missed questions due now and advances correct ones', () => {
    let progress: QuizProgress = {};
    // Miss two questions today.
    progress = recordRound(progress, 'deck', { percent: 50, missedQuestions: ['Q1', 'Q2'], correctQuestions: [] }, '2026-01-01');
    expect(scheduledCount(progress, 'deck')).toBe(2);
    expect(dueForReview(progress, 'deck', '2026-01-01')).toEqual(['Q1', 'Q2']);

    // Review round: get Q1 right (box 1 -> 2, due +2 days), Q2 wrong (stays box 1, due now).
    progress = recordRound(progress, 'deck', { missedQuestions: ['Q2'], correctQuestions: ['Q1'] }, '2026-01-01');
    const sched = progress.deck.schedule!;
    expect(sched.Q1.box).toBe(2);
    expect(sched.Q1.due).toBe('2026-01-03');
    // Q1 is no longer due on the 1st, Q2 still is.
    expect(dueForReview(progress, 'deck', '2026-01-01')).toEqual(['Q2']);
    // On the 3rd, Q1 comes due again.
    expect(dueForReview(progress, 'deck', '2026-01-03')).toContain('Q1');
  });

  it('graduates a question out of the schedule after the top box', () => {
    let progress: QuizProgress = { deck: { attempts: 0, best: 0, missed: {}, schedule: { Q1: { box: 5, due: '2026-01-01' } } } };
    progress = recordRound(progress, 'deck', { missedQuestions: [], correctQuestions: ['Q1'] }, '2026-01-01');
    expect(scheduledCount(progress, 'deck')).toBe(0);
  });

  it('leaves the schedule untouched when no date is given (backward compatible)', () => {
    const progress = recordRound({}, 'deck', { percent: 80, missedQuestions: ['Q1'], correctQuestions: [] });
    expect(progress.deck.schedule).toEqual({});
    expect(progress.deck.missed.Q1).toBe(1);
  });
});
