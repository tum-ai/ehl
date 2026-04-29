import nodemailer from "nodemailer";
import path from "path";
import { checkRateLimit, emailLimiter } from "@/lib/ratelimit";

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.gmail.com",
  port: Number(process.env.SMTP_PORT) || 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASSWORD,
  },
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
}

export async function sendEmail({ to, subject, html, attachments = [] }: SendEmailOptions) {
  const from = process.env.SMTP_FROM;
  if (!from) {
    console.error("SMTP_FROM env var is not set. Skipping email.");
    return;
  }

  // Per-address rate limiting (3 emails/hour/address)
  const recipients = Array.isArray(to) ? to : [to];
  for (const recipient of recipients) {
    const rl = await checkRateLimit(emailLimiter, recipient.toLowerCase());
    if (rl.limited) {
      console.warn(`Email rate limit hit for ${recipient}, skipping`);
      return;
    }
  }

  // Always include the logo as an inline CID attachment
  const logoAttachment: Attachment = {
    filename: "ehl-logo.png",
    path: path.join(process.cwd(), "public", "images", "ehl-logo.png"),
    cid: "ehl-logo",
  };

  await transporter.sendMail({
    from,
    to: recipients.join(", "),
    subject,
    html,
    attachments: [logoAttachment, ...attachments],
  });
}
