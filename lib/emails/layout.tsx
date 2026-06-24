import * as React from "react";

const colors = {
  bg: "#0B0B1A",
  card: "#1A1A3A",
  gold: "#E8B84B",
  purple: "#9B59B6",
  text: "#E0E0E0",
  textMuted: "#8888AA",
  border: "rgba(255,255,255,0.06)",
};

export function EmailLayout({ preview, children }: { preview: string; children: React.ReactNode }) {
  return (
    <html>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="dark" />
        <title>EHL</title>
      </head>
      <body style={{ margin: 0, padding: 0, backgroundColor: colors.bg, fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif" }}>
        {/* Preview text (hidden) */}
        <div style={{ display: "none", maxHeight: 0, overflow: "hidden" }}>{preview}</div>

        <table width="100%" cellPadding={0} cellSpacing={0} role="presentation" style={{ backgroundColor: colors.bg }}>
          <tr>
            <td align="center" style={{ padding: "40px 16px" }}>
              <table width="100%" cellPadding={0} cellSpacing={0} role="presentation" style={{ maxWidth: 560, margin: "0 auto" }}>
                {/* Logo */}
                <tr>
                  <td align="center" style={{ paddingBottom: 32 }}>
                    <img
                      src="cid:ehl-logo"
                      alt="European Hackathon League"
                      width={180}
                      height={90}
                      style={{ height: 60, width: "auto" }}
                    />
                  </td>
                </tr>

                {/* Content card */}
                <tr>
                  <td style={{
                    backgroundColor: colors.card,
                    borderRadius: 16,
                    padding: "32px 32px 40px",
                    border: `1px solid ${colors.border}`,
                  }}>
                    {children}
                  </td>
                </tr>

                {/* Footer */}
                <tr>
                  <td align="center" style={{ paddingTop: 32 }}>
                    <p style={{ fontSize: 12, color: colors.textMuted, margin: 0, lineHeight: "20px" }}>
                      European Hackathon League by TUM.ai e.V.
                    </p>
                    <p style={{ fontSize: 11, color: colors.textMuted, margin: "8px 0 0", opacity: 0.6 }}>
                      You received this email because you are part of an EHL team.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  );
}

// Reusable styled components
export function Heading({ children }: { children: React.ReactNode }) {
  return (
    <h1 style={{ fontSize: 24, fontWeight: 900, color: "#FFFFFF", margin: "0 0 8px", lineHeight: "32px" }}>
      {children}
    </h1>
  );
}

export function Text({ children, muted, preserveLines }: { children: React.ReactNode; muted?: boolean; preserveLines?: boolean }) {
  return (
    <p style={{
      fontSize: 15,
      color: muted ? colors.textMuted : colors.text,
      margin: "0 0 16px",
      lineHeight: "24px",
      // Keep single newlines admins typed inside a paragraph as line breaks.
      whiteSpace: preserveLines ? ("pre-line" as const) : undefined,
    }}>
      {children}
    </p>
  );
}

export function Button({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <table cellPadding={0} cellSpacing={0} role="presentation" style={{ width: "100%", margin: "24px 0" }}>
      <tr>
        <td align="center">
          <table cellPadding={0} cellSpacing={0} role="presentation">
            <tr>
              <td style={{
                backgroundColor: colors.gold,
                borderRadius: 10,
                padding: "12px 28px",
              }}>
                <a href={href} style={{
                  color: colors.bg,
                  fontSize: 14,
                  fontWeight: 800,
                  textDecoration: "none",
                }}>
                  {children}
                </a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  );
}

export function Divider() {
  return (
    <hr style={{
      border: "none",
      borderTop: `1px solid ${colors.border}`,
      margin: "24px 0",
    }} />
  );
}

export function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <tr>
      <td style={{ fontSize: 13, color: colors.textMuted, padding: "6px 0", width: 120, verticalAlign: "top" as const }}>
        {label}
      </td>
      <td style={{ fontSize: 14, color: colors.text, padding: "6px 0", fontWeight: 600 }}>
        {value}
      </td>
    </tr>
  );
}
