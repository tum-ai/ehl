/**
 * Print the RSVP request email as plain text, for reviewing copy without
 * sending anything. Run: pnpm exec tsx scripts/preview-rsvp-email.ts
 */
import { renderRsvpRequestEmail } from "@/lib/emails/render";
import { formatRsvpDeadline } from "@/lib/rsvp-window";

async function main() {
  const html = await renderRsvpRequestEmail({
    firstName: "Hacker",
    chapterName: "Zurich Hackathon",
    chapterCity: "Zurich, Switzerland",
    chapterDate: "14-15 June 2026",
    rsvpToken: "00000000-0000-0000-0000-000000000000",
    deadline: formatRsvpDeadline(new Date()),
  });

  const text = html
    .replace(/<style[\s\S]*?<\/style>/g, "")
    .replace(/<\/(p|div|tr|h1|h2|td|a)>/g, "\n")
    .replace(/<br\s*\/?>/g, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n");

  console.log(text);
}

main();
