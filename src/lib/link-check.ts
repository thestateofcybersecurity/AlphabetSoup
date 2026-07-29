/**
 * Deciding whether a source URL is broken.
 *
 * The distinction that matters is between a link that is *broken* and one we
 * merely *could not reach*. A 404 is a fact about the link. A connection reset
 * from a CI runner is a fact about the network path, and often about the host
 * refusing traffic from cloud IP ranges.
 *
 * Conflating the two made the weekly link check fail on both of the two
 * occasions it ever ran, each time on a single government URL that serves
 * HTTP 200 to an ordinary request. A scheduled check that is always red teaches
 * everyone to ignore it, which costs you the one time it is right.
 *
 * The fetch implementation is injected so this can be tested without a network.
 */

export type Verdict = 'ok' | 'broken' | 'unreachable';

export interface CheckResult {
  url: string;
  verdict: Verdict;
  detail: string;
}

export interface CheckOptions {
  attempts?: number;
  timeoutMs?: number;
  userAgent?: string;
  /** Injected for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Injected for tests so retries do not actually wait. */
  sleep?: (ms: number) => Promise<void>;
}

export const DEFAULT_ATTEMPTS = 3;
export const BACKOFF_MS = [0, 1_000, 3_000];
export const USER_AGENT = 'Mozilla/5.0 (compatible; CyberdleLinkCheck/1.0)';

/**
 * What a given HTTP status means for a link.
 *
 * 403 and 429 are answers, not outages: the host is up and has decided
 * something about the request. Treating them as broken would flag every site
 * that dislikes automated traffic.
 */
export function classifyStatus(status: number): Verdict {
  if (status < 400) return 'ok';
  if (status === 403 || status === 429) return 'ok';
  return 'broken';
}

/** A readable reason from whatever fetch threw. */
export function describeError(error: unknown): string {
  const cause = (error as { cause?: { code?: string; message?: string } })?.cause;
  return cause?.code ?? cause?.message ?? (error as Error)?.message ?? 'unknown error';
}

/**
 * Check one URL, retrying only when the failure was at the network level.
 *
 * A definitive answer from the server ends it immediately: retrying a 404 three
 * times just makes the job slower and no more certain.
 */
export async function checkUrl(url: string, options: CheckOptions = {}): Promise<CheckResult> {
  const {
    attempts = DEFAULT_ATTEMPTS,
    timeoutMs = 15_000,
    userAgent = USER_AGENT,
    fetchImpl = fetch,
    sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
  } = options;

  let last: CheckResult = { url, verdict: 'unreachable', detail: 'no response' };

  for (let i = 0; i < attempts; i += 1) {
    const wait = BACKOFF_MS[Math.min(i, BACKOFF_MS.length - 1)];
    if (i > 0 && wait) await sleep(wait);

    for (const method of ['HEAD', 'GET'] as const) {
      try {
        const response = await fetchImpl(url, {
          method,
          redirect: 'follow',
          signal: AbortSignal.timeout(timeoutMs),
          headers: { 'user-agent': userAgent, accept: '*/*' },
        });
        const verdict = classifyStatus(response.status);
        if (verdict === 'ok') return { url, verdict, detail: String(response.status) };
        // Some hosts answer HEAD with an error but serve GET fine, so only a
        // failing GET is conclusive.
        if (method === 'GET') return { url, verdict, detail: `HTTP ${response.status}` };
      } catch (error) {
        if (method === 'GET') last = { url, verdict: 'unreachable', detail: describeError(error) };
      }
    }
  }
  return last;
}

export interface Summary {
  ok: CheckResult[];
  broken: CheckResult[];
  unreachable: CheckResult[];
}

export function summarize(results: CheckResult[]): Summary {
  return {
    ok: results.filter((r) => r.verdict === 'ok'),
    broken: results.filter((r) => r.verdict === 'broken'),
    unreachable: results.filter((r) => r.verdict === 'unreachable'),
  };
}

/** Only genuinely broken links should fail a build. */
export function shouldFail(summary: Summary): boolean {
  return summary.broken.length > 0;
}
