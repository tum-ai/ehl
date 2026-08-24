import * as React from "react";
import { EmailLayout, Heading, Text, Divider } from "./layout";

interface CreditCodeEmailProps {
  name: string;
  code: string;
  /** Sponsor/credit label, e.g. "OpenAI API credits". */
  creditLabel: string;
  /** Where the code is redeemed. */
  redeemUrl: string;
  chapterName: string;
  /** Optional extra line, e.g. redemption deadline. */
  note?: string;
}

/**
 * One sponsor credit code, sent to a single checked-in participant. Codes are
 * single-use and personal, so the copy says so explicitly: a forwarded code is
 * unrecoverable.
 */
export function CreditCodeEmail({
  name,
  code,
  creditLabel,
  redeemUrl,
  chapterName,
  note,
}: CreditCodeEmailProps) {
  return (
    <EmailLayout preview={`Your ${creditLabel} code for ${chapterName}`}>
      <Heading>Your {creditLabel}</Heading>

      <Text>
        Hey {name}, here is your personal {creditLabel} code for {chapterName}.
        It is single use and tied to you, so please do not share or forward it.
      </Text>

      {/* Code display */}
      <table
        cellPadding={0}
        cellSpacing={0}
        role="presentation"
        style={{ margin: "24px auto", textAlign: "center" as const }}
      >
        <tr>
          <td
            style={{
              backgroundColor: "rgba(232, 180, 75, 0.08)",
              border: "2px solid rgba(232, 180, 75, 0.25)",
              borderRadius: 12,
              padding: "20px 32px",
            }}
          >
            <span
              style={{
                fontSize: 26,
                fontWeight: 900,
                fontFamily: "'JetBrains Mono', 'Courier New', monospace",
                color: "#E8B84B",
                letterSpacing: "0.12em",
              }}
            >
              {code}
            </span>
          </td>
        </tr>
      </table>

      <Text>
        Redeem it at <a href={redeemUrl} style={{ color: "#E8B84B" }}>{redeemUrl}</a>.
      </Text>

      {note && <Text>{note}</Text>}

      <Divider />

      <Text muted>
        You received this because you checked in at {chapterName} in the European
        Hackathon League. If the code does not work, reply to this email.
      </Text>
    </EmailLayout>
  );
}
