import csfRaw from './data/nist-csf.json';
import cisTitles from 'virtual:cis-titles';
import mapRaw from './data/csf-cis-map.json';
import type { CsfData } from './lib/frameworks';
import { CSF_FUNCTIONS, frameworkSlug } from './lib/frameworks';
import type { FrameworkRecord } from './lib/framework-search';
import { initFrameworkPage } from './ui/framework-page';

const csf = csfRaw as CsfData;
const csfToCis = mapRaw as Record<string, string[]>;

const records: FrameworkRecord[] = Object.keys(csf)
  .sort()
  .map((id) => ({
    id,
    group: csf[id].functionCode,
    heading: csf[id].text,
    metaphor: csf[id].metaphor,
    translation: csf[id].translation,
    keywords: `${csf[id].function} ${csf[id].category}`,
  }));

initFrameworkPage({
  records,
  section: 'csf',
  groups: CSF_FUNCTIONS.map(([code, name]) => ({ value: code, label: name })),
  kicker: (record) => `${csf[record.id].function} / ${csf[record.id].category}`,
  countNoun: 'subcategories',
  relatedLabel: 'Related CIS safeguards (unofficial)',
  related: (record) =>
    (csfToCis[record.id] ?? []).map((cisId) => ({
      label: `CIS ${cisId}`,
      href: `../cis/${frameworkSlug(cisId)}.html`,
      title: cisTitles[cisId],
    })),
});
