#!/usr/bin/env python3
"""
EHL Production Cleanup + Batch Import (Optimized)
==================================================
Uses batched SQL via Supabase Management API (~8 requests total).
Imports 510+ users, 99 teams, 510 applications, 99 scores.

Usage:
  python3 scripts/cleanup-production.py --dry-run
  python3 scripts/cleanup-production.py --execute [--yes]
  python3 scripts/cleanup-production.py --verify
"""

import csv
import json
import os
import re
import sys
import subprocess
import uuid

# ─── Configuration ───────────────────────────────────────

PROD_REF = "fdoeygfcjllrzogoymsf"
INIT_DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "init-data")
GUESTS_CSV = os.path.join(INIT_DATA, "TUM.ai Makeathon 2026 - Guests - 2026-05-21-09-45-58.csv")
TALLY_CSV = os.path.join(INIT_DATA, "Application for TUM.ai Makeathon 2026_Submissions_2026-05-21.csv")
SUBS_CSV = os.path.join(INIT_DATA, "Final Submission_ Makeathon 2026_Submissions_2026-05-21.csv")

ADMIN_EMAILS = {"julian.sikora@tum-ai.com", "makeathon@tum-ai.com", "e2e-admin@test-ehl.com"}

# Winners: challenge_name (as in submission CSV) -> [(placement, team_name_in_csv)]
WINNERS = {
    "Spherecast": [(1,"bussies"),(2,"Harissa"),(3,"Default Name"),(4,"ASM"),(5,"Optily")],
    "Osapiens": [(1,"Non Deterministic"),(2,"Aguacates"),(3,"OMEGA-EARTH"),(4,"error404.ai"),(5,"GeoPixels")],
    "reply": [(1,"TakeTheMoneyAndRun"),(2,"AgenTUM"),(3,"y/agent"),(4,"StudiClaw"),(5,"5 heads")],
    "HappyRobot": [(1,"Multiply"),(2,"Yantra"),(3,"AskOnce"),(4,"Clerque"),(5,"undeterministic tornado")],
}
PLACEMENT_POINTS = {1: 8, 2: 7, 3: 6, 4: 4, 5: 4}

MUNICH_CHALLENGES = [
    ("Spherecast", "Spherecast", 1),
    ("Osapiens", "Osapiens", 2),
    ("reply", "Reply", 3),
    ("HappyRobot", "HappyRobot", 4),
]

# ─── Helpers ─────────────────────────────────────────────

def slugify(name):
    return re.sub(r"^-|-$", "", re.sub(r"[^a-z0-9]+", "-", name.lower()))

def esc(s):
    """Escape a value for use in SQL string literals. Prevents SQL injection."""
    if s is None: return ""
    s = str(s)
    s = s.replace("'", "''")       # Single quotes
    s = s.replace("\\", "\\\\")    # Backslashes
    s = s.replace("\x00", "")      # Null bytes
    s = s.replace("\n", " ")       # Newlines -> space
    s = s.replace("\r", "")        # Carriage returns
    return s

def load_config():
    root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
    env = {}
    for f in [".env.supabase", ".env.local"]:
        path = os.path.join(root, f)
        if os.path.exists(path):
            with open(path) as fh:
                for line in fh:
                    line = line.strip()
                    if line and not line.startswith("#") and "=" in line:
                        k, v = line.split("=", 1)
                        env[k.strip()] = v.strip()
    token = env.get("SUPABASE_ACCESS_TOKEN")
    if not token:
        print("ERROR: SUPABASE_ACCESS_TOKEN not found"); sys.exit(1)
    return token

def sql_exec(sql, token, label=""):
    """Execute SQL via Management API. Returns parsed JSON or None on error."""
    if label:
        print(f"  [{label}] Sending {len(sql)//1024}KB SQL...")
    result = subprocess.run(
        ["curl", "-s", "-X", "POST",
         f"https://api.supabase.com/v1/projects/{PROD_REF}/database/query",
         "-H", f"Authorization: Bearer {token}",
         "-H", "Content-Type: application/json",
         "-d", json.dumps({"query": sql})],
        capture_output=True, text=True, timeout=120
    )
    try:
        data = json.loads(result.stdout)
    except (json.JSONDecodeError, Exception) as e:
        print(f"  ERROR: Failed to parse response: {str(e)[:200]}")
        print(f"  Response: {result.stdout[:500]}")
        return None
    if isinstance(data, dict) and ("message" in data or "error" in data):
        msg = data.get("message") or data.get("error", "")
        print(f"  SQL ERROR: {str(msg)[:500]}")
        return None
    if label:
        print(f"  [{label}] OK")
    return data

# ─── CSV Loaders ─────────────────────────────────────────

def load_guests():
    guests = {}
    with open(GUESTS_CSV, encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            if row["checked_in_at"].strip():
                email = row["email"].strip().lower()
                guests[email] = {
                    "first_name": row.get("first_name", "").strip(),
                    "last_name": row.get("last_name", "").strip(),
                    "checked_in_at": row["checked_in_at"].strip(),
                }
    return guests

def load_tally():
    apps = {}
    with open(TALLY_CSV, encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            email = row.get("Email", "").strip().lower()
            if not email: continue
            submitted = row.get("Submitted at", "")
            if email in apps and submitted <= apps[email].get("_sub", ""):
                continue
            row["_sub"] = submitted
            apps[email] = row
    return apps

def load_submissions():
    by_captain = {}
    with open(SUBS_CSV, encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            email = row.get("Email of the Team Captain", "").strip().lower()
            team = row.get("Team Name", "").strip()
            submitted = row.get("Submitted at", "")
            if email and team:
                if email not in by_captain or submitted > by_captain[email].get("Submitted at", ""):
                    by_captain[email] = row
    return list(by_captain.values())

def build_form_data(tally_row):
    def get(col): return (tally_row.get(col) or "").strip()
    def get_bool(col): return get(col).lower() in ("yes", "true", "1")

    location = get("Current location (City, Country)")
    city, country = (location.rsplit(",", 1) + [""])[:2]
    city, country = city.strip(), country.strip()

    uni = get("What is the name of your university")
    if uni.lower() == "other": uni = get("Other") or uni
    degree = get("What degree are you currently pursuing?")
    if degree.lower() == "other": degree = get("Other (2)") or degree
    field = get("What is your field of study?")
    if field.lower() == "other": field = get("Other (3)") or field

    social = get("Any Social Media links that can help to get to know your expertise better?")
    linkedin = social if "linkedin.com" in social.lower() else ""

    sources = []
    for col, label in [
        ("How did you find out about us? (TUM.ai Website)", "TUM.ai Website"),
        ("How did you find out about us? (University)", "University"),
        ("How did you find out about us? (Friends)", "Friends"),
        ("How did you find out about us? (Linkedin)", "LinkedIn"),
        ("How did you find out about us? (Instagram)", "Instagram"),
    ]:
        if get(col).lower() in ("true", "yes"): sources.append(label)

    restrictions = []
    if get("Do you have any dietary restrictions? (Vegetarian)").lower() in ("true","yes"): restrictions.append("Vegetarian")
    if get("Do you have any dietary restrictions? (Vegan)").lower() in ("true","yes"): restrictions.append("Vegan")
    other = get("Other (4)")
    if other: restrictions.append(other)

    return {
        "dateOfBirth": get("Date of Birth") or None,
        "gender": get("Gender") or None,
        "nationality": get("Nationality") or None,
        "city": city or None, "country": country or None,
        "currentlyStudying": get_bool("Are you currently studying at a university?"),
        "university": uni or None, "degree": degree or None,
        "fieldOfStudy": field or None,
        "graduationDate": get("Graduation Date (expected)") or None,
        "hasProgrammingSkills": get_bool("Do you have any programming skills?"),
        "isTumaiMember": get_bool("TUM.ai Member"),
        "hackathonExperience": get("What is your previous experience when it comes to Hackathons or similar events? What do you like about them? (in three sentences)") or "",
        "linkedIn": linkedin or None,
        "github": get("GitHub") or None,
        "website": get("Website/ Blog") or None,
        "hasTeam": get_bool("Do you already have a team? "),
        "dietaryRestrictions": ", ".join(restrictions) if restrictions else "None",
        "tshirtCut": get("Do you want a women's cut t-shirt or a men's cut t-shirt?") or "men's",
        "tshirtSize": get("What is your T-Shirt size?") or "M",
        "discoverySource": sources,
        "additionalNotes": get("Is there anything else you would like to share?") or None,
    }

def parse_team_members(tally_row):
    members = []
    for col in ["Name, Last Name, Email", "Name, Last Name, Email (2)", "Name, Last Name, Email (3)", "Name, Last Name, Email (4)"]:
        val = (tally_row.get(col) or "").strip()
        if not val: continue
        parts = [p.strip() for p in val.split(",")]
        if len(parts) >= 3 and "@" in parts[-1]:
            members.append({"firstName": parts[0], "lastName": parts[1], "email": parts[-1].lower()})
        elif len(parts) >= 2 and "@" in parts[-1]:
            members.append({"firstName": parts[0], "lastName": "", "email": parts[-1].lower()})
    return members

# ─── Main ────────────────────────────────────────────────

def main():
    dry_run = "--dry-run" in sys.argv
    execute = "--execute" in sys.argv
    verify = "--verify" in sys.argv

    if not dry_run and not execute and not verify:
        print("Usage: python3 scripts/cleanup-production.py --dry-run|--execute [--yes]|--verify")
        sys.exit(1)

    token = load_config()

    if verify:
        print("=== Verification ===")
        r = sql_exec("""
            SELECT 'auth_users' as t, count(*)::text as c FROM auth.users
            UNION ALL SELECT 'profiles', count(*)::text FROM profiles
            UNION ALL SELECT 'teams', count(*)::text FROM teams
            UNION ALL SELECT 'team_members', count(*)::text FROM team_members
            UNION ALL SELECT 'applications', count(*)::text FROM applications
            UNION ALL SELECT 'scores_published', count(*)::text FROM scores WHERE published = true
            UNION ALL SELECT 'challenges', count(*)::text FROM challenges
            UNION ALL SELECT 'registrations', count(*)::text FROM challenge_registrations
            UNION ALL SELECT 'partners', count(*)::text FROM partners
            UNION ALL SELECT 'media', count(*)::text FROM media
        """, token)
        if r:
            for row in r: print(f"  {row['t']:25s} {row['c']}")
        r2 = sql_exec("SELECT name, slug, status FROM chapters ORDER BY match_number", token)
        if r2:
            print()
            for row in r2: print(f"  Chapter: {row['name']:15s} {row['status']}")
        r3 = sql_exec("""
            SELECT t.name, s.challenge_name, s.placement, s.points
            FROM scores s JOIN teams t ON s.team_id = t.id
            WHERE s.published = true ORDER BY s.points DESC, s.placement ASC LIMIT 15
        """, token)
        if r3:
            print("\n  Top 15 Leaderboard:")
            for row in r3:
                p = row.get("placement") or "-"
                print(f"    {row['name']:30s} {row['points']:2d}pts  {row['challenge_name']} #{p}")
        return

    # ═══════════════════════════════════════════════════════
    # LOAD DATA
    # ═══════════════════════════════════════════════════════

    print("=== Loading CSV data ===")
    guests = load_guests()
    tally = load_tally()
    submissions = load_submissions()

    print(f"  Checked-in guests: {len(guests)}")
    print(f"  Tally applications: {len(tally)}")
    print(f"  Final submissions (deduped): {len(submissions)}")

    # ═══════════════════════════════════════════════════════
    # COMPUTE IMPORT PLAN (all in Python, no API calls)
    # ═══════════════════════════════════════════════════════

    print("\n=== Computing import plan ===")

    # --- Users ---
    all_emails = set(guests.keys())
    for sub in submissions:
        email = sub.get("Email of the Team Captain", "").strip().lower()
        if email: all_emails.add(email)
    # Remove admins (they already exist)
    import_emails = all_emails - {e.lower() for e in ADMIN_EMAILS}

    # Pre-generate UUIDs for all users
    email_to_uuid = {}
    for email in sorted(import_emails):
        email_to_uuid[email] = str(uuid.uuid4())

    # Get name for each user (prefer Tally, fallback to Luma)
    email_to_name = {}
    for email in import_emails:
        t = tally.get(email)
        g = guests.get(email)
        if t:
            first = t.get("We would love to get a brief idea about you...", "").strip()
            last = t.get("Last name", "").strip()
            name = f"{first} {last}".strip()
        elif g:
            name = f"{g['first_name']} {g['last_name']}".strip()
        else:
            name = email.split("@")[0]
        email_to_name[email] = name or email.split("@")[0]

    print(f"  Users to import: {len(import_emails)}")

    # --- Teams ---
    teams = []
    used_slugs = set()
    team_name_to_uuid = {}

    for sub in submissions:
        team_name = sub.get("Team Name", "").strip()
        captain_email = sub.get("Email of the Team Captain", "").strip().lower()
        challenge = sub.get("What Challenge did you work on?", "").strip()

        slug = slugify(team_name)
        if slug in used_slugs:
            slug = slug + "-2"
        if slug in used_slugs:
            slug = slug + "-3"
        used_slugs.add(slug)

        team_uuid = str(uuid.uuid4())
        captain_uuid = email_to_uuid.get(captain_email)
        if not captain_uuid:
            # Admin might be captain
            continue

        team_name_to_uuid[team_name.lower()] = team_uuid
        teams.append({
            "id": team_uuid, "name": team_name, "slug": slug,
            "captain_uuid": captain_uuid, "challenge": challenge,
        })

    print(f"  Teams to import: {len(teams)}")

    # --- Winner matching ---
    winner_scores = []
    winner_team_ids = set()
    missing_winners = []

    for challenge, placements in WINNERS.items():
        for placement, team_name in placements:
            team_uuid = team_name_to_uuid.get(team_name.lower())
            if not team_uuid:
                missing_winners.append(f"{challenge} #{placement}: {team_name}")
                continue
            winner_scores.append({
                "team_id": team_uuid, "challenge": challenge,
                "placement": placement, "points": PLACEMENT_POINTS[placement],
            })
            winner_team_ids.add(team_uuid)

    # Participation scores
    participation_scores = []
    for t in teams:
        if t["id"] not in winner_team_ids:
            participation_scores.append({"team_id": t["id"]})

    print(f"  Winner scores: {len(winner_scores)}/20 matched")
    if missing_winners:
        print(f"  MISSING WINNERS:")
        for w in missing_winners:
            print(f"    ! {w}")
    print(f"  Participation scores: {len(participation_scores)}")

    # --- Applications ---
    app_count = len(guests)
    app_with_tally = len(set(guests.keys()) & set(tally.keys()))
    print(f"  Applications: {app_count} ({app_with_tally} with Tally data)")

    # ═══════════════════════════════════════════════════════
    # SUMMARY
    # ═══════════════════════════════════════════════════════

    print(f"""
{'='*55}
SUMMARY
{'='*55}
  NUKE: Delete all test data, all challenges (cleanup duplicates)
  IMPORT:
    {len(import_emails)} auth.users + profiles (batch SQL, 1 request)
    {len(teams)} teams + members + registrations (batch SQL, 1 request)
    {app_count} applications (batch SQL, 1-2 requests)
    {len(winner_scores)} winner + {len(participation_scores)} participation scores (1 request)
  FINALIZE: Munich=completed, others=announced, re-enable trigger
  Estimated: ~8 API calls, ~30 seconds total
""")

    if dry_run:
        print("=== DRY RUN COMPLETE ===")
        return

    if "--yes" not in sys.argv:
        confirm = input("Type YES to execute on PRODUCTION: ")
        if confirm != "YES":
            print("Aborted."); return

    # ═══════════════════════════════════════════════════════
    # EXECUTE
    # ═══════════════════════════════════════════════════════

    admin_list = ",".join(f"'{esc(e)}'" for e in ADMIN_EMAILS)

    # --- Call 1: NUKE ---
    print("\n[1/8] Nuking test data...")
    nuke_sql = f"""
    BEGIN;
    DROP TRIGGER IF EXISTS event_log_no_update ON event_log;
    DELETE FROM event_log;
    DELETE FROM admin_audit_log;
    DELETE FROM screening_scores;
    DELETE FROM jury_rankings;
    DELETE FROM jury_feedback;
    DELETE FROM jury_assignments;
    DELETE FROM pitch_orders;
    DELETE FROM code_reviews;
    DELETE FROM submissions;
    DELETE FROM challenge_registrations;
    DELETE FROM applications;
    DELETE FROM scores;
    DELETE FROM verification_codes;
    DELETE FROM team_invites;
    DELETE FROM team_join_requests;
    DELETE FROM chapter_unlocks;
    DELETE FROM participant_flags;
    DELETE FROM team_members;
    UPDATE teams SET president_user_id = NULL;
    DELETE FROM teams;
    DELETE FROM profiles WHERE email NOT IN ({admin_list});
    DELETE FROM auth.users WHERE email NOT IN ({admin_list});
    DELETE FROM challenges;
    COMMIT;
    """
    r = sql_exec(nuke_sql, token, "NUKE")
    if r is None:
        print("NUKE failed! Aborting."); return

    # --- Call 2: Munich chapters + challenges ---
    print("\n[2/8] Getting Munich chapter ID + creating challenges...")
    r = sql_exec("SELECT id FROM chapters WHERE slug = 'munich-1'", token)
    if not r or len(r) == 0:
        print("Munich chapter not found!"); return
    munich_id = r[0]["id"]

    challenge_values = ", ".join(
        f"('{munich_id}', '{esc(title)}', '{esc(sponsor)}', {order})"
        for title, sponsor, order in MUNICH_CHALLENGES
    )
    sql_exec(f"""
        INSERT INTO challenges (chapter_id, title, sponsor_name, display_order)
        VALUES {challenge_values}
    """, token, "Challenges INSERT")

    r = sql_exec(f"SELECT id, title FROM challenges WHERE chapter_id = '{munich_id}'", token)
    if not r:
        print("Failed to get challenge IDs!"); return
    challenge_map = {row["title"]: row["id"] for row in r}
    print(f"  Challenges: {list(challenge_map.keys())}")

    # --- Call 3: auth.users batch ---
    print(f"\n[3/8] Batch creating {len(import_emails)} auth.users...")

    user_values = []
    for email in sorted(import_emails):
        uid = email_to_uuid[email]
        name = email_to_name[email]
        meta = json.dumps({"name": name}).replace("'", "''")
        user_values.append(
            f"('{uid}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', "
            f"'{esc(email)}', crypt('ehl-imported-2026', gen_salt('bf')), now(), "
            f"'{{\"provider\":\"email\",\"providers\":[\"email\"]}}'::jsonb, "
            f"'{meta}'::jsonb, now(), now(), false, false)"
        )

    auth_sql = f"""
    INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
        email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
        is_sso_user, is_anonymous)
    VALUES
    {','.join(user_values)};
    """
    r = sql_exec(auth_sql, token, "auth.users")
    if r is None:
        print("auth.users batch failed! Aborting."); return

    # --- Call 4: profiles batch ---
    print(f"\n[4/8] Batch creating {len(import_emails)} profiles...")

    profile_values = []
    for email in sorted(import_emails):
        uid = email_to_uuid[email]
        name = email_to_name[email]
        profile_values.append(f"('{uid}', '{esc(email)}', '{esc(name)}', 'participant')")

    profiles_sql = f"""
    INSERT INTO profiles (id, email, name, role)
    VALUES {','.join(profile_values)}
    ON CONFLICT (id) DO NOTHING;
    """
    r = sql_exec(profiles_sql, token, "profiles")
    if r is None:
        print("profiles batch failed! Aborting."); return

    # --- Call 5: teams + members + registrations ---
    print(f"\n[5/8] Batch creating {len(teams)} teams + members + registrations...")

    team_values = []
    member_values = []
    reg_values = []

    for t in teams:
        team_values.append(
            f"('{t['id']}', '{esc(t['name'])}', '{esc(t['slug'])}', '{t['captain_uuid']}', 'active')"
        )
        member_values.append(
            f"('{t['id']}', '{t['captain_uuid']}', 'president')"
        )
        ch_id = challenge_map.get(t["challenge"])
        if ch_id:
            reg_values.append(f"('{munich_id}', '{t['id']}', '{ch_id}')")

    teams_sql = f"""
    BEGIN;
    INSERT INTO teams (id, name, slug, president_user_id, status)
    VALUES {','.join(team_values)};

    INSERT INTO team_members (team_id, user_id, role)
    VALUES {','.join(member_values)};

    INSERT INTO challenge_registrations (chapter_id, team_id, challenge_id)
    VALUES {','.join(reg_values)};
    COMMIT;
    """
    r = sql_exec(teams_sql, token, "teams+members+regs")
    if r is None:
        print("Teams batch failed!"); return

    # --- Call 6: applications batch ---
    # Get admin user ID for checked_in_by
    admin_r = sql_exec("SELECT id FROM profiles WHERE email = 'julian.sikora@tum-ai.com'", token)
    admin_id = admin_r[0]["id"] if admin_r and len(admin_r) > 0 else "NULL"

    print(f"\n[6/8] Batch creating {len(guests)} applications...")

    app_values = []
    for email, guest in sorted(guests.items()):
        t = tally.get(email)
        if t:
            first = esc(t.get("We would love to get a brief idea about you...", "").strip() or guest["first_name"])
            last = esc(t.get("Last name", "").strip() or guest["last_name"])
            fd = json.dumps(build_form_data(t)).replace("'", "''")
            tm = json.dumps(parse_team_members(t)).replace("'", "''")
            c_att = t.get("Consent Attendance (Confirm)", "").lower() in ("true", "yes")
            c_priv = t.get("Consent Data Privacy (Confirm)", "").lower() in ("true", "yes")
            c_news = t.get("Consent Newsletter (Confirm)", "").lower() in ("true", "yes")
            c_rec = t.get("Consent Recruiting (Confirm)", "").lower() in ("true", "yes")
        else:
            first = esc(guest["first_name"])
            last = esc(guest["last_name"])
            fd = "{}"
            tm = "[]"
            c_att, c_priv, c_news, c_rec = True, True, False, False

        checked_in_at = esc(guest["checked_in_at"])
        admin_ref = f"'{admin_id}'" if admin_id != "NULL" else "NULL"

        app_values.append(
            f"('{munich_id}', '{esc(email)}', '{first}', '{last}', 'checked_in', "
            f"'{fd}'::jsonb, '{tm}'::jsonb, "
            f"{str(c_att).lower()}, {str(c_priv).lower()}, {str(c_news).lower()}, {str(c_rec).lower()}, "
            f"true, true, true, "
            f"'{checked_in_at}', {admin_ref})"
        )

    # Split into chunks if needed (each chunk ~250 rows)
    chunk_size = 250
    for i in range(0, len(app_values), chunk_size):
        chunk = app_values[i:i+chunk_size]
        chunk_label = f"applications {i+1}-{i+len(chunk)}/{len(app_values)}"
        app_sql = f"""
        INSERT INTO applications (
            chapter_id, email, first_name, last_name, status,
            form_data, team_members,
            consent_attendance, consent_privacy, consent_newsletter, consent_recruiting,
            consent_media, consent_ip_transfer, consent_sponsor_data,
            checked_in_at, checked_in_by
        ) VALUES {','.join(chunk)}
        ON CONFLICT (chapter_id, email) DO NOTHING;
        """
        r = sql_exec(app_sql, token, chunk_label)
        if r is None:
            print(f"  Applications chunk {i} failed!")

    # --- Call 7: scores batch ---
    print(f"\n[7/8] Batch creating {len(winner_scores) + len(participation_scores)} scores...")

    score_values = []
    for s in winner_scores:
        score_values.append(
            f"('{munich_id}', '{s['team_id']}', '{esc(s['challenge'])}', {s['placement']}, {s['points']}, 'jury', true, now())"
        )
    for s in participation_scores:
        score_values.append(
            f"('{munich_id}', '{s['team_id']}', 'Participation', NULL, 2, 'admin_override', true, now())"
        )

    scores_sql = f"""
    INSERT INTO scores (chapter_id, team_id, challenge_name, placement, points, source, published, published_at)
    VALUES {','.join(score_values)}
    ON CONFLICT (chapter_id, team_id) DO UPDATE SET
        challenge_name = EXCLUDED.challenge_name,
        placement = EXCLUDED.placement,
        points = EXCLUDED.points,
        source = EXCLUDED.source,
        published = true,
        published_at = now();
    """
    r = sql_exec(scores_sql, token, "scores")
    if r is None:
        print("Scores batch failed!")

    # --- Call 8: finalize ---
    print(f"\n[8/8] Finalizing...")
    sql_exec("""
        UPDATE chapters SET status = 'completed' WHERE slug = 'munich-1';
        UPDATE chapters SET status = 'announced' WHERE slug != 'munich-1' AND status = 'draft' AND slug != 'berlin';
        CREATE TRIGGER event_log_no_update
            BEFORE UPDATE OR DELETE ON event_log
            FOR EACH ROW EXECUTE FUNCTION prevent_event_log_mutation();
        NOTIFY pgrst, 'reload schema';
    """, token, "finalize")

    # --- Verify ---
    print(f"\n{'='*55}")
    print("IMPORT COMPLETE - Running verification...")
    print(f"{'='*55}\n")

    r = sql_exec("""
        SELECT 'auth_users' as t, count(*)::text as c FROM auth.users
        UNION ALL SELECT 'profiles', count(*)::text FROM profiles
        UNION ALL SELECT 'teams', count(*)::text FROM teams
        UNION ALL SELECT 'team_members', count(*)::text FROM team_members
        UNION ALL SELECT 'applications', count(*)::text FROM applications
        UNION ALL SELECT 'scores_published', count(*)::text FROM scores WHERE published = true
        UNION ALL SELECT 'challenges', count(*)::text FROM challenges
        UNION ALL SELECT 'registrations', count(*)::text FROM challenge_registrations
        UNION ALL SELECT 'partners', count(*)::text FROM partners
    """, token)
    if r:
        for row in r: print(f"  {row['t']:25s} {row['c']}")

    print(f"\nNEXT STEPS:")
    print(f"  1. Check ehl.gg - homepage loads")
    print(f"  2. Check ehl.gg/leaderboard - correct rankings")
    print(f"  3. Check ehl.gg/matches - Munich=completed, rest=announced")
    print(f"  4. Supabase Dashboard -> Backups -> Create snapshot")

if __name__ == "__main__":
    main()
