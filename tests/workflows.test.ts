import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Supply-chain and privilege rules for .github/workflows, checked in the unit
 * suite so a new workflow cannot quietly drop them.
 *
 * Pentest 2026-10-07 (L7) pinned every action to a commit and scoped the
 * Pages grants to the deploy job. blog-automerge.yml was added to main
 * afterwards with tag-pinned actions and one job that both ran `npm ci`
 * (dependency lifecycle scripts) and held contents/actions/issues write
 * (pentest 2026-11-22, N4). A rule that only lives in a review comment does
 * not survive the next file, so it lives here.
 */

const DIR = fileURLToPath(new URL('../.github/workflows/', import.meta.url));
const workflows = readdirSync(DIR)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .map((name) => ({ name, text: readFileSync(`${DIR}${name}`, 'utf8') }));

/** Lines that are not YAML comments. */
const code = (text: string): string[] => text.split('\n').filter((line) => !/^\s*#/.test(line));

/**
 * The jobs of a workflow as { name: body }. A light indentation parse (job
 * keys sit at two spaces under `jobs:`), which is all these files need and
 * avoids a YAML dependency.
 */
function jobsOf(text: string): Record<string, string> {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => /^jobs:\s*$/.test(line));
  const jobs: Record<string, string> = {};
  let current = '';
  for (const line of lines.slice(start + 1)) {
    const key = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (key) {
      current = key[1];
      jobs[current] = '';
    } else if (current) jobs[current] += `${line}\n`;
  }
  return jobs;
}

/** The scopes a job's own `permissions:` block grants, or null when it has none. */
function jobPermissions(body: string): Record<string, string> | null {
  const lines = body.split('\n');
  const at = lines.findIndex((line) => /^ {4}permissions:\s*$/.test(line));
  if (at === -1) return null;
  const out: Record<string, string> = {};
  for (const line of lines.slice(at + 1)) {
    const entry = /^ {6}([a-z-]+):\s*([a-z]+)\s*$/.exec(line);
    if (!entry) break;
    out[entry[1]] = entry[2];
  }
  return out;
}

describe('GitHub Actions workflows', () => {
  it('finds the workflows', () => {
    expect(workflows.map((w) => w.name).sort()).toEqual(
      ['blog-automerge.yml', 'deploy.yml', 'link-check.yml', 'semgrep.yml', 'verify-analytics.yml'].sort(),
    );
  });

  it('pins every action to a full commit SHA with a version comment', () => {
    const unpinned: string[] = [];
    for (const { name, text } of workflows) {
      for (const line of code(text)) {
        const uses = /^\s*(?:-\s*)?uses:\s*(\S+)(.*)$/.exec(line);
        if (!uses) continue;
        if (!/@[0-9a-f]{40}$/.test(uses[1]) || !/#\s*v\d/.test(uses[2])) unpinned.push(`${name}: ${line.trim()}`);
      }
    }
    expect(unpinned).toEqual([]);
  });

  it('never runs on pull_request_target', () => {
    for (const { name, text } of workflows) expect(code(text).join('\n'), name).not.toMatch(/pull_request_target/);
  });

  it('never expands attacker-influenced event fields into a workflow expression', () => {
    // github.event.* and github.head_ref are text an outsider can choose (PR
    // titles, branch names). Expanded with ${{ }} inside a run step they are
    // shell injection; the shell's own $GITHUB_* variables are the safe form.
    for (const { name, text } of workflows) {
      expect(code(text).join('\n'), name).not.toMatch(/\$\{\{[^}]*github\.(event\.|head_ref)/);
    }
  });

  it('grants write scopes per job, never at workflow level', () => {
    for (const { name, text } of workflows) {
      const lines = text.split('\n');
      const at = lines.findIndex((line) => /^permissions:/.test(line));
      if (at === -1) continue; // semgrep.yml scopes everything on its single job
      const block = [lines[at], ...lines.slice(at + 1).filter((_, i, rest) => rest.slice(0, i + 1).every((l) => /^\s+\S/.test(l)))];
      expect(block.join('\n'), name).not.toMatch(/:\s*write/);
    }
  });

  it('never gives a write token to a job that installs or runs dependencies', () => {
    const offenders: string[] = [];
    for (const { name, text } of workflows) {
      for (const [job, body] of Object.entries(jobsOf(text))) {
        if (!/\bnpm (ci|install|run|test)\b|\bnpx \b|\bpip install\b/.test(body)) continue;
        const granted = jobPermissions(body) ?? {};
        // security-events: write is how semgrep uploads SARIF; it cannot touch code, releases, or Pages.
        const writes = Object.entries(granted).filter(([scope, level]) => level === 'write' && scope !== 'security-events');
        if (writes.length > 0) offenders.push(`${name} job ${job}: ${writes.map(([scope]) => scope).join(', ')}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('keeps the blog auto-merge split: verify is read-only, only merge can push', () => {
    const text = workflows.find((w) => w.name === 'blog-automerge.yml')!.text;
    expect(text).toMatch(/^permissions: \{\}$/m);
    const jobs = jobsOf(text);
    expect(Object.keys(jobs)).toEqual(['verify', 'merge', 'notify-failure']);
    expect(jobPermissions(jobs.verify)).toEqual({ contents: 'read' });
    expect(jobPermissions(jobs.merge)).toEqual({ contents: 'write', actions: 'write' });
    expect(jobPermissions(jobs['notify-failure'])).toEqual({ issues: 'write' });
    expect(jobs.merge).toMatch(/^ {4}needs: verify$/m);
    // Every content gate runs before anything is merged.
    for (const gate of ['npm run validate:data', 'npm test', 'npx tsc --noEmit', 'npm run build', 'npx playwright test']) {
      expect(jobs.verify, gate).toContain(gate);
    }
    expect(jobs.merge).not.toMatch(/\bnpm\b|\bnpx\b/);
    expect(text.match(/git push origin main/g)).toHaveLength(1);
    expect(jobs.merge).toContain('git push origin main');
  });
});
