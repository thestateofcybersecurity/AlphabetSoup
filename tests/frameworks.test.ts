import { describe, expect, it } from 'vitest';
import csfRaw from '../src/data/nist-csf.json';
import cisRaw from '../src/data/cis.json';
import { frameworkSlug, validateCis, validateCsf } from '../src/lib/frameworks';
import type { CisData, CsfData } from '../src/lib/frameworks';
import { detectFrameworkQuery, searchFramework } from '../src/lib/framework-search';
import type { FrameworkRecord } from '../src/lib/framework-search';

const csf = csfRaw as CsfData;
const cis = cisRaw as CisData;

describe('framework datasets', () => {
  it('NIST CSF 2.0 dataset is complete and valid (106 subcategories)', () => {
    expect(validateCsf(csf)).toEqual([]);
    expect(Object.keys(csf)).toHaveLength(106);
    expect(csf['GV.SC-04']).toBeDefined();
  });

  it('CIS Controls v8 dataset is complete and valid (153 safeguards)', () => {
    expect(validateCis(cis)).toEqual([]);
    expect(Object.keys(cis)).toHaveLength(153);
    expect(cis['15.7']).toBeDefined();
  });
});

describe('frameworkSlug', () => {
  it('slugs CSF and CIS ids', () => {
    expect(frameworkSlug('GV.OC-01')).toBe('gv-oc-01');
    expect(frameworkSlug('1.1')).toBe('1-1');
    expect(frameworkSlug('18.5')).toBe('18-5');
  });
});

describe('searchFramework', () => {
  const records: FrameworkRecord[] = [
    { id: 'GV.OC-01', group: 'GV', heading: 'The organizational mission is understood', metaphor: 'purpose of family', translation: 'family knows priorities' },
    { id: 'PR.AA-03', group: 'PR', heading: 'Users, services, and hardware are authenticated', metaphor: 'checking ID at the door', translation: 'verify before entry' },
    { id: 'DE.CM-01', group: 'DE', heading: 'Networks are monitored', metaphor: 'watching cameras', translation: 'spot intruders' },
  ];

  it('exact id match ranks first', () => {
    expect(searchFramework(records, 'gv.oc-01')[0].id).toBe('GV.OC-01');
  });

  it('id prefix matches', () => {
    expect(searchFramework(records, 'pr.')[0].id).toBe('PR.AA-03');
  });

  it('searches headings and metaphors', () => {
    expect(searchFramework(records, 'authenticated')[0].id).toBe('PR.AA-03');
    expect(searchFramework(records, 'cameras')[0].id).toBe('DE.CM-01');
  });

  it('filters by group', () => {
    expect(searchFramework(records, '', 'DE')).toHaveLength(1);
    expect(searchFramework(records, 'network', 'GV')).toHaveLength(0);
  });
});

describe('detectFrameworkQuery', () => {
  it('detects CSF-shaped and CIS-shaped queries', () => {
    expect(detectFrameworkQuery('GV.OC-01')).toBe('csf');
    expect(detectFrameworkQuery('pr.aa')).toBe('csf');
    expect(detectFrameworkQuery('8.1')).toBe('cis');
    expect(detectFrameworkQuery('SIEM')).toBeNull();
    expect(detectFrameworkQuery('zero trust')).toBeNull();
  });
});
