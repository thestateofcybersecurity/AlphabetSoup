import soc2Raw from './data/soc2.json';
import crosswalkRaw from './data/crosswalk.json';
import { frameworkSlug } from './lib/frameworks';
import { byFamily, relatedByCriterion, type CrosswalkDomain, type Soc2Data } from './lib/soc2';
import type { FrameworkRecord } from './lib/framework-search';
import { initFrameworkPage } from './ui/framework-page';

const soc2 = soc2Raw as unknown as Soc2Data;
const domains = crosswalkRaw.controls as unknown as CrosswalkDomain[];

/**
 * Related controls in the other frameworks, via the shared crosswalk.
 *
 * The derivation lives in lib/soc2 rather than here because it has a rule worth
 * keeping in one place: criteria this site does not enumerate get no entry, so
 * the Processing Integrity identifiers the crosswalk cites cannot produce links
 * to pages that do not exist.
 */
const related = relatedByCriterion(soc2, domains);

/** Criteria in family order, then numerically within each family. */
const criteria = byFamily(soc2).flatMap((f) => f.criteria);

const records: FrameworkRecord[] = criteria.map((c) => ({
  id: c.id,
  group: c.family,
  heading: c.subject,
  metaphor: c.metaphor,
  translation: c.translation,
  keywords: c.familyName,
}));

// Capped so a broad domain does not bury a card in chips.
const CHIP_CAP = 6;

initFrameworkPage({
  records,
  section: 'soc2',
  groups: soc2.meta.families.map((f) => ({
    value: f.code,
    label: f.code,
    title: f.coso ? `${f.name} (COSO ${f.coso})` : f.name,
  })),
  kicker: (record) => {
    const criterion = criteria.find((c) => c.id === record.id)!;
    return `${criterion.familyName} / ${criterion.id}`;
  },
  countNoun: 'criteria',
  relatedLabel: 'Related CSF, CIS and ISO controls (unofficial)',
  related: (record) => {
    const rel = related.get(record.id);
    if (!rel) return [];
    return [
      ...rel.csf.slice(0, CHIP_CAP).map((id) => ({
        label: id,
        href: `../nist-csf/${frameworkSlug(id)}.html`,
      })),
      ...rel.cis.slice(0, CHIP_CAP).map((id) => ({
        label: id,
        href: `../cis/${frameworkSlug(id)}.html`,
      })),
      ...rel.iso.slice(0, CHIP_CAP).map((id) => ({
        label: id,
        href: `../iso/${frameworkSlug(id)}.html`,
      })),
    ];
  },
});
