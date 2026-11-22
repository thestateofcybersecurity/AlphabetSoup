/**
 * Structural validation for src/data/blog-posts.json.
 *
 * Posts are the one dataset that reaches production without a human reading
 * the diff: the scheduled routine pushes a claude/blog-* branch and
 * .github/workflows/blog-automerge.yml merges it once the gates pass. That
 * makes this validator a security boundary, not a style check, so it treats a
 * post as untrusted input: every field is type-checked (JSON can put an array
 * or an object where a string is expected), and every link target must pass
 * the same scheme allowlist the renderer uses. A "related" chip used to be
 * checked for presence only, which let href="javascript:..." through every
 * gate and onto a published page (pentest 2026-11-22, N2).
 */
import { isSafeHref } from './inline';

/**
 * Max blog title length. A published post and the backlog topic it comes from
 * share this cap, so an over-length backlog title is caught when it is written
 * rather than after a post has been drafted against it.
 */
export const BLOG_TITLE_MAX = 70;
export const BLOG_CATEGORIES: ReadonlySet<string> = new Set(['Explainer', 'Career', 'Spotlight']);
export const BLOG_BLOCK_TYPES: ReadonlySet<string> = new Set(['p', 'h2', 'list', 'quote']);

/** Slugs that would overwrite a generated page other than the post itself (dist/blog/index.html). */
export const RESERVED_BLOG_SLUGS: ReadonlySet<string> = new Set(['index']);

const SLUG = /^[a-z0-9-]+$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const INLINE_LINK = /\[[^\]]+\]\(([^)]+)\)/g;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

/** Inline [label](href) targets the renderer would refuse and silently rewrite to "#". */
function unsafeInlineLinks(text: string): string[] {
  return [...text.matchAll(INLINE_LINK)].map((m) => m[1]).filter((href) => !isSafeHref(href));
}

/** Structural checks for blog posts. Returns human-readable problems (empty = valid). */
export function validateBlogPosts(posts: unknown): string[] {
  if (!Array.isArray(posts)) return ['blog-posts.json must be an array of posts'];
  const out: string[] = [];
  const seen = new Set<string>();
  posts.forEach((post: unknown, index) => {
    if (!isRecord(post)) {
      out.push(`post ${index}: not an object`);
      return;
    }
    const p = post;
    const w = typeof p.slug === 'string' && p.slug ? p.slug : `post ${index}`;

    if (typeof p.slug !== 'string' || !SLUG.test(p.slug)) out.push(`${w}: bad slug`);
    else {
      if (seen.has(p.slug)) out.push(`duplicate slug ${w}`);
      seen.add(p.slug);
      if (RESERVED_BLOG_SLUGS.has(p.slug)) out.push(`${w}: reserved slug`);
    }
    if (!isText(p.title) || p.title.length > BLOG_TITLE_MAX) {
      out.push(`${w}: title length ${typeof p.title === 'string' ? p.title.length : 0}, max ${BLOG_TITLE_MAX}`);
    }
    if (typeof p.description !== 'string' || p.description.length < 100 || p.description.length > 170) {
      out.push(`${w}: description length`);
    }
    if (typeof p.category !== 'string' || !BLOG_CATEGORIES.has(p.category)) out.push(`${w}: bad category ${String(p.category)}`);
    if (!isText(p.author)) out.push(`${w}: missing author`);
    if (typeof p.date !== 'string' || !ISO_DATE.test(p.date)) out.push(`${w}: bad date`);
    if (typeof p.readingMinutes !== 'number' || !Number.isInteger(p.readingMinutes) || p.readingMinutes < 1) {
      out.push(`${w}: bad readingMinutes`);
    }

    if (!Array.isArray(p.tags) || p.tags.length < 2) out.push(`${w}: too few tags`);
    else if (!p.tags.every(isText)) out.push(`${w}: tags must be non-empty strings`);

    if (!Array.isArray(p.body) || p.body.length < 4) out.push(`${w}: body too short`);
    for (const block of Array.isArray(p.body) ? (p.body as unknown[]) : []) {
      if (!isRecord(block) || typeof block.type !== 'string' || !BLOG_BLOCK_TYPES.has(block.type)) {
        out.push(`${w}: bad block type ${isRecord(block) ? String(block.type) : typeof block}`);
        continue;
      }
      const texts: unknown[] = block.type === 'list' ? (Array.isArray(block.items) ? block.items : [undefined]) : [block.text];
      if (texts.length === 0 || !texts.every(isText)) {
        out.push(`${w}: ${block.type} block text must be non-empty strings`);
        continue;
      }
      for (const text of texts as string[]) {
        for (const href of unsafeInlineLinks(text)) out.push(`${w}: unsafe link target in body: ${href.slice(0, 60)}`);
      }
    }

    if (!Array.isArray(p.related) || p.related.length === 0) out.push(`${w}: no related links`);
    for (const link of Array.isArray(p.related) ? (p.related as unknown[]) : []) {
      if (!isRecord(link) || !isText(link.label) || typeof link.href !== 'string') {
        out.push(`${w}: related link needs a label and an href`);
      } else if (!isSafeHref(link.href)) {
        out.push(`${w}: unsafe related link target: ${link.href.slice(0, 60)}`);
      }
    }

    if (JSON.stringify(p).includes('—')) out.push(`${w}: em dash`);
  });
  return out;
}
