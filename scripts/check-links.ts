import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { AcronymData } from '../src/lib/types';

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
const TIMEOUT_MS = 15_000;
const UA = 'Mozilla/5.0 (compatible; CyberdleLinkCheck/1.0)';

async function check(url: string): Promise<{ url: string; ok: boolean; detail: string }> {
  for (const method of ['HEAD', 'GET'] as const) {
    try {
      const response = await fetch(url, {
        method,
        redirect: 'follow',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { 'user-agent': UA, accept: '*/*' },
      });
      // Some sites reject HEAD or bot requests; only hard failures matter.
      if (response.status < 400 || response.status === 403 || response.status === 429) {
        return { url, ok: true, detail: String(response.status) };
      }
      if (method === 'GET') {
        return { url, ok: false, detail: `HTTP ${response.status}` };
      }
    } catch (error) {
      if (method === 'GET') {
        return { url, ok: false, detail: (error as Error).message };
      }
    }
  }
  return { url, ok: false, detail: 'unreachable' };
}

const urls = [...urlOwners.keys()];
console.log(`Checking ${urls.length} unique source URLs...`);

const failures: Array<{ url: string; detail: string; owners: string[] }> = [];
for (let i = 0; i < urls.length; i += CONCURRENCY) {
  const batch = urls.slice(i, i + CONCURRENCY);
  const settled = await Promise.all(batch.map(check));
  for (const result of settled) {
    if (!result.ok) {
      failures.push({ ...result, owners: urlOwners.get(result.url) ?? [] });
    }
  }
  process.stdout.write(`  ${Math.min(i + CONCURRENCY, urls.length)}/${urls.length}\r`);
}

console.log();
if (failures.length > 0) {
  console.error(`${failures.length} broken source URLs:`);
  for (const failure of failures) {
    console.error(`  - ${failure.url} (${failure.detail}) used by: ${failure.owners.join(', ')}`);
  }
  process.exit(1);
}
console.log('All source links OK.');
