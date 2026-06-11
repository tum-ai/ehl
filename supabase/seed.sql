-- EHL Test Seed Data
-- Run with: psql ... -f supabase/seed.sql
-- Cleans existing test data and inserts a full scenario.
--
-- Scenario:
--   Chapter 1 (Munich):  completed, scores published, full results
--   Chapter 2 (Zurich):  registration_open, challenges + unlocks, applications
--   Chapter 3 (Berlin):  draft, minimal data
--   6 teams, 3 chapters, 4 challenges, scores, applications, jury assignments

BEGIN;

-- ═══════════════════════════════════════════════════════════════
-- CLEANUP (reverse dependency order)
-- ═══════════════════════════════════════════════════════════════

DELETE FROM screening_scores;
DELETE FROM team_join_requests;
DELETE FROM applications;
DELETE FROM jury_feedback;
DELETE FROM jury_rankings;
DELETE FROM jury_assignments;
DELETE FROM pitch_orders;
DELETE FROM code_reviews;
DELETE FROM submissions;
DELETE FROM challenge_registrations;
DELETE FROM challenges;
DELETE FROM scores;
DELETE FROM media;
DELETE FROM partners;
DELETE FROM team_members;
DELETE FROM teams;
DELETE FROM chapters;
DELETE FROM profiles;

-- ═══════════════════════════════════════════════════════════════
-- PROFILES (IDs must match auth.users if they exist)
-- For test purposes we insert directly; in prod these come from auth
-- ═══════════════════════════════════════════════════════════════

-- Admin
INSERT INTO profiles (id, name, email, role) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'Admin User', 'admin@example.com', 'admin');

-- Jury
INSERT INTO profiles (id, name, email, role) VALUES
  ('b0000000-0000-0000-0000-000000000001', 'Jury Alpha', 'jury1@example.com', 'jury'),
  ('b0000000-0000-0000-0000-000000000002', 'Jury Beta', 'jury2@example.com', 'jury');

-- Participants (presidents + members)
INSERT INTO profiles (id, name, email, role) VALUES
  -- Team 1: Alpha Innovators
  ('c0000000-0000-0000-0000-000000000001', 'Alice Mueller', 'alice@example.com', 'participant'),
  ('c0000000-0000-0000-0000-000000000002', 'Bob Schmidt', 'bob@example.com', 'participant'),
  ('c0000000-0000-0000-0000-000000000003', 'Clara Weber', 'clara@example.com', 'participant'),
  -- Team 2: Beta Hackers
  ('c0000000-0000-0000-0000-000000000004', 'David Chen', 'david@example.com', 'participant'),
  ('c0000000-0000-0000-0000-000000000005', 'Eva Rossi', 'eva@example.com', 'participant'),
  ('c0000000-0000-0000-0000-000000000006', 'Felix Braun', 'felix@example.com', 'participant'),
  -- Team 3: Gamma Coders
  ('c0000000-0000-0000-0000-000000000007', 'Gina Park', 'gina@example.com', 'participant'),
  ('c0000000-0000-0000-0000-000000000008', 'Hiro Tanaka', 'hiro@example.com', 'participant'),
  -- Team 4: Delta Builders
  ('c0000000-0000-0000-0000-000000000009', 'Isla Martin', 'isla@example.com', 'participant'),
  ('c0000000-0000-0000-0000-000000000010', 'Jan Novak', 'jan@example.com', 'participant'),
  ('c0000000-0000-0000-0000-000000000011', 'Kira Sokolov', 'kira@example.com', 'participant'),
  -- Team 5: Epsilon Devs
  ('c0000000-0000-0000-0000-000000000012', 'Leo Hoffmann', 'leo@example.com', 'participant'),
  ('c0000000-0000-0000-0000-000000000013', 'Mia Becker', 'mia@example.com', 'participant'),
  -- Team 6: Zeta Tech
  ('c0000000-0000-0000-0000-000000000014', 'Nina Wagner', 'nina@example.com', 'participant'),
  ('c0000000-0000-0000-0000-000000000015', 'Oscar Lehmann', 'oscar@example.com', 'participant'),
  ('c0000000-0000-0000-0000-000000000016', 'Paula Fischer', 'paula@example.com', 'participant');

-- ═══════════════════════════════════════════════════════════════
-- TEAMS
-- ═══════════════════════════════════════════════════════════════

INSERT INTO teams (id, name, slug, university, city, president_user_id) VALUES
  ('d0000000-0000-0000-0000-000000000001', 'Alpha Innovators', 'alpha-innovators', 'University of Munich', 'Munich', 'c0000000-0000-0000-0000-000000000001'),
  ('d0000000-0000-0000-0000-000000000002', 'Beta Hackers', 'beta-hackers', 'University of Zurich', 'Zurich', 'c0000000-0000-0000-0000-000000000004'),
  ('d0000000-0000-0000-0000-000000000003', 'Gamma Coders', 'gamma-coders', 'University of Karlsruhe', 'Karlsruhe', 'c0000000-0000-0000-0000-000000000007'),
  ('d0000000-0000-0000-0000-000000000004', 'Delta Builders', 'delta-builders', 'University of Munich South', 'Munich', 'c0000000-0000-0000-0000-000000000009'),
  ('d0000000-0000-0000-0000-000000000005', 'Epsilon Devs', 'epsilon-devs', 'University of Berlin', 'Berlin', 'c0000000-0000-0000-0000-000000000012'),
  ('d0000000-0000-0000-0000-000000000006', 'Zeta Tech', 'zeta-tech', 'University of Aachen', 'Aachen', 'c0000000-0000-0000-0000-000000000014');

-- ═══════════════════════════════════════════════════════════════
-- TEAM MEMBERS
-- ═══════════════════════════════════════════════════════════════

INSERT INTO team_members (team_id, user_id, role) VALUES
  -- TUM.ai Innovators (3 members)
  ('d0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'president'),
  ('d0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002', 'member'),
  ('d0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000003', 'member'),
  -- ETH Zurich Hackers (3 members)
  ('d0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000004', 'president'),
  ('d0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000005', 'member'),
  ('d0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000006', 'member'),
  -- KIT Coders (2 members)
  ('d0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000007', 'president'),
  ('d0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000008', 'member'),
  -- LMU Builders (3 members)
  ('d0000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-000000000009', 'president'),
  ('d0000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-000000000010', 'member'),
  ('d0000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-000000000011', 'member'),
  -- TU Berlin Devs (2 members)
  ('d0000000-0000-0000-0000-000000000005', 'c0000000-0000-0000-0000-000000000012', 'president'),
  ('d0000000-0000-0000-0000-000000000005', 'c0000000-0000-0000-0000-000000000013', 'member'),
  -- RWTH Aachen Tech (3 members)
  ('d0000000-0000-0000-0000-000000000006', 'c0000000-0000-0000-0000-000000000014', 'president'),
  ('d0000000-0000-0000-0000-000000000006', 'c0000000-0000-0000-0000-000000000015', 'member'),
  ('d0000000-0000-0000-0000-000000000006', 'c0000000-0000-0000-0000-000000000016', 'member');

-- ═══════════════════════════════════════════════════════════════
-- CHAPTERS
-- ═══════════════════════════════════════════════════════════════

INSERT INTO chapters (id, name, slug, city, country, country_code, date, date_end, status, description, match_number, is_finale, challenge_registration_enabled) VALUES
  ('e0000000-0000-0000-0000-000000000001', 'Match 1', 'munich-1', 'Munich', 'Germany', 'DE', '2026-04-17', '2026-04-19', 'completed', 'The first EHL match, hosted in Munich.', 1, false, false),
  ('e0000000-0000-0000-0000-000000000002', 'Match 2', 'zurich-2', 'Zurich', 'Switzerland', 'CH', '2026-06-14', '2026-06-15', 'challenge_selection', 'Second match of the season in Zurich.', 2, false, true),
  ('e0000000-0000-0000-0000-000000000003', 'Match 3', 'berlin-3', 'Berlin', 'Germany', 'DE', '2026-09-01', NULL, 'draft', 'Third match planned for Berlin.', 3, false, false);

-- ═══════════════════════════════════════════════════════════════
-- CHALLENGES
-- ═══════════════════════════════════════════════════════════════

INSERT INTO challenges (id, chapter_id, title, description, sponsor_name, submission_fields, display_order) VALUES
  -- Match 1
  ('f0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 'AI for Good', 'Build an AI solution for social impact.', 'TechCorp',
   '[{"key":"repo","label":"GitHub Repository","type":"url","required":true},{"key":"deck","label":"Pitch Deck","type":"file","required":true,"accept":".pdf,.pptx"}]', 1),
  ('f0000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-000000000001', 'Green Innovation', 'Create a sustainable technology solution.', 'EcoTech',
   '[{"key":"repo","label":"GitHub Repository","type":"url","required":true},{"key":"demo","label":"Live Demo","type":"url","required":false}]', 2),
  -- Match 2
  ('f0000000-0000-0000-0000-000000000003', 'e0000000-0000-0000-0000-000000000002', 'Smart City', 'Design smart solutions for urban living.', 'UrbanAI',
   '[{"key":"repo","label":"GitHub Repository","type":"url","required":true}]', 1),
  ('f0000000-0000-0000-0000-000000000004', 'e0000000-0000-0000-0000-000000000002', 'HealthTech', 'Innovate in healthcare technology.', 'MediCode',
   '[{"key":"repo","label":"GitHub Repository","type":"url","required":true}]', 2);

-- ═══════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════
-- CHALLENGE REGISTRATIONS
-- ═══════════════════════════════════════════════════════════════

INSERT INTO challenge_registrations (id, chapter_id, challenge_id, team_id, roster) VALUES
  -- Match 1: AI for Good (3 teams)
  ('10000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001',
   '["c0000000-0000-0000-0000-000000000001","c0000000-0000-0000-0000-000000000002","c0000000-0000-0000-0000-000000000003"]'),
  ('10000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000002',
   '["c0000000-0000-0000-0000-000000000004","c0000000-0000-0000-0000-000000000005","c0000000-0000-0000-0000-000000000006"]'),
  ('10000000-0000-0000-0000-000000000003', 'e0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000005',
   '["c0000000-0000-0000-0000-000000000012","c0000000-0000-0000-0000-000000000013"]'),
  -- Match 1: Green Innovation (3 teams)
  ('10000000-0000-0000-0000-000000000004', 'e0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000003',
   '["c0000000-0000-0000-0000-000000000007","c0000000-0000-0000-0000-000000000008"]'),
  ('10000000-0000-0000-0000-000000000005', 'e0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000004',
   '["c0000000-0000-0000-0000-000000000009","c0000000-0000-0000-0000-000000000010","c0000000-0000-0000-0000-000000000011"]'),
  ('10000000-0000-0000-0000-000000000006', 'e0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000006',
   '["c0000000-0000-0000-0000-000000000014","c0000000-0000-0000-0000-000000000015","c0000000-0000-0000-0000-000000000016"]'),
  -- Match 2: Smart City (2 teams)
  ('10000000-0000-0000-0000-000000000007', 'e0000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000001',
   '["c0000000-0000-0000-0000-000000000001","c0000000-0000-0000-0000-000000000002"]'),
  ('10000000-0000-0000-0000-000000000008', 'e0000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000002',
   '["c0000000-0000-0000-0000-000000000004","c0000000-0000-0000-0000-000000000005"]');

-- ═══════════════════════════════════════════════════════════════
-- SUBMISSIONS (Match 1 only)
-- ═══════════════════════════════════════════════════════════════

INSERT INTO submissions (id, challenge_id, team_id, project_name, short_description, fields, tech_stack, is_locked) VALUES
  ('20000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001',
   'EduAI', 'AI-powered tutoring for underserved communities', '{"repo":"https://github.com/tum-ai/edu-ai"}', '["Python","FastAPI","React","OpenAI"]', true),
  ('20000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000002',
   'ClimateBot', 'Chatbot for climate action awareness', '{"repo":"https://github.com/eth/climatebot"}', '["TypeScript","Next.js","Anthropic"]', true),
  ('20000000-0000-0000-0000-000000000003', 'f0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000005',
   'AccessMap', 'Accessibility mapping for wheelchair users', '{"repo":"https://github.com/tuberlin/accessmap"}', '["React Native","Node.js","PostgreSQL"]', true),
  ('20000000-0000-0000-0000-000000000004', 'f0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000003',
   'WasteWise', 'Smart waste sorting with computer vision', '{"repo":"https://github.com/kit/wastewise"}', '["Python","TensorFlow","Flutter"]', true),
  ('20000000-0000-0000-0000-000000000005', 'f0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000004',
   'GreenRoute', 'Eco-friendly route planning', '{"repo":"https://github.com/lmu/greenroute"}', '["Go","Vue.js","OpenStreetMap"]', true),
  ('20000000-0000-0000-0000-000000000006', 'f0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000006',
   'SolarShare', 'Community solar energy sharing platform', '{"repo":"https://github.com/rwth/solarshare"}', '["Rust","Svelte","MQTT"]', true);

-- ═══════════════════════════════════════════════════════════════
-- SCORES (Match 1, published)
-- ═══════════════════════════════════════════════════════════════

INSERT INTO scores (chapter_id, team_id, challenge_name, challenge_id, placement, points, source, published, published_at) VALUES
  ('e0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'AI for Good', 'f0000000-0000-0000-0000-000000000001', 1, 8, 'jury', true, now()),
  ('e0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000002', 'AI for Good', 'f0000000-0000-0000-0000-000000000001', 2, 7, 'jury', true, now()),
  ('e0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000005', 'AI for Good', 'f0000000-0000-0000-0000-000000000001', NULL, 2, 'jury', true, now()),
  ('e0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000003', 'Green Innovation', 'f0000000-0000-0000-0000-000000000002', 3, 6, 'jury', true, now()),
  ('e0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000004', 'Green Innovation', 'f0000000-0000-0000-0000-000000000002', 4, 4, 'jury', true, now()),
  ('e0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000006', 'Green Innovation', 'f0000000-0000-0000-0000-000000000002', NULL, 2, 'jury', true, now());

-- ═══════════════════════════════════════════════════════════════
-- JURY ASSIGNMENTS
-- ═══════════════════════════════════════════════════════════════

INSERT INTO jury_assignments (user_id, challenge_id, chapter_id) VALUES
  ('b0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001'),
  ('b0000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-000000000001'),
  ('b0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000003', 'e0000000-0000-0000-0000-000000000002');

-- ═══════════════════════════════════════════════════════════════
-- JURY RANKINGS + FEEDBACK (Match 1)
-- ═══════════════════════════════════════════════════════════════

INSERT INTO jury_rankings (id, challenge_id, entered_by, ranking, is_final) VALUES
  ('30000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001',
   '{"1":"d0000000-0000-0000-0000-000000000001","2":"d0000000-0000-0000-0000-000000000002"}', true),
  ('30000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000002',
   '{"3":"d0000000-0000-0000-0000-000000000003","4":"d0000000-0000-0000-0000-000000000004"}', true);

-- entered_by is required and part of the PK since migration 00026 (per-juror
-- feedback). Attribute each challenge's feedback to the juror who ranked it.
INSERT INTO jury_feedback (challenge_id, team_id, entered_by, feedback_text) VALUES
  ('f0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'Excellent AI implementation with clear social impact.'),
  ('f0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001', 'Creative approach to climate awareness. Could improve UX.'),
  ('f0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000002', 'Solid computer vision work. Practical and deployable.'),
  ('f0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-000000000002', 'Good concept but execution could be stronger.');

-- ═══════════════════════════════════════════════════════════════
-- PITCH ORDERS (Match 1)
-- ═══════════════════════════════════════════════════════════════

INSERT INTO pitch_orders (challenge_id, order_list, generated_by) VALUES
  ('f0000000-0000-0000-0000-000000000001',
   '["d0000000-0000-0000-0000-000000000002","d0000000-0000-0000-0000-000000000005","d0000000-0000-0000-0000-000000000001"]',
   'a0000000-0000-0000-0000-000000000001'),
  ('f0000000-0000-0000-0000-000000000002',
   '["d0000000-0000-0000-0000-000000000006","d0000000-0000-0000-0000-000000000003","d0000000-0000-0000-0000-000000000004"]',
   'a0000000-0000-0000-0000-000000000001');

-- ═══════════════════════════════════════════════════════════════
-- APPLICATIONS (Match 2, various statuses)
-- ═══════════════════════════════════════════════════════════════

INSERT INTO applications (id, chapter_id, email, first_name, last_name, status, form_data, consent_attendance, consent_privacy, consent_newsletter) VALUES
  ('40000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000002',
   'applicant1@example.com', 'Anna', 'Schneider', 'accepted',
   '{"dateOfBirth":"2000-05-15","gender":"female","nationality":"German","city":"Zurich","country":"Switzerland","currentlyStudying":true,"university":"ETH Zurich","degree":"MSc","fieldOfStudy":"Computer Science","hasProgrammingSkills":true,"isTumaiMember":false,"hackathonExperience":"3 hackathons","tshirtCut":"womens","tshirtSize":"M","dietaryRestrictions":"none","discoverySource":["instagram"]}',
   true, true, true),
  ('40000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-000000000002',
   'applicant2@example.com', 'Ben', 'Keller', 'accepted',
   '{"dateOfBirth":"2001-03-22","gender":"male","nationality":"Swiss","city":"Zurich","country":"Switzerland","currentlyStudying":true,"university":"ETH Zurich","degree":"BSc","fieldOfStudy":"Electrical Engineering","hasProgrammingSkills":true,"isTumaiMember":false,"hackathonExperience":"1 hackathon","tshirtCut":"mens","tshirtSize":"L","dietaryRestrictions":"vegetarian","discoverySource":["friend"]}',
   true, true, false),
  ('40000000-0000-0000-0000-000000000003', 'e0000000-0000-0000-0000-000000000002',
   'applicant3@example.com', 'Carla', 'Meyer', 'pending',
   '{"dateOfBirth":"1999-11-08","gender":"female","nationality":"German","city":"Munich","country":"Germany","currentlyStudying":true,"university":"TU Munich","degree":"MSc","fieldOfStudy":"Data Science","hasProgrammingSkills":true,"isTumaiMember":true,"hackathonExperience":"5+ hackathons","tshirtCut":"womens","tshirtSize":"S","dietaryRestrictions":"vegan","discoverySource":["tumai","instagram"]}',
   true, true, true),
  ('40000000-0000-0000-0000-000000000004', 'e0000000-0000-0000-0000-000000000002',
   'applicant4@example.com', 'Daniel', 'Roth', 'pending',
   '{"dateOfBirth":"2002-07-30","gender":"male","nationality":"Austrian","city":"Vienna","country":"Austria","currentlyStudying":true,"university":"TU Vienna","degree":"BSc","fieldOfStudy":"Software Engineering","hasProgrammingSkills":true,"isTumaiMember":false,"hackathonExperience":"none","tshirtCut":"mens","tshirtSize":"M","dietaryRestrictions":"none","discoverySource":["linkedin"]}',
   true, true, false),
  ('40000000-0000-0000-0000-000000000005', 'e0000000-0000-0000-0000-000000000002',
   'applicant5@example.com', 'Elena', 'Popov', 'rejected',
   '{"dateOfBirth":"2000-01-12","gender":"female","nationality":"Romanian","city":"Bucharest","country":"Romania","currentlyStudying":false,"hasProgrammingSkills":false,"isTumaiMember":false,"hackathonExperience":"none","tshirtCut":"womens","tshirtSize":"M","dietaryRestrictions":"none","discoverySource":["other"],"discoverySourceOther":"University bulletin"}',
   true, true, false),
  ('40000000-0000-0000-0000-000000000006', 'e0000000-0000-0000-0000-000000000002',
   'applicant6@example.com', 'Florian', 'Jung', 'waitlisted',
   '{"dateOfBirth":"2001-09-05","gender":"male","nationality":"German","city":"Berlin","country":"Germany","currentlyStudying":true,"university":"TU Berlin","degree":"MSc","fieldOfStudy":"AI","hasProgrammingSkills":true,"isTumaiMember":false,"hackathonExperience":"2 hackathons","tshirtCut":"mens","tshirtSize":"XL","dietaryRestrictions":"none","discoverySource":["instagram","linkedin"]}',
   true, true, true),
  ('40000000-0000-0000-0000-000000000007', 'e0000000-0000-0000-0000-000000000002',
   'applicant7@example.com', 'Greta', 'Lindberg', 'checked_in',
   '{"dateOfBirth":"2000-06-18","gender":"female","nationality":"Swedish","city":"Stockholm","country":"Sweden","currentlyStudying":true,"university":"KTH","degree":"MSc","fieldOfStudy":"Machine Learning","hasProgrammingSkills":true,"isTumaiMember":false,"hackathonExperience":"4 hackathons","tshirtCut":"womens","tshirtSize":"S","dietaryRestrictions":"gluten-free","discoverySource":["friend"]}',
   true, true, false),
  ('40000000-0000-0000-0000-000000000008', 'e0000000-0000-0000-0000-000000000002',
   'applicant8@example.com', 'Hugo', 'Fernandez', 'pending',
   '{"dateOfBirth":"2001-12-01","gender":"male","nationality":"Spanish","city":"Madrid","country":"Spain","currentlyStudying":true,"university":"UPM","degree":"BSc","fieldOfStudy":"Telecommunications","hasProgrammingSkills":true,"isTumaiMember":false,"hackathonExperience":"1 hackathon","tshirtCut":"mens","tshirtSize":"L","dietaryRestrictions":"none","discoverySource":["instagram"]}',
   true, true, false);

-- ═══════════════════════════════════════════════════════════════
-- SCREENING SCORES
-- ═══════════════════════════════════════════════════════════════

INSERT INTO screening_scores (application_id, screener_id, score, notes) VALUES
  ('40000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 8, 'Strong technical background'),
  ('40000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 7, 'Good potential'),
  ('40000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 9, 'Excellent, TUM.ai member'),
  ('40000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000001', 5, 'No hackathon experience'),
  ('40000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000001', 3, 'No programming skills');

-- ═══════════════════════════════════════════════════════════════
-- PARTNERS
-- ═══════════════════════════════════════════════════════════════

-- Logo URLs must use an `images.remotePatterns` host (next.config.ts derives
-- it from NEXT_PUBLIC_SUPABASE_URL) or next/image throws and 500s the landing
-- page. Use the Supabase Storage public path so it works in any environment.
INSERT INTO partners (id, name, logo_url, url, tier, description, display_order, chapter_id) VALUES
  ('50000000-0000-0000-0000-000000000001', 'TechCorp', '/images/ehl-logo.png', 'https://techcorp.example.com', 'title', 'Title sponsor for Match 1', 1, 'e0000000-0000-0000-0000-000000000001'),
  ('50000000-0000-0000-0000-000000000002', 'EcoTech', '/images/ehl-logo.png', 'https://ecotech.example.com', 'challenge', 'Challenge sponsor', 2, 'e0000000-0000-0000-0000-000000000001'),
  ('50000000-0000-0000-0000-000000000003', 'DevTools Inc', '/images/ehl-logo.png', 'https://devtools.example.com', 'tech', 'Tech partner', 3, 'e0000000-0000-0000-0000-000000000001'),
  ('50000000-0000-0000-0000-000000000004', 'UrbanAI', '/images/ehl-logo.png', 'https://urbanai.example.com', 'challenge', 'Challenge sponsor for Match 2', 1, 'e0000000-0000-0000-0000-000000000002');

COMMIT;

-- ═══════════════════════════════════════════════════════════════
-- EXPECTED LEADERBOARD:
--
-- Rank | Team                | Points | Best Finish
-- -----+---------------------+--------+------------
--  1   | TUM.ai Innovators   |   8    |    1st
--  2   | ETH Zurich Hackers  |   7    |    2nd
--  3   | KIT Coders          |   6    |    3rd
--  4   | LMU Builders        |   4    |    4th
--  5   | TU Berlin Devs      |   2    |    null
--  5   | RWTH Aachen Tech    |   2    |    null
-- ═══════════════════════════════════════════════════════════════
