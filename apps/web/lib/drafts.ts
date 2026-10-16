import { useCallback, useEffect, useRef, useState } from 'react';
import { isRedirectingToLogin } from './api';
import { useMe } from './use-me';

export const LEAVE_MESSAGE = 'You have unsaved changes. Leave without saving?';

function read<T>(key: string): T | null {
  try {
    const raw = window.sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Full or blocked storage: the unsaved-changes guard still warns.
  }
}

function remove(key: string) {
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // Nothing stored then.
  }
}

/** The storage key of a draft: per signed-in user and entity. Null until the user is known. */
export function draftKey(userId: string | null | undefined, entity: string): string | null {
  return userId ? `draft:${userId}:${entity}` : null;
}

/** What useDraft does with storage on a change: write while dirty, remove once an edited form is clean again. */
export function draftStep(dirty: boolean, edited: boolean): 'write' | 'remove' | null {
  if (dirty) return 'write';
  return edited ? 'remove' : null;
}

/**
 * Keeps an unsaved form in sessionStorage per signed-in user and entity (`job:<id>`), so it
 * survives a reload or a forced re-login. Only edits are stored: pass the form's `dirty` flag.
 * Going back to the saved value removes the draft.
 *
 * `restored` is the draft found on arrival. To use it: `setForm(restored); clear()`.
 * To drop it, or after saving: `clear()`.
 */
export function useDraft<T>(entity: string, value: T, dirty: boolean) {
  const key = draftKey(useMe().data?.user.id, entity);
  const [restored, setRestored] = useState<T | null>(null);
  const edited = useRef(false);

  useEffect(() => {
    if (key) setRestored(read<T>(key));
  }, [key]);

  useEffect(() => {
    if (!key) return;
    const step = draftStep(dirty, edited.current);
    if (step === 'write') {
      edited.current = true;
      write(key, value);
    } else if (step === 'remove') {
      remove(key);
    }
  }, [key, value, dirty]);

  const clear = useCallback(() => {
    if (key) remove(key);
    setRestored(null);
  }, [key]);

  return { restored, clear };
}

/** True when `to` is another page of this site (not a new origin, not the same page or a #hash). */
export function isOtherPage(to: string, from: string): boolean {
  const next = new URL(to, from);
  const here = new URL(from);
  return next.origin === here.origin && (next.pathname !== here.pathname || next.search !== here.search);
}

type HistoryEntry = { state: unknown; url: string };

/**
 * The guard's listeners, apart from the hook so they can be tested without a browser.
 * `here` gives the history entry the page is on, so a cancelled Back/Forward can be put back.
 */
export function leaveGuardHandlers(message: string, here: () => HistoryEntry | null) {
  let leaving = false;
  const confirmLeave = () => (leaving = window.confirm(message));

  const onBeforeUnload = (e: BeforeUnloadEvent) => {
    if (leaving || isRedirectingToLogin()) return;
    e.preventDefault();
    e.returnValue = '';
  };

  const onClick = (e: MouseEvent) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const link = e.target instanceof Element ? e.target.closest('a[href]') : null;
    if (!(link instanceof HTMLAnchorElement)) return;
    if ((link.target && link.target !== '_self') || link.hasAttribute('download')) return;
    if (!isOtherPage(link.href, window.location.href) || confirmLeave()) return;
    e.preventDefault();
    e.stopPropagation();
  };

  // Added in the capture phase on window, so it runs before the router's own popstate listener.
  const onPopState = (e: PopStateEvent) => {
    const from = here();
    if (!from || !isOtherPage(window.location.href, from.url) || confirmLeave()) return;
    e.stopImmediatePropagation();
    // The browser already moved: put our entry back. Next's history state passes through untouched.
    window.history.pushState(from.state, '', from.url);
  };

  return { onBeforeUnload, onClick, onPopState };
}

/**
 * Warns before leaving with unsaved changes: closing or reloading the tab (beforeunload),
 * in-app links (Next <Link> included, caught before the router sees the click) and Back/Forward.
 * A forced sign-in after the session ends skips the prompt; useDraft keeps the work.
 */
export function useUnsavedChangesGuard(dirty: boolean, message = LEAVE_MESSAGE) {
  // The history entry we are on, so a cancelled Back/Forward can be put back.
  const here = useRef<HistoryEntry | null>(null);
  useEffect(() => {
    here.current = { state: window.history.state, url: window.location.href };
  });

  useEffect(() => {
    if (!dirty) return;
    const { onBeforeUnload, onClick, onPopState } = leaveGuardHandlers(message, () => here.current);

    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onClick, true);
    window.addEventListener('popstate', onPopState, true);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onClick, true);
      window.removeEventListener('popstate', onPopState, true);
    };
  }, [dirty, message]);
}
