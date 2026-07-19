/** A searchable framework record, normalized from CSF or CIS shapes. */
export interface FrameworkRecord {
  id: string;
  /** Filter group: CSF function code or CIS control number as string. */
  group: string;
  /** Official heading: CSF subcategory text or CIS safeguard title. */
  heading: string;
  metaphor: string;
  translation: string;
  /** Extra searchable text, e.g. the control/category name and function. */
  keywords?: string;
  /** Short badges shown on the card, e.g. ["IG1"]. */
  badges?: string[];
  /** Numeric tier for secondary filtering (CIS implementation group). */
  tier?: number;
}

/**
 * Rank-ordered search: exact id > id prefix > heading word-start >
 * heading contains > metaphor/translation contains.
 * Empty query returns the (filtered) set in original order.
 */
export function searchFramework(
  records: FrameworkRecord[],
  query: string,
  group = '',
): FrameworkRecord[] {
  const term = query.trim().toLowerCase();
  const scored: Array<[FrameworkRecord, number]> = [];

  for (const record of records) {
    if (group && record.group !== group) continue;
    if (!term) {
      scored.push([record, 0]);
      continue;
    }
    const id = record.id.toLowerCase();
    const heading = record.heading.toLowerCase();
    let rank: number | null = null;
    if (id === term) rank = 0;
    else if (id.startsWith(term)) rank = 1;
    else if (new RegExp(`\\b${escapeRegExp(term)}`).test(heading)) rank = 2;
    else if (heading.includes(term)) rank = 3;
    else if (record.keywords?.toLowerCase().includes(term)) rank = 3;
    else if (
      record.metaphor.toLowerCase().includes(term) ||
      record.translation.toLowerCase().includes(term)
    ) {
      rank = 4;
    }
    if (rank !== null) scored.push([record, rank]);
  }

  return scored
    .map(([record, rank], index) => ({ record, rank, index }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((item) => item.record);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Detect a framework-control-shaped query: "GV.OC-01" style or "8.1" style. */
export function detectFrameworkQuery(query: string): 'csf' | 'cis' | null {
  const trimmed = query.trim();
  if (/^[a-z]{2}\.[a-z]{2}(-\d{1,2})?$/i.test(trimmed)) return 'csf';
  if (/^\d{1,2}\.\d{1,2}$/.test(trimmed)) return 'cis';
  return null;
}
