import { describe, it, expect, beforeEach, vi } from "vitest";

// Regression guard for the dropped-confirmation-email bug: transactional
// emails were sent as floating promises ("fire and forget"). On Vercel the
// function instance freezes as soon as the action returns, so the promise
// never ran and the email was silently lost. The fix routes every deferred
// send through next/server's after(), which keeps the instance alive until
// the callback finishes. These tests pin that contract:
//   1. the work is registered with after(), not executed inline
//   2. the work actually runs when the runtime flushes after() callbacks
//   3. a failing send is contained (logged, never thrown into the response)
const afterMock = vi.fn();
vi.mock("next/server", () => ({
  after: (cb: () => Promise<void>) => afterMock(cb),
}));

import { sendEmailAfterResponse } from "@/lib/email-deferred";

describe("sendEmailAfterResponse", () => {
  beforeEach(() => {
    afterMock.mockReset();
  });

  it("registers the task via after() and does not run it inline", () => {
    const task = vi.fn().mockResolvedValue(undefined);

    sendEmailAfterResponse("test email", task);

    expect(afterMock).toHaveBeenCalledTimes(1);
    expect(task).not.toHaveBeenCalled();
  });

  it("runs the task when the after() callback is flushed", async () => {
    const task = vi.fn().mockResolvedValue(undefined);

    sendEmailAfterResponse("test email", task);
    const registered = afterMock.mock.calls[0][0] as () => Promise<void>;
    await registered();

    expect(task).toHaveBeenCalledTimes(1);
  });

  it("contains task failures: logs the error and never rethrows", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const task = vi.fn().mockRejectedValue(new Error("SMTP down"));

    sendEmailAfterResponse("confirmation to a@b.c", task);
    const registered = afterMock.mock.calls[0][0] as () => Promise<void>;

    await expect(registered()).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("confirmation to a@b.c"),
      expect.any(Error)
    );
    consoleError.mockRestore();
  });

  it("a synchronously throwing task is also contained", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const task = vi.fn(() => {
      throw new Error("render exploded");
    });

    sendEmailAfterResponse("broken render", task as () => Promise<void>);
    const registered = afterMock.mock.calls[0][0] as () => Promise<void>;

    await expect(registered()).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalledTimes(1);
    consoleError.mockRestore();
  });
});
