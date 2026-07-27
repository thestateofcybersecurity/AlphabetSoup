import { describe, expect, it } from 'vitest';
import counts from 'virtual:assessment-counts';
import cisRaw from '../src/data/cis.json';
import igsRaw from '../src/data/cis-igs.json';
import csfRaw from '../src/data/nist-csf.json';
import ransomware from '../src/data/assessment.json';
import cpg from '../src/data/assessment-cpg.json';
import cmmc from '../src/data/assessment-800171.json';
import ce from '../src/data/assessment-cyber-essentials.json';
import ztmm from '../src/data/assessment-ztmm.json';
import ssdf from '../src/data/assessment-ssdf.json';
import pci from '../src/data/assessment-pci-dss.json';
import { cisControlsAssessment, cisIg1Assessment, csfAssessment } from '../src/lib/assessment';
import type { AssessmentData } from '../src/lib/assessment';
import type { CisData, CsfData } from '../src/lib/frameworks';

/**
 * The assess picker prints each assessment's question count before any dataset
 * is loaded, using numbers computed at build time by the `assessment-counts`
 * Vite plugin. If those numbers drift from the real datasets the page lies to
 * the visitor, so this recomputes every one of them from source.
 *
 * Three of the ten are generated from cis.json and nist-csf.json rather than
 * read from a file, which is the reason the counts are derived by running the
 * real builders instead of being written down.
 */

const actual: Record<string, number> = {
  ransomware: (ransomware as AssessmentData).questions.length,
  cpg: (cpg as AssessmentData).questions.length,
  'nist-800171': (cmmc as AssessmentData).questions.length,
  'cyber-essentials': (ce as AssessmentData).questions.length,
  'zero-trust': (ztmm as AssessmentData).questions.length,
  ssdf: (ssdf as AssessmentData).questions.length,
  'pci-dss': (pci as AssessmentData).questions.length,
  'cis-ig1': cisIg1Assessment(cisRaw as CisData, igsRaw as Record<string, number>).questions.length,
  'cis-v8': cisControlsAssessment(cisRaw as CisData, igsRaw as Record<string, number>).questions
    .length,
  'nist-csf': csfAssessment(csfRaw as unknown as CsfData).questions.length,
};

describe('assessment question counts', () => {
  it('covers every assessment and nothing else', () => {
    expect(Object.keys(counts).sort()).toEqual(Object.keys(actual).sort());
  });

  it.each(Object.keys(actual))('%s matches the real dataset', (id) => {
    expect(counts[id]).toBe(actual[id]);
  });

  it('are all positive', () => {
    for (const [id, n] of Object.entries(counts)) {
      expect(n, id).toBeGreaterThan(0);
    }
  });
});
