import { describe, it, expect, vi } from "vitest";
import { stopScannerSafely } from "@/lib/qr-scanner";

// html5-qrcode's stop() can throw synchronously, reject, or resolve. In every
// case teardown must NOT throw (an escaping throw crashes the admin page via the
// error boundary) and must still attempt clear().
describe("stopScannerSafely", () => {
  it("absorbs a synchronous throw from stop() and still clears", () => {
    const clear = vi.fn();
    const scanner = {
      stop: () => {
        // This is exactly what html5-qrcode does when never started.
        throw "Cannot stop, scanner is not running or paused.";
      },
      clear,
    };
    expect(() => stopScannerSafely(scanner)).not.toThrow();
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it("clears after stop() resolves", async () => {
    const clear = vi.fn();
    const scanner = { stop: () => Promise.resolve(), clear };
    stopScannerSafely(scanner);
    await Promise.resolve();
    await Promise.resolve();
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it("clears after stop() rejects (and does not throw)", async () => {
    const clear = vi.fn();
    const scanner = { stop: () => Promise.reject(new Error("boom")), clear };
    expect(() => stopScannerSafely(scanner)).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it("never throws even if clear() itself throws", () => {
    const scanner = {
      stop: () => {
        throw "nope";
      },
      clear: () => {
        throw new Error("clear failed");
      },
    };
    expect(() => stopScannerSafely(scanner)).not.toThrow();
  });
});
