/**
 * One-off script: mail each checked-in participant ONE sponsor credit code.
 *
 * Codes are single-use and unrecoverable once sent, so the script is built to
 * be safe rather than clever:
 *   - Dry run by default. A real send requires SEND=true.
 *   - The assignment is computed once, written to disk, and REUSED on later
 *     runs (--assignments), so a resumed run can never re-roll who gets what.
 *   - Every successful send is appended to a sent-log immediately; a re-run
 *     skips those addresses. A crash mid-send costs nothing.
 *   - Codes are drawn from the BOTTOM of the pool upward; the unused top block
 *     is written to a separate leftovers file.
 *
 * Nothing here writes to the database: the credit codes live only in the input
 * file and the generated assignment/log files. Keep all of those OUT of the
 * repo (this repo is public).
 *
 * Usage:
 *   # 1. dry run, writes assignment + leftovers, sends nothing
 *   npx tsx scripts/send-credit-codes.ts \
 *     --emails ~/Downloads/emails.txt \
 *     --codes ~/Downloads/codes.txt \
 *     --out-dir ~/Downloads
 *
 *   # 2. real send, reusing the exact assignment from step 1
 *   SEND=true npx tsx scripts/send-credit-codes.ts \
 *     --assignments ~/Downloads/credit-code-assignments.csv \
 *     --out-dir ~/Downloads
 *
 * Optional:
 *   --names <csv>   CSV with `name` + an email column, used for the greeting
 *   --limit <n>     only process the first n recipients (test send)
 *   ENV_FILE=<path> env file to load (default .env.local)
 *
 * Required env: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { config } from "dotenv";
import { assignCodes, type CodeAssignment } from "../lib/credit-codes";

config({ path: process.env.ENV_FILE ?? ".env.local" });

// --- Copy shown to participants. Review before a real send. -----------------
const CREDIT_LABEL = process.env.CREDIT_LABEL ?? "OpenAI API credits";
const REDEEM_URL =
  process.env.REDEEM_URL ?? "https://platform.openai.com/settings/organization/billing/overview";
const CHAPTER_NAME = process.env.CHAPTER_NAME ?? "EHL Munich";
const SUBJECT = process.env.SUBJECT ?? `Your ${CREDIT_LABEL} code for ${CHAPTER_NAME}`;
const NOTE =
  process.env.NOTE ??
  "Redeem it before the end of the hackathon weekend. One code per person, and it cannot be reissued.";
// Pause between messages so a bulk run stays well inside Gmail's send rate.
const DELAY_MS = Number(process.env.DELAY_MS ?? 400);

const DRY_RUN = process.env.SEND !== "true";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

function readLines(path: string): string[] {
  return readFileSync(path, "utf8").split("\n").map((l) => l.trim()).filter(Boolean);
}

/** Minimal CSV row splitter: handles quoted fields with embedded commas. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') inQuotes = false;
      else cur += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

function csvEscape(s: string): string {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** email -> display name, from a CSV with a `name` column. */
function loadNames(path: string): Map<string, string> {
  const map = new Map<string, string>();
  const lines = readLines(path);
  if (lines.length === 0) return map;
  const header = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const nameIdx = header.indexOf("name");
  const emailIdxs = header
    .map((h, i) => (h.includes("email") ? i : -1))
    .filter((i) => i !== -1);
  if (nameIdx === -1 || emailIdxs.length === 0) return map;
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line);
    const name = (cells[nameIdx] ?? "").trim();
    if (!name) continue;
    for (const ei of emailIdxs) {
      const email = (cells[ei] ?? "").trim().toLowerCase();
      if (email) map.set(email, name);
    }
  }
  return map;
}

async function main() {
  const outDir = arg("out-dir") ?? process.cwd();
  const assignmentsPath = arg("assignments") ?? join(outDir, "credit-code-assignments.csv");
  const leftoversPath = join(outDir, "credit-code-leftovers.txt");
  const sentLogPath = join(outDir, "credit-code-sent.log");
  const namesPath = arg("names");
  const limit = arg("limit") ? Number(arg("limit")) : undefined;

  let assignments: CodeAssignment[];

  if (arg("assignments")) {
    // Reuse a previously computed assignment. Never re-roll on a resume.
    const lines = readLines(assignmentsPath);
    const header = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
    const ei = header.indexOf("email");
    const ci = header.indexOf("code");
    if (ei === -1 || ci === -1) {
      console.error(`${assignmentsPath} needs 'email' and 'code' columns.`);
      process.exit(1);
    }
    assignments = lines.slice(1).map((l) => {
      const cells = splitCsvLine(l);
      return { email: cells[ei].trim().toLowerCase(), code: cells[ci].trim() };
    });
    console.log(`Loaded ${assignments.length} existing assignments from ${assignmentsPath}`);
  } else {
    const emailsPath = arg("emails");
    const codesPath = arg("codes");
    if (!emailsPath || !codesPath) {
      console.error("Need --emails <file> and --codes <file> (or --assignments <csv>).");
      process.exit(1);
    }
    if (existsSync(assignmentsPath)) {
      console.error(
        `${assignmentsPath} already exists. Pass --assignments to reuse it, or move it aside.\n` +
          "Refusing to overwrite: a second assignment would hand out different codes."
      );
      process.exit(1);
    }

    const emails = readLines(emailsPath);
    const codes = readLines(codesPath);
    const result = assignCodes(emails, codes);
    assignments = result.assignments;

    const names = namesPath ? loadNames(namesPath) : new Map<string, string>();
    const rows = [
      ["email", "code", "name"].join(","),
      ...assignments.map((a) =>
        [a.email, a.code, names.get(a.email) ?? ""].map(csvEscape).join(",")
      ),
    ];
    writeFileSync(assignmentsPath, rows.join("\n") + "\n");
    writeFileSync(leftoversPath, result.leftoverCodes.join("\n") + "\n");

    console.log(`recipients in file : ${emails.length}`);
    console.log(`codes in pool      : ${codes.length}`);
    console.log(`assigned           : ${assignments.length}  -> ${assignmentsPath}`);
    console.log(`leftover codes     : ${result.leftoverCodes.length}  -> ${leftoversPath}`);
    if (result.duplicateEmails.length) {
      console.log(`duplicate emails collapsed: ${result.duplicateEmails.length}`);
      result.duplicateEmails.forEach((e) => console.log(`   ${e}`));
    }
    if (result.unservedEmails.length) {
      console.log(`NOT ENOUGH CODES for ${result.unservedEmails.length} people:`);
      result.unservedEmails.forEach((e) => console.log(`   ${e}`));
    }
  }

  // Resume support: skip anyone already logged as sent.
  const alreadySent = new Set<string>();
  if (existsSync(sentLogPath)) {
    for (const line of readLines(sentLogPath)) {
      const email = line.split(",")[1]?.trim().toLowerCase();
      if (email) alreadySent.add(email);
    }
    console.log(`sent-log: ${alreadySent.size} already delivered, will be skipped`);
  }

  const names = namesPath ? loadNames(namesPath) : new Map<string, string>();
  let queue = assignments.filter((a) => !alreadySent.has(a.email));
  if (limit !== undefined) queue = queue.slice(0, limit);

  console.log(`\n${DRY_RUN ? "DRY RUN" : "LIVE SEND"}: ${queue.length} emails`);
  console.log(`from    : ${process.env.SMTP_FROM}`);
  console.log(`subject : ${SUBJECT}`);
  console.log(`redeem  : ${REDEEM_URL}\n`);

  const { renderCreditCodeEmail } = await import("../lib/emails/render");

  if (DRY_RUN) {
    for (const a of queue.slice(0, 3)) {
      console.log(`  -> ${a.email}  code=${a.code}  name=${names.get(a.email) ?? "(none)"}`);
    }
    if (queue.length > 3) console.log(`  ... and ${queue.length - 3} more`);
    const sample = queue[0];
    if (sample) {
      const html = await renderCreditCodeEmail({
        name: names.get(sample.email)?.split(" ")[0] ?? "there",
        code: sample.code,
        creditLabel: CREDIT_LABEL,
        redeemUrl: REDEEM_URL,
        chapterName: CHAPTER_NAME,
        note: NOTE,
      });
      const previewPath = join(outDir, "credit-code-preview.html");
      writeFileSync(previewPath, html);
      console.log(`\nSample email written to ${previewPath}`);
    }
    console.log("\nNothing was sent. Re-run with SEND=true to deliver.");
    return;
  }

  const { sendEmail } = await import("../lib/email");
  let ok = 0;
  const failures: { email: string; error: string }[] = [];

  for (const [i, a] of queue.entries()) {
    const name = names.get(a.email)?.split(" ")[0] ?? "there";
    try {
      const html = await renderCreditCodeEmail({
        name,
        code: a.code,
        creditLabel: CREDIT_LABEL,
        redeemUrl: REDEEM_URL,
        chapterName: CHAPTER_NAME,
        note: NOTE,
      });
      // skipRateLimit: admin-initiated bulk send, same as acceptance emails.
      await sendEmail({ to: a.email, subject: SUBJECT, html, skipRateLimit: true });
      // Log immediately: a crash after this point must not resend this code.
      appendFileSync(sentLogPath, `${new Date().toISOString()},${a.email},${a.code}\n`);
      ok++;
      console.log(`[${i + 1}/${queue.length}] sent ${a.email}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      failures.push({ email: a.email, error: msg });
      console.error(`[${i + 1}/${queue.length}] FAILED ${a.email}: ${msg}`);
    }
    if (DELAY_MS > 0) await new Promise((r) => setTimeout(r, DELAY_MS));
  }

  console.log(`\nsent ${ok}, failed ${failures.length}`);
  if (failures.length) {
    const failPath = join(outDir, "credit-code-failures.csv");
    writeFileSync(
      failPath,
      "email,error\n" + failures.map((f) => [f.email, f.error].map(csvEscape).join(",")).join("\n") + "\n"
    );
    console.log(`Failures written to ${failPath}. Their codes were NOT logged as sent;`);
    console.log("re-running with --assignments will retry exactly those addresses.");
  }
  console.log(`Sent log: ${sentLogPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
