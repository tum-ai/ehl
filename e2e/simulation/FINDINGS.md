# Simulation findings (real app bugs)

These are bugs found in the **application code** while building the live-UI
simulation. Per the test-discipline rules, app code was NOT changed to make a
test pass; the issues are documented here with repro + evidence instead.

---

## 1. `createNewChapter()` cannot create a chapter — `match_number` NOT NULL violation

**Status:** FIXED in `lib/actions/admin.ts` (createNewChapter now selects
`max(match_number)+1` and supplies it on insert, before `recalculateMatchNumbers`).
Regression test: `e2e/simulation/09-create-chapter-button.sim.ts` (drives the real
"New Chapter" button; fails before the fix, passes after). Verified the old insert
errors with the exact not-null violation against the test DB.

**Severity:** High (the admin "New Chapter" button was non-functional on a
correctly-migrated database).

**Where:** `lib/actions/admin.ts` -> `createNewChapter()` (around line 231).

**What happens:** The action inserts a new chapter row without a `match_number`:

    const { data, error } = await adminClient
      .from("chapters")
      .insert({
        name: "New Chapter", slug, city: "", country: "",
        country_code: "", description: "", status: "draft", is_finale: false,
      })
      .select("id").single();

But `chapters.match_number` is declared `int not null` with **no default**
(`supabase/migrations/00001_initial_schema.sql:51`, and no later migration adds
a default). The insert fails before `recalculateMatchNumbers()` (which runs
*after* the insert) can assign a number.

**Repro (UI):** Log in as admin -> `/admin/chapters` -> click "New Chapter".
The page stays on `/admin/chapters` and a browser alert() fires:

    null value in column "match_number" of relation "chapters" violates not-null constraint

**Repro (direct, against the test Supabase):** running the exact insert above
returns the same not-null violation.

**Likely fix (NOT applied):** give `match_number` a default in the insert, or
make the column nullable/defaulted and let `recalculateMatchNumbers()` assign
the ordering. (The e2e data-factory `createChapter()` already works around this
by passing `match_number: opts.matchNumber ?? 99`.)

**Simulation impact / workaround:** Because the admin chapter-CREATE UI is
broken on this schema, the simulation bootstraps the initial *draft* chapter
row via the admin Supabase client (the one step with no working UI), then
drives **every** subsequent admin action through the real UI (filling chapter
details, advancing status, creating challenges, assigning jury, scoring,
media). See `createDraftChapterRow` in `sim-helpers.ts`.
