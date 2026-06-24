import { describe, it, expect } from "vitest";
import { shouldGuardNavigation } from "@/lib/hooks/use-unsaved-changes";

// The hook attaches a capture-phase click listener that prompts before letting
// an in-app navigation discard unsaved form edits. The DOM wiring is thin; the
// real logic is the decision of WHICH clicks to guard. These tests pin that
// decision so we don't accidentally prompt on new-tab clicks or fail to guard a
// genuine page navigation.

const HERE = "https://admin.example.com/admin/chapters/c1/challenges";

function click(overrides: Partial<Parameters<typeof shouldGuardNavigation>[0]>) {
  return shouldGuardNavigation({
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    defaultPrevented: false,
    href: "/admin/chapters/c1",
    target: null,
    isDownload: false,
    currentUrl: HERE,
    ...overrides,
  });
}

describe("shouldGuardNavigation", () => {
  it("guards a plain left-click to another page", () => {
    expect(click({})).toBe(true);
  });

  it("guards an external absolute URL", () => {
    expect(click({ href: "https://elsewhere.example.com/x" })).toBe(true);
  });

  it("does NOT guard middle-click or right-click", () => {
    expect(click({ button: 1 })).toBe(false);
    expect(click({ button: 2 })).toBe(false);
  });

  it("does NOT guard modifier clicks (open in new tab)", () => {
    expect(click({ metaKey: true })).toBe(false);
    expect(click({ ctrlKey: true })).toBe(false);
    expect(click({ shiftKey: true })).toBe(false);
    expect(click({ altKey: true })).toBe(false);
  });

  it("does NOT guard a click another handler already prevented", () => {
    expect(click({ defaultPrevented: true })).toBe(false);
  });

  it("does NOT guard target=_blank or download anchors", () => {
    expect(click({ target: "_blank" })).toBe(false);
    expect(click({ isDownload: true })).toBe(false);
  });

  it("does NOT guard anchors with no href or pure-hash href", () => {
    expect(click({ href: null })).toBe(false);
    expect(click({ href: "#section" })).toBe(false);
  });

  it("does NOT guard a same-page hash link (form is not unmounted)", () => {
    expect(click({ href: `${HERE}#bottom` })).toBe(false);
  });

  it("DOES guard a hash link that also changes the path", () => {
    expect(
      click({ href: "/admin/chapters/c1/code-reviews#config" })
    ).toBe(true);
  });

  it("guards an unparseable href to be safe", () => {
    // No throw, returns a boolean; odd hrefs default to guarded.
    expect(click({ href: "::::" })).toBe(true);
  });
});
