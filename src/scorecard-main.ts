import scorecardRaw from './data/scorecard.json';

interface ScorecardTool {
  name: string;
  elevatorPitch: string;
  inputs: string[];
  outputs: string[];
  mvpFeatures: string[];
  day1Value: string;
  status: 'live' | 'planned';
  href?: string;
}

interface ScorecardCard {
  id: string;
  rank: number;
  title: string;
  frequencyPct: number;
  plainEnglish: string;
  howJDsSayIt: string[];
  whyItMatters: string;
  onTheJobTool: ScorecardTool;
}

interface Scorecard {
  meta: {
    title: string;
    description: string;
    methodology: string;
    corpusSize: number;
    corpusWindow: string;
    seniorityRange: string;
    version: string;
    lastUpdated: string;
  };
  cards: ScorecardCard[];
}

const scorecard = scorecardRaw as Scorecard;

function esc(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function toolPanel(tool: ScorecardTool): string {
  const cta =
    tool.status === 'live' && tool.href
      ? `<a class="sc-tool-cta" href="${encodeURI(tool.href)}">Open the tool &rarr;</a>`
      : '<span class="sc-tool-soon">In the works</span>';
  return `
    <div class="sc-tool${tool.status === 'live' ? ' live' : ''}">
      <p class="sc-tool-kicker">the on-the-job tool</p>
      <p class="sc-tool-name">${esc(tool.name)}</p>
      <p class="sc-tool-pitch">${esc(tool.elevatorPitch)}</p>
      <p class="sc-tool-day1"><strong>Day-one value:</strong> ${esc(tool.day1Value)}</p>
      ${cta}
    </div>`;
}

function cardHtml(card: ScorecardCard): string {
  return `
    <article class="sc-card" id="${card.id}">
      <header class="sc-head">
        <span class="sc-rank" aria-label="Rank ${card.rank}">${card.rank}</span>
        <h2 class="sc-title">${esc(card.title)}</h2>
        <div class="sc-freq" title="Appeared in roughly ${card.frequencyPct}% of postings">
          <div class="sc-freq-track"><div class="sc-freq-fill" style="width:${card.frequencyPct}%"></div></div>
          <span class="sc-freq-label">~${card.frequencyPct}% of postings</span>
        </div>
      </header>
      <p class="sc-plain">${esc(card.plainEnglish)}</p>
      <details class="sc-details">
        <summary>How job descriptions say it</summary>
        <ul>${card.howJDsSayIt.map((quote) => `<li>&ldquo;${esc(quote)}&rdquo;</li>`).join('')}</ul>
      </details>
      <details class="sc-details">
        <summary>Why it matters</summary>
        <p>${esc(card.whyItMatters)}</p>
      </details>
      ${toolPanel(card.onTheJobTool)}
    </article>`;
}

const cards = [...scorecard.cards].sort((a, b) => a.rank - b.rank);
const live = cards.filter((card) => card.onTheJobTool.status === 'live').length;

document.querySelector('#cards')!.innerHTML = cards.map(cardHtml).join('');
document.querySelector('#corpus-size')!.textContent = String(scorecard.meta.corpusSize);
document.querySelector('#live-count')!.textContent = `${live} of ${cards.length}`;
document.querySelector('#methodology-text')!.textContent =
  `${scorecard.meta.description} ${scorecard.meta.methodology}`;
