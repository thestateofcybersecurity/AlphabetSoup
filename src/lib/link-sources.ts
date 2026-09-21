/**
 * Finding every external URL the datasets cite.
 *
 * The link check used to read acronyms.json and nothing else, which left most
 * of the data unwatched. When OWASP moved its project pages in September 2026
 * the check caught the eight citations in acronyms.json and would have said
 * nothing about genai.owasp.org in four AI datasets or owaspsamm.org in
 * ssdlc.json, because it never looked at them.
 *
 * Rather than teach the checker the shape of twenty-seven files, this walks
 * whatever it is handed and treats any string that is entirely an http(s) URL
 * as a citation. New datasets are covered the day they are added, with no
 * change here.
 *
 * Affiliate links are the deliberate exception. See shouldSkipHost.
 */

/** A string counts as a citation only if the URL is the whole value. */
const WHOLE_URL = /^https?:\/\/\S+$/;

/** Fields an object can use to name itself, in the order we prefer them. */
const IDENTITY_FIELDS = ['id', 'code', 'acronym', 'key'] as const;

export interface Document {
  /** Display name, normally the file's basename. */
  file: string;
  data: unknown;
}

export interface Collected {
  /** URL to the places that cite it, e.g. "acronyms.json > API". */
  owners: Map<string, string[]>;
  /** URLs left unchecked because they are affiliate links. */
  skipped: string[];
}

/**
 * The hostnames of the affiliate links, taken from the affiliate dataset
 * itself rather than from a hand-kept list of networks.
 */
export function affiliateHosts(affiliates: unknown): Set<string> {
  const hosts = new Set<string>();
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit);
    } else if (node && typeof node === 'object') {
      Object.values(node as Record<string, unknown>).forEach(visit);
    } else if (typeof node === 'string' && WHOLE_URL.test(node.trim())) {
      const host = hostOf(node.trim());
      if (host) hosts.add(host);
    }
  };
  visit(affiliates);
  return hosts;
}

/** The hostname of a URL, or undefined if it will not parse. */
export function hostOf(url: string): string | undefined {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

/**
 * Whether to leave a URL alone.
 *
 * Affiliate URLs are tracking redirects. Requesting them on a schedule sends
 * clicks no human made to a network that pays per click and watches for
 * exactly that, so the check stays away from them and says how many it left.
 *
 * The match is on the exact hostname, never a substring: www.amazon.com is an
 * affiliate link here and aws.amazon.com is AWS security documentation, and a
 * substring rule would silently stop checking the second one.
 */
export function shouldSkipHost(url: string, affiliateHosts: Set<string>): boolean {
  const host = hostOf(url);
  return host !== undefined && affiliateHosts.has(host);
}

/**
 * Whether a root object is a record of entries keyed by name, like
 * acronyms.json, rather than a document with named sections. Only in the first
 * case does the top-level key name the thing that owns the URL.
 */
function isRecordOfEntries(data: unknown): boolean {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  const values = Object.values(data as Record<string, unknown>);
  return (
    values.length > 0 &&
    values.every((v) => v !== null && typeof v === 'object' && !Array.isArray(v))
  );
}

/** What an object calls itself, if anything. */
function identityOf(node: Record<string, unknown>): string | undefined {
  for (const field of IDENTITY_FIELDS) {
    const value = node[field];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

/**
 * Collect every cited URL, with the places that cite it.
 *
 * A URL cited in several files gets one entry listing all of them, so a broken
 * link is fixed everywhere it appears rather than in the first place it was
 * noticed.
 */
export function collectUrls(documents: Document[], affiliateHosts: Set<string>): Collected {
  const owners = new Map<string, string[]>();
  const skipped = new Set<string>();

  const record = (url: string, label: string): void => {
    if (shouldSkipHost(url, affiliateHosts)) {
      skipped.add(url);
      return;
    }
    const seen = owners.get(url) ?? [];
    if (!seen.includes(label)) seen.push(label);
    owners.set(url, seen);
  };

  for (const { file, data } of documents) {
    const keyed = isRecordOfEntries(data);

    const walk = (node: unknown, label: string): void => {
      if (Array.isArray(node)) {
        for (const item of node) walk(item, label);
        return;
      }
      if (node && typeof node === 'object') {
        const object = node as Record<string, unknown>;
        const own = identityOf(object);
        const next = own ? `${file} > ${own}` : label;
        for (const value of Object.values(object)) walk(value, next);
        return;
      }
      if (typeof node === 'string') {
        const url = node.trim();
        if (WHOLE_URL.test(url)) record(url, label);
      }
    };

    if (keyed) {
      for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
        walk(value, `${file} > ${key}`);
      }
    } else {
      walk(data, file);
    }
  }

  return { owners, skipped: [...skipped].sort() };
}
