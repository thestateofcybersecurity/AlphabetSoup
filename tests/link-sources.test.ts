import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { basename, join } from 'node:path';
import {
  affiliateHosts,
  collectUrls,
  hostOf,
  shouldSkipHost,
  type Document,
} from '../src/lib/link-sources';

/**
 * The link check read acronyms.json and nothing else, so most cited URLs were
 * never watched. These tests pin the two things that matter now that it reads
 * everything: that a new dataset is covered without touching the collector,
 * and that affiliate links are never requested.
 */

const AFFILIATES = {
  nordvpn: { url: 'https://www.anrdoezrs.net/click-1-2' },
  yubikey: { url: 'https://www.amazon.com/dp/B08?tag=x-20' },
};
const hosts = affiliateHosts(AFFILIATES);

describe('affiliateHosts', () => {
  it('reads the hosts out of the affiliate data rather than a hand-kept list', () => {
    expect(hosts).toEqual(new Set(['www.anrdoezrs.net', 'www.amazon.com']));
  });

  it('is empty when there are no affiliates, so nothing is skipped by accident', () => {
    expect(affiliateHosts({})).toEqual(new Set());
  });
});

describe('shouldSkipHost', () => {
  it('skips an affiliate link', () => {
    expect(shouldSkipHost('https://www.anrdoezrs.net/click-9-9', hosts)).toBe(true);
  });

  // The rule that makes this worth a test: www.amazon.com is an affiliate link
  // and aws.amazon.com is AWS security documentation. A substring match on the
  // domain would quietly stop checking the documentation.
  it('does not skip a different host that merely shares a domain suffix', () => {
    expect(shouldSkipHost('https://aws.amazon.com/blogs/security/ai', hosts)).toBe(false);
  });

  it('does not skip an ordinary citation', () => {
    expect(shouldSkipHost('https://csrc.nist.gov/pubs/sp/800/53/r5/final', hosts)).toBe(false);
  });

  it('treats an unparseable URL as not skippable', () => {
    expect(shouldSkipHost('https://', hosts)).toBe(false);
    expect(hostOf('not a url')).toBeUndefined();
  });
});

describe('collectUrls', () => {
  it('finds a URL at any depth, in a shape it has never seen', () => {
    const docs: Document[] = [
      { file: 'new-dataset.json', data: { meta: { deep: [{ nested: { url: 'https://a.test/' } }] } } },
    ];
    expect([...collectUrls(docs, hosts).owners.keys()]).toEqual(['https://a.test/']);
  });

  it('names the owner by the entry id, so a failure says where to go', () => {
    const docs: Document[] = [
      { file: 'regs.json', data: { regulations: [{ id: 'GDPR', sources: [{ url: 'https://a.test/' }] }] } },
    ];
    expect(collectUrls(docs, hosts).owners.get('https://a.test/')).toEqual(['regs.json > GDPR']);
  });

  it('uses the top-level key when the file is a record of entries, as acronyms.json is', () => {
    const docs: Document[] = [
      { file: 'acronyms.json', data: { API: { sources: [{ url: 'https://a.test/' }] } } },
    ];
    expect(collectUrls(docs, hosts).owners.get('https://a.test/')).toEqual(['acronyms.json > API']);
  });

  it('falls back to the file name when nothing names itself', () => {
    const docs: Document[] = [{ file: 'plain.json', data: { items: [{ url: 'https://a.test/' }] } }];
    expect(collectUrls(docs, hosts).owners.get('https://a.test/')).toEqual(['plain.json']);
  });

  // A file that is only named sections, like {"meta": {...}}, reads as a
  // record of entries and is labelled by section. That is the same rule that
  // gives acronyms.json its acronym labels, and naming the section is useful.
  it('names the section when a file is nothing but named sections', () => {
    const docs: Document[] = [{ file: 'iso.json', data: { meta: { url: 'https://a.test/' } } }];
    expect(collectUrls(docs, hosts).owners.get('https://a.test/')).toEqual(['iso.json > meta']);
  });

  it('lists every citation of one URL, so it gets fixed everywhere at once', () => {
    const docs: Document[] = [
      { file: 'one.json', data: [{ code: 'A', url: 'https://shared.test/' }] },
      { file: 'two.json', data: [{ code: 'B', url: 'https://shared.test/' }] },
    ];
    expect(collectUrls(docs, hosts).owners.get('https://shared.test/')).toEqual([
      'one.json > A',
      'two.json > B',
    ]);
  });

  it('records a repeated citation once per owner, not once per occurrence', () => {
    const docs: Document[] = [
      { file: 'one.json', data: { items: [{ a: 'https://x.test/' }, { b: 'https://x.test/' }] } },
    ];
    expect(collectUrls(docs, hosts).owners.get('https://x.test/')).toEqual(['one.json']);
  });

  it('collects affiliate links into skipped instead of checking them', () => {
    const docs: Document[] = [
      { file: 'affiliates.json', data: { nordvpn: { url: 'https://www.anrdoezrs.net/click-1-2' } } },
    ];
    const { owners, skipped } = collectUrls(docs, hosts);
    expect(owners.size).toBe(0);
    expect(skipped).toEqual(['https://www.anrdoezrs.net/click-1-2']);
  });

  it('ignores relative links and URLs embedded in prose', () => {
    const docs: Document[] = [
      { file: 'x.json', data: { links: ['/frameworks/cis/'], body: 'see https://a.test/ for more' } },
    ];
    expect(collectUrls(docs, hosts).owners.size).toBe(0);
  });
});

describe('the real datasets', () => {
  const dir = fileURLToPath(new URL('../src/data', import.meta.url));
  const files = (function walk(d: string): string[] {
    return readdirSync(d, { withFileTypes: true }).flatMap((e) => {
      const p = join(d, e.name);
      if (e.isDirectory()) return walk(p);
      return e.isFile() && e.name.endsWith('.json') ? [p] : [];
    });
  })(dir);
  const docs: Document[] = files.map((p) => ({
    file: basename(p),
    data: JSON.parse(readFileSync(p, 'utf8')) as unknown,
  }));
  const real = affiliateHosts(docs.find((d) => d.file === 'affiliates.json')?.data ?? {});
  const { owners, skipped } = collectUrls(docs, real);

  it('covers more than acronyms.json alone ever did', () => {
    const fromOthers = [...owners.values()].filter((o) =>
      o.every((label) => !label.startsWith('acronyms.json')),
    );
    expect(fromOthers.length).toBeGreaterThan(50);
  });

  // The two that went unwatched when OWASP moved its pages in September 2026.
  it.each(['https://genai.owasp.org/llm-top-10/', 'https://owaspsamm.org/'])(
    'now watches %s',
    (url) => {
      expect(owners.has(url)).toBe(true);
    },
  );

  it('never queues an affiliate link', () => {
    expect(skipped.length).toBeGreaterThan(0);
    for (const url of owners.keys()) {
      expect(shouldSkipHost(url, real)).toBe(false);
    }
  });

  it('still watches the AWS documentation that shares a domain with an affiliate link', () => {
    const aws = [...owners.keys()].filter((u) => hostOf(u) === 'aws.amazon.com');
    expect(aws.length).toBeGreaterThan(0);
  });
});
