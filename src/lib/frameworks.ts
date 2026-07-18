export interface CsfEntry {
  function: string;
  functionCode: string;
  category: string;
  categoryCode: string;
  text: string;
  metaphor: string;
  translation: string;
}

export interface CisEntry {
  control: number;
  controlName: string;
  title: string;
  metaphor: string;
  translation: string;
}

export type CsfData = Record<string, CsfEntry>;
export type CisData = Record<string, CisEntry>;

export const CSF_FUNCTIONS: ReadonlyArray<readonly [string, string]> = [
  ['GV', 'Govern'],
  ['ID', 'Identify'],
  ['PR', 'Protect'],
  ['DE', 'Detect'],
  ['RS', 'Respond'],
  ['RC', 'Recover'],
];

/** Official NIST CSF 2.0 subcategory counts per function (total 106). */
export const CSF_EXPECTED_COUNTS: Record<string, number> = {
  GV: 31,
  ID: 21,
  PR: 22,
  DE: 11,
  RS: 13,
  RC: 8,
};

/** Official CIS Controls v8 safeguard counts per control (total 153). */
export const CIS_EXPECTED_COUNTS: Record<number, number> = {
  1: 5, 2: 7, 3: 14, 4: 12, 5: 6, 6: 8, 7: 7, 8: 12, 9: 7,
  10: 7, 11: 5, 12: 8, 13: 11, 14: 9, 15: 7, 16: 14, 17: 9, 18: 5,
};

const CSF_ID = /^[A-Z]{2}\.[A-Z]{2}-\d{2}$/;
const CIS_ID = /^\d{1,2}\.\d{1,2}$/;

/** Slug for generated pages: "GV.OC-01" -> "gv-oc-01", "1.1" -> "1-1". */
export function frameworkSlug(id: string): string {
  return id.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

function checkProse(where: string, entry: { metaphor: string; translation: string }, errors: string[]): void {
  for (const field of ['metaphor', 'translation'] as const) {
    const value = entry[field]?.trim() ?? '';
    if (value.length < 20 || value.length > 600) {
      errors.push(`${where} ${field} length ${value.length} outside 20-600`);
    }
    if (value.includes('—')) {
      errors.push(`${where} ${field} contains an em dash`);
    }
  }
}

export function validateCsf(data: CsfData): string[] {
  const errors: string[] = [];
  const counts: Record<string, number> = {};
  for (const [id, entry] of Object.entries(data)) {
    const where = `[${id}]`;
    if (!CSF_ID.test(id)) errors.push(`${where} invalid CSF id`);
    const fn = id.split('.')[0];
    counts[fn] = (counts[fn] ?? 0) + 1;
    if (entry.functionCode !== fn) errors.push(`${where} functionCode mismatch`);
    if (entry.categoryCode !== id.split('-')[0]) errors.push(`${where} categoryCode mismatch`);
    if (!entry.text?.trim()) errors.push(`${where} missing text`);
    if (entry.text?.includes('—')) errors.push(`${where} text contains an em dash`);
    checkProse(where, entry, errors);
  }
  for (const [fn, expected] of Object.entries(CSF_EXPECTED_COUNTS)) {
    if ((counts[fn] ?? 0) !== expected) {
      errors.push(`function ${fn}: expected ${expected} subcategories, found ${counts[fn] ?? 0}`);
    }
  }
  return errors;
}

export function validateCis(data: CisData): string[] {
  const errors: string[] = [];
  const counts: Record<number, number> = {};
  for (const [id, entry] of Object.entries(data)) {
    const where = `[${id}]`;
    if (!CIS_ID.test(id)) errors.push(`${where} invalid CIS id`);
    const control = Number(id.split('.')[0]);
    counts[control] = (counts[control] ?? 0) + 1;
    if (entry.control !== control) errors.push(`${where} control number mismatch`);
    if (!entry.controlName?.trim()) errors.push(`${where} missing controlName`);
    if (!entry.title?.trim()) errors.push(`${where} missing title`);
    checkProse(where, entry, errors);
  }
  for (const [control, expected] of Object.entries(CIS_EXPECTED_COUNTS)) {
    if ((counts[Number(control)] ?? 0) !== expected) {
      errors.push(`control ${control}: expected ${expected} safeguards, found ${counts[Number(control)] ?? 0}`);
    }
  }
  return errors;
}
