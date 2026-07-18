import cisRaw from './data/cis.json';
import type { CisData } from './lib/frameworks';
import type { FrameworkRecord } from './lib/framework-search';
import { initFrameworkPage } from './ui/framework-page';

const cis = cisRaw as CisData;

const ids = Object.keys(cis).sort((a, b) => {
  const [a1, a2] = a.split('.').map(Number);
  const [b1, b2] = b.split('.').map(Number);
  return a1 - b1 || a2 - b2;
});

const records: FrameworkRecord[] = ids.map((id) => ({
  id,
  group: String(cis[id].control),
  heading: cis[id].title,
  metaphor: cis[id].metaphor,
  translation: cis[id].translation,
}));

const controlNames = new Map<number, string>();
for (const id of ids) controlNames.set(cis[id].control, cis[id].controlName);

initFrameworkPage({
  records,
  groups: [...controlNames.entries()].map(([control, name]) => ({
    value: String(control),
    label: String(control),
    title: name,
  })),
  kicker: (record) => `Control ${cis[record.id].control} / ${cis[record.id].controlName}`,
  countNoun: 'safeguards',
});
