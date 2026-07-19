/**
 * Small sharing helpers used by the quiz, assessment, and roadmap result views.
 * Everything degrades gracefully: Web Share where available, clipboard next,
 * and a legacy execCommand fallback, with a brief toast either way. No network.
 */

export interface ShareData {
  title: string;
  text: string;
  url?: string;
}

let toastTimer: number | undefined;

/** Show a brief, polite confirmation toast (created lazily, reused thereafter). */
export function toast(message: string): void {
  let node = document.getElementById('app-toast');
  if (!node) {
    node = document.createElement('div');
    node.id = 'app-toast';
    node.className = 'toast';
    node.setAttribute('role', 'status');
    node.setAttribute('aria-live', 'polite');
    document.body.appendChild(node);
  }
  node.textContent = message;
  node.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => node?.classList.remove('show'), 2200);
}

/** Copy text to the clipboard, returning whether it succeeded. */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy path
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.focus();
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

/** Copy text and toast the outcome. */
export async function copyWithToast(text: string, label = 'Copied to clipboard'): Promise<void> {
  const ok = await copyToClipboard(text);
  toast(ok ? label : 'Could not copy, please copy manually');
}

/** Native share where offered (mobile), otherwise copy the text and link. */
export async function shareOrCopy(data: ShareData): Promise<void> {
  if (navigator.share) {
    try {
      await navigator.share(data);
      return;
    } catch {
      // user cancelled or the target rejected; fall back to copying
    }
  }
  const composed = data.url ? `${data.text} ${data.url}` : data.text;
  await copyWithToast(composed, 'Copied result to clipboard');
}
