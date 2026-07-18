import deckIndexRaw from './data/quiz/index.json';
import {
  answerCurrent,
  createSession,
  isDone,
  reviewSession,
  scorePercent,
  shuffledChoices,
} from './lib/quiz';
import type { ChoiceQuestion, Deck, DeckMeta, FlipQuestion, QuizSession } from './lib/quiz';
import { slugForKey } from './lib/slug';

const deckIndex = deckIndexRaw as DeckMeta[];
const deckModules = import.meta.glob('./data/quiz/*.json');
const byId = (id: string) => document.getElementById(id) as HTMLElement;

const QUESTIONS_PER_RUN = 20;

let currentDeck: Deck | null = null;
let currentMeta: DeckMeta | null = null;
let session: QuizSession | null = null;

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
    card.appendChild(
      el('p', 'deck-sub', `${meta.count} ${meta.mode === 'choice' ? 'practice questions' : 'flashcards'}`),
    );
    const actions = el('div', 'deck-actions');
    const start = el('button', 'primary-btn', meta.mode === 'choice' ? 'Start quiz' : 'Study cards');
    start.addEventListener('click', () => void startDeck(meta));
    actions.appendChild(start);
    if (meta.certKey) {
      const gloss = el('a', 'permalink', 'about this cert');
      gloss.href = `../definitions/${slugForKey(meta.certKey)}.html`;
      actions.appendChild(gloss);
    }
    card.appendChild(actions);
    grid.appendChild(card);
  }
}

async function startDeck(meta: DeckMeta): Promise<void> {
  currentMeta = meta;
  currentDeck = await loadDeck(meta.slug);
  session = createSession(currentDeck.questions.length, QUESTIONS_PER_RUN);
  const url = new URL(location.href);
  url.searchParams.set('deck', meta.slug);
  history.replaceState(null, '', url);
  renderQuestion();
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
  const reveal = el('button', 'primary-btn', 'Reveal answer');
  reveal.addEventListener('click', () => {
    reveal.remove();
    player.appendChild(el('div', 'flip-answer', question.a));
    const grade = el('div', 'deck-actions');
    const knew = el('button', 'ghost-btn', 'Knew it');
    knew.addEventListener('click', () => {
      session = answerCurrent(session!, true);
      renderQuestion();
    });
    const missed = el('button', 'ghost-btn missed', 'Missed it');
    missed.addEventListener('click', () => {
      session = answerCurrent(session!, false);
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
