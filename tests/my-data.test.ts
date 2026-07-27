import { describe, expect, it } from 'vitest';
import {
  BUNDLE_FORMAT,
  BUNDLE_VERSION,
  PREFIX,
  assessmentSummaries,
  buildBundle,
  bundleFilename,
  collectStored,
  describeKey,
  formatBytes,
  groupBySection,
  humanize,
  parseBundle,
  quizSummary,
  sectionLabel,
  type StorageLike,
  type StoredItem,
} from '../src/lib/my-data';

/** A minimal localStorage stand-in. */
function fakeStorage(entries: Record<string, string>): StorageLike {
  const keys = Object.keys(entries);
  return {
    length: keys.length,
    key: (i) => keys[i] ?? null,
    getItem: (k) => entries[k] ?? null,
    removeItem: (k) => {
      delete entries[k];
    },
  };
}

const TOOLS = ['skills-matrix', 'board-metrics', 'crosswalk', 'runbook'];

describe('collectStored', () => {
  it('picks up only this site’s keys', () => {
    const storage = fakeStorage({
      [`${PREFIX}quiz`]: '{}',
      'someone-else:token': 'secret',
      [`${PREFIX}roadmap:csf`]: '[]',
    });
    expect(collectStored(storage).map((i) => i.key)).toEqual([
      `${PREFIX}quiz`,
      `${PREFIX}roadmap:csf`,
    ]);
  });

  it('never reads another origin’s data', () => {
    const storage = fakeStorage({ 'unrelated-app': 'x', 'alphabetsoupfake:y': 'z' });
    // The prefix ends in a colon, so a lookalike name must not match.
    expect(collectStored(storage)).toEqual([]);
  });

  it('records sizes and sorts stably', () => {
    const storage = fakeStorage({ [`${PREFIX}zzz`]: 'abc', [`${PREFIX}aaa`]: 'de' });
    const items = collectStored(storage);
    expect(items.map((i) => i.key)).toEqual([`${PREFIX}aaa`, `${PREFIX}zzz`]);
    expect(items[0].bytes).toBe(2);
  });

  it('handles empty storage', () => {
    expect(collectStored(fakeStorage({}))).toEqual([]);
  });
});

describe('describeKey', () => {
  it.each([
    ['quiz', 'quiz'],
    ['quiz-session', 'quiz'],
    ['assessment', 'assessments'],
    ['assessment:cis-ig1', 'assessments'],
    ['assessment-history:pci-dss', 'assessments'],
    ['assessment-notes:ransomware', 'assessments'],
    ['roadmap:csf', 'roadmap'],
    ['skills-matrix:state', 'tools'],
  ])('files %s under %s', (rest, section) => {
    expect(describeKey(`${PREFIX}${rest}`, TOOLS).section).toBe(section);
  });

  it('links each key back to where the work continues', () => {
    expect(describeKey(`${PREFIX}assessment:pci-dss`, TOOLS).href).toBe('assess/?a=pci-dss');
    expect(describeKey(`${PREFIX}skills-matrix:state`, TOOLS).href).toBe('tools/skills-matrix/');
    expect(describeKey(`${PREFIX}quiz`, TOOLS).href).toBe('quiz/');
  });

  it('does not invent a tool link for an unknown slug', () => {
    const info = describeKey(`${PREFIX}not-a-tool:state`, TOOLS);
    expect(info.section).toBe('other');
    expect(info.href).toBeUndefined();
  });

  it('still surfaces a key it has never seen, rather than hiding it', () => {
    // The important property: unknown data is visible, so export and erase
    // cannot silently miss it.
    const info = describeKey(`${PREFIX}future-feature`, TOOLS);
    expect(info.section).toBe('other');
    expect(info.label).toBe('future-feature');
  });

  it('reads the legacy single-assessment key', () => {
    expect(describeKey(`${PREFIX}assessment`, TOOLS).label).toMatch(/earlier format/i);
  });
});

describe('groupBySection', () => {
  const items: StoredItem[] = [
    { key: `${PREFIX}skills-matrix:state`, value: 'aaaa', bytes: 4 },
    { key: `${PREFIX}quiz`, value: 'bb', bytes: 2 },
    { key: `${PREFIX}mystery`, value: 'c', bytes: 1 },
    { key: `${PREFIX}assessment:cpg`, value: 'ddd', bytes: 3 },
  ];

  it('orders sections predictably and sums their size', () => {
    const groups = groupBySection(items, TOOLS);
    expect(groups.map((g) => g.section)).toEqual(['quiz', 'assessments', 'tools', 'other']);
    expect(groups.find((g) => g.section === 'tools')?.bytes).toBe(4);
  });

  it('omits sections with nothing in them', () => {
    const groups = groupBySection([items[1]], TOOLS);
    expect(groups.map((g) => g.section)).toEqual(['quiz']);
  });

  it('accounts for every item exactly once', () => {
    const groups = groupBySection(items, TOOLS);
    expect(groups.reduce((n, g) => n + g.items.length, 0)).toBe(items.length);
  });

  it('labels every section', () => {
    for (const group of groupBySection(items, TOOLS)) {
      expect(sectionLabel(group.section)).toBeTruthy();
    }
  });
});

describe('quizSummary', () => {
  it('summarises started decks only', () => {
    const raw = JSON.stringify({
      cissp: { attempts: 3, best: 80, missed: { a: 1, b: 1 } },
      ceh: { attempts: 1, best: 60, missed: {} },
      unopened: { attempts: 0, best: 0, missed: {} },
    });
    expect(quizSummary(raw)).toEqual({
      decksStarted: 2,
      totalRounds: 4,
      bestAverage: 70,
      dueForReview: 2,
    });
  });

  it('returns null when nothing has been attempted', () => {
    expect(quizSummary(JSON.stringify({ cissp: { attempts: 0 } }))).toBeNull();
    expect(quizSummary('{}')).toBeNull();
    expect(quizSummary(null)).toBeNull();
  });

  it('survives corrupt json rather than throwing', () => {
    expect(quizSummary('{not json')).toBeNull();
  });
});

describe('assessmentSummaries', () => {
  const history = (id: string, points: number[]): StoredItem => ({
    key: `${PREFIX}assessment-history:${id}`,
    value: JSON.stringify(points.map((overall, i) => ({ date: `2026-07-0${i + 1}`, overall }))),
    bytes: 0,
  });

  it('reports the latest score and the change since last time', () => {
    const out = assessmentSummaries([history('cpg', [40, 55])]);
    expect(out).toEqual([{ id: 'cpg', latest: 55, delta: 15, date: '2026-07-02' }]);
  });

  it('has no delta from a single snapshot', () => {
    expect(assessmentSummaries([history('ssdf', [70])])[0].delta).toBeNull();
  });

  it('puts the weakest assessment first, since that is the one to work on', () => {
    const out = assessmentSummaries([history('high', [90]), history('low', [30])]);
    expect(out.map((o) => o.id)).toEqual(['low', 'high']);
  });

  it('ignores answers and notes, reading only history', () => {
    const items: StoredItem[] = [
      { key: `${PREFIX}assessment:cpg`, value: '{"q1":"yes"}', bytes: 0 },
      { key: `${PREFIX}assessment-notes:cpg`, value: '{}', bytes: 0 },
    ];
    expect(assessmentSummaries(items)).toEqual([]);
  });

  it('skips corrupt or empty history', () => {
    const bad: StoredItem[] = [
      { key: `${PREFIX}assessment-history:a`, value: 'nope', bytes: 0 },
      { key: `${PREFIX}assessment-history:b`, value: '[]', bytes: 0 },
    ];
    expect(assessmentSummaries(bad)).toEqual([]);
  });
});

describe('export and import', () => {
  const items: StoredItem[] = [
    { key: `${PREFIX}quiz`, value: '{"cissp":{}}', bytes: 12 },
    { key: `${PREFIX}roadmap:csf`, value: '[]', bytes: 2 },
  ];

  it('round-trips losslessly', () => {
    const bundle = buildBundle(items, '2026-07-27T10:00:00.000Z');
    const parsed = parseBundle(JSON.stringify(bundle));
    expect(parsed.error).toBeUndefined();
    expect(parsed.items).toEqual({
      [`${PREFIX}quiz`]: '{"cissp":{}}',
      [`${PREFIX}roadmap:csf`]: '[]',
    });
  });

  it('exports every key it was given', () => {
    const bundle = buildBundle(items, '2026-07-27T10:00:00.000Z');
    expect(Object.keys(bundle.items)).toHaveLength(items.length);
    expect(bundle.format).toBe(BUNDLE_FORMAT);
    expect(bundle.version).toBe(BUNDLE_VERSION);
  });

  it('refuses a bundle that would write outside this site', () => {
    const hostile = JSON.stringify({
      format: BUNDLE_FORMAT,
      version: 1,
      exportedAt: 'x',
      items: { 'other-site:session': 'stolen' },
    });
    expect(parseBundle(hostile).error).toMatch(/unexpected key/i);
    expect(parseBundle(hostile).items).toBeUndefined();
  });

  it.each([
    ['not json at all', /valid JSON/i],
    ['null', /not a backup/i],
    ['{"format":"something-else"}', /not exported from this site/i],
    [`{"format":"${BUNDLE_FORMAT}","version":99,"items":{}}`, /newer version/i],
    [`{"format":"${BUNDLE_FORMAT}","version":1}`, /no data/i],
    [`{"format":"${BUNDLE_FORMAT}","version":1,"items":{}}`, /no data/i],
  ])('rejects %s', (input, message) => {
    expect(parseBundle(input).error).toMatch(message);
  });

  it('rejects a non-string value', () => {
    const bad = `{"format":"${BUNDLE_FORMAT}","version":1,"items":{"${PREFIX}quiz":{"a":1}}}`;
    expect(parseBundle(bad).error).toMatch(/bad value/i);
  });

  it('names the file by export date', () => {
    expect(bundleFilename('2026-07-27T10:00:00.000Z')).toBe('alphabet-soup-backup-2026-07-27.json');
  });
});

describe('formatting helpers', () => {
  it('humanizes slugs', () => {
    expect(humanize('skills-matrix')).toBe('Skills matrix');
    expect(humanize('cyber-essentials')).toBe('Cyber essentials');
  });

  it('keeps acronyms and designators in their proper form', () => {
    // These are assessment ids, on a site about getting these names right.
    expect(humanize('cpg')).toBe('CPG');
    expect(humanize('cis-ig1')).toBe('CIS IG1');
    expect(humanize('cis-v8')).toBe('CIS v8');
    expect(humanize('nist-csf')).toBe('NIST CSF');
    expect(humanize('pci-dss')).toBe('PCI DSS');
    expect(humanize('nist-800171')).toBe('NIST 800171');
    expect(humanize('ssdf')).toBe('SSDF');
  });

  it('renders every real assessment id without a mangled label', () => {
    const ids = ['ransomware', 'cpg', 'cis-ig1', 'cis-v8', 'nist-csf', 'nist-800171',
      'cyber-essentials', 'zero-trust', 'ssdf', 'pci-dss'];
    for (const id of ids) {
      const label = humanize(id);
      expect(label, id).not.toMatch(/-/);
      // No half-capitalised acronym like "Cis ig1".
      expect(label, id).not.toMatch(/\b(Cis|Csf|Cpg|Nist|Pci|Dss|Ssdf|Ig1)\b/);
    }
  });

  it('formats byte counts', () => {
    expect(formatBytes(512)).toBe('512 bytes');
    expect(formatBytes(2048)).toBe('2.0 KB');
  });
});
