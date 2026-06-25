import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";

// Auth-boundary tests for the public certificate route.
//
// The route accepts EITHER a valid session (admin / team member) OR a valid
// capability token bound to (chapterId, teamId). No token + no session => 401.
// A token for team A must not work for team B. Tampered/missing token + no
// session => 401. Non-member session => 403.

beforeAll(() => {
  process.env.CERTIFICATE_LINK_SECRET = "test-cert-route-secret";
  delete process.env.VERIFICATION_ENCRYPTION_KEY;
});

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  createAdminClient: vi.fn(),
  checkRateLimit: vi.fn(),
}));

vi.mock("@/lib/actions/auth", () => ({ getSession: mocks.getSession }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));
vi.mock("@/lib/ratelimit", () => ({
  checkRateLimit: mocks.checkRateLimit,
  certLimiter: { prefix: "rl:cert" },
}));

// Stub PDF generation: we only care about auth, not real rendering.
vi.mock("@react-pdf/renderer", () => ({
  default: {
    renderToStream: vi.fn(async () => {
      async function* gen() {
        yield Buffer.from("%PDF-1.4 fake");
      }
      return gen();
    }),
  },
}));
vi.mock("@/lib/certificates/template", () => ({
  CertificateDocument: vi.fn(() => ({})),
}));

import { GET } from "@/app/api/certificates/[chapterId]/[teamId]/route";
import { certificateToken } from "@/lib/certificate-token";

const CHAPTER = "11111111-1111-1111-1111-111111111111";
const TEAM_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const TEAM_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const MEMBER_ID = "member-user-id";

function params(chapterId = CHAPTER, teamId = TEAM_A) {
  return { params: Promise.resolve({ chapterId, teamId }) };
}

function req(token?: string) {
  const url = token
    ? `http://t/api/certificates/${CHAPTER}/${TEAM_A}?token=${token}`
    : `http://t/api/certificates/${CHAPTER}/${TEAM_A}`;
  return new Request(url, { headers: { "x-forwarded-for": "1.2.3.4" } });
}

// A fully-populated DB stub returning published score, team, chapter, members.
function fullDb(opts: { memberUserId?: string } = {}) {
  return {
    from(table: string) {
      const builder: Record<string, unknown> = {};
      builder.select = () => builder;
      builder.eq = () => builder;
      builder.single = () => {
        switch (table) {
          case "scores":
            return Promise.resolve({
              data: {
                placement: 1,
                points: 8,
                challenge_name: "Challenge",
                published: true,
              },
            });
          case "teams":
            return Promise.resolve({
              data: { name: "Team A", university: "Uni" },
            });
          case "chapters":
            return Promise.resolve({
              data: {
                name: "Chapter",
                city: "Berlin",
                country: "DE",
                date: "2026-01-01",
                date_end: null,
              },
            });
          case "team_members":
            // membership lookup
            return Promise.resolve(
              opts.memberUserId
                ? { data: { user_id: opts.memberUserId } }
                : { data: null }
            );
          default:
            return Promise.resolve({ data: null });
        }
      };
      // team_members member-names list uses thenable (no .single())
      builder.then = (onF: (v: unknown) => unknown) =>
        Promise.resolve({ data: [{ profiles: { name: "Alice" } }] }).then(onF);
      return builder;
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.checkRateLimit.mockResolvedValue({ limited: false });
  mocks.createAdminClient.mockReturnValue(fullDb());
  mocks.getSession.mockResolvedValue(null);
});

describe("GET /api/certificates/[chapterId]/[teamId] — token path", () => {
  it("valid token + no session => 200 (PDF served)", async () => {
    const token = certificateToken(CHAPTER, TEAM_A);
    const res = await GET(req(token), params());
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    // Session was never required on the token path.
    expect(mocks.getSession).not.toHaveBeenCalled();
  });

  it("missing token + no session => 401", async () => {
    const res = await GET(req(), params());
    expect(res.status).toBe(401);
  });

  it("invalid/tampered token + no session => 401", async () => {
    const token = certificateToken(CHAPTER, TEAM_A);
    const tampered = (token[0] === "A" ? "B" : "A") + token.slice(1);
    const res = await GET(req(tampered), params());
    expect(res.status).toBe(401);
  });

  it("token for team A does NOT authorize team B => 401", async () => {
    const tokenA = certificateToken(CHAPTER, TEAM_A);
    // Request team B with team A's token; no session.
    const res = await GET(
      new Request(
        `http://t/api/certificates/${CHAPTER}/${TEAM_B}?token=${tokenA}`,
        { headers: { "x-forwarded-for": "1.2.3.4" } }
      ),
      params(CHAPTER, TEAM_B)
    );
    expect(res.status).toBe(401);
  });

  it("rate limit applies on the token path (429 before serving)", async () => {
    mocks.checkRateLimit.mockResolvedValue({ limited: true });
    const token = certificateToken(CHAPTER, TEAM_A);
    const res = await GET(req(token), params());
    expect(res.status).toBe(429);
  });
});

describe("GET /api/certificates/[chapterId]/[teamId] — session path (unchanged)", () => {
  it("admin session + no token => 200", async () => {
    mocks.getSession.mockResolvedValue({
      user: { id: "admin-id" },
      profile: { role: "admin" },
    });
    const res = await GET(req(), params());
    expect(res.status).toBe(200);
  });

  it("team-member session + no token => 200", async () => {
    mocks.createAdminClient.mockReturnValue(fullDb({ memberUserId: MEMBER_ID }));
    mocks.getSession.mockResolvedValue({
      user: { id: MEMBER_ID },
      profile: { role: "participant" },
    });
    const res = await GET(req(), params());
    expect(res.status).toBe(200);
  });

  it("non-member session + no token => 403", async () => {
    mocks.createAdminClient.mockReturnValue(fullDb()); // membership lookup => null
    mocks.getSession.mockResolvedValue({
      user: { id: "stranger-id" },
      profile: { role: "participant" },
    });
    const res = await GET(req(), params());
    expect(res.status).toBe(403);
  });
});
