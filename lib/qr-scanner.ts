/**
 * Safe teardown for the html5-qrcode scanner used on the admin check-in page.
 *
 * html5-qrcode's `stop()` THROWS synchronously (a bare string, e.g. "Cannot
 * stop, scanner is not running or paused.") when the scanner never reached a
 * running/paused state — which happens whenever camera start fails or is denied.
 * If that throw escapes a React effect-cleanup it crashes the whole page via the
 * error boundary. This wrapper absorbs both the synchronous throw and any async
 * rejection, always attempting `clear()` afterwards.
 */

export interface StoppableScanner {
  stop: () => Promise<unknown> | unknown;
  clear: () => void;
}

function safeClear(scanner: StoppableScanner): void {
  try {
    scanner.clear();
  } catch {
    /* ignore — the container may already be gone */
  }
}

export function stopScannerSafely(scanner: StoppableScanner): void {
  try {
    const result = scanner.stop();
    if (result && typeof (result as Promise<unknown>).then === "function") {
      (result as Promise<unknown>).then(
        () => safeClear(scanner),
        () => safeClear(scanner)
      );
    } else {
      // stop() returned synchronously (already stopped) — just clear.
      safeClear(scanner);
    }
  } catch {
    // stop() threw synchronously (scanner never started) — just clear.
    safeClear(scanner);
  }
}
