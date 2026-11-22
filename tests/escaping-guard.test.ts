import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Pentest 2026-11-22, finding N1. Most tools define a local esc() that is the
 * textContent/innerHTML round trip. It escapes & < > and nothing else, so it
 * is correct between tags and wrong inside a quoted attribute: a value such as
 *   x" autofocus onfocus="..."
 * closes the attribute and runs script on load. The AI Threat Modeler did
 * exactly that with value="${esc(p.name)}" for the system name, owner,
 * reviewer, node label, verdict note and verdict owner, all of which arrive
 * from imported Threat Dragon files, stored drafts and restored backups.
 *
 * This is a source-level guard, so the mistake fails the unit suite before it
 * ever reaches a browser: no text-only escaper inside a quoted attribute.
 * Use escAttr() (src/lib/escape.ts) there instead.
 */

const SRC = fileURLToPath(new URL('../src/', import.meta.url));

/**
 * Files whose local esc() also escapes double quotes (a string replace chain,
 * not the DOM round trip), so esc() in a double-quoted attribute is safe.
 */
const QUOTE_SAFE_ESC = new Set(['lib/about.ts']);

function sourceFiles(dir: string, prefix = ''): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'data') continue;
    const rel = `${prefix}${entry.name}`;
    if (entry.isDirectory()) out.push(...sourceFiles(`${dir}${entry.name}/`, `${rel}/`));
    else if (entry.name.endsWith('.ts')) out.push(rel);
  }
  return out;
}

/** attr="...${esc(...)" or attr='...${esc(...)': a text-only escaper in attribute context. */
const TEXT_ESC_IN_ATTR = /[\w-]+=(?:"[^"<>]*|'[^'<>]*)\$\{(?:esc|escText)\(/;

describe('attribute-context escaping', () => {
  const files = sourceFiles(SRC);

  it('scans the tool sources', () => {
    expect(files.length).toBeGreaterThan(40);
    expect(files).toContain('ai-threat-main.ts');
  });

  it('never uses a text-only escaper inside a quoted attribute', () => {
    const offenders: string[] = [];
    for (const rel of files) {
      if (QUOTE_SAFE_ESC.has(rel)) continue;
      readFileSync(`${SRC}${rel}`, 'utf8')
        .split('\n')
        .forEach((line, index) => {
          if (TEXT_ESC_IN_ATTR.test(line)) offenders.push(`src/${rel}:${index + 1}: ${line.trim().slice(0, 120)}`);
        });
    }
    expect(offenders).toEqual([]);
  });

  it('recognizes the pattern it is guarding against', () => {
    expect(TEXT_ESC_IN_ATTR.test('<input id="tm-name" type="text" value="${esc(p.name)}" />')).toBe(true);
    expect(TEXT_ESC_IN_ATTR.test("<input value='${esc(p.name)}' />")).toBe(true);
    expect(TEXT_ESC_IN_ATTR.test('<a title="Read ${escText(code)} in plain English">')).toBe(true);
    // Text context and the attribute escaper are both fine.
    expect(TEXT_ESC_IN_ATTR.test('<span class="tm-check-label">${esc(c.label)}</span>')).toBe(false);
    expect(TEXT_ESC_IN_ATTR.test('<input value="${escAttr(p.name)}" />')).toBe(false);
  });

  it('keeps the exemption honest: exempt files escape double quotes in esc()', () => {
    for (const rel of QUOTE_SAFE_ESC) {
      const source = readFileSync(`${SRC}${rel}`, 'utf8');
      const body = source.slice(source.indexOf('function esc('), source.indexOf('function esc(') + 300);
      expect(body, rel).toContain('&quot;');
    }
  });
});
