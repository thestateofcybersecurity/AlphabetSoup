import cisRaw from './data/cis.json';
import mapRaw from './data/csf-cis-map.json';
import igsRaw from './data/cis-igs.json';
import type { CisData } from './lib/frameworks';
import { frameworkSlug } from './lib/frameworks';
import type { FrameworkRecord } from './lib/framework-search';
import { initFrameworkPage } from './ui/framework-page';

const cis = cisRaw as CisData;
const igs = igsRaw as Record<string, number>;
const csfToCis = mapRaw as Record<string, string[]>;
const cisToCsf = new Map<string, string[]>();
for (const [csfId, cisIds] of Object.entries(csfToCis)) {
  for (const cisId of cisIds) {
    const list = cisToCsf.get(cisId) ?? [];
    list.push(csfId);
    cisToCsf.set(cisId, list);
  }
}

const ids = Object.keys(cis).sort((a, b) => {
  const [a1, a2] = a.split('.').map(Number);
  const [b1, b2] = b.split('.').map(Number);
  return a1 - b1 || a2 - b2;
});

const records: FrameworkRecord[] = ids.map((id) => {
  const ig = igs[id] ?? 3;
  return {
    id,
    group: String(cis[id].control),
    heading: cis[id].title,
    metaphor: cis[id].metaphor,
    translation: cis[id].translation,
    keywords: cis[id].controlName,
    badges: [`IG${ig}`],
    tier: ig,
  };
});

const controlNames = new Map<number, string>();
for (const id of ids) controlNames.set(cis[id].control, cis[id].controlName);

initFrameworkPage({
  records,
  section: 'cis',
  groups: [...controlNames.entries()].map(([control, name]) => ({
    value: String(control),
    label: String(control),
    title: name,
  })),
  secondary: {
    label: 'Filter by implementation group',
    pills: [
      { value: '1', label: 'IG1', title: 'Essential cyber hygiene' },
      { value: '2', label: 'IG2', title: 'IG1 plus IG2' },
      { value: '3', label: 'IG3', title: 'Everything' },
    ],
    match: (record, value) => (record.tier ?? 3) <= Number(value),
  },
  kicker: (record) => `Control ${cis[record.id].control} / ${cis[record.id].controlName}`,
  countNoun: 'safeguards',
  relatedLabel: 'Related CSF subcategories (unofficial)',
  related: (record) =>
    (cisToCsf.get(record.id) ?? []).sort().map((csfId) => ({
      label: csfId,
      href: `../nist-csf/${frameworkSlug(csfId)}.html`,
    })),
});
