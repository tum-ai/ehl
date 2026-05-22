import * as React from "react";
import { EmailLayout, Heading, Text, Button, Divider, InfoRow } from "./layout";

interface WelcomeEmailProps {
  teamName: string;
  presidentName: string;
  members: { name: string; email: string }[];
  isPresident: boolean;
  recipientName: string;
}

export function WelcomeEmail({ teamName, presidentName, members, isPresident, recipientName }: WelcomeEmailProps) {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://ehl.gg";

  return (
    <EmailLayout preview={`Welcome to the European Hackathon League, ${recipientName}!`}>
      <Heading>
        Welcome to the EHL{isPresident ? ", President!" : "!"}
      </Heading>

      <Text>
        Hey {recipientName}, your team <strong style={{ color: "#E8B84B" }}>{teamName}</strong> has been
        registered for the European Hackathon League Season 1.
      </Text>

      {isPresident ? (
        <Text>
          As team president, you must be present at every match your team participates in
          and are responsible for selecting challenges. Each member still applies individually,
          but you coordinate participation and represent the team on match day.
        </Text>
      ) : (
        <Text>
          {presidentName} registered you as a team member. You will be notified when
          your team signs up for upcoming matches.
        </Text>
      )}

      <Divider />

      {/* Team info */}
      <table cellPadding={0} cellSpacing={0} role="presentation" style={{ width: "100%" }}>
        <InfoRow label="Team" value={teamName} />
        <InfoRow label="President" value={presidentName} />
        <InfoRow label="Members" value={`${members.length + 1} total`} />
      </table>

      {/* Member list */}
      <div style={{
        marginTop: 16,
        padding: "12px 16px",
        backgroundColor: "rgba(155, 89, 182, 0.08)",
        borderRadius: 10,
        border: "1px solid rgba(155, 89, 182, 0.15)",
      }}>
        <p style={{ fontSize: 11, fontWeight: 700, color: "#9B59B6", letterSpacing: "0.15em", textTransform: "uppercase" as const, margin: "0 0 8px" }}>
          Roster
        </p>
        <p style={{ fontSize: 13, color: "#E0E0E0", margin: 0, lineHeight: "22px" }}>
          <span style={{ color: "#E8B84B" }}>&#9733;</span> {presidentName}
          {members.map((m) => (
            <React.Fragment key={m.email}>
              <br />
              {m.name}
            </React.Fragment>
          ))}
        </p>
      </div>

      <Button href={`${baseUrl}${isPresident ? "/dashboard" : "/leaderboard"}`}>
        {isPresident ? "Go to Dashboard" : "View Leaderboard"}
      </Button>

      <Text muted>
        Season 1: 6 matches across 4 European cities. Top 15 teams qualify for the Grand Finale in Munich.
      </Text>
    </EmailLayout>
  );
}
