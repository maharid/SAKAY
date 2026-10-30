/**
 * Keeps the browser's developer tools out of the production apps (panel comment, decision D-P7: "disable developer options: F12, no inspect").
 *
 * What this is and is not. It blocks the ways a person normally opens the tools or the page source (F12, Ctrl/Cmd+Shift+I / J / C / K, Cmd+Option+I / J / C / U,
 * Ctrl/Cmd+U) and the right-click menu (which has "Inspect"), outside text fields. It is a DETERRENT for a casual visitor: a browser's own menu, a different browser or a
 * script still opens the tools, and nothing in a web page can truly prevent that. What actually protects the data is on the server: every table is behind row security, every
 * function checks its caller, nothing secret ships in the bundle (the Supabase URL and the public "anon" key are meant to be seen), the production build has no source maps
 * and drops console output (see the apps' vite.config.ts). It is switched on only in a production build, so developers keep their tools.
 */

type KeyLike = Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>;

/** True for the key combinations that open the developer tools or the page source. `code` is used when there is one, because Option changes `key` on a Mac. */
export function isDevToolsShortcut(e: KeyLike): boolean {
  const letter = (e.code && /^Key[A-Z]$/.test(e.code) ? e.code.slice(3) : String(e.key || '')).toLowerCase();
  if (e.key === 'F12' || e.code === 'F12') return true;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.shiftKey && ['i', 'j', 'c', 'k'].includes(letter)) return true;   // inspector, console, element picker, Firefox console
  if (e.metaKey && e.altKey && ['i', 'j', 'c', 'u'].includes(letter)) return true; // macOS: Cmd+Option+I / J / C / U
  if (mod && !e.shiftKey && !e.altKey && letter === 'u') return true;             // view source
  return false;
}

interface LockdownTarget {
  addEventListener(type: string, listener: (event: Event) => void, options?: boolean | AddEventListenerOptions): void;
  removeEventListener(type: string, listener: (event: Event) => void, options?: boolean | EventListenerOptions): void;
}

export interface BrowserLockdownOptions {
  /** Switched on for a production build only: `import.meta.env.PROD` */
  enabled: boolean;
  /** Where to listen (the document); tests pass a stand-in */
  target?: LockdownTarget;
}

/** A text field keeps its own menu (paste, spell check): it is not where "Inspect" matters, and breaking it would break typing on a phone. */
const isEditable = (t: EventTarget | null): boolean => {
  const el = t as { tagName?: string; isContentEditable?: boolean } | null;
  if (!el) return false;
  return Boolean(el.isContentEditable) || ['INPUT', 'TEXTAREA', 'SELECT'].includes(String(el.tagName || '').toUpperCase());
};

/** Installs the guard; returns the function that removes it. A no-op when `enabled` is false. */
export function installBrowserLockdown(options: BrowserLockdownOptions): () => void {
  if (!options.enabled) return () => undefined;
  const target: LockdownTarget | undefined = options.target ?? (typeof document !== 'undefined' ? document : undefined);
  if (!target) return () => undefined;

  const onKey = (event: Event): void => {
    if (isDevToolsShortcut(event as KeyboardEvent)) {
      event.preventDefault();
      event.stopPropagation();
    }
  };
  const onMenu = (event: Event): void => {
    if (!isEditable(event.target)) event.preventDefault();
  };
  target.addEventListener('keydown', onKey, true);
  target.addEventListener('contextmenu', onMenu, true);
  return () => {
    target.removeEventListener('keydown', onKey, true);
    target.removeEventListener('contextmenu', onMenu, true);
  };
}
