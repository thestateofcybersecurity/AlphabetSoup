import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateData } from '../src/data/validate';
import type { AcronymData } from '../src/lib/types';

const dataPath = fileURLToPath(new URL('../src/data/acronyms.json', import.meta.url));
const data = JSON.parse(readFileSync(dataPath, 'utf8')) as AcronymData;

const errors = validateData(data);
const count = Object.keys(data).length;

if (errors.length > 0) {
  console.error(`Dataset INVALID (${count} entries, ${errors.length} problems):`);
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}
console.log(`Dataset OK: ${count} entries.`);
