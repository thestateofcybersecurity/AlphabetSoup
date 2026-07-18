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
