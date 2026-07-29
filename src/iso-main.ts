import isoRaw from './data/iso-27001.json';
import crosswalkRaw from './data/crosswalk.json';
import { frameworkSlug } from './lib/frameworks';
import type { FrameworkRecord } from './lib/framework-search';
import { initFrameworkPage } from './ui/framework-page';

interface IsoControl {
  id: string;
  theme: string;
  themeName: string;
  subject: string;
  metaphor: string;
  translation: string;
}

const iso = isoRaw as unknown as {
  meta: { themes: { code: string; name: string; blurb: string; count: number }[] };
  controls: IsoControl[];
};

/**
 * Related controls in the other frameworks, via the shared crosswalk.
 *
 * The crosswalk maps a control domain to identifiers in each framework, so an
 * ISO control reaches CSF and CIS by way of whichever domains cite it. Every
 * link is an unofficial mapping and is labelled as such on the page.
 */
const domains = crosswalkRaw.controls as { id: string; mappings: Record<string, string[]> }[];
const relatedByIso = new Map<string, { csf: Set<string>; cis: Set<string> }>();
for (const domain of domains) {
  for (const isoId of domain.mappings.iso ?? []) {
    const entry = relatedByIso.get(isoId) ?? { csf: new Set<string>(), cis: new Set<string>() };
    for (const id of domain.mappings.csf ?? []) entry.csf.add(id);
    for (const id of domain.mappings.cis ?? []) entry.cis.add(id);
    relatedByIso.set(isoId, entry);
  }
}

/** Sort by theme, then by control number, so A.5.2 precedes A.5.10. */
const controls = [...iso.controls].sort((a, b) => {
  const [, at, an] = a.id.split('.');
  const [, bt, bn] = b.id.split('.');
  return Number(at) - Number(bt) || Number(an) - Number(bn);
});

const records: FrameworkRecord[] = controls.map((c) => ({
  id: c.id,
  group: c.theme,
  heading: c.subject,
  metaphor: c.metaphor,
  translation: c.translation,
  keywords: c.themeName,
}));

initFrameworkPage({
  records,
  section: 'iso',
  groups: iso.meta.themes.map((t) => ({
    value: t.code,
    label: `A.${t.code}`,
    title: `${t.name} controls`,
  })),
  kicker: (record) => {
    const control = controls.find((c) => c.id === record.id)!;
    return `${control.themeName} / ${control.id}`;
  },
  countNoun: 'controls',
  relatedLabel: 'Related CSF and CIS controls (unofficial)',
  related: (record) => {
    const rel = relatedByIso.get(record.id);
    if (!rel) return [];
    // Capped so a broad domain does not bury the page in chips.
    const csf = [...rel.csf].sort().slice(0, 6).map((id) => ({
      label: id,
      href: `../nist-csf/${frameworkSlug(id)}.html`,
    }));
    const cis = [...rel.cis].sort().slice(0, 6).map((id) => ({
      label: id,
      href: `../cis/${frameworkSlug(id)}.html`,
    }));
    return [...csf, ...cis];
  },
});
