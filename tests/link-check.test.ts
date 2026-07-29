import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_ATTEMPTS,
  checkUrl,
  classifyStatus,
  describeError,
  shouldFail,
  summarize,
  type CheckResult,
} from '../src/lib/link-check';

/**
 * The weekly link check failed on both of the two occasions it ever ran, each
 * time on one government URL that serves HTTP 200 to an ordinary request. The
 * cause was treating "could not reach from this runner" as "broken".
 *
 * These tests pin the distinction, because a check that cries wolf gets ignored
 * and then cannot do its job.
 */

const URL_ = 'https://example.test/doc';
const noSleep = async (): Promise<void> => {};

/** A fetch that returns the given statuses in order, then repeats the last. */
function statusFetch(...statuses: number[]): typeof fetch {
  let i = 0;
  return vi.fn(async () => {
    const status = statuses[Math.min(i, statuses.length - 1)];
    i += 1;
    return new Response(null, { status });
  }) as unknown as typeof fetch;
}

/** A fetch that throws a network-level error every time. */
function networkErrorFetch(code = 'ECONNRESET'): typeof fetch {
  return vi.fn(async () => {
    throw Object.assign(new TypeError('fetch failed'), { cause: { code } });
  }) as unknown as typeof fetch;
}

describe('classifyStatus', () => {
  it.each([200, 204, 301, 302, 399])('treats %i as ok', (s) => {
    expect(classifyStatus(s)).toBe('ok');
  });

  it.each([403, 429])('treats %i as ok, since the host answered', (s) => {
    // A refusal is an answer. Flagging these would mark every site that
    // dislikes automated traffic as broken.
    expect(classifyStatus(s)).toBe('ok');
  });

  it.each([404, 410, 500, 503])('treats %i as broken', (s) => {
    expect(classifyStatus(s)).toBe('broken');
  });
});

describe('checkUrl', () => {
  it('reports a working URL as ok', async () => {
    const result = await checkUrl(URL_, { fetchImpl: statusFetch(200), sleep: noSleep });
    expect(result.verdict).toBe('ok');
  });

  it('reports a 404 as broken, not unreachable', async () => {
    const result = await checkUrl(URL_, { fetchImpl: statusFetch(404), sleep: noSleep });
    expect(result.verdict).toBe('broken');
    expect(result.detail).toBe('HTTP 404');
  });

  it('does not retry a definitive answer', async () => {
    // Retrying a 404 three times is slower and no more certain.
    const impl = statusFetch(404);
    await checkUrl(URL_, { fetchImpl: impl, sleep: noSleep });
    // One HEAD plus one GET, then it stops.
    expect((impl as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
  });

  it('reports a persistent network failure as unreachable, never broken', async () => {
    // This is the case that made the job red: the link is fine, the path is not.
    const result = await checkUrl(URL_, { fetchImpl: networkErrorFetch(), sleep: noSleep });
    expect(result.verdict).toBe('unreachable');
    expect(result.detail).toBe('ECONNRESET');
  });

  it('retries network failures the full number of attempts', async () => {
    const impl = networkErrorFetch();
    await checkUrl(URL_, { fetchImpl: impl, sleep: noSleep, attempts: DEFAULT_ATTEMPTS });
    // HEAD and GET per attempt.
    expect((impl as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(DEFAULT_ATTEMPTS * 2);
  });

  it('recovers when a transient failure clears on a later attempt', async () => {
    let call = 0;
    const impl = (async () => {
      call += 1;
      if (call <= 2) throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ETIMEDOUT' } });
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;
    const result = await checkUrl(URL_, { fetchImpl: impl, sleep: noSleep });
    expect(result.verdict).toBe('ok');
  });

  it('accepts a URL whose HEAD fails but whose GET succeeds', async () => {
    // Some hosts reject HEAD outright.
    const impl = statusFetch(405, 200);
    const result = await checkUrl(URL_, { fetchImpl: impl, sleep: noSleep });
    expect(result.verdict).toBe('ok');
  });

  it('waits between retries, so a struggling host is not hammered', async () => {
    const waits: number[] = [];
    const sleep = async (ms: number): Promise<void> => {
      waits.push(ms);
    };
    await checkUrl(URL_, { fetchImpl: networkErrorFetch(), sleep });
    expect(waits.length).toBeGreaterThan(0);
    for (const ms of waits) expect(ms).toBeGreaterThan(0);
  });

  it('describes an error by its code when there is one', () => {
    expect(describeError(Object.assign(new Error('x'), { cause: { code: 'ENOTFOUND' } }))).toBe('ENOTFOUND');
    expect(describeError(new Error('plain'))).toBe('plain');
  });
});

describe('build outcome', () => {
  const r = (verdict: CheckResult['verdict']): CheckResult => ({ url: URL_, verdict, detail: '' });

  it('fails only on genuinely broken links', () => {
    expect(shouldFail(summarize([r('broken'), r('ok')]))).toBe(true);
  });

  it('does not fail when a link was merely unreachable', () => {
    // The whole point: an unverifiable link is a warning, not a red build.
    expect(shouldFail(summarize([r('unreachable'), r('ok')]))).toBe(false);
  });

  it('does not fail when everything is fine', () => {
    expect(shouldFail(summarize([r('ok'), r('ok')]))).toBe(false);
  });

  it('counts each verdict separately for reporting', () => {
    const s = summarize([r('ok'), r('ok'), r('broken'), r('unreachable')]);
    expect([s.ok.length, s.broken.length, s.unreachable.length]).toEqual([2, 1, 1]);
  });
});
