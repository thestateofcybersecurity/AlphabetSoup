import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { checkUrl, shouldFail, summarize, type CheckResult } from '../src/lib/link-check';
import type { AcronymData } from '../src/lib/types';

/**
 * Checks every source URL cited by the acronym dataset.
 *
 * Broken links fail the build. Links that could not be reached are reported as
 * warnings instead, because a connection reset from a CI runner says something
 * about the network path rather than about the link. See src/lib/link-check.ts
 * for why that distinction was worth making.
 */

const dataPath = fileURLToPath(new URL('../src/data/acronyms.json', import.meta.url));
const data = JSON.parse(readFileSync(dataPath, 'utf8')) as AcronymData;

const urlOwners = new Map<string, string[]>();
for (const [key, entry] of Object.entries(data)) {
  for (const source of entry.sources) {
    const owners = urlOwners.get(source.url) ?? [];
    owners.push(key);
    urlOwners.set(source.url, owners);
  }
}

const CONCURRENCY = 10;
const urls = [...urlOwners.keys()];
console.log(`Checking ${urls.length} unique source URLs...`);

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
