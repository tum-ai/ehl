/**
 * Mailpit email helper for the live-UI simulation.
 *
 * The simulation runs a production build whose SMTP points at a local Mailpit
 * instance (SMTP :1025, HTTP API :8025). This reads emails deterministically
 * from Mailpit's HTTP API — no LLM in the loop, no real inbox, no prompt-injection
 * surface. This is the real email code path: the app sends via nodemailer exactly
 * as in production; Mailpit just captures instead of delivering.
 */

const MAILPIT_API = process.env.MAILPIT_API || "http://localhost:8025";

interface MailpitMessageSummary {
  ID: string;
  To: Array<{ Address: string }>;
  Subject: string;
  Created: string;
}

interface MailpitMessage {
  ID: string;
  Subject: string;
  Text: string;
  HTML: string;
  To: Array<{ Address: string }>;
}

async function listMessages(): Promise<MailpitMessageSummary[]> {
  const res = await fetch(`${MAILPIT_API}/api/v1/messages?limit=200`);
  if (!res.ok) throw new Error(`Mailpit list failed: ${res.status}`);
  const data = (await res.json()) as { messages?: MailpitMessageSummary[] };
  return data.messages ?? [];
}

async function getMessage(id: string): Promise<MailpitMessage> {
  const res = await fetch(`${MAILPIT_API}/api/v1/message/${id}`);
  if (!res.ok) throw new Error(`Mailpit get failed: ${res.status}`);
  return (await res.json()) as MailpitMessage;
}

/** Delete all captured mail. Call between runs / users to avoid cross-talk. */
export async function clearMailbox(): Promise<void> {
  await fetch(`${MAILPIT_API}/api/v1/messages`, { method: "DELETE" });
}

/**
 * Wait for the most recent email to `address` (optionally matching a subject
 * substring), polling Mailpit. Returns the full message (Text + HTML).
 */
export async function waitForEmail(
  address: string,
  opts: { subjectIncludes?: string; timeoutMs?: number; sinceISO?: string } = {}
): Promise<MailpitMessage> {
  const timeoutMs = opts.timeoutMs ?? 20000;
  const deadline = Date.now() + timeoutMs;
  const target = address.toLowerCase();

  while (Date.now() < deadline) {
    const messages = await listMessages();
    const match = messages.find((m) => {
      const toMatch = m.To?.some((t) => t.Address.toLowerCase() === target);
      const subjMatch = opts.subjectIncludes
        ? m.Subject.toLowerCase().includes(opts.subjectIncludes.toLowerCase())
        : true;
      const timeMatch = opts.sinceISO ? m.Created > opts.sinceISO : true;
      return toMatch && subjMatch && timeMatch;
    });
    if (match) return getMessage(match.ID);
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(
    `No email to ${address}${opts.subjectIncludes ? ` matching "${opts.subjectIncludes}"` : ""} within ${timeoutMs}ms`
  );
}

/** Extract the first 6-digit verification code from an email body. */
export function extractVerificationCode(msg: MailpitMessage): string {
  const body = `${msg.Text}\n${msg.HTML}`;
  const m = body.match(/\b(\d{6})\b/);
  if (!m) throw new Error(`No 6-digit code in email "${msg.Subject}"`);
  return m[1];
}

/** Extract the first auth-callback / magic / confirm link from an email body. */
export function extractLink(msg: MailpitMessage, pathHint = "/auth/callback"): string {
  const body = `${msg.HTML}\n${msg.Text}`;
  // Prefer a link containing the hint; fall back to the first http(s) URL.
  const hintRe = new RegExp(`https?://[^\\s"'<>]*${pathHint.replace(/\//g, "\\/")}[^\\s"'<>]*`, "i");
  const hinted = body.match(hintRe);
  if (hinted) return decodeHtml(hinted[0]);
  const any = body.match(/https?:\/\/[^\s"'<>]+/);
  if (!any) throw new Error(`No link found in email "${msg.Subject}"`);
  return decodeHtml(any[0]);
}

function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&#x2F;/g, "/")
    .replace(/&#61;/g, "=")
    .replace(/&quot;/g, '"');
}
