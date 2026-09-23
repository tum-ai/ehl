import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ admin: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
import { getTeamMatchHistory } from "@/lib/queries/teams";

// Mirror the schema's submitted_at column. Reject unknown selected columns,
// as PostgREST does, rather than returning a submission regardless of the query.
function client(withSubmission: boolean) {
  const tables: Record<string, Record<string, unknown>[]> = {
    challenge_registrations: [{ chapter_id: "chapter", challenge_id: "challenge", team_id: "team", roster: ["captain", "member"], registered_at: "2026-09-22T09:00:00Z" }],
    scores: [],
    submissions: withSubmission ? [{ challenge_id: "challenge", team_id: "team", project_name: "Saved Project", submitted_at: "2026-09-22T10:00:00Z" }] : [],
    chapters: [{ id: "chapter", name: "Hackathon", slug: "hackathon", date: "2026-09-22", city: "Munich", status: "submissions_open" }],
    challenges: [{ id: "challenge", title: "Challenge", chapter_id: "chapter" }],
  };
  return {
    from(table: string) {
      let columns: string[] = [];
      let rows = tables[table];
      const query = {
        select(value: string) { columns = value.split(",").map((column) => column.trim()); return query; },
        eq(key: string, value: unknown) { rows = rows.filter((row) => row[key] === value); return query; },
        neq(key: string, value: unknown) { rows = rows.filter((row) => row[key] !== value); return query; },
        then(resolve: (value: unknown) => unknown) {
          if (table === "submissions" && columns.some((column) => column.split(":").at(-1) === "created_at")) {
            return Promise.resolve({ data: null, error: { code: "42703", message: "column submissions.created_at does not exist" } }).then(resolve);
          }
          const data = rows.map((row) => Object.fromEntries(columns.map((column) => {
            const [alias, source = alias] = column.split(":");
            return [alias, row[source]];
          })));
          return Promise.resolve({ data, error: null }).then(resolve);
        },
      };
      return query;
    },
  };
}

describe("team match history submission state", () => {
  it("returns a saved project and its submission timestamp for the dashboard", async () => {
    mocks.admin.mockReturnValue(client(true));
    const history = await getTeamMatchHistory("team");
    expect(history).toHaveLength(1);
    expect(history[0].submission).toEqual({ projectName: "Saved Project", createdAt: "2026-09-22T10:00:00Z" });
  });

  it("returns no submission when the registered team has not submitted", async () => {
    mocks.admin.mockReturnValue(client(false));
    const history = await getTeamMatchHistory("team");
    expect(history).toHaveLength(1);
    expect(history[0].submission).toBeNull();
  });
});
