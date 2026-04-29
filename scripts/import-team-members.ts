/**
 * Import team members from Tally CSV exports into Supabase.
 *
 * Reads:
 *   1. Final Submission CSV (team name -> captain email)
 *   2. Application CSV (captain email -> team member details)
 *
 * Creates profiles and team_members entries for all members.
 *
 * Usage:
 *   npx tsx scripts/import-team-members.ts <submission-csv> <application-csv> [--dry-run]
 *
 * Example:
 *   npx tsx scripts/import-team-members.ts \
 *     "Final Submission_ Makeathon 2026_Submissions_2026-04-23.csv" \
 *     "Application for TUM.ai Makeathon 2026_Submissions_2026-04-24.csv"
 */

import { readFileSync } from "fs";
import { parse } from "csv-parse/sync";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars");
  process.exit(1);
}

interface TeamMember {
  firstName: string;
  lastName: string;
  email: string | null;
}

interface TeamData {
  teamName: string;
  captainEmail: string;
  captainFirstName: string | null;
  captainLastName: string | null;
  members: TeamMember[];
}

function parseSubmissionCSV(filePath: string): Map<string, string> {
  const content = readFileSync(filePath, "utf-8");
  const rows = parse(content, {
    columns: true,
    skip_empty_lines: true,
    relax_quotes: true,
    relax_column_count: true,
  });

  // Map team name (lowercase) -> captain email
  const teamCaptains = new Map<string, string>();
  for (const row of rows) {
    const name = row["Team Name"]?.trim();
    const email = row["Email of the Team Captain"]?.trim().toLowerCase();
    if (name && email) {
      const key = name.toLowerCase();
      if (!teamCaptains.has(key)) {
        teamCaptains.set(key, email);
      }
    }
  }
  return teamCaptains;
}

function parseMemberField(value: string): TeamMember | null {
  if (!value?.trim()) return null;

  // Format: "FirstName, LastName, email@example.com"
  // Some entries are incomplete: just "FirstName LastName" or "FirstName"
  const parts = value.split(",").map((s) => s.trim());

  if (parts.length >= 3) {
    return {
      firstName: parts[0],
      lastName: parts[1],
      email: parts[2].toLowerCase(),
    };
  } else if (parts.length === 2) {
    // Could be "FirstName, LastName" or "FirstName LastName, email"
    if (parts[1].includes("@")) {
      const nameParts = parts[0].split(" ");
      return {
        firstName: nameParts[0],
        lastName: nameParts.slice(1).join(" ") || "",
        email: parts[1].toLowerCase(),
      };
    }
    return {
      firstName: parts[0],
      lastName: parts[1],
      email: null,
    };
  } else if (parts.length === 1) {
    const nameParts = parts[0].split(" ");
    return {
      firstName: nameParts[0],
      lastName: nameParts.slice(1).join(" ") || "",
      email: null,
    };
  }

  return null;
}

function parseApplicationCSV(
  filePath: string
): Map<string, { firstName: string; lastName: string; members: TeamMember[] }> {
  const content = readFileSync(filePath, "utf-8");
  const rows = parse(content, {
    columns: false,
    skip_empty_lines: true,
    relax_quotes: true,
    relax_column_count: true,
    from_line: 2, // skip header
  });

  // Map email -> { firstName, lastName, members[] }
  const applicants = new Map<
    string,
    { firstName: string; lastName: string; members: TeamMember[] }
  >();

  for (const row of rows) {
    const firstName = row[3]?.trim();
    const lastName = row[4]?.trim();
    const email = row[5]?.trim().toLowerCase();
    if (!email) continue;

    const members: TeamMember[] = [];
    for (const idx of [25, 26, 27, 28]) {
      const member = parseMemberField(row[idx]);
      if (member) members.push(member);
    }

    // Keep first application per email
    if (!applicants.has(email)) {
      applicants.set(email, { firstName, lastName, members });
    }
  }

  return applicants;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const csvFiles = args.filter((a) => !a.startsWith("--"));

  if (csvFiles.length < 2) {
    console.error(
      "Usage: npx tsx scripts/import-team-members.ts <submission-csv> <application-csv> [--dry-run]"
    );
    process.exit(1);
  }

  const [submissionFile, applicationFile] = csvFiles;

  console.log("Parsing CSVs...");
  const teamCaptains = parseSubmissionCSV(submissionFile);
  const applicants = parseApplicationCSV(applicationFile);
  console.log(
    `  ${teamCaptains.size} teams from submissions, ${applicants.size} applicants`
  );

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // Get all teams from DB
  const { data: dbTeams } = await supabase
    .from("teams")
    .select("id, name")
    .order("name");

  if (!dbTeams || dbTeams.length === 0) {
    console.error("No teams found in database.");
    process.exit(1);
  }

  console.log(`\n${dbTeams.length} teams in database.\n`);

  let profilesCreated = 0;
  let membersLinked = 0;
  let captainsLinked = 0;
  let skipped = 0;

  for (const team of dbTeams) {
    const captainEmail = teamCaptains.get(team.name.toLowerCase());
    if (!captainEmail) {
      console.log(`  [SKIP] ${team.name}: no captain email found in CSV`);
      skipped++;
      continue;
    }

    const applicant = applicants.get(captainEmail);
    const captainFirst = applicant?.firstName || captainEmail.split("@")[0];
    const captainLast = applicant?.lastName || "";

    // Collect all people for this team: captain + members
    const people: { firstName: string; lastName: string; email: string; role: "president" | "member" }[] = [];

    // Captain
    people.push({
      firstName: captainFirst,
      lastName: captainLast,
      email: captainEmail,
      role: "president",
    });

    // Members from application
    if (applicant?.members) {
      for (const m of applicant.members) {
        if (m.email && m.email !== captainEmail) {
          people.push({
            firstName: m.firstName,
            lastName: m.lastName,
            email: m.email,
            role: "member",
          });
        }
      }
    }

    console.log(
      `  [${team.name}] captain: ${captainEmail}, ${people.length - 1} members`
    );

    if (dryRun) continue;

    for (const person of people) {
      // Find or create profile
      let { data: profile } = await supabase
        .from("profiles")
        .select("id")
        .eq("email", person.email)
        .single();

      if (!profile) {
        // Create auth user first (needed for profile FK)
        const { data: authUser, error: authError } =
          await supabase.auth.admin.createUser({
            email: person.email,
            email_confirm: true,
            user_metadata: {
              name: `${person.firstName} ${person.lastName}`.trim(),
            },
          });

        if (authError) {
          // User might already exist in auth but not in profiles
          const { data: existingUsers } =
            await supabase.auth.admin.listUsers();
          const existing = existingUsers?.users?.find(
            (u) => u.email === person.email
          );
          if (existing) {
            // Create profile for existing auth user
            await supabase.from("profiles").upsert({
              id: existing.id,
              email: person.email,
              name: `${person.firstName} ${person.lastName}`.trim(),
              role: "participant",
            });
            profile = { id: existing.id };
          } else {
            console.log(
              `    [WARN] Could not create user for ${person.email}: ${authError.message}`
            );
            continue;
          }
        } else if (authUser?.user) {
          // Create profile
          await supabase.from("profiles").upsert({
            id: authUser.user.id,
            email: person.email,
            name: `${person.firstName} ${person.lastName}`.trim(),
            role: "participant",
          });
          profile = { id: authUser.user.id };
          profilesCreated++;
        }
      }

      if (!profile) continue;

      // Link to team
      const { error: memberError } = await supabase
        .from("team_members")
        .upsert(
          {
            team_id: team.id,
            user_id: profile.id,
            role: person.role,
          },
          { onConflict: "team_id,user_id" }
        );

      if (memberError) {
        console.log(
          `    [WARN] Could not link ${person.email} to ${team.name}: ${memberError.message}`
        );
      } else {
        if (person.role === "president") {
          captainsLinked++;
          // Also set president_user_id on team
          await supabase
            .from("teams")
            .update({ president_user_id: profile.id })
            .eq("id", team.id);
        } else {
          membersLinked++;
        }
      }
    }
  }

  console.log("\n--- Summary ---");
  console.log(`  Profiles created: ${profilesCreated}`);
  console.log(`  Captains linked: ${captainsLinked}`);
  console.log(`  Members linked: ${membersLinked}`);
  console.log(`  Teams skipped (no CSV match): ${skipped}`);
  if (dryRun) console.log("  (DRY RUN - no changes made)");
}

main().catch(console.error);
