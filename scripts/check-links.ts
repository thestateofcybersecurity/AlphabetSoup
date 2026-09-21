import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { basename, join } from 'node:path';
import { checkUrl, shouldFail, summarize, type CheckResult } from '../src/lib/link-check';
import { affiliateHosts, collectUrls, type Document } from '../src/lib/link-sources';

/**
 * Checks every source URL cited anywhere in src/data.
 *
 * Broken links fail the build. Links that could not be reached are reported as
 * warnings instead, because a connection reset from a CI runner says something
 * about the network path rather than about the link. See src/lib/link-check.ts
 * for why that distinction was worth making, and src/lib/link-sources.ts for
 * how the URLs are found and why affiliate links are left out.
 */

const dataDir = fileURLToPath(new URL('../src/data', import.meta.url));

/** Every .json under src/data, including the quiz subdirectory. */
function dataFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return dataFiles(path);
    return entry.isFile() && entry.name.endsWith('.json') ? [path] : [];
  });
}

const paths = dataFiles(dataDir).sort();
const documents: Document[] = paths.map((path) => ({
  file: basename(path),
  data: JSON.parse(readFileSync(path, 'utf8')) as unknown,
}));

const affiliates = documents.find((d) => d.file === 'affiliates.json');
const hosts = affiliateHosts(affiliates?.data ?? {});
const { owners: urlOwners, skipped } = collectUrls(documents, hosts);

const CONCURRENCY = 10;
const urls = [...urlOwners.keys()];
console.log(`Checking ${urls.length} unique source URLs across ${documents.length} data files...`);
if (skipped.length > 0) {
  console.log(`  (${skipped.length} affiliate links skipped: they are paid click trackers)`);
}

const results: CheckResult[] = [];
for (let i = 0; i < urls.length; i += CONCURRENCY) {
  const batch = urls.slice(i, i + CONCURRENCY);
  results.push(...(await Promise.all(batch.map((url) => checkUrl(url)))));
  process.stdout.write(`  ${Math.min(i + CONCURRENCY, urls.length)}/${urls.length}\r`);
}

const summary = summarize(results);
const owners = (url: string): string => (urlOwners.get(url) ?? []).join(', ');

console.log();
if (summary.unreachable.length > 0) {
  console.warn(`${summary.unreachable.length} URL(s) could not be reached after retries:`);
  for (const result of summary.unreachable) {
    console.warn(`  ? ${result.url} (${result.detail}) used by: ${owners(result.url)}`);
  }
  console.warn('  These may be refusing this network rather than being gone. Check by hand.');
}

if (summary.broken.length > 0) {
  console.error(`${summary.broken.length} broken source URL(s):`);
  for (const result of summary.broken) {
    console.error(`  - ${result.url} (${result.detail}) used by: ${owners(result.url)}`);
  }
}

if (shouldFail(summary)) process.exit(1);

console.log(
  summary.unreachable.length > 0
    ? `No broken links. ${summary.unreachable.length} unverified, listed above.`
    : 'All source links OK.',
);
