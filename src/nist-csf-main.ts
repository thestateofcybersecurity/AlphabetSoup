import csfRaw from './data/nist-csf.json';
import cisRaw from './data/cis.json';
import mapRaw from './data/csf-cis-map.json';
import type { CisData, CsfData } from './lib/frameworks';
import { CSF_FUNCTIONS, frameworkSlug } from './lib/frameworks';
import type { FrameworkRecord } from './lib/framework-search';
import { initFrameworkPage } from './ui/framework-page';

const csf = csfRaw as CsfData;
const cis = cisRaw as CisData;
const csfToCis = mapRaw as Record<string, string[]>;

const records: FrameworkRecord[] = Object.keys(csf)
  .sort()
  .map((id) => ({
    id,
    group: csf[id].functionCode,
    heading: csf[id].text,
    metaphor: csf[id].metaphor,
    translation: csf[id].translation,
  }));

initFrameworkPage({
  records,
  groups: CSF_FUNCTIONS.map(([code, name]) => ({ value: code, label: name })),
  kicker: (record) => `${csf[record.id].function} / ${csf[record.id].category}`,
  countNoun: 'subcategories',
  relatedLabel: 'Related CIS safeguards (unofficial)',
  related: (record) =>
    (csfToCis[record.id] ?? []).map((cisId) => ({
      label: `CIS ${cisId}`,
      href: `../cis/${frameworkSlug(cisId)}.html`,
      title: cis[cisId]?.title,
    })),
});
