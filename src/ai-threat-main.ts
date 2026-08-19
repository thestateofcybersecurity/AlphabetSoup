import threatRaw from './data/ai-threat-model.json';
import type {
  FlowInstance,
  GraphNode,
  RiskLevel,
  SystemProfile,
  ThreatModelData,
  ThreatVerdict,
} from './lib/ai-threat';
import {
  ZONE_COLUMNS,
  boundaries,
  defaultGraph,
  diagramLayout,
  flowCandidates,
  graphOf,
  migrateVerdicts,
  registerCsv,
  riskFor,
  summarize,
  importThreatDragon,
  linddunSummary,
  threatDragonModel,
  threatModelReport,
  zoneAt,
} from './lib/ai-threat';

const data = threatRaw as ThreatModelData;

const DRAFT_KEY = 'alphabetsoup:ai-threat:draft';
const MODELS_KEY = 'alphabetsoup:ai-threat:models';

interface ModelState {
  profile: SystemProfile;
  verdicts: Record<string, ThreatVerdict>;
  savedAt?: string;
}

type Step = 1 | 2 | 3 | 4;

let state: ModelState = {
  profile: { name: '', components: [], exposure: 'internal', dataClass: 'internal' },
  verdicts: {},
};
let step: Step = 1;
/** Step-one mode: the quick checklist or the editable canvas. */
let canvasMode = false;

// Canvas editor state, transient by design.
let selected: { type: 'node' | 'flow'; id: string } | null = null;
let connectFrom: string | null = null;
let connecting = false;
let resetArmed = false;
let lensOn = false;
let pendingImport: SystemProfile | null = null;
let dragging: { id: string; dx: number; dy: number; moved: boolean } | null = null;

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;

function esc(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function loadDraft(): void {
  try {
    const raw = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null') as ModelState | null;
    if (raw && typeof raw === 'object' && raw.profile && Array.isArray(raw.profile.components)) {
      state = { profile: raw.profile, verdicts: migrateVerdicts(data, raw.profile, raw.verdicts ?? {}) };
      canvasMode = !!raw.profile.graph;
    }
  } catch {
    /* fresh start */
  }
}

function saveDraft(): void {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(state));
  } catch {
    /* private browsing */
  }
}

const instances = () => flowCandidates(data, state.profile);
const verdictFor = (key: string): ThreatVerdict => state.verdicts[key] ?? { status: 'unreviewed' };

// ------------------------------- stepper -------------------------------

const STEPS: { n: Step; label: string }[] = [
  { n: 1, label: 'What are we building?' },
  { n: 2, label: 'What can go wrong?' },
  { n: 3, label: 'What will we do about it?' },
  { n: 4, label: 'Did we do a good job?' },
];

function described(): boolean {
  return state.profile.graph ? state.profile.graph.nodes.length > 0 : state.profile.components.length > 0;
}

function stepReachable(n: Step): boolean {
  return n === 1 || described();
}

function renderStepper(): void {
  $('#stepper').innerHTML = STEPS.map(({ n, label }) => {
    const current = n === step ? ' aria-current="step"' : '';
    const disabled = stepReachable(n) ? '' : ' disabled';
    return `<button type="button" class="tm-step${n === step ? ' current' : ''}" data-step="${n}"${current}${disabled}><span class="tm-step-n">${n}</span> ${esc(label)}</button>`;
  }).join('');
}

function goTo(next: Step): void {
  if (!stepReachable(next)) return;
  step = next;
  render();
  $('#stepper').scrollIntoView({ block: 'nearest' });
}

// ------------------------------- step 1 --------------------------------

function renderStep1(host: HTMLElement): void {
  const p = state.profile;
  host.innerHTML = `
    <p class="tm-lede">Describe the system first. Nothing is concluded from an empty form: the candidate threat list is derived from exactly what you select here, and each proposal will tell you which answer surfaced it.</p>
    <label class="tm-field"><span class="tm-label">System name</span>
      <input id="tm-name" type="text" placeholder="e.g. Support ticket summarizer" value="${esc(p.name)}" />
    </label>
    <div class="tm-two">
      <label class="tm-field"><span class="tm-label">Owner</span>
        <input id="tm-owner-field" type="text" placeholder="Accountable for the system" value="${esc(p.owner ?? '')}" />
      </label>
      <label class="tm-field"><span class="tm-label">Reviewer</span>
        <input id="tm-reviewer-field" type="text" placeholder="Who reviews this model" value="${esc(p.reviewer ?? '')}" />
      </label>
    </div>
    <div class="tm-mode-row" role="tablist" aria-label="How to describe the system">
      <button type="button" class="tm-vbtn${canvasMode ? '' : ' on'}" id="tm-mode-quick" role="tab" aria-selected="${!canvasMode}">Quick describe</button>
      <button type="button" class="tm-vbtn${canvasMode ? ' on' : ''}" id="tm-mode-canvas" role="tab" aria-selected="${canvasMode}">Canvas editor</button>
    </div>
    <div class="tm-import-row print-hide">
      <label class="tm-btn tm-btn-sm">Import a Threat Dragon model
        <input type="file" id="tm-import" accept=".json,application/json" hidden />
      </label>
      <span id="tm-import-status" class="tm-hint" role="status"></span>
    </div>
    <div id="tm-quick" ${canvasMode ? 'hidden' : ''}>
      <fieldset class="tm-group"><legend>Which elements exist? Select all that apply.</legend>
        <div class="tm-options">
          ${data.components.map((c) => `
            <label class="tm-check${p.components.includes(c.id) ? ' selected' : ''}">
              <input type="checkbox" name="component" value="${c.id}" ${p.components.includes(c.id) ? 'checked' : ''} />
              <span class="tm-check-label">${esc(c.label)}</span>
              <span class="tm-check-detail">${esc(c.detail)}</span>
            </label>`).join('')}
        </div>
      </fieldset>
    </div>
    <div id="tm-canvas-wrap" ${canvasMode ? '' : 'hidden'}></div>
    <fieldset class="tm-group"><legend>Who can reach it?</legend>
      <div class="tm-options tm-options-row">
        ${data.exposures.map((e) => `
          <label class="tm-check${p.exposure === e.id ? ' selected' : ''}">
            <input type="radio" name="exposure" value="${e.id}" ${p.exposure === e.id ? 'checked' : ''} />
            <span class="tm-check-label">${esc(e.label)}</span>
            <span class="tm-check-detail">${esc(e.detail)}</span>
          </label>`).join('')}
      </div>
    </fieldset>
    <fieldset class="tm-group"><legend>Most sensitive data it touches?</legend>
      <div class="tm-options tm-options-row">
        ${data.dataClasses.map((d) => `
          <label class="tm-check${p.dataClass === d.id ? ' selected' : ''}">
            <input type="radio" name="dataClass" value="${d.id}" ${p.dataClass === d.id ? 'checked' : ''} />
            <span class="tm-check-label">${esc(d.label)}</span>
            <span class="tm-check-detail">${esc(d.detail)}</span>
          </label>`).join('')}
      </div>
    </fieldset>
    <div class="tm-boundaries" id="tm-boundaries"></div>
    <div class="tm-actions">
      <button type="button" class="tm-btn tm-btn-primary" id="tm-to-2" ${described() ? '' : 'disabled'}>Enumerate what can go wrong &rarr;</button>
    </div>`;

  renderBoundaryPreview();
  if (canvasMode) renderCanvas();

  host.addEventListener('change', (event) => {
    const input = event.target as HTMLInputElement;
    // Canvas props inputs live in the same container; their change events are
    // handled where they are rendered and must not re-render the canvas here.
    if (!['component', 'exposure', 'dataClass'].includes(input.name)) return;
    if (input.name === 'component') {
      const set = new Set(state.profile.components);
      input.checked ? set.add(input.value) : set.delete(input.value);
      state.profile.components = data.components.map((c) => c.id).filter((id) => set.has(id));
    }
    if (input.name === 'exposure') state.profile.exposure = input.value;
    if (input.name === 'dataClass') state.profile.dataClass = input.value;
    input.closest('.tm-options')?.querySelectorAll('.tm-check').forEach((label) => {
      label.classList.toggle('selected', (label.querySelector('input') as HTMLInputElement).checked);
    });
    saveDraft();
    renderBoundaryPreview();
    if (canvasMode) renderCanvas();
    ($('#tm-to-2') as HTMLButtonElement).disabled = !described();
    renderStepper();
  });
  host.querySelector('#tm-name')?.addEventListener('input', (event) => {
    state.profile.name = (event.target as HTMLInputElement).value;
    saveDraft();
  });
  host.querySelector('#tm-owner-field')?.addEventListener('input', (event) => {
    state.profile.owner = (event.target as HTMLInputElement).value;
    saveDraft();
  });
  host.querySelector('#tm-reviewer-field')?.addEventListener('input', (event) => {
    state.profile.reviewer = (event.target as HTMLInputElement).value;
    saveDraft();
  });
  $('#tm-mode-quick').addEventListener('click', () => {
    canvasMode = false;
    render();
  });
  $('#tm-mode-canvas').addEventListener('click', () => {
    canvasMode = true;
    if (!state.profile.graph) {
      state.profile.graph = defaultGraph(data, state.profile);
      saveDraft();
    }
    render();
  });
  $('#tm-to-2').addEventListener('click', () => goTo(2));
  $('#tm-import').addEventListener('change', (event) => {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const status = $('#tm-import-status');
      try {
        const profile = importThreatDragon(JSON.parse(String(reader.result)));
        if (described()) {
          // A described model is on screen: ask before replacing it.
          pendingImport = profile;
          status.innerHTML = '';
          const note = document.createElement('span');
          note.textContent = `Replace the current model with "${profile.name}"? `;
          const confirm = document.createElement('button');
          confirm.type = 'button';
          confirm.className = 'tm-btn tm-btn-sm';
          confirm.id = 'tm-import-confirm';
          confirm.textContent = 'Import and replace';
          confirm.addEventListener('click', applyImport);
          status.append(note, confirm);
        } else {
          pendingImport = profile;
          applyImport();
        }
      } catch (error) {
        status.textContent = error instanceof Error ? error.message : 'That file could not be read.';
      }
    };
    reader.readAsText(file);
  });
}

function applyImport(): void {
  if (!pendingImport) return;
  state = { profile: pendingImport, verdicts: {} };
  pendingImport = null;
  canvasMode = true;
  selected = null;
  connecting = false;
  connectFrom = null;
  saveDraft();
  render();
  const status = document.querySelector('#tm-import-status');
  if (status) {
    status.textContent = `Imported "${state.profile.name}": ${state.profile.graph?.nodes.length ?? 0} elements, ${state.profile.graph?.flows.length ?? 0} flows${state.profile.imported?.length ? `, ${state.profile.imported.length} existing threats preserved` : ''}. Classify the flows to enumerate this library's threats.`;
  }
}

function renderBoundaryPreview(): void {
  const host = $('#tm-boundaries');
  if (!described()) {
    host.innerHTML = '<p class="tm-hint">Select the elements above and the trust boundaries of your system appear here.</p>';
    return;
  }
  const list = state.profile.graph
    ? [...new Set(instances().map((i) => i.boundary))]
    : boundaries(data, state.profile);
  host.innerHTML = `<h3 class="tm-h">Trust boundaries in this system</h3>
    <ul class="tm-boundary-list">${list.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>
    ${canvasMode ? '' : diagramSvg(false)}
    <p class="tm-hint">${instances().length} candidate threats will be proposed across these boundaries, each for you to judge.${canvasMode ? '' : ' The badges show where they attach.'}</p>`;
}

// ------------------------------ diagram --------------------------------

/** The diagram as SVG. Interactive adds hit targets, selection, and drag. */
function diagramSvg(interactive: boolean): string {
  const layout = diagramLayout(data, state.profile, instances());
  if (!layout) return '';
  const zones = layout.zones
    .map(
      (z) => `<rect x="${z.x}" y="${z.y}" width="${z.w}" height="${z.h}" rx="10" fill="none" stroke="var(--line)" stroke-width="1.5" stroke-dasharray="6 4"/>` +
        `<text x="${z.x + 10}" y="${z.y - 9}" class="tmd-zone">${esc(z.label)}</text>`,
    )
    .join('');
  const graph = graphOf(data, state.profile);
  const nodes = layout.nodes
    .map((n) => {
      const isSelected = interactive && selected?.type === 'node' && selected.id === n.id;
      const isSource = interactive && connectFrom === n.id;
      const stroke = isSelected || isSource ? 'var(--tomato-deep)' : 'var(--tomato)';
      const width = isSelected || isSource ? 2.5 : 1;
      return `<g${interactive ? ` class="tmd-node" data-node-id="${n.id}" tabindex="-1"` : ''}>` +
        `<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="8" fill="var(--paper-raised)" stroke="${stroke}" stroke-width="${width}"/>` +
        `<text x="${n.x + 10}" y="${n.y + 19}" class="tmd-title">${esc(n.label)}</text>` +
        `<text x="${n.x + 10}" y="${n.y + 35}" class="tmd-sub">${esc(n.sub || n.kind)}</text></g>`;
    })
    .join('');
  const flows = layout.flows
    .map((f) => {
      const mx = (f.x1 + f.x2) / 2;
      const my = (f.y1 + f.y2) / 2;
      const flow = graph.flows.find((g) => g.id === f.id);
      const isSelected = interactive && selected?.type === 'flow' && selected.id === f.id;
      const unclassified = flow?.kind === 'plain';
      const stroke = isSelected ? 'var(--tomato-deep)' : unclassified ? 'var(--line)' : 'var(--ink-soft)';
      const badge = f.badge > 0
        ? `<g><title>${esc(`${f.badge} candidate threats where "${flow?.label ?? ''}" crosses a boundary`)}</title>` +
          `<circle cx="${mx}" cy="${my}" r="11" fill="var(--paper)" stroke="var(--status-bad)" stroke-width="1.5"/>` +
          `<text x="${mx}" y="${my + 4}" text-anchor="middle" class="tmd-badge">${f.badge}</text></g>`
        : unclassified && interactive
          ? `<g><title>Unclassified flow: pick what it carries to surface threats</title>` +
            `<circle cx="${mx}" cy="${my}" r="11" fill="var(--paper)" stroke="var(--line)" stroke-width="1.5"/>` +
            `<text x="${mx}" y="${my + 4}" text-anchor="middle" class="tmd-badge-plain">?</text></g>`
          : '';
      const line = `<line x1="${f.x1}" y1="${f.y1}" x2="${f.x2}" y2="${f.y2}" stroke="${stroke}" stroke-width="${isSelected ? 2.2 : 1.2}" marker-end="url(#tmd-arrow)"/>`;
      if (!interactive) return `${line}${badge}`;
      // One group per flow: the badge circle gives the group a real bounding
      // box (a bare SVG line reports zero size, which breaks click targeting),
      // and the fat transparent stroke keeps the whole length clickable.
      const anchor = badge || `<circle cx="${mx}" cy="${my}" r="9" fill="transparent" stroke="var(--line)" stroke-width="1" stroke-dasharray="2 3"/>`;
      const hit = `<line x1="${f.x1}" y1="${f.y1}" x2="${f.x2}" y2="${f.y2}" stroke="transparent" stroke-width="14" class="tmd-flow-hit"/>`;
      return `<g class="tmd-flow" data-flow-id="${f.id}">${line}${hit}${anchor}</g>`;
    })
    .join('');
  return `<figure class="tm-diagram"><svg ${interactive ? 'id="tm-canvas" tabindex="0" ' : ''}width="100%" viewBox="0 0 ${layout.width} ${layout.height}" role="${interactive ? 'application' : 'img'}" aria-label="${interactive ? 'Editable data flow diagram; use the toolbar to add elements' : 'Data flow diagram derived from the described system'}">` +
    `<defs><marker id="tmd-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">` +
    `<path d="M2 1L8 5L2 9" fill="none" stroke="var(--ink-soft)" stroke-width="1.5" stroke-linecap="round"/></marker></defs>` +
    `${zones}${flows}${nodes}</svg>` +
    `<figcaption class="tm-hint">${interactive ? 'Drag elements between zones, connect flows, and classify what each flow carries. Arrow keys nudge the selection; Delete removes it.' : 'Derived from your answers, never drawn by hand. Badges: candidate threats at that flow.'}</figcaption></figure>`;
}

// --------------------------- canvas editor -----------------------------

function ensureGraph() {
  if (!state.profile.graph) state.profile.graph = defaultGraph(data, state.profile);
  return state.profile.graph;
}

function renderCanvas(): void {
  const host = $('#tm-canvas-wrap');
  const graph = ensureGraph();
  host.innerHTML = `
    <div class="tm-group tm-canvas-group">
      <div class="tm-toolbar print-hide" role="toolbar" aria-label="Canvas tools">
        <button type="button" class="tm-btn tm-btn-sm" data-add="actor">+ Actor</button>
        <button type="button" class="tm-btn tm-btn-sm" data-add="process">+ Process</button>
        <button type="button" class="tm-btn tm-btn-sm" data-add="store">+ Store</button>
        <button type="button" class="tm-vbtn${connecting ? ' on' : ''}" id="tm-connect" aria-pressed="${connecting}">${connecting ? (connectFrom ? 'Pick the target' : 'Pick the source') : 'Connect flow'}</button>
        <button type="button" class="tm-btn tm-btn-sm tm-btn-quiet" id="tm-canvas-reset">${resetArmed ? 'Really reset?' : 'Reset to derived'}</button>
      </div>
      ${graph.nodes.length === 0 ? '<p class="tm-hint">An empty canvas proposes nothing. Add elements, or switch to Quick describe and select what exists.</p>' : diagramSvg(true)}
      <div id="tm-props"></div>
    </div>`;
  renderProps();
  wireCanvas();
}

function renderProps(): void {
  const host = document.querySelector('#tm-props') as HTMLElement | null;
  if (!host) return;
  const graph = ensureGraph();
  if (!selected) {
    host.innerHTML = '<p class="tm-hint">Select an element or a flow to edit it.</p>';
    return;
  }
  if (selected.type === 'node') {
    const node = graph.nodes.find((n) => n.id === selected!.id);
    if (!node) { host.innerHTML = ''; return; }
    host.innerHTML = `
      <div class="tm-props-row">
        <label class="tm-field tm-grow"><span class="tm-label">${esc(node.kind)} label</span>
          <input id="tm-node-label" type="text" value="${esc(node.label)}" /></label>
        <span class="tm-hint">Zone: ${esc(ZONE_COLUMNS.find((z) => z.id === node.zone)?.label ?? '')}</span>
        <button type="button" class="tm-btn tm-btn-sm tm-btn-quiet" id="tm-delete-sel">Delete element</button>
      </div>`;
    host.querySelector('#tm-node-label')?.addEventListener('input', (e) => {
      node.label = (e.target as HTMLInputElement).value;
      saveDraft();
      refreshCanvasSvg();
    });
    host.querySelector('#tm-delete-sel')?.addEventListener('click', deleteSelection);
  } else {
    const flow = graph.flows.find((f) => f.id === selected!.id);
    if (!flow) { host.innerHTML = ''; return; }
    host.innerHTML = `
      <div class="tm-props-row">
        <label class="tm-field tm-grow"><span class="tm-label">This flow carries</span>
          <select id="tm-flow-kind" class="tm-select">
            <option value="plain" ${flow.kind === 'plain' ? 'selected' : ''}>Nothing threat-relevant (plain flow)</option>
            ${data.components.map((c) => `<option value="${c.id}" ${flow.kind === c.id ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}
          </select></label>
        <label class="tm-field"><span class="tm-label">Data on this flow</span>
          <select id="tm-flow-data" class="tm-select">
            <option value="" ${!flow.dataClass ? 'selected' : ''}>System default</option>
            ${data.dataClasses.map((d) => `<option value="${d.id}" ${flow.dataClass === d.id ? 'selected' : ''}>${esc(d.label)}</option>`).join('')}
          </select></label>
        <button type="button" class="tm-btn tm-btn-sm tm-btn-quiet" id="tm-delete-sel">Delete flow</button>
      </div>
      <p class="tm-hint">${flow.kind === 'plain' ? 'Unclassified flows carry no threats; pick what this flow represents to enumerate them.' : `${instances().filter((i) => i.flow.id === flow.id).length} candidate threats attach to this flow.`}</p>`;
    host.querySelector('#tm-flow-kind')?.addEventListener('change', (e) => {
      flow.kind = (e.target as HTMLSelectElement).value;
      flow.label = flow.kind === 'plain' ? flow.label : data.components.find((c) => c.id === flow.kind)?.label ?? flow.label;
      saveDraft();
      renderCanvas();
      renderBoundaryPreview();
      renderStepper();
    });
    host.querySelector('#tm-flow-data')?.addEventListener('change', (e) => {
      const value = (e.target as HTMLSelectElement).value;
      flow.dataClass = value || undefined;
      saveDraft();
      renderCanvas();
      renderBoundaryPreview();
    });
    host.querySelector('#tm-delete-sel')?.addEventListener('click', deleteSelection);
  }
}

function deleteSelection(): void {
  const graph = ensureGraph();
  if (!selected) return;
  if (selected.type === 'node') {
    graph.nodes = graph.nodes.filter((n) => n.id !== selected!.id);
    graph.flows = graph.flows.filter((f) => f.from !== selected!.id && f.to !== selected!.id);
  } else {
    graph.flows = graph.flows.filter((f) => f.id !== selected!.id);
  }
  selected = null;
  saveDraft();
  renderCanvas();
  renderBoundaryPreview();
  renderStepper();
}

function refreshCanvasSvg(): void {
  // Re-render just the canvas figure, keeping toolbar and props focus intact.
  const figure = document.querySelector('#tm-canvas-wrap .tm-diagram');
  if (!figure) return;
  const temp = document.createElement('div');
  temp.innerHTML = diagramSvg(true);
  figure.replaceWith(temp.firstElementChild!);
  wireCanvasSvg();
}

function wireCanvas(): void {
  const host = $('#tm-canvas-wrap');
  host.querySelectorAll('button[data-add]').forEach((b) =>
    b.addEventListener('click', () => {
      const kind = (b as HTMLElement).dataset.add as GraphNode['kind'];
      const graph = ensureGraph();
      const col = ZONE_COLUMNS[1];
      const y = 64 + 26 + graph.nodes.filter((n) => n.zone === 'app').length * 64;
      const id = `n-${crypto.randomUUID().slice(0, 8)}`;
      graph.nodes.push({ id, kind, label: `New ${kind}`, sub: kind, zone: 'app', x: col.x + 12, y });
      selected = { type: 'node', id };
      saveDraft();
      renderCanvas();
      renderStepper();
      (document.querySelector('#tm-node-label') as HTMLInputElement | null)?.focus();
    }),
  );
  host.querySelector('#tm-connect')?.addEventListener('click', () => {
    connecting = !connecting;
    connectFrom = null;
    renderCanvas();
  });
  host.querySelector('#tm-canvas-reset')?.addEventListener('click', () => {
    if (!resetArmed) {
      resetArmed = true;
      renderCanvas();
      return;
    }
    resetArmed = false;
    state.profile.graph = undefined;
    selected = null;
    connecting = false;
    connectFrom = null;
    state.profile.graph = defaultGraph(data, state.profile);
    saveDraft();
    renderCanvas();
    renderBoundaryPreview();
  });
  wireCanvasSvg();
}

function canvasSvg(): SVGSVGElement | null {
  return document.querySelector('#tm-canvas') as SVGSVGElement | null;
}

function wireCanvasSvg(): void {
  const svg = canvasSvg();
  if (!svg) return;
  const graph = ensureGraph();

  // Graph mutations happen on click, never on pointerdown: replacing the DOM
  // mid-gesture makes automated and fast real-world clicks land twice.
  svg.addEventListener('click', (event) => {
    if (dragging?.moved) return;
    const nodeEl = (event.target as Element).closest('[data-node-id]');
    if (nodeEl) {
      const id = (nodeEl as HTMLElement).dataset.nodeId!;
      if (connecting) {
        if (!connectFrom) {
          connectFrom = id;
        } else if (connectFrom !== id) {
          const flowId = `f-${crypto.randomUUID().slice(0, 8)}`;
          graph.flows.push({ id: flowId, from: connectFrom, to: id, kind: 'plain', label: 'New flow' });
          connecting = false;
          connectFrom = null;
          selected = { type: 'flow', id: flowId };
          saveDraft();
          renderStepper();
        }
        renderCanvas();
        return;
      }
      selected = { type: 'node', id };
      refreshCanvasSvg();
      renderProps();
      return;
    }
    const flowEl = (event.target as Element).closest('[data-flow-id]');
    if (flowEl) {
      selected = { type: 'flow', id: (flowEl as HTMLElement).dataset.flowId! };
      refreshCanvasSvg();
      renderProps();
      return;
    }
    selected = null;
    refreshCanvasSvg();
    renderProps();
  });

  svg.addEventListener('pointerdown', (event) => {
    if (connecting) return;
    const nodeEl = (event.target as Element).closest('[data-node-id]');
    if (!nodeEl) return;
    const id = (nodeEl as HTMLElement).dataset.nodeId!;
    const node = graph.nodes.find((n) => n.id === id)!;
    const scale = 680 / svg.getBoundingClientRect().width;
    const rect = svg.getBoundingClientRect();
    dragging = {
      id,
      dx: (event.clientX - rect.left) * scale - node.x,
      dy: (event.clientY - rect.top) * scale - node.y,
      moved: false,
    };
  });

  svg.addEventListener('keydown', (event) => {
    if (!selected) return;
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      deleteSelection();
      return;
    }
    if (selected.type !== 'node') return;
    const node = graph.nodes.find((n) => n.id === selected!.id);
    if (!node) return;
    const step8 = 8;
    if (event.key === 'ArrowLeft') node.x -= step8;
    else if (event.key === 'ArrowRight') node.x += step8;
    else if (event.key === 'ArrowUp') node.y = Math.max(72, node.y - step8);
    else if (event.key === 'ArrowDown') node.y += step8;
    else return;
    event.preventDefault();
    node.zone = zoneAt(node.x + 60);
    saveDraft();
    refreshCanvasSvg();
  });
}

// Drag tracking lives on the window: the SVG is re-rendered as the node
// moves, and listeners tied to a replaced element would orphan the gesture.
window.addEventListener('pointermove', (event) => {
  if (!dragging) return;
  const svg = canvasSvg();
  const graph = state.profile.graph;
  if (!svg || !graph) return;
  const node = graph.nodes.find((n) => n.id === dragging!.id);
  if (!node) return;
  const scale = 680 / svg.getBoundingClientRect().width;
  const rect = svg.getBoundingClientRect();
  node.x = Math.max(20, Math.min(660 - 100, Math.round(((event.clientX - rect.left) * scale - dragging.dx) / 8) * 8));
  node.y = Math.max(72, Math.round(((event.clientY - rect.top) * scale - dragging.dy) / 8) * 8);
  node.zone = zoneAt(node.x + 60);
  dragging.moved = true;
  refreshCanvasSvg();
});

window.addEventListener('pointerup', () => {
  if (!dragging) return;
  if (dragging.moved) {
    selected = { type: 'node', id: dragging.id };
    saveDraft();
    renderBoundaryPreview();
    refreshCanvasSvg();
    renderProps();
    // Let the click that follows this pointerup see the drag and skip.
    setTimeout(() => { dragging = null; }, 0);
    return;
  }
  dragging = null;
});

// ------------------------------- step 2 --------------------------------

function renderStep2(host: HTMLElement): void {
  const all = instances();
  const list = lensOn ? all.filter((i) => (i.threat.linddun ?? []).length > 0) : all;
  const byFlow = new Map<string, FlowInstance[]>();
  for (const instance of list) {
    const group = byFlow.get(instance.flow.id) ?? [];
    group.push(instance);
    byFlow.set(instance.flow.id, group);
  }

  const reviewed = all.filter(({ key }) => verdictFor(key).status !== 'unreviewed').length;
  const privacyCount = all.filter((i) => (i.threat.linddun ?? []).length > 0).length;
  const imported = state.profile.imported ?? [];
  host.innerHTML = `
    <p class="tm-lede">These are candidates, not conclusions: each is proposed because of something you said in step one, and it needs your judgment. Mark each one, and rate the ones that apply with the anchored scales.</p>
    <div class="tm-lens-row print-hide">
      <p class="tm-progress" id="tm-progress">${reviewed} of ${all.length} judged</p>
      <button type="button" class="tm-vbtn${lensOn ? ' on' : ''}" id="tm-lens" aria-pressed="${lensOn}">Privacy lens (LINDDUN)</button>
    </div>
    ${lensOn ? `<p class="tm-hint">Showing the ${privacyCount} candidates that touch LINDDUN privacy categories; the other ${all.length - privacyCount} stay judged and counted, just out of view.</p>` : ''}
    ${[...byFlow.values()].map((group) => `
      <section class="tm-boundary-group">
        <h3 class="tm-h">${esc(group[0].flow.label)} &middot; ${esc(group[0].boundary)}</h3>
        ${group.map((instance) => threatCard(instance)).join('')}
      </section>`).join('')}
    ${imported.length ? `
      <section class="tm-boundary-group">
        <h3 class="tm-h">Imported from Threat Dragon (${imported.length})</h3>
        <p class="tm-hint">Preserved verbatim from the imported model; they travel into the report and the Threat Dragon re-export unchanged.</p>
        ${imported.map(() => `
          <article class="tm-card tm-imported">
            <header class="tm-card-head">
              <h4 class="tm-card-title"></h4>
              <span class="tm-stride"></span>
              <span class="tm-id"></span>
            </header>
            <p class="tm-desc"></p>
          </article>`).join('')}
      </section>` : ''}
    <div class="tm-actions">
      <button type="button" class="tm-btn" data-step-nav="1">&larr; Back to the system</button>
      <button type="button" class="tm-btn tm-btn-primary" data-step-nav="3">Decide what to do &rarr;</button>
    </div>`;

  // Imported threat text is foreign, user-supplied data: textContent only.
  host.querySelectorAll('.tm-imported').forEach((card, index) => {
    const t = imported[index];
    if (!t) return;
    (card.querySelector('.tm-card-title') as HTMLElement).textContent = t.title;
    (card.querySelector('.tm-stride') as HTMLElement).textContent = t.type || 'Imported';
    (card.querySelector('.tm-id') as HTMLElement).textContent = `${t.cellName} · ${t.status}${t.severity ? ` · ${t.severity}` : ''}`;
    (card.querySelector('.tm-desc') as HTMLElement).textContent = t.description;
  });
  host.querySelector('#tm-lens')?.addEventListener('click', () => {
    lensOn = !lensOn;
    render();
  });

  host.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest('button[data-verdict]') as HTMLButtonElement | null;
    if (!button) return;
    const key = (button.closest('[data-key]') as HTMLElement).dataset.key!;
    const current = verdictFor(key);
    const status = button.dataset.verdict as ThreatVerdict['status'];
    state.verdicts[key] = { ...current, status: current.status === status ? 'unreviewed' : status };
    saveDraft();
    render();
  });
  host.addEventListener('change', (event) => {
    const input = event.target as HTMLInputElement;
    const card = input.closest('[data-key]') as HTMLElement | null;
    if (!card) return;
    const key = card.dataset.key!;
    const verdict = verdictFor(key);
    if (input.name === `lik-${key}`) verdict.likelihood = input.value;
    if (input.name === `imp-${key}`) verdict.impact = input.value;
    state.verdicts[key] = verdict;
    saveDraft();
    render();
  });
  host.addEventListener('input', (event) => {
    const input = event.target as HTMLInputElement;
    const card = input.closest('[data-key]') as HTMLElement | null;
    if (card && input.classList.contains('tm-note')) {
      state.verdicts[card.dataset.key!] = { ...verdictFor(card.dataset.key!), note: input.value };
      saveDraft();
    }
  });
  host.querySelectorAll('button[data-step-nav]').forEach((b) =>
    b.addEventListener('click', () => goTo(Number((b as HTMLElement).dataset.stepNav) as Step)),
  );
}

function refChips(refs: string[]): string {
  return refs
    .map((code) => `<a class="tm-ref" href="../../frameworks/ai/?q=${encodeURIComponent(code)}" title="Read ${esc(code)} in plain English">${esc(code)}</a>`)
    .join('');
}

function threatCard(instance: FlowInstance): string {
  const { threat, because, key } = instance;
  const verdict = verdictFor(key);
  const risk = riskFor(data, verdict.likelihood, verdict.impact);
  const pick = (kind: 'lik' | 'imp', options: typeof data.likelihood, chosen?: string) => `
    <div class="tm-scale" role="radiogroup" aria-label="${kind === 'lik' ? 'Likelihood' : 'Impact'}">
      <span class="tm-scale-label">${kind === 'lik' ? 'Likelihood' : 'Impact'}</span>
      ${options.map((o) => `
        <label class="tm-scale-opt${chosen === o.id ? ' selected' : ''}" title="${esc(o.detail)}">
          <input type="radio" name="${kind}-${key}" value="${o.id}" ${chosen === o.id ? 'checked' : ''} />${esc(o.label)}
        </label>`).join('')}
    </div>`;
  return `
    <article class="tm-card${verdict.status !== 'unreviewed' ? ` tm-${verdict.status}` : ''}" data-key="${key}" data-threat="${threat.id}">
      <header class="tm-card-head">
        <span class="tm-id">${threat.id}</span>
        <h4 class="tm-card-title">${esc(threat.title)}</h4>
        <span class="tm-stride">${esc(threat.stride)}</span>
        ${(threat.linddun ?? []).map((c) => `<span class="tm-stride tm-linddun">${esc(c)}</span>`).join('')}
      </header>
      <p class="tm-because">Proposed because ${esc(because)}.</p>
      <p class="tm-desc">${esc(threat.description)} <span class="tm-refs">${refChips(threat.refs)}</span></p>
      <div class="tm-verdict-row">
        <button type="button" class="tm-vbtn${verdict.status === 'applies' ? ' on' : ''}" data-verdict="applies">Applies</button>
        <button type="button" class="tm-vbtn${verdict.status === 'mitigated' ? ' on' : ''}" data-verdict="mitigated">Already mitigated</button>
        <button type="button" class="tm-vbtn${verdict.status === 'not-applicable' ? ' on' : ''}" data-verdict="not-applicable">Not applicable</button>
      </div>
      ${verdict.status === 'applies' ? `
        <div class="tm-rating">
          ${pick('lik', data.likelihood, verdict.likelihood)}
          ${pick('imp', data.impact, verdict.impact)}
          ${risk ? `<span class="tm-risk tm-risk-${risk}">${risk}</span>` : '<span class="tm-hint">Pick both scales to rate this threat.</span>'}
        </div>` : ''}
      ${verdict.status === 'mitigated' || verdict.status === 'not-applicable' ? `
        <input class="tm-note" type="text" placeholder="${verdict.status === 'mitigated' ? 'How is it mitigated?' : 'Why does it not apply?'}" value="${esc(verdict.note ?? '')}" />` : ''}
    </article>`;
}

// ------------------------------- step 3 --------------------------------

function renderStep3(host: HTMLElement): void {
  const applying = instances().filter(({ key }) => verdictFor(key).status === 'applies');
  host.innerHTML = `
    <p class="tm-lede">For each threat you said applies: here are the mitigations this library suggests, linked to the plain-English frameworks. Decide the treatment and name an owner; an unowned decision is a wish.</p>
    ${applying.length === 0 ? '<p class="tm-hint">No threats are marked as applying yet. Go back to step two and judge the candidates.</p>' : ''}
    ${applying.map((instance) => {
      const { threat, flow, key } = instance;
      const verdict = verdictFor(key);
      const risk = riskFor(data, verdict.likelihood, verdict.impact);
      return `
      <article class="tm-card" data-key="${key}" data-threat="${threat.id}">
        <header class="tm-card-head">
          <span class="tm-id">${threat.id}</span>
          <h4 class="tm-card-title">${esc(threat.title)} <span class="tm-flow-tag">${esc(flow.label)}</span></h4>
          ${risk ? `<span class="tm-risk tm-risk-${risk}">${risk}</span>` : ''}
        </header>
        <ul class="tm-mitigations">
          ${threat.mitigations.map((m) => `<li>${esc(m.text)} <span class="tm-refs">${refChips(m.refs)}</span></li>`).join('')}
        </ul>
        <div class="tm-treat-row">
          <button type="button" class="tm-vbtn${verdict.treatment === 'mitigate' ? ' on' : ''}" data-treat="mitigate">Mitigate now</button>
          <button type="button" class="tm-vbtn${verdict.treatment === 'accept' ? ' on' : ''}" data-treat="accept">Accept for now</button>
          <input class="tm-owner" type="text" placeholder="Owner" value="${esc(verdict.owner ?? '')}" aria-label="Owner for ${threat.id}" />
        </div>
        ${verdict.treatment ? residualRow(key, verdict) : ''}
      </article>`;
    }).join('')}
    <div class="tm-actions">
      <button type="button" class="tm-btn" data-step-nav="2">&larr; Back to judgments</button>
      <button type="button" class="tm-btn tm-btn-primary" data-step-nav="4">Review the model &rarr;</button>
    </div>`;

  host.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest('button[data-treat]') as HTMLButtonElement | null;
    if (!button) return;
    const key = (button.closest('[data-key]') as HTMLElement).dataset.key!;
    const verdict = verdictFor(key);
    const treatment = button.dataset.treat as 'mitigate' | 'accept';
    state.verdicts[key] = { ...verdict, treatment: verdict.treatment === treatment ? undefined : treatment };
    saveDraft();
    render();
  });
  host.addEventListener('input', (event) => {
    const input = event.target as HTMLInputElement;
    const card = input.closest('[data-key]') as HTMLElement | null;
    if (card && input.classList.contains('tm-owner')) {
      state.verdicts[card.dataset.key!] = { ...verdictFor(card.dataset.key!), owner: input.value };
      saveDraft();
    }
  });
  host.addEventListener('change', (event) => {
    const input = event.target as HTMLInputElement;
    const card = input.closest('[data-key]') as HTMLElement | null;
    if (!card || input.type !== 'radio') return;
    const key = card.dataset.key!;
    const verdict = verdictFor(key);
    if (input.name === `rlik-${key}`) verdict.residualLikelihood = input.value;
    if (input.name === `rimp-${key}`) verdict.residualImpact = input.value;
    state.verdicts[key] = verdict;
    saveDraft();
    render();
  });
  host.querySelectorAll('button[data-step-nav]').forEach((b) =>
    b.addEventListener('click', () => goTo(Number((b as HTMLElement).dataset.stepNav) as Step)),
  );
}

/** Residual re-rating: same anchored scales, after the treatment lands. */
function residualRow(key: string, verdict: ThreatVerdict): string {
  const residual = riskFor(data, verdict.residualLikelihood, verdict.residualImpact);
  const pick = (kind: 'rlik' | 'rimp', options: typeof data.likelihood, chosen?: string) => `
    <div class="tm-scale" role="radiogroup" aria-label="Residual ${kind === 'rlik' ? 'likelihood' : 'impact'}">
      <span class="tm-scale-label">${kind === 'rlik' ? 'Likelihood' : 'Impact'}</span>
      ${options.map((o) => `
        <label class="tm-scale-opt${chosen === o.id ? ' selected' : ''}" title="${esc(o.detail)}">
          <input type="radio" name="${kind}-${key}" value="${o.id}" ${chosen === o.id ? 'checked' : ''} />${esc(o.label)}
        </label>`).join('')}
    </div>`;
  return `
    <div class="tm-rating tm-residual">
      <span class="tm-scale-label">After treatment:</span>
      ${pick('rlik', data.likelihood, verdict.residualLikelihood)}
      ${pick('rimp', data.impact, verdict.residualImpact)}
      ${residual ? `<span class="tm-risk tm-risk-${residual}">residual ${residual}</span>` : '<span class="tm-hint">Re-rate to show the residual risk.</span>'}
    </div>`;
}

// ------------------------------- step 4 --------------------------------

function renderStep4(host: HTMLElement): void {
  const list = instances();
  const summary = summarize(data, list, state.verdicts);
  const warnings: string[] = [];
  if (summary.reviewed < summary.total) warnings.push(`${summary.total - summary.reviewed} candidate threats have not been judged yet.`);
  if (summary.unrated > 0) warnings.push(`${summary.unrated} applying threats have no likelihood or impact rating.`);
  if (summary.untreated > 0) warnings.push(`${summary.untreated} applying threats have no treatment decision.`);
  if (summary.mitigatedNoResidual > 0) warnings.push(`${summary.mitigatedNoResidual} mitigate decisions have no residual re-rating.`);
  const unclassified = graphOf(data, state.profile).flows.filter((f) => f.kind === 'plain').length;
  if (unclassified > 0) warnings.push(`${unclassified} flows on the diagram are unclassified and carry no threats yet.`);

  const tile = (label: string, value: number, cls = '') => `<div class="tm-tile ${cls}"><span class="tm-tile-n">${value}</span>${label}</div>`;
  host.innerHTML = `
    <p class="tm-lede">The fourth question is honesty about the first three. This register is only as done as its weakest row; the warnings below are the work remaining.</p>
    ${warnings.length ? `<div class="tm-warnings">${warnings.map((w) => `<p>${esc(w)}</p>`).join('')}</div>` : '<p class="tm-complete">Every candidate judged, every applying threat rated and owned. This model is presentable.</p>'}
    <div class="tm-meta-line">${state.profile.owner ? `Owner: ${esc(state.profile.owner)}. ` : ''}${state.profile.reviewer ? `Reviewer: ${esc(state.profile.reviewer)}.` : ''}</div>
    ${(() => {
      const privacy = linddunSummary(list, state.verdicts);
      if (privacy.length === 0) return '';
      return `<p class="tm-hint">Privacy lens: applying threats touch ${privacy.map((p) => `${esc(p.category)} (${p.threats.length})`).join(', ')}.</p>`;
    })()}
    ${(state.profile.imported ?? []).length ? `<p class="tm-hint">${(state.profile.imported ?? []).length} imported Threat Dragon threats are preserved in the report and re-export.</p>` : ''}
    ${diagramSvg(false)}
    <div class="tm-tiles">
      ${tile('candidates', summary.total)}
      ${tile('apply', summary.applies)}
      ${(['critical', 'high', 'medium', 'low'] as RiskLevel[]).map((r) => tile(r, summary.byRisk[r], `tm-tile-${r}`)).join('')}
    </div>
    ${Object.values(summary.byResidualRisk).some((n) => n > 0) ? `
    <div class="tm-tiles">
      ${(['critical', 'high', 'medium', 'low'] as RiskLevel[]).map((r) => tile(`residual ${r}`, summary.byResidualRisk[r], `tm-tile-${r}`)).join('')}
    </div>` : ''}
    <table class="tm-table">
      <thead><tr><th>ID</th><th>Threat</th><th>Flow</th><th>Boundary</th><th>Status</th><th>Risk</th><th>Residual</th><th>Treatment</th><th>Owner</th></tr></thead>
      <tbody>
        ${list.map(({ threat, flow, boundary, key }) => {
          const v = verdictFor(key);
          const risk = riskFor(data, v.likelihood, v.impact);
          const residual = riskFor(data, v.residualLikelihood, v.residualImpact);
          return `<tr class="tm-row-${v.status}">
            <td>${threat.id}</td><td>${esc(threat.title)}</td><td>${esc(flow.label)}</td><td>${esc(boundary)}</td>
            <td>${v.status === 'unreviewed' ? '<em>unreviewed</em>' : esc(v.status)}</td>
            <td>${risk ? `<span class="tm-risk tm-risk-${risk}">${risk}</span>` : ''}</td>
            <td>${residual ? `<span class="tm-risk tm-risk-${residual}">${residual}</span>` : ''}</td>
            <td>${esc(v.treatment ?? '')}</td><td>${esc(v.owner ?? '')}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
    <div class="tm-actions print-hide">
      <button type="button" class="tm-btn" data-step-nav="3">&larr; Back to treatment</button>
      <button type="button" class="tm-btn" id="tm-csv">Export register CSV</button>
      <button type="button" class="tm-btn" id="tm-json">Export model JSON</button>
      <button type="button" class="tm-btn" id="tm-td">Export for Threat Dragon</button>
      <button type="button" class="tm-btn tm-btn-primary" id="tm-report">Download report</button>
      <a class="tm-btn" href="../../roadmap/?source=threat">Send mitigations to the roadmap &rarr;</a>
      <button type="button" class="tm-btn" id="tm-print">Print</button>
      <button type="button" class="tm-btn tm-btn-primary" id="tm-save">Save model</button>
    </div>
    <section id="tm-models" class="print-hide"></section>`;

  host.querySelectorAll('button[data-step-nav]').forEach((b) =>
    b.addEventListener('click', () => goTo(Number((b as HTMLElement).dataset.stepNav) as Step)),
  );
  $('#tm-csv').addEventListener('click', () => {
    download(`${slug()}-threat-register.csv`, registerCsv(data, state.profile, list, state.verdicts), 'text/csv');
  });
  $('#tm-json').addEventListener('click', () => {
    download(`${slug()}-threat-model.json`, JSON.stringify({ ...state, datasetVersion: data.meta.version }, null, 2), 'application/json');
  });
  $('#tm-td').addEventListener('click', () => {
    const model = threatDragonModel(data, state.profile, list, state.verdicts, () => crypto.randomUUID());
    download(`${slug()}-threat-dragon.json`, JSON.stringify(model, null, 2), 'application/json');
  });
  $('#tm-print').addEventListener('click', () => window.print());
  $('#tm-report').addEventListener('click', () => {
    const generated = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
    download(`${slug()}-threat-model-report.html`, threatModelReport(data, state.profile, list, state.verdicts, generated), 'text/html');
  });
  host.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest('#tm-models button[data-action]') as HTMLButtonElement | null;
    if (!button) return;
    const index = Number((button.closest('li') as HTMLElement).dataset.index);
    const models = loadModels();
    if (button.dataset.action === 'delete') {
      models.splice(index, 1);
      localStorage.setItem(MODELS_KEY, JSON.stringify(models));
      renderModels();
    } else if (models[index]) {
      state = {
        profile: models[index].profile,
        verdicts: migrateVerdicts(data, models[index].profile, models[index].verdicts ?? {}),
      };
      canvasMode = !!models[index].profile.graph;
      saveDraft();
      render();
    }
  });
  $('#tm-save').addEventListener('click', () => {
    const models = loadModels();
    models.unshift({ ...structuredClone(state), savedAt: new Date().toISOString() });
    localStorage.setItem(MODELS_KEY, JSON.stringify(models.slice(0, 20)));
    renderModels();
  });
  renderModels();
}

function slug(): string {
  return (state.profile.name || 'system').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'system';
}

function download(filename: string, content: string, type: string): void {
  const blob = new Blob([content], { type });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

function loadModels(): ModelState[] {
  try {
    const raw = JSON.parse(localStorage.getItem(MODELS_KEY) ?? '[]');
    return Array.isArray(raw)
      ? raw.filter((m): m is ModelState => !!m && typeof m === 'object' && !!(m as ModelState).profile)
      : [];
  } catch {
    return [];
  }
}

function renderModels(): void {
  const host = document.querySelector('#tm-models');
  if (!host) return;
  const models = loadModels();
  if (models.length === 0) {
    host.innerHTML = '';
    return;
  }
  host.innerHTML = `<h3 class="tm-h">Saved models</h3>
    <ul class="tm-model-list">
      ${models.map((m, index) => {
        const saved = new Date(m.savedAt ?? '');
        return `<li data-index="${index}">
          <span class="tm-model-name"></span>
          <span class="tm-model-meta">${Number.isNaN(saved.getTime()) ? '' : saved.toLocaleDateString()}</span>
          <button type="button" class="tm-btn tm-btn-sm" data-action="load">Load</button>
          <button type="button" class="tm-btn tm-btn-sm tm-btn-quiet" data-action="delete">Delete</button>
        </li>`;
      }).join('')}
    </ul>`;
  // Names come from stored, user-editable data: set via textContent, never markup.
  host.querySelectorAll('li').forEach((li, index) => {
    (li.querySelector('.tm-model-name') as HTMLElement).textContent = models[index]?.profile.name || 'Untitled system';
  });
}

// -------------------------------- shell --------------------------------

function render(): void {
  renderStepper();
  const host = $('#tm-body');
  const fresh = host.cloneNode(false) as HTMLElement;
  host.replaceWith(fresh);
  if (step === 1) renderStep1(fresh);
  if (step === 2) renderStep2(fresh);
  if (step === 3) renderStep3(fresh);
  if (step === 4) renderStep4(fresh);
}

$('#stepper').addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest('button[data-step]') as HTMLButtonElement | null;
  if (button && !button.disabled) goTo(Number(button.dataset.step) as Step);
});

loadDraft();
$('#threat-count').textContent = String(data.threats.length);
$('#component-count').textContent = String(data.components.length);
render();
