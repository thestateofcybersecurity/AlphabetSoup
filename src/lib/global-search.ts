import { searchFramework } from './framework-search';
import type { FrameworkRecord } from './framework-search';
import type { CisData, CsfData } from './frameworks';
import { frameworkSlug } from './frameworks';
import type { DeckMeta } from './quiz';

export interface CrossHit {
  section: 'NIST CSF' | 'CIS Controls' | 'Quiz';
  label: string;
  detail: string;
  href: string;
}

const CAP = 5;

/**
 * Search framework controls and quiz decks for homepage cross-section hits.
 * Hrefs are relative to the site root.
 */
export function crossSearch(
  query: string,
  csf: CsfData,
  cis: CisData,
  decks: DeckMeta[],
): CrossHit[] {
  const term = query.trim();
  if (term.length < 2) return [];
  const hits: CrossHit[] = [];

  const csfRecords: FrameworkRecord[] = Object.keys(csf).map((id) => ({
    id,
    group: csf[id].functionCode,
    heading: csf[id].text,
    metaphor: csf[id].metaphor,
    translation: csf[id].translation,
  }));
  for (const record of searchFramework(csfRecords, term).slice(0, 3)) {
    hits.push({
      section: 'NIST CSF',
      label: record.id,
      detail: record.heading,
      href: `frameworks/nist-csf/${frameworkSlug(record.id)}.html`,
    });
  }

  const cisRecords: FrameworkRecord[] = Object.keys(cis).map((id) => ({
    id,
    group: String(cis[id].control),
    heading: cis[id].title,
    metaphor: cis[id].metaphor,
    translation: cis[id].translation,
  }));
  for (const record of searchFramework(cisRecords, term).slice(0, 3)) {
    hits.push({
      section: 'CIS Controls',
      label: `CIS ${record.id}`,
      detail: record.heading,
      href: `frameworks/cis/${frameworkSlug(record.id)}.html`,
    });
  }

  const lower = term.toLowerCase();
  for (const deck of decks) {
    if (
      deck.name.toLowerCase().includes(lower) ||
      deck.slug.includes(lower) ||
      (deck.certKey && deck.certKey.toLowerCase() === lower.replace(/[^a-z0-9]/g, ''))
    ) {
      hits.push({
        section: 'Quiz',
        label: deck.name,
        detail: `${deck.count} practice questions`,
        href: `quiz/?deck=${deck.slug}`,
      });
    }
  }

  return hits.slice(0, CAP);
}
