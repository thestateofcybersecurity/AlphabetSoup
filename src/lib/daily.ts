/** First "Soup of the Day" date (local time). */
export const EPOCH = '2026-07-17';

const DAY_MS = 86_400_000;

/** Local-time YYYY-MM-DD so the soup rotates at the reader's midnight. */
export function localDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** 1-based day number for a local date string. */
export function dayNumber(dateString: string, epoch = EPOCH): number {
  const days = Math.round((Date.parse(dateString) - Date.parse(epoch)) / DAY_MS);
  return days + 1;
}

/**
 * Deterministic pool index for a day number. A large-prime multiplicative
 * step visits every entry before repeating (for coprime pool sizes).
 */
export function dailyIndex(dayNum: number, poolSize: number): number {
  if (poolSize <= 0) throw new Error('Pool is empty');
  const PRIME = 2_654_435_761;
  return Number((BigInt(dayNum) * BigInt(PRIME)) % BigInt(poolSize));
}

/**
 * Index for Soup of the Day. Cyberdle's "acronym of the day" uses the identical
 * dailyIndex over the same shared acronym pool and epoch, so a plain dailyIndex
 * would make the two features show the same term every day. Shifting by a fixed
 * nonzero offset guarantees Soup of the Day never lands on Cyberdle's pick for
 * the same day, while still cycling through the whole pool deterministically.
 */
export const SOUP_OFFSET = 271;
export function soupIndex(dayNum: number, poolSize: number): number {
  const offset = SOUP_OFFSET % poolSize || 1;
  return (dailyIndex(dayNum, poolSize) + offset) % poolSize;
}
