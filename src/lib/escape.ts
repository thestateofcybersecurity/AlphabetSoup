/**
 * HTML escaping helpers.
 *
 * The tools build markup with template literals, so escaping has to match the
 * context the value lands in. Text context and attribute context are not the
 * same problem:
 *
 * - escText() is the DOM-serializer trick (textContent in, innerHTML out). Per
 *   the HTML text-node serialization algorithm that escapes &, <, > and U+00A0
 *   but deliberately NOT quotes, because quotes carry no meaning in text.
 * - escAttr() must additionally escape " and ', otherwise a value containing a
 *   quote closes the attribute early and the rest is parsed as markup. Use it
 *   for every value interpolated inside a quoted attribute.
 */

/** Escape for text context (between tags). Does not escape quotes. */
export function escText(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/** Escape for use inside a quoted HTML attribute value. */
export function escAttr(text: string): string {
  return escText(text).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Ids that are interpolated into both an attribute and a querySelector must
 * stay selector-safe, so escaping is the wrong tool: sanitize instead. Returns
 * the id when it is already safe, otherwise a fresh fallback.
 */
export function safeId(id: unknown, fallback: () => string): string {
  return typeof id === 'string' && /^[A-Za-z0-9_-]+$/.test(id) ? id : fallback();
}
