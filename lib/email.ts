import nodemailer from "nodemailer";
import path from "path";
import { checkRateLimit, emailLimiter } from "@/lib/ratelimit";

// EMAIL_FAKE_TRANSPORT=true uses Nodemailer's built-in JSON transport: it never
// opens a network connection, just serializes the message and resolves. Used by
// E2E/CI so tests exercising email paths (verification codes, broadcasts) don't
// block on real SMTP (which made the lifecycle suite exceed the CI time budget)
// and never send to real inboxes. Production/preview leave it unset -> real SMTP.
const useFakeTransport = process.env.EMAIL_FAKE_TRANSPORT === "true";

const transporter = useFakeTransport
  ? nodemailer.createTransport({ jsonTransport: true })
  : nodemailer.createTransport({
      host: process.env.SMTP_HOST || "smtp.gmail.com",
      port: Number(process.env.SMTP_PORT) || 587,
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD,
      },
      // Pool connections so bulk sends (acceptance/rejection for hundreds of
      // applicants) reuse a few TCP/auth sessions instead of opening one per
      // message — the latter made each send ~1-2s and timed out the function.
      pool: true,
      maxConnections: 3,
      maxMessages: 100,
      connectionTimeout: 10_000,  // 10s to connect
      greetingTimeout: 10_000,    // 10s for greeting
      socketTimeout: 15_000,      // 15s for socket inactivity
    });

interface Attachment {
  filename: string;
  content?: Buffer | string;
  path?: string;
  contentType?: string;
  cid: string;
}

interface SendEmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  attachments?: Attachment[];
  skipRateLimit?: boolean;
}

export async function sendEmail({ to, subject, html, attachments = [], skipRateLimit = false }: SendEmailOptions) {
  const from = process.env.SMTP_FROM;
  if (!from) {
    console.error("SMTP_FROM env var is not set. Skipping email.");
    return;
  }

  // Per-address rate limiting (3 emails/hour/address)
  // Skipped for admin-initiated sends (acceptance/rejection emails)
  const recipients = Array.isArray(to) ? to : [to];
  if (!skipRateLimit) {
    for (const recipient of recipients) {
      const rl = await checkRateLimit(emailLimiter, recipient.toLowerCase());
      if (rl.limited) {
        console.warn(`[Email] Rate limit hit for ${recipient}, skipping "${subject}"`);
        throw new Error(`Email rate limit exceeded for ${recipient}`);
      }
    }
  }

  // Always include the logo as an inline CID attachment
  const logoAttachment: Attachment = {
    filename: "ehl-logo.png",
    path: path.join(process.cwd(), "public", "images", "ehl-logo.png"),
    cid: "ehl-logo",
  };

  try {
    await transporter.sendMail({
      from,
      to: recipients.join(", "),
      subject,
      html,
      attachments: [logoAttachment, ...attachments],
    });
  } catch (err) {
    console.error(`[Email] Failed to send "${subject}" to ${recipients.join(", ")}:`, err);
    throw err;
  }
}
