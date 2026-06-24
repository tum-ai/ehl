"use client";

import { useEffect, useRef } from "react";

const DEFAULT_MESSAGE =
  "You have unsaved changes. Leave this page and discard them?";

/**
 * Pure decision: given an intercepted anchor click, should we prompt before
 * letting the navigation proceed? Extracted from the hook so the (tricky) branch
 * logic is unit-testable without a DOM environment.
 *
 * Returns true only when the click would navigate away from the current form in
 * a way that unmounts it. Returns false for: modifier/middle clicks (new tab),
 * already-handled clicks, non-navigating anchors (no href, pure hash, target
 * _blank, download), and same-page hash anchors.
 */
export function shouldGuardNavigation(input: {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  defaultPrevented: boolean;
  href: string | null;
  target: string | null;
  isDownload: boolean;
  currentUrl: string;
}): boolean {
  if (
    input.defaultPrevented ||
    input.button !== 0 ||
    input.metaKey ||
    input.ctrlKey ||
    input.shiftKey ||
    input.altKey
  ) {
    return false;
  }

  const { href } = input;
  if (
    !href ||
    href.startsWith("#") ||
    input.target === "_blank" ||
    input.isDownload
  ) {
    return false;
  }

  // Same-document hash links don't unmount the form, so don't prompt.
  try {
    const dest = new URL(href, input.currentUrl);
    const here = new URL(input.currentUrl);
    if (
      dest.pathname === here.pathname &&
      dest.search === here.search &&
      dest.hash
    ) {
      return false;
    }
  } catch {
    // Unparseable href: be safe and guard it.
  }

  return true;
}

/**
 * Warns the admin before they navigate away while a form has unsaved edits.
 *
 * Admin settings forms (challenges, code-review config, chapter settings, global
 * app settings, ...) require an explicit Save. It is easy to click a link or
 * close the tab mid-edit and silently lose the changes, which on these pages can
 * have real consequences (e.g. a half-configured challenge). This hook is the
 * generic guard wired into every such form.
 *
 * It covers the two ways unsaved work is lost:
 *  1. Tab close / hard reload / navigation to an external URL  -> the native
 *     `beforeunload` prompt.
 *  2. In-app navigation via a clicked `<a>`/`<Link>`           -> a `confirm()`
 *     intercept in the capture phase. The Next.js App Router has no built-in
 *     navigation blocker, so we gate the anchor click before the router sees it.
 *
 * The listeners are only attached while `isDirty` is true, so a clean form never
 * prompts. Call it unconditionally at the top of a client component:
 *
 *   useUnsavedChanges(isDirty);
 *
 * `isDirty` should be derived from comparing current form state to the last
 * saved snapshot (true == there are unsaved edits).
 */
export function useUnsavedChanges(isDirty: boolean, message = DEFAULT_MESSAGE) {
  // Keep the latest values in refs so the capture-phase click listener (attached
  // once) always reads current state without re-binding on every keystroke.
  const dirtyRef = useRef(isDirty);
  const messageRef = useRef(message);
  dirtyRef.current = isDirty;
  messageRef.current = message;

  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (!dirtyRef.current) return;
      e.preventDefault();
      // Legacy browsers require returnValue to be set; the string is ignored by
      // modern browsers, which show their own generic message.
      e.returnValue = messageRef.current;
      return messageRef.current;
    }

    function handleClickCapture(e: MouseEvent) {
      if (!dirtyRef.current) return;

      const anchor = (e.target as Element | null)?.closest?.("a");
      if (!anchor) return;

      const guard = shouldGuardNavigation({
        button: e.button,
        metaKey: e.metaKey,
        ctrlKey: e.ctrlKey,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
        defaultPrevented: e.defaultPrevented,
        href: anchor.getAttribute("href"),
        target: anchor.getAttribute("target"),
        isDownload: anchor.hasAttribute("download"),
        currentUrl: window.location.href,
      });
      if (!guard) return;

      if (!window.confirm(messageRef.current)) {
        // Stop the router (and any other handlers) from navigating.
        e.preventDefault();
        e.stopPropagation();
      }
    }

    window.addEventListener("beforeunload", handleBeforeUnload);
    // Capture phase so we run before React/router click handlers.
    document.addEventListener("click", handleClickCapture, true);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      document.removeEventListener("click", handleClickCapture, true);
    };
  }, []);
}
