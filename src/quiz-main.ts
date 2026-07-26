import deckIndexRaw from './data/quiz/index.json';
import { announce } from './lib/announce';
import { shareOrCopy } from './lib/share';
import {
  answerCurrent,
  createSession,
  dueForReview,
  isDone,
  recordRound,
  reviewSession,
  scorePercent,
  shuffle,
  shuffledChoices,
} from './lib/quiz';
import type {
  ChoiceQuestion,
  Deck,
  DeckMeta,
  FlipQuestion,
  QuizProgress,
  QuizSession,
} from './lib/quiz';
import { slugForKey } from './lib/slug';

const deckIndex = deckIndexRaw as DeckMeta[];
const deckModules = import.meta.glob('./data/quiz/*.json');
const byId = (id: string) => document.getElementById(id) as HTMLElement;

const QUESTIONS_PER_RUN = 20;
const PROGRESS_KEY = 'alphabetsoup:quiz';

let currentDeck: Deck | null = null;
let currentMeta: DeckMeta | null = null;
let session: QuizSession | null = null;
/** Whether the current session is a full scored round (vs a review/drill). */
let fullRound = true;
/** Question indexes answered correctly/missed during this round. */
let roundCorrect: number[] = [];
let roundMissed: number[] = [];

function loadProgress(): QuizProgress {
  try {
    return JSON.parse(localStorage.getItem(PROGRESS_KEY) ?? '{}') as QuizProgress;
  } catch {
    return {};
  }
}

function saveProgress(progress: QuizProgress): void {
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
  } catch {
    // Private mode: progress just is not remembered.
  }
}

/* ---- exam mode + in-flight session resume ---- */

const SESSION_KEY = 'alphabetsoup:quiz-session';
const EXAM_PASS = 72;
let examMode = false;
let examStartMs = 0;

function today(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
}

interface SavedSession {
  slug: string;
  session: QuizSession;
  fullRound: boolean;
  exam: boolean;
  roundCorrect: number[];
  roundMissed: number[];
}

function persistSession(): void {
  if (!currentMeta || !session) return;
  try {
    localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ slug: currentMeta.slug, session, fullRound, exam: examMode, roundCorrect, roundMissed } as SavedSession),
    );
  } catch {
    // ignore
  }
}

function clearSavedSession(): void {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    // ignore
  }
}

function loadSavedSession(): SavedSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    const saved = raw ? (JSON.parse(raw) as SavedSession) : null;
    return saved && saved.session.position < saved.session.order.length ? saved : null;
  } catch {
    return null;
  }
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

async function loadDeck(slug: string): Promise<Deck> {
  const loader = deckModules[`./data/quiz/${slug}.json`];
  if (!loader) throw new Error(`Unknown deck: ${slug}`);
  const module = (await loader()) as { default: Deck };
  return module.default;
}

function renderDeckGrid(): void {
  byId('player').hidden = true;
  const grid = byId('deck-grid');
  grid.hidden = false;
  grid.innerHTML = '';
  for (const meta of deckIndex) {
    const card = el('article', 'deck-card');
    const head = el('div', 'deck-head');
    head.appendChild(el('h2', 'deck-name', meta.name));
    if (meta.retired) head.appendChild(el('span', 'chip', 'retired cert'));
    card.appendChild(head);
    const progress = loadProgress()[meta.slug];
    const stats = progress?.attempts
      ? ` · best ${progress.best}% · ${progress.attempts} round${progress.attempts === 1 ? '' : 's'}`
      : '';
    card.appendChild(
      el('p', 'deck-sub', `${meta.count} ${meta.mode === 'choice' ? 'practice questions' : 'flashcards'}${stats}`),
    );
    const actions = el('div', 'deck-actions');
    const start = el('button', 'primary-btn', meta.mode === 'choice' ? 'Start quiz' : 'Study cards');
    start.addEventListener('click', () => {
      if (meta.mode === 'choice') renderSetup(meta);
      else void startDeck(meta, meta.count, false);
    });
    actions.appendChild(start);
    const due = dueForReview(loadProgress(), meta.slug, today());
    if (due.length > 0) {
      const drill = el('button', 'ghost-btn missed', `Review due (${due.length})`);
      drill.addEventListener('click', () => void startReview(meta));
      actions.appendChild(drill);
    }
    if (meta.certKey) {
      const gloss = el('a', 'permalink', 'about this cert');
      gloss.href = `../definitions/${slugForKey(meta.certKey)}.html`;
      actions.appendChild(gloss);
    }
    card.appendChild(actions);
    grid.appendChild(card);
  }
}

/** A pre-quiz setup: choose how many questions and whether to run a timed exam. */
function renderSetup(meta: DeckMeta): void {
  const player = playerShell();
  player.appendChild(el('p', 'quiz-question', `${meta.name}: set up your round`));
  const options = [...new Set([10, 20, meta.count].filter((n) => n <= meta.count))].sort((a, b) => a - b);
  let count = Math.min(QUESTIONS_PER_RUN, meta.count);

  const countRow = el('div', 'setup-row');
  countRow.appendChild(el('span', 'setup-label', 'Questions'));
  const countBtns = el('div', 'seg');
  for (const n of options) {
    const btn = el('button', 'seg-btn', n === meta.count ? `All (${n})` : String(n));
    btn.type = 'button';
    if (n === count) btn.classList.add('active');
    btn.addEventListener('click', () => {
      count = n;
      countBtns.querySelectorAll('.seg-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
    });
    countBtns.appendChild(btn);
  }
  countRow.appendChild(countBtns);
  player.appendChild(countRow);

  const examWrap = el('label', 'setup-check');
  const exam = el('input') as HTMLInputElement;
  exam.type = 'checkbox';
  examWrap.appendChild(exam);
  examWrap.appendChild(el('span', undefined, `Exam mode: timed, ${EXAM_PASS}% to pass`));
  player.appendChild(examWrap);

  const actions = el('div', 'deck-actions');
  const go = el('button', 'primary-btn', 'Start');
  go.addEventListener('click', () => void startDeck(meta, count, exam.checked));
  actions.appendChild(go);
  const back = el('button', 'ghost-btn', 'cancel');
  back.addEventListener('click', renderDeckGrid);
  actions.appendChild(back);
  player.appendChild(actions);
}

/** Start a session made only of this deck's questions that are due for review. */
async function startReview(meta: DeckMeta): Promise<void> {
  currentMeta = meta;
  currentDeck = await loadDeck(meta.slug);
  const due = new Set(dueForReview(loadProgress(), meta.slug, today()));
  const indexes = currentDeck.questions
    .map((question, index) => ({ question, index }))
    .filter(({ question }) => due.has(question.q))
    .map(({ index }) => index);
  fullRound = false;
  examMode = false;
  roundCorrect = [];
  roundMissed = [];
  session = { order: shuffle(indexes), position: 0, correct: 0, missed: [] };
  persistSession();
  renderQuestion();
}

async function startDeck(meta: DeckMeta, count: number, exam: boolean): Promise<void> {
  currentMeta = meta;
  currentDeck = await loadDeck(meta.slug);
  session = createSession(currentDeck.questions.length, count);
  fullRound = true;
  examMode = exam;
  examStartMs = exam ? Date.now() : 0;
  roundCorrect = [];
  roundMissed = [];
  const url = new URL(location.href);
  url.searchParams.set('deck', meta.slug);
  history.replaceState(null, '', url);
  persistSession();
  renderQuestion();
}

/** Resume a persisted in-flight session after a reload. */
async function resumeSession(saved: SavedSession): Promise<void> {
  const meta = deckIndex.find((m) => m.slug === saved.slug);
  if (!meta) return;
  currentMeta = meta;
  currentDeck = await loadDeck(meta.slug);
  session = saved.session;
  fullRound = saved.fullRound;
  examMode = saved.exam;
  examStartMs = saved.exam ? Date.now() : 0;
  roundCorrect = saved.roundCorrect;
  roundMissed = saved.roundMissed;
  renderQuestion();
}

function trackAnswer(questionIndex: number, correct: boolean): void {
  (correct ? roundCorrect : roundMissed).push(questionIndex);
}

function commitRound(): void {
  if (!currentDeck || !currentMeta || !session) return;
  const toText = (indexes: number[]) => indexes.map((i) => currentDeck!.questions[i].q);
  const progress = recordRound(
    loadProgress(),
    currentMeta.slug,
    {
      ...(fullRound ? { percent: scorePercent(session) } : {}),
      missedQuestions: toText(roundMissed),
      correctQuestions: toText(roundCorrect),
    },
    today(),
  );
  saveProgress(progress);
  clearSavedSession();
}

function playerShell(): HTMLElement {
  byId('deck-grid').hidden = true;
  const player = byId('player');
  player.hidden = false;
  player.innerHTML = '';
  const top = el('div', 'quiz-top');
  const back = el('button', 'ghost-btn', 'all decks');
  back.addEventListener('click', () => {
    const url = new URL(location.href);
    url.searchParams.delete('deck');
    history.replaceState(null, '', url);
    renderDeckGrid();
  });
  top.appendChild(back);
  top.appendChild(el('div', 'quiz-title', currentMeta?.name ?? ''));
  const progress = el('div', 'quiz-progress');
  progress.id = 'quiz-progress';
  top.appendChild(progress);
  player.appendChild(top);
  return player;
}

function examClock(): string {
  if (!examMode || !examStartMs) return '';
  const secs = Math.floor((Date.now() - examStartMs) / 1000);
  return ` · ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
}

function updateProgress(): void {
  if (!session) return;
  byId('quiz-progress').textContent = `${Math.min(session.position + 1, session.order.length)}/${session.order.length} · ${session.correct} correct${examClock()}`;
}

function renderQuestion(): void {
  if (!currentDeck || !session) return;
  if (isDone(session)) {
    renderResults();
    return;
  }
  const player = playerShell();
  updateProgress();
  const question = currentDeck.questions[session.order[session.position]];

  if (currentDeck.mode === 'choice') {
    renderChoice(player, question as ChoiceQuestion);
  } else {
    renderFlip(player, question as FlipQuestion);
  }
}

function renderChoice(player: HTMLElement, question: ChoiceQuestion): void {
  player.appendChild(el('p', 'quiz-question', question.q));
  const questionIndex = session!.order[session!.position];
  const { choices, correctIndex } = shuffledChoices(question);
  const list = el('div', 'choice-list');
  list.setAttribute('role', 'radiogroup');
  list.setAttribute('aria-label', `Answer choices (press 1 to ${choices.length} to answer)`);
  let answered = false;
  const onKey = (event: KeyboardEvent): void => {
    if (answered) return;
    const n = Number(event.key);
    if (Number.isInteger(n) && n >= 1 && n <= choices.length) {
      event.preventDefault();
      (list.children[n - 1] as HTMLElement).click();
    }
  };
  document.addEventListener('keydown', onKey);
  choices.forEach((choice, index) => {
    const btn = el('button', 'choice-btn', choice);
    btn.setAttribute('role', 'radio');
    btn.setAttribute('aria-checked', 'false');
    btn.addEventListener('click', () => {
      if (answered) return;
      answered = true;
      document.removeEventListener('keydown', onKey);
      const correct = index === correctIndex;
      btn.setAttribute('aria-checked', 'true');
      btn.classList.add(correct ? 'right' : 'wrong');
      const answerEl = list.children[correctIndex] as HTMLElement;
      answerEl.classList.add('right');
      // The right/wrong states are conveyed by colour plus a ::after glyph, and
      // generated content is not reliably announced. Mark them in real text too,
      // so someone who answered wrong can still tell which choice was correct
      // rather than having to distinguish two near-identical tints.
      answerEl.appendChild(el('span', 'sr-only', ' (correct answer)'));
      if (!correct) btn.appendChild(el('span', 'sr-only', ' (your answer, incorrect)'));
      list.querySelectorAll('.choice-btn').forEach((b) => b.classList.add('locked'));
      session = answerCurrent(session!, correct);
      trackAnswer(questionIndex, correct);
      persistSession();
      if (question.why) {
        const why = el('div', 'why-box');
        why.appendChild(el('span', 'why-label', correct ? 'Correct' : 'Not quite'));
        why.appendChild(el('p', undefined, question.why));
        player.appendChild(why);
      }
      // A role="status" on a freshly inserted node is generally not announced;
      // the live region has to be in the DOM before its text changes. Route the
      // verdict through the shared region instead, including the right answer
      // when the pick was wrong.
      announce(
        correct
          ? `Correct. ${question.why ?? ''}`
          : `Not quite. The correct answer is ${choices[correctIndex]}. ${question.why ?? ''}`,
      );
      const next = el('button', 'primary-btn quiz-next', isDone(session) ? 'See results' : 'Next question');
      next.addEventListener('click', renderQuestion);
      player.appendChild(next);
      next.focus();
      updateProgressAfterAnswer();
    });
    list.appendChild(btn);
  });
  player.appendChild(list);
}

function renderFlip(player: HTMLElement, question: FlipQuestion): void {
  player.appendChild(el('p', 'quiz-question', question.q));
  const questionIndex = session!.order[session!.position];
  const reveal = el('button', 'primary-btn', 'Reveal answer');
  reveal.addEventListener('click', () => {
    reveal.remove();
    player.appendChild(el('div', 'flip-answer', question.a));
    const grade = el('div', 'deck-actions');
    const knew = el('button', 'ghost-btn', 'Knew it');
    knew.addEventListener('click', () => {
      session = answerCurrent(session!, true);
      trackAnswer(questionIndex, true);
      persistSession();
      renderQuestion();
    });
    const missed = el('button', 'ghost-btn missed', 'Missed it');
    missed.addEventListener('click', () => {
      session = answerCurrent(session!, false);
      trackAnswer(questionIndex, false);
      persistSession();
      renderQuestion();
    });
    grade.appendChild(knew);
    grade.appendChild(missed);
    player.appendChild(grade);
  });
  player.appendChild(reveal);
}

function updateProgressAfterAnswer(): void {
  if (!session) return;
  byId('quiz-progress').textContent = `${session.position}/${session.order.length} · ${session.correct} correct`;
}

function renderResults(): void {
  if (!currentDeck || !session) return;
  commitRound();
  const player = playerShell();
  const percent = scorePercent(session);
  player.appendChild(el('p', 'quiz-question', fullRound ? 'Round complete.' : 'Review complete.'));
  const score = el('div', 'quiz-score');
  score.appendChild(el('span', 'quiz-score-big', `${percent}%`));
  const scoreMeta = el('div');
  scoreMeta.appendChild(el('span', 'deck-sub', `${session.correct} of ${session.order.length} correct`));
  if (examMode && fullRound) {
    const passed = percent >= EXAM_PASS;
    const secs = examStartMs ? Math.floor((Date.now() - examStartMs) / 1000) : 0;
    const verdict = el('div', `exam-verdict ${passed ? 'pass' : 'fail'}`, passed ? `PASS (needed ${EXAM_PASS}%)` : `FAIL (needed ${EXAM_PASS}%)`);
    scoreMeta.appendChild(verdict);
    scoreMeta.appendChild(el('div', 'deck-sub', `Timed exam · ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`));
  }
  if (!fullRound) {
    scoreMeta.appendChild(el('div', 'deck-sub', 'Review round, not counted toward your best score.'));
  }
  score.appendChild(scoreMeta);
  player.appendChild(score);

  const actions = el('div', 'deck-actions');
  if (session.missed.length > 0) {
    const review = el('button', 'primary-btn', `Review ${session.missed.length} missed`);
    review.addEventListener('click', () => {
      session = reviewSession(session!);
      fullRound = false;
      roundCorrect = [];
      roundMissed = [];
      renderQuestion();
    });
    actions.appendChild(review);
  }
  if (fullRound && currentMeta) {
    const share = el('button', 'ghost-btn', 'Share result');
    const url = `${location.origin}${location.pathname}?deck=${currentMeta.slug}`;
    share.addEventListener('click', () => {
      void shareOrCopy({
        title: 'Cybersecurity Alphabet Soup quiz',
        text: `I scored ${percent}% (${session!.correct}/${session!.order.length}) on the ${currentMeta!.name} quiz.`,
        url,
      });
    });
    actions.appendChild(share);
  }
  const again = el('button', 'ghost-btn', 'New round');
  again.addEventListener('click', () => {
    if (currentMeta!.mode === 'choice') renderSetup(currentMeta!);
    else void startDeck(currentMeta!, currentMeta!.count, false);
  });
  actions.appendChild(again);
  const back = el('button', 'ghost-btn', 'All decks');
  back.addEventListener('click', renderDeckGrid);
  actions.appendChild(back);
  player.appendChild(actions);
}

function main(): void {
  byId('hero-count').textContent = String(deckIndex.reduce((sum, meta) => sum + meta.count, 0));
  renderDeckGrid();
  const requested = new URLSearchParams(location.search).get('deck');
  const meta = deckIndex.find((m) => m.slug === requested);
  if (meta) {
    // Deep link / share link: start straight away with a default round.
    void startDeck(meta, Math.min(QUESTIONS_PER_RUN, meta.count), false);
    return;
  }
  // No deck requested: resume an in-flight session if one was left mid-round.
  const saved = loadSavedSession();
  if (saved) void resumeSession(saved);
}

main();
