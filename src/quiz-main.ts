import deckIndexRaw from './data/quiz/index.json';
import {
  answerCurrent,
  createSession,
  isDone,
  missedBank,
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
    start.addEventListener('click', () => void startDeck(meta));
    actions.appendChild(start);
    const bank = missedBank(loadProgress(), meta.slug);
    if (bank.length > 0) {
      const drill = el('button', 'ghost-btn missed', `Drill missed (${bank.length})`);
      drill.addEventListener('click', () => void startDrill(meta));
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

/** Start a session made only of this deck's persistently missed questions. */
async function startDrill(meta: DeckMeta): Promise<void> {
  currentMeta = meta;
  currentDeck = await loadDeck(meta.slug);
  const bank = new Set(missedBank(loadProgress(), meta.slug));
  const indexes = currentDeck.questions
    .map((question, index) => ({ question, index }))
    .filter(({ question }) => bank.has(question.q))
    .map(({ index }) => index);
  fullRound = false;
  roundCorrect = [];
  roundMissed = [];
  session = { order: shuffle(indexes), position: 0, correct: 0, missed: [] };
  renderQuestion();
}

async function startDeck(meta: DeckMeta): Promise<void> {
  currentMeta = meta;
  currentDeck = await loadDeck(meta.slug);
  session = createSession(currentDeck.questions.length, QUESTIONS_PER_RUN);
  fullRound = true;
  roundCorrect = [];
  roundMissed = [];
  const url = new URL(location.href);
  url.searchParams.set('deck', meta.slug);
  history.replaceState(null, '', url);
  renderQuestion();
}

function trackAnswer(questionIndex: number, correct: boolean): void {
  (correct ? roundCorrect : roundMissed).push(questionIndex);
}

function commitRound(): void {
  if (!currentDeck || !currentMeta || !session) return;
  const toText = (indexes: number[]) => indexes.map((i) => currentDeck!.questions[i].q);
  const progress = recordRound(loadProgress(), currentMeta.slug, {
    ...(fullRound ? { percent: scorePercent(session) } : {}),
    missedQuestions: toText(roundMissed),
    correctQuestions: toText(roundCorrect),
  });
  saveProgress(progress);
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

function updateProgress(): void {
  if (!session) return;
  byId('quiz-progress').textContent = `${Math.min(session.position + 1, session.order.length)}/${session.order.length} · ${session.correct} correct`;
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
  let answered = false;
  choices.forEach((choice, index) => {
    const btn = el('button', 'choice-btn', choice);
    btn.addEventListener('click', () => {
      if (answered) return;
      answered = true;
      const correct = index === correctIndex;
      btn.classList.add(correct ? 'right' : 'wrong');
      (list.children[correctIndex] as HTMLElement).classList.add('right');
      list.querySelectorAll('.choice-btn').forEach((b) => b.classList.add('locked'));
      session = answerCurrent(session!, correct);
      trackAnswer(questionIndex, correct);
      if (question.why) {
        const why = el('div', 'why-box');
        why.appendChild(el('span', 'why-label', correct ? 'Correct' : 'Not quite'));
        why.appendChild(el('p', undefined, question.why));
        player.appendChild(why);
      }
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
      renderQuestion();
    });
    const missed = el('button', 'ghost-btn missed', 'Missed it');
    missed.addEventListener('click', () => {
      session = answerCurrent(session!, false);
      trackAnswer(questionIndex, false);
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
  player.appendChild(el('p', 'quiz-question', 'Round complete.'));
  const score = el('div', 'quiz-score');
  score.appendChild(el('span', 'quiz-score-big', `${percent}%`));
  score.appendChild(
    el('span', 'deck-sub', `${session.correct} of ${session.order.length} correct`),
  );
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
  const again = el('button', 'ghost-btn', 'New round');
  again.addEventListener('click', () => void startDeck(currentMeta!));
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
  if (meta) void startDeck(meta);
}

main();
