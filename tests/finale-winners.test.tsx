import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FINALE_WINNERS, finalePodiumSlots } from "@/lib/finale";

// The podium reveal animation waits for the element to scroll into view; in a
// static render it never does, so treat it as in view.
vi.mock("framer-motion", async (orig) => ({
  ...(await orig<typeof import("framer-motion")>()),
  useInView: () => true,
}));

import { FinaleWinnersPodium } from "@/components/podium/FinaleWinnersPodium";

describe("Grand Finale winners", () => {
  it("are Codacabana, Yantra and BaoByte, in that order", () => {
    expect(FINALE_WINNERS).toEqual(["Codacabana", "Yantra", "BaoByte"]);
  });

  it("stand on the podium 2nd, 1st, 3rd with their own places", () => {
    expect(finalePodiumSlots()).toEqual([
      { teamName: "Yantra", place: 2 },
      { teamName: "Codacabana", place: 1 },
      { teamName: "BaoByte", place: 3 },
    ]);
  });

  it("leaves out places that are not filled", () => {
    expect(finalePodiumSlots(["A", "B"])).toEqual([
      { teamName: "B", place: 2 },
      { teamName: "A", place: 1 },
    ]);
  });

  it("renders the three winners without points", () => {
    const html = renderToStaticMarkup(<FinaleWinnersPodium />);
    const order = FINALE_WINNERS.map((name) => html.indexOf(name));
    // Display order: Yantra (2nd), Codacabana (1st), BaoByte (3rd).
    expect(order[1]).toBeLessThan(order[0]);
    expect(order[0]).toBeLessThan(order[2]);
    expect(html.toLowerCase()).not.toContain("points");
  });
});
