import { runWithConcurrency } from "@/lib/utils";

/**
 * Scheduling for bulk transactional email.
 *
 * Every admin-triggered bulk send in this codebase has the same two problems,
 * and until now each solved them differently (or not at all):
 *
 *   - A sequential `for … await` loop over N recipients is N round trips to
 *     SMTP end to end, which blows the function timeout on a real chapter. It
 *     also wastes the connection pool: lib/email.ts opens `maxConnections: 3`,
 *     and a sequential loop only ever uses one of them.
 *   - Without a wall-clock budget, hitting the timeout kills the request
 *     mid-loop: some recipients are mailed, nothing is recorded about how far
 *     it got, and the admin has no idea what to do next.
 *
 * This helper fixes the scheduling once. Callers keep their own bookkeeping
 * (what "sent" and "failed" mean differs per email type) and handle their own
 * errors inside `worker`; all this owns is concurrency and the deadline.
 *
 * The deadline is checked INSIDE each job rather than around the loop, so a
 * recipient the budget did not reach is reported as skipped having done
 * nothing at all. That matters whenever the worker's first act is to persist
 * something ("already emailed" stamps, RSVP rows): a half-done job would mark
 * someone as handled and quietly exclude them from every later attempt.
 */

/** Matches `maxConnections` on the nodemailer pool in lib/email.ts. Raising it
 *  beyond the pool size just queues inside nodemailer, it does not send faster. */
export const EMAIL_SEND_CONCURRENCY = 3;

/** Wall-clock budget for one bulk send. Deliberately below the Vercel function
 *  timeout so the caller always gets to record its result and report what is
 *  left, instead of the request being killed mid-flight. */
export const EMAIL_SEND_BUDGET_MS = 45_000;

export interface BudgetedRunOptions {
  concurrency?: number;
  budgetMs?: number;
  /** Injectable clock, for tests. */
  now?: () => number;
}

/**
 * Run `worker` over `items`, at most `concurrency` at a time, stopping once the
 * budget is spent. Returns the items never started, in input order.
 *
 * `worker` must handle its own errors: a throw propagates and aborts the run.
 */
export async function runBudgetedConcurrent<T>(
  items: T[],
  worker: (item: T) => Promise<void>,
  opts: BudgetedRunOptions = {}
): Promise<{ skipped: T[] }> {
  const {
    concurrency = EMAIL_SEND_CONCURRENCY,
    budgetMs = EMAIL_SEND_BUDGET_MS,
    now = Date.now,
  } = opts;

  const deadline = now() + budgetMs;
  const skipped: T[] = [];

  const jobs = items.map((item) => async () => {
    if (now() > deadline) {
      skipped.push(item);
      return;
    }
    await worker(item);
  });

  await runWithConcurrency(jobs, concurrency);

  return { skipped };
}
