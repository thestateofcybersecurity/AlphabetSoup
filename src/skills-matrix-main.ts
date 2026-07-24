import dataRaw from './data/skills-matrix.json';
import type { Member, SkillsData } from './lib/skills-matrix';
import {
  busFactorWarnings,
  coverage,
  growthPlan,
  hiringProfile,
  matrixCsv,
  maxLevel,
  rating,
  resilientCoverage,
} from './lib/skills-matrix';

const data = dataRaw as SkillsData;

const STATE_KEY = 'alphabetsoup:skills-matrix:state';

const competencyIds = new Set(data.competencies.map((c) => c.id));
const SHORT: Record<string, string> = {
  'framework-fluency': 'Frameworks',
  'ai-security-governance': 'AI gov',
  'cloud-security': 'Cloud',
  'incident-response': 'IR',
  'board-communication': 'Board',
  'regulatory-compliance': 'Regs',
  'third-party-trust': '3rd-party',
  'automation-efficiency': 'Automation',
  devsecops: 'DevSecOps',
  'player-coach': 'Leadership',
};
const shortName = (id: string): string => SHORT[id] ?? id;

let seq = 0;
const newId = (): string => `m-${seq++}-${Math.round(performance.now())}`;

let members: Member[] = [];
let priorities = new Set<string>();

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;

function esc(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ------------------------------- state --------------------------------

const persist = (): void => localStorage.setItem(STATE_KEY, JSON.stringify({ members, priorities: [...priorities] }));

function loadState(): void {
  try {
    const raw = JSON.parse(localStorage.getItem(STATE_KEY) ?? 'null') as { members?: unknown; priorities?: unknown } | null;
    if (raw && typeof raw === 'object') {
      if (Array.isArray(raw.members)) {
        members = raw.members
          .filter((m): m is Member => !!m && typeof m === 'object')
          .map((m) => {
            const ratings: Record<string, number> = {};
            for (const [cid, v] of Object.entries(m.ratings ?? {})) if (competencyIds.has(cid) && typeof v === 'number') ratings[cid] = v;
            return { id: typeof m.id === 'string' ? m.id : newId(), name: typeof m.name === 'string' ? m.name : '', ratings };
          });
      }
      if (Array.isArray(raw.priorities)) priorities = new Set(raw.priorities.filter((x): x is string => competencyIds.has(x)));
      return;
    }
  } catch {
    /* ignore */
  }
  // First visit: seed a small example team so the outputs are demonstrated.
  priorities = new Set(['cloud-security', 'ai-security-governance']);
  members = [
    { id: newId(), name: 'Alex Rivera', ratings: { 'framework-fluency': 4, 'ai-security-governance': 2, 'cloud-security': 3, 'incident-response': 3, 'board-communication': 3, 'regulatory-compliance': 2, 'third-party-trust': 2, 'automation-efficiency': 2, devsecops: 2, 'player-coach': 3 } },
    { id: newId(), name: 'Sam Chen', ratings: { 'framework-fluency': 2, 'ai-security-governance': 1, 'cloud-security': 2, 'incident-response': 2, 'board-communication': 1, 'regulatory-compliance': 1, 'third-party-trust': 1, 'automation-efficiency': 3, devsecops: 3, 'player-coach': 1 } },
  ];
}

// ----------------------------- priorities -----------------------------

function renderPriorities(): void {
  const host = $('#priorities');
  host.innerHTML = data.competencies
    .map(
      (c) => `
      <label class="sm-pri${priorities.has(c.id) ? ' selected' : ''}" title="${esc(c.blurb)}">
        <input type="checkbox" value="${c.id}" ${priorities.has(c.id) ? 'checked' : ''} /> ${esc(c.name)}
      </label>`,
    )
    .join('');
  host.addEventListener('change', (event) => {
    const input = event.target as HTMLInputElement;
    if (input.type !== 'checkbox') return;
    if (input.checked) priorities.add(input.value);
    else priorities.delete(input.value);
    input.closest('.sm-pri')?.classList.toggle('selected', input.checked);
    persist();
    renderMatrix();
    renderOutput();
  });
}

// ------------------------------- matrix -------------------------------

function ratingSelect(member: Member, competencyId: string): string {
  const cur = rating(data, member, competencyId);
  const opts = data.levels
    .map((l) => `<option value="${l.value}" ${l.value === cur ? 'selected' : ''}>${l.value}</option>`)
    .join('');
  return `<td class="sm-cell sm-lvl-${cur}" data-cid="${competencyId}"><select aria-label="${esc(member.name || 'member')} ${esc(shortName(competencyId))}">${opts}</select></td>`;
}

function renderMatrix(): void {
  const table = $('#matrix');
  if (members.length === 0) {
    table.innerHTML = '<tbody><tr><td class="sm-empty-roster">No team members yet. Add someone to start the matrix.</td></tr></tbody>';
    return;
  }
  const headers = data.competencies
    .map((c) => `<th class="${priorities.has(c.id) ? 'pri' : ''}" title="${esc(c.name)}">${priorities.has(c.id) ? '<span class="sm-col-star">&#9733;</span> ' : ''}${esc(shortName(c.id))}</th>`)
    .join('');
  const rows = members
    .map(
      (m) => `
      <tr data-id="${m.id}">
        <td class="sm-member-c"><input type="text" value="${esc(m.name)}" placeholder="Name" aria-label="Member name" /></td>
        ${data.competencies.map((c) => ratingSelect(m, c.id)).join('')}
        <td><button type="button" class="sm-del" data-action="delete" aria-label="Remove member">&times;</button></td>
      </tr>`,
    )
    .join('');
  const cov = coverage(data, members, priorities);
  const foot = data.competencies
    .map((c) => {
      const row = cov.find((r) => r.competency.id === c.id)!;
      return `<td class="${row.busFactor ? 'bus' : ''}" title="${row.proficient} proficient">${row.proficient}${row.busFactor ? '&#9888;' : ''}</td>`;
    })
    .join('');
  table.innerHTML = `
    <thead><tr><th class="sm-member-h">Team member</th>${headers}<th></th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot class="sm-foot"><tr><td class="sm-member-c">Proficient (level ${data.proficientLevel}+)</td>${foot}<td></td></tr></tfoot>`;

  table.addEventListener('change', (event) => {
    const el = event.target as HTMLElement;
    if (el.tagName === 'SELECT') {
      const td = el.closest('.sm-cell') as HTMLElement;
      const tr = el.closest('tr') as HTMLElement;
      const member = members.find((m) => m.id === tr.dataset.id);
      if (!member) return;
      const value = Math.max(0, Math.min(maxLevel(data), Number((el as HTMLSelectElement).value) || 0));
      member.ratings[td.dataset.cid!] = value;
      td.className = `sm-cell sm-lvl-${value}`;
      persist();
      updateFooter();
      renderOutput();
    }
  });
  table.addEventListener('input', (event) => {
    const el = event.target as HTMLInputElement;
    if (el.type !== 'text') return;
    const tr = el.closest('tr') as HTMLElement;
    const member = members.find((m) => m.id === tr.dataset.id);
    if (member) {
      member.name = el.value;
      persist();
      renderOutput();
    }
  });
  table.addEventListener('click', (event) => {
    const btn = (event.target as HTMLElement).closest('[data-action="delete"]');
    if (!btn) return;
    const id = (btn.closest('tr') as HTMLElement).dataset.id;
    members = members.filter((m) => m.id !== id);
    persist();
    renderMatrix();
    renderOutput();
  });
}

function updateFooter(): void {
  const cov = coverage(data, members, priorities);
  const cells = $('#matrix').querySelectorAll('.sm-foot td');
  data.competencies.forEach((c, i) => {
    const row = cov.find((r) => r.competency.id === c.id)!;
    const cell = cells[i + 1] as HTMLElement; // +1 skips the label cell
    if (cell) {
      cell.className = row.busFactor ? 'bus' : '';
      cell.innerHTML = `${row.proficient}${row.busFactor ? '&#9888;' : ''}`;
    }
  });
}

// ------------------------------- output -------------------------------

function renderOutput(): void {
  const panel = $('#output');
  if (members.length === 0) {
    panel.innerHTML = '<p class="sm-empty">Add team members above to see coverage, bus-factor risks, and growth plans.</p>';
    return;
  }
  const warnings = busFactorWarnings(data, members, priorities);
  const hires = hiringProfile(data, members, priorities);
  const resilient = resilientCoverage(data, members);

  const warnHtml =
    warnings.length === 0
      ? '<p class="sm-good">No single-points-of-failure: every competency has at least two proficient people.</p>'
      : warnings
          .map(
            (w) => `<div class="sm-warn">${w.priority ? '<b>Priority. </b>' : ''}<b>${esc(w.competency.name)}</b>: ${w.proficient === 0 ? 'no one is proficient' : 'only one person is proficient'}. Losing them leaves a gap.</div>`,
          )
          .join('');

  const people = members
    .map((m) => {
      const gaps = growthPlan(data, m, priorities);
      const name = m.name.trim() || 'Unnamed member';
      if (gaps.length === 0) {
        return `<div class="sm-person"><div class="sm-person-done"><strong>${esc(name)}</strong>: proficient across every competency. Consider stretch goals or mentoring others.</div></div>`;
      }
      const items = gaps
        .map(
          (g) => `
          <div class="sm-gap">
            <span class="sm-gap-name">${g.priority ? '&#9733; ' : ''}${esc(g.competency.name)}</span>
            <span class="sm-gap-meta"> level ${g.current} to ${g.target}</span>
            <div class="sm-gap-res">${g.competency.resources.map((r) => `<a href="${esc(r.href)}"${r.href.startsWith('http') ? ' rel="noopener" target="_blank"' : ''}>${esc(r.label)}</a>`).join('')}</div>
          </div>`,
        )
        .join('');
      return `<details class="sm-person"><summary>${esc(name)}<span class="sm-person-gaps">${gaps.length} growth area${gaps.length === 1 ? '' : 's'}</span></summary>${items}</details>`;
    })
    .join('');

  const hireHtml =
    hires.length === 0
      ? '<p class="sm-good">Coverage on your priorities is healthy. The next hire can broaden depth rather than fill a gap.</p>'
      : `<ul class="sm-hire">${hires
          .map((h) => `<li>${h.priority ? '<b>Priority. </b>' : ''}<b>${esc(h.competency.name)}</b>: ${esc(h.reason)}</li>`)
          .join('')}</ul>`;

  panel.innerHTML = `
    <div class="sm-actions print-hide">
      <button type="button" class="sm-btn sm-btn-primary" id="sm-print">Print assessment</button>
      <button type="button" class="sm-btn" id="sm-csv">Export matrix as CSV</button>
    </div>
    <div class="sm-doc">
      <div class="sm-stat-row">
        <div class="sm-stat"><div class="sm-stat-num">${members.length}</div><div class="sm-stat-lbl">team members</div></div>
        <div class="sm-stat"><div class="sm-stat-num">${resilient}%</div><div class="sm-stat-lbl">competencies with 2+ proficient</div></div>
        <div class="sm-stat"><div class="sm-stat-num">${warnings.length}</div><div class="sm-stat-lbl">single-point-of-failure risks</div></div>
      </div>

      <h3 class="sm-block-head">Bus-factor risks</h3>
      ${warnHtml}

      <h3 class="sm-block-head">Per-person growth plans</h3>
      ${people}

      <h3 class="sm-block-head">Hiring-priority profile</h3>
      ${hireHtml}
    </div>`;

  $('#sm-print').addEventListener('click', () => window.print());
  $('#sm-csv').addEventListener('click', () => {
    const blob = new Blob([matrixCsv(data, members)], { type: 'text/csv' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'team-skills-matrix.csv';
    link.click();
    URL.revokeObjectURL(link.href);
  });
}

// -------------------------------- boot --------------------------------

loadState();
$('#comp-count').textContent = String(data.competencies.length);
renderPriorities();
renderMatrix();
renderOutput();

$('#add-member').addEventListener('click', () => {
  const member: Member = { id: newId(), name: '', ratings: {} };
  members.push(member);
  persist();
  renderMatrix();
  renderOutput();
  const input = $('#matrix').querySelector(`tr[data-id="${member.id}"] input[type="text"]`) as HTMLInputElement | null;
  input?.focus();
});
