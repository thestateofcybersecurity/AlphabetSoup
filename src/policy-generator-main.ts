import catalogRaw from './data/policies.json';
import crosswalkRaw from './data/crosswalk.json';
import { announce } from './lib/announce';
import { escAttr } from './lib/escape';
import {
  EMPTY_PROFILE,
  coverage,
  deriveTier,
  policyToMarkdown,
  renderPolicy,
  selectPolicies,
  setToMarkdown,
  type Catalog,
  type CrosswalkDomain,
  type Framework,
  type Profile,
  type Tier,
} from './lib/policy';

const catalog = catalogRaw as unknown as Catalog;
const domains = crosswalkRaw.controls as unknown as CrosswalkDomain[];
const frameworks = crosswalkRaw.frameworks as unknown as Framework[];

/**
 * Real control counts for the frameworks this site holds in full.
 *
 * Coverage is measured against these, not against how much the crosswalk maps.
 * The catalog reaches every mapped control, so measuring against the crosswalk
 * would render 100% for every framework and tell the user something untrue.
 * ISO is measurable now that src/data/iso-27001.json enumerates all 93 Annex A
 * controls by identifier. Holding the identifiers is what makes a denominator
 * possible; no ISO text is reproduced anywhere.
 *
 * SOC 2 is still absent on purpose. Its criteria are not enumerated on this
 * site yet, so no honest denominator exists and coverage stays unmeasured
 * rather than being divided by the mapped subset.
 */
const FRAMEWORK_SIZES: Record<string, number> = {
  csf: 106,
  cis: 153,
  hipaa: 22,
  pci: 12,
  cmmc: 14,
  iso: 93,
};

const STORAGE_KEY = 'alphabetsoup:policy-generator:profile';
const byId = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const TIER_NAME: Record<Tier, string> = { ig1: 'IG1', ig2: 'IG2', ig3: 'IG3' };

const esc = (s: string): string => {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
};

/* ------------------------------- profile -------------------------------- */

const TEXT_FIELDS = ['orgName', 'policyOwner'] as const;
const SELECT_FIELDS = ['size', 'reviewCadence'] as const;
const CHECK_FIELDS = [
  'buildsSoftware',
  'hasOffices',
  'usesCloud',
  'personalData',
  'cardData',
  'healthData',
  'controlledUnclassified',
] as const;

function readProfile(): Profile {
  const p: Profile = { ...EMPTY_PROFILE };
  for (const f of TEXT_FIELDS) p[f] = byId<HTMLInputElement>(f).value;
  for (const f of SELECT_FIELDS) {
    (p as unknown as Record<string, string>)[f] = byId<HTMLSelectElement>(f).value;
  }
  for (const f of CHECK_FIELDS) p[f] = byId<HTMLInputElement>(f).checked;
  const tier = byId<HTMLSelectElement>('tier').value;
  if (tier) p.tier = tier as Tier;
  return p;
}

function writeProfile(p: Profile): void {
  for (const f of TEXT_FIELDS) byId<HTMLInputElement>(f).value = p[f] ?? '';
  for (const f of SELECT_FIELDS) {
    byId<HTMLSelectElement>(f).value = (p as unknown as Record<string, string>)[f] ?? '';
  }
  for (const f of CHECK_FIELDS) byId<HTMLInputElement>(f).checked = Boolean(p[f]);
  byId<HTMLSelectElement>('tier').value = p.tier ?? '';
}

function save(p: Profile): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    // Private mode: the generator still works for this session.
  }
}

function load(): Profile | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? ({ ...EMPTY_PROFILE, ...(JSON.parse(raw) as Partial<Profile>) } as Profile) : null;
  } catch {
    return null;
  }
}

/* ------------------------------- rendering ------------------------------ */

function renderTierLine(profile: Profile, tier: Tier, included: number): void {
  const meta = catalog.meta.tiers.find((t) => t.id === tier);
  const derived = profile.tier ? 'chosen' : 'derived from your profile';
  byId('pg-tierline').innerHTML =
    `<b>${included} policies</b> at <b>${esc(TIER_NAME[tier])}</b>, ${derived}. ${esc(meta?.blurb ?? '')}`;
}

function renderCoverage(cover: ReturnType<typeof coverage>): void {
  const rows = cover
    .map(
      (c) => `<tr>
        <td>${esc(c.name)}</td>
        <td>${c.addressed}${c.frameworkTotal === null ? ` <span class="pg-approx">of ${c.mapped} mapped</span>` : ` of ${c.frameworkTotal}`}</td>
        <td>${c.percent === null ? '' : `<span class="pg-bar"><span style="width:${Math.min(100, c.percent)}%"></span></span>`}</td>
        <td>${c.percent === null ? '<span class="pg-approx">not measured</span>' : `${c.percent}%`}</td>
      </tr>`,
    )
    .join('');
  byId('pg-coverage').innerHTML = `<table>
      <thead><tr><th>Framework</th><th>Controls addressed</th><th></th><th>Coverage</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  byId('pg-caveat').textContent =
    'Coverage counts the controls these policies address. Having a policy is not evidence that the control operates effectively, and an assessor will ask for the evidence listed under each policy. Where a framework is not reproduced in full on this site, the controls addressed are listed but no percentage is shown, because the true denominator is not known here.';
}

function renderExcluded(excluded: ReturnType<typeof selectPolicies>['excluded']): void {
  const host = byId('pg-excluded');
  if (excluded.length === 0) {
    host.innerHTML = '';
    return;
  }
  host.innerHTML = `<p class="pg-h">Considered and not included</p><ul>${excluded
    .map((e) => `<li><strong>${esc(e.policy.title)}.</strong> ${esc(e.reason)}</li>`)
    .join('')}</ul>`;
}

function renderPolicies(rendered: ReturnType<typeof renderPolicy>[], profile: Profile): void {
  byId('pg-policies').innerHTML = rendered
    .map((p) => {
      const reqs = p.requirements
        .map((r) => `<li>${esc(r.text)}<span class="pg-tag">${TIER_NAME[r.tier]}</span></li>`)
        .join('');
      const roles = p.roles
        .map((r) => `<li><strong>${esc(r.role)}.</strong> ${esc(r.responsibility)}</li>`)
        .join('');
      const evidence = p.evidence.map((e) => `<li>${esc(e)}</li>`).join('');
      const maps = Object.entries(p.mappings)
        .filter(([, ids]) => ids.length > 0)
        .map(([fw, ids]) => `${esc(fw.toUpperCase())}: ${esc(ids.join(', '))}`)
        .join('<br />');
      return `<details class="pg-policy" data-policy="${escAttr(p.id)}">
        <summary><span>${esc(p.title)}</span><span class="pg-count">${p.requirements.length} requirements</span></summary>
        <div class="pg-body">
          <p class="pg-h">Purpose</p><p>${esc(p.purpose)}</p>
          <p class="pg-h">Scope</p><p>${esc(p.scope)}</p>
          <p class="pg-h">Roles</p><ul>${roles}</ul>
          <p class="pg-h">Requirements</p><ul>${reqs}</ul>
          <p class="pg-h">Exceptions</p><p>${esc(p.exceptions)}</p>
          <p class="pg-h">Review</p><p>${esc(p.review)}</p>
          <p class="pg-h">Evidence an assessor may request</p><ul>${evidence}</ul>
          <p class="pg-h">Control mapping</p><p class="pg-map">${maps || 'None mapped'}</p>
          <p><button class="ghost-btn" type="button" data-download="${escAttr(p.id)}">Download this policy</button></p>
        </div>
      </details>`;
    })
    .join('');
  byId('pg-policies').addEventListener('click', (event) => {
    const btn = (event.target as HTMLElement).closest<HTMLElement>('[data-download]');
    if (!btn) return;
    const one = rendered.find((r) => r.id === btn.dataset.download);
    if (one) downloadText(policyToMarkdown(one, profile), `${one.id}.md`);
  });
}

function downloadText(text: string, filename: string): void {
  const blob = new Blob([text], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* --------------------------------- state -------------------------------- */

let current: { md: string; count: number } = { md: '', count: 0 };

function render(): void {
  const profile = readProfile();
  save(profile);
  const tier = deriveTier(profile);
  const selection = selectPolicies(catalog, profile);
  const rendered = selection.included.map((p) => renderPolicy(p, profile, tier, catalog, domains));
  const cover = coverage(selection.included, frameworks, domains, FRAMEWORK_SIZES);

  renderTierLine(profile, tier, selection.included.length);
  renderCoverage(cover);
  renderExcluded(selection.excluded);
  renderPolicies(rendered, profile);

  current = {
    md: setToMarkdown(rendered, selection, profile, tier, cover),
    count: selection.included.length,
  };
}

function main(): void {
  const saved = load();
  if (saved) writeProfile(saved);
  render();

  byId('pg-form').addEventListener('input', () => {
    render();
    announce(`${current.count} policies at ${TIER_NAME[deriveTier(readProfile())]}.`);
  });
  byId('pg-form').addEventListener('submit', (e) => e.preventDefault());

  byId('download-set').addEventListener('click', () => {
    const org = readProfile().orgName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'policy';
    downloadText(current.md, `${org}-policy-set.md`);
    announce(`Downloaded ${current.count} policies.`);
  });
  byId('print-set').addEventListener('click', () => {
    document.querySelectorAll<HTMLDetailsElement>('.pg-policy').forEach((d) => {
      d.open = true;
    });
    window.print();
  });
  byId('reset-form').addEventListener('click', () => {
    writeProfile({ ...EMPTY_PROFILE });
    render();
    announce('Reset to defaults.');
  });
}

main();
