/**
 * The inline syntax authored copy is allowed to use: [label](href) links and
 * **bold**. Everything else is literal text and gets escaped, so a post can
 * never inject markup into a generated page.
 *
 * The two spans nest in both directions. An earlier single-pass matcher walked
 * the string once and let whichever delimiter opened first swallow the other,
 * so a link inside a bold run came out as the literal characters
 * "[MFA](/?q=MFA)" on the page. Each span now re-enters the renderer for its
 * own contents instead of escaping them wholesale.
 *
 * Anchors can never nest, because the label matcher stops at the first "]" and
 * so a label cannot contain the "](" that a link requires. The recursion always
 * terminates for the same reason: a span's contents are strictly shorter than
 * the span itself.
 */

/** Escape for HTML text and quoted-attribute context. */
export function escHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** A link or a bold run, whichever opens first. */
const SPAN = /\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*/;

/** Hrefs we will emit: absolute http(s), site-absolute, relative, or an anchor. */
const SAFE_HREF = /^(https?:\/\/|\/|\.\.?\/|#)/;

export function renderInline(raw: string): string {
  let out = '';
  let last = 0;
  // A fresh regex per call: the recursion would otherwise share one lastIndex
  // across nesting levels and lose its place in the outer string.
  const re = new RegExp(SPAN.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    out += escHtml(raw.slice(last, m.index));
    out += m[1] !== undefined ? anchor(m[1], m[2]) : `<strong>${renderInline(m[3])}</strong>`;
    last = re.lastIndex;
  }
  return out + escHtml(raw.slice(last));
}

function anchor(label: string, rawHref: string): string {
  const href = rawHref.trim();
  const safe = SAFE_HREF.test(href) ? href : '#';
  const external = /^https?:\/\//.test(safe);
  const attrs = external ? ' rel="noopener" target="_blank"' : '';
  return `<a href="${escHtml(safe)}"${attrs}>${renderInline(label)}</a>`;
}
