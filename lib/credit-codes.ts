/**
 * Pairing of one-per-person sponsor credit codes with recipients.
 *
 * Kept pure (no I/O, no email) so the allocation can be unit tested: a
 * mis-assignment here means a code is either burned on nobody or handed to two
 * people, and codes are single-use and non-recoverable once sent.
 */

export interface CodeAssignment {
  email: string;
  code: string;
}

export interface AssignmentResult {
  assignments: CodeAssignment[];
  /** Codes nobody was given, in original file order. */
  leftoverCodes: string[];
  /** Recipients left without a code because the pool ran out, in input order. */
  unservedEmails: string[];
  /** Duplicate recipient addresses that were collapsed, in input order. */
  duplicateEmails: string[];
}

/**
 * Assign codes to recipients, drawing from the BOTTOM of the code list upward.
 *
 * Recipients keep their input order; the code pool is consumed last-line-first,
 * so the unused remainder is the TOP of the file. That is the requested
 * behaviour and it also makes a partial send obvious: an untouched top block
 * still lines up with the original file.
 *
 * Recipient addresses are normalized (trimmed, lowercased) and de-duplicated so
 * one person can never consume two codes.
 */
export function assignCodes(emails: string[], codes: string[]): AssignmentResult {
  const seen = new Set<string>();
  const duplicateEmails: string[] = [];
  const recipients: string[] = [];
  for (const raw of emails) {
    const email = raw.trim().toLowerCase();
    if (!email) continue;
    if (seen.has(email)) {
      duplicateEmails.push(email);
      continue;
    }
    seen.add(email);
    recipients.push(email);
  }

  const pool = codes.map((c) => c.trim()).filter(Boolean);
  // Drawing from the bottom: walk the pool backwards as recipients are served.
  let next = pool.length - 1;
  const assignments: CodeAssignment[] = [];
  const unservedEmails: string[] = [];
  for (const email of recipients) {
    if (next < 0) {
      unservedEmails.push(email);
      continue;
    }
    assignments.push({ email, code: pool[next] });
    next -= 1;
  }

  // Everything not consumed, still in original file order.
  const leftoverCodes = pool.slice(0, next + 1);

  return { assignments, leftoverCodes, unservedEmails, duplicateEmails };
}
