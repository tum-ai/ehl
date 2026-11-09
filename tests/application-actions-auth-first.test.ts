import { describe, it, expect, vi, beforeEach } from "vitest";

// Every admin application action checks the admin guard BEFORE it touches the
// database. If it looked the row up first, a non-admin could tell an existing
// application id or check-in token ("Admin access required") from a missing
// one ("not found").

const mocks = vi.hoisted(() => ({
  requireAdminAction: vi.fn(),
  createAdminClient: vi.fn(),
  createClient: vi.fn(),
  getSession: vi.fn(),
  logEvent: vi.fn(),
  sendEmail: vi.fn(),
  renderApplicationAcceptedEmail: vi.fn(),
  renderApplicationRejectedEmail: vi.fn(),
  QRCode: { toBuffer: vi.fn() },
}));

vi.mock("@/lib/admin-auth", () => ({
  requireAdminAction: mocks.requireAdminAction,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/actions/auth", () => ({ getSession: mocks.getSession }));
vi.mock("@/lib/event-log", () => ({ logEvent: mocks.logEvent }));
vi.mock("@/lib/email", () => ({ sendEmail: mocks.sendEmail }));
vi.mock("@/lib/emails/render", () => ({
  renderApplicationAcceptedEmail: mocks.renderApplicationAcceptedEmail,
  renderApplicationRejectedEmail: mocks.renderApplicationRejectedEmail,
}));
vi.mock("qrcode", () => ({ default: mocks.QRCode }));

import {
  addApplicationNote,
  bulkUpdateApplicationStatus,
  cancelApplication,
  checkInApplication,
  checkInApplicationById,
  deleteApplication,
  sendAcceptanceEmails,
  sendRejectionEmails,
  updateApplicationStatus,
} from "@/lib/actions/applications";

const DENIED = "Admin access required.";

const ACTIONS: Array<[string, () => Promise<unknown>]> = [
  ["deleteApplication", () => deleteApplication("app-1")],
  ["updateApplicationStatus", () => updateApplicationStatus("app-1", "accepted")],
  ["bulkUpdateApplicationStatus", () => bulkUpdateApplicationStatus(["app-1"], "accepted")],
  ["sendAcceptanceEmails", () => sendAcceptanceEmails(["app-1"])],
  ["sendRejectionEmails", () => sendRejectionEmails(["app-1"])],
  ["cancelApplication", () => cancelApplication("app-1", "no-show")],
  ["addApplicationNote", () => addApplicationNote("app-1", "a note")],
  ["checkInApplication", () => checkInApplication("token-1")],
  ["checkInApplicationById", () => checkInApplicationById("app-1")],
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdminAction.mockResolvedValue(DENIED);
});

describe("admin application actions check the guard first", () => {
  it.each(ACTIONS)("%s refuses a non-admin before any database access", async (_name, run) => {
    const result = await run();

    expect(result).toEqual({ error: DENIED });
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });
});
