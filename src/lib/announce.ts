/**
 * Screen-reader announcements and focus survival across DOM rebuilds.
 *
 * The site rebuilds panels with `innerHTML = ''` in 54 places and had no
 * `aria-live` region anywhere, so results appearing, scores changing, and rows
 * being removed were all silent to assistive technology. Those same rebuilds
 * destroy the focused element, which drops keyboard focus to <body>: deleting
 * one table row meant tabbing from the top of the page again, and editing a
 * text field that triggers a re-render lost the caret mid-word.
 */

const REGION_ID = 'a11y-live-region';

/**
 * The live region has to already exist in the DOM before its text changes, or
 * screen readers will not announce the update. Creating it lazily on first use
 * is fine because the first call still inserts it, then mutates it a tick later.
 */
function liveRegion(): HTMLElement {
  let node = document.getElementById(REGION_ID);
  if (!node) {
    node = document.createElement('div');
    node.id = REGION_ID;
    node.className = 'sr-only';
    node.setAttribute('role', 'status');
    node.setAttribute('aria-live', 'polite');
    node.setAttribute('aria-atomic', 'true');
    document.body.appendChild(node);
  }
  return node;
}

let announceTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Announce a short message politely, without stealing focus.
 *
 * The region is cleared first so that repeating an identical message (answering
 * two questions correctly in a row, say) is still announced the second time;
 * setting the same string twice is a no-op to most screen readers.
 */
export function announce(message: string): void {
  const node = liveRegion();
  node.textContent = '';
  if (announceTimer) clearTimeout(announceTimer);
  announceTimer = setTimeout(() => {
    node.textContent = message;
  }, 60);
}

/** Position of an element within a container, as a list of child indices. */
function pathTo(container: Element, target: Element): number[] | undefined {
  const path: number[] = [];
  let node: Element | null = target;
  while (node && node !== container) {
    const parent: Element | null = node.parentElement;
    if (!parent) return undefined;
    path.unshift(Array.prototype.indexOf.call(parent.children, node));
    node = parent;
  }
  return node === container ? path : undefined;
}

/** Follow a child-index path back down from the container. */
function elementAt(container: Element, path: number[]): HTMLElement | undefined {
  let node: Element | undefined = container;
  for (const index of path) {
    node = node?.children[index];
    if (!node) return undefined;
  }
  return node instanceof HTMLElement ? node : undefined;
}

type TextEntry = HTMLInputElement | HTMLTextAreaElement;

function isTextEntry(node: Element | undefined): node is TextEntry {
  if (node instanceof HTMLTextAreaElement) return true;
  return node instanceof HTMLInputElement && /^(text|search|number|email|url|tel|password)$/.test(node.type);
}

/**
 * Run a rebuild of `container` and put keyboard focus back where it was.
 *
 * Focus is restored by structural position rather than by identity, because the
 * rebuild replaces the nodes entirely. Caret position in text fields is carried
 * across too. If the focused element no longer exists (its row was deleted),
 * focus falls back to the container so the user stays roughly in place instead
 * of being thrown to the top of the document.
 */
export function preserveFocus<T>(container: HTMLElement, rebuild: () => T): T {
  const active = document.activeElement;
  const tracked = active instanceof HTMLElement && container.contains(active) ? active : undefined;
  const path = tracked ? pathTo(container, tracked) : undefined;
  const caret = isTextEntry(tracked) ? { start: tracked.selectionStart, end: tracked.selectionEnd } : undefined;

  const result = rebuild();

  if (path) {
    const restored = elementAt(container, path);
    if (restored) {
      restored.focus();
      if (caret && isTextEntry(restored) && restored === document.activeElement) {
        try {
          restored.setSelectionRange(caret.start, caret.end);
        } catch {
          // Some input types reject setSelectionRange; the focus still landed.
        }
      }
    } else if (container.isConnected) {
      if (!container.hasAttribute('tabindex')) container.setAttribute('tabindex', '-1');
      container.focus();
    }
  }
  return result;
}
