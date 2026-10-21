import { describe, expect, it } from "vitest";
import type { CallFit } from "../../lib/api";
import {
  autoAdvanceNote,
  chipText,
  laneCount,
  meetsAllFirst,
  overallSentence,
  requirementLines,
  rowChips,
  VERDICT,
  visibleFlags,
} from "./fit";

const rahul: CallFit = {
  overall: "check",
  items: [
    {
      requirement: "salary",
      label: "Expected salary within 4 to 6 lakh a year",
      verdict: "unclear",
    },
    {
      requirement: "notice",
      label: "Notice period of 45 days or less",
      verdict: "not_met",
      evidence: "60 days",
      atSeconds: 41,
    },
    {
      requirement: "work_mode",
      label: "Can work on-site in Pune",
      verdict: "met",
    },
    {
      requirement: "must_have_1",
      label: "3+ years running a warehouse team",
      verdict: "met",
    },
  ],
  flags: [
    {
      kind: "flexibility",
      text: "Can join in 45 days if bought out",
      requirement: "notice",
    },
    { kind: "competing_offer", text: "" },
  ],
};

describe("lane counts", () => {
  it("shows the server counts, and none at all when they are unknown", () => {
    const totals = { meets_all: 1, check: 2, doesnt_meet: 0, not_screened: 3 };
    expect(laneCount(totals, "check")).toBe(2);
    expect(laneCount(totals, "all")).toBe(6);
    expect(laneCount(undefined, "meets_all")).toBeNull();
  });
});

describe("row chips", () => {
  it("puts what needs a look first, at most three, and counts the rest", () => {
    const { chips, more } = rowChips(rahul);
    expect(chips.map((c) => c.requirement)).toEqual([
      "notice",
      "salary",
      "work_mode",
    ]);
    expect(more).toBe(1);
    expect(chipText(chips[0]!)).toBe("Notice: not met");
  });
  it("has nothing for a call that was not scored", () => {
    expect(rowChips(null)).toEqual({ chips: [], more: 0 });
  });
});

describe("verdict copy", () => {
  it("names every verdict in words, each with its own icon", () => {
    expect(VERDICT.met.label).toBe("Met");
    expect(VERDICT.not_met.label).toBe("Not met");
    expect(VERDICT.unclear.label).toBe("Unclear");
    expect(new Set(Object.values(VERDICT).map((v) => v.icon)).size).toBe(3);
  });
  it("says the overall in one line", () => {
    expect(overallSentence(rahul)).toBe(
      "2 met, 1 not met, 1 unclear. Worth a look before you decide.",
    );
    expect(
      overallSentence({
        overall: "meets_all",
        items: rahul.items.slice(2),
        flags: [],
      }),
    ).toBe("Meets all 2 requirements you set.");
  });
  it("drops flags whose words were removed", () => {
    expect(visibleFlags(rahul).map((f) => f.kind)).toEqual(["flexibility"]);
  });
});

describe("auto-advance note", () => {
  it("shows only when the latest change was automatic", () => {
    const auto = {
      automatic: true,
      reason: "Moved forward automatically: met all 5 requirements",
      status: "reviewed",
    };
    expect(autoAdvanceNote([auto], null)).toBe(
      "Moved forward automatically: met all 5 requirements",
    );
    expect(
      autoAdvanceNote(
        [{ automatic: true, reason: null, status: "reviewed" }],
        rahul,
      ),
    ).toBe("Moved forward automatically: met all 4 requirements");
    expect(
      autoAdvanceNote(
        [{ automatic: false, reason: null, status: "new" }, auto],
        null,
      ),
    ).toBeNull();
    expect(autoAdvanceNote([], null)).toBeNull();
  });
});

describe("review order", () => {
  it("lists meets-all first and keeps the rest in order", () => {
    const items = [
      { id: "a", fit: rahul },
      { id: "b", fit: null },
      { id: "c", fit: { ...rahul, overall: "meets_all" as const } },
    ];
    expect(meetsAllFirst(items).map((i) => i.id)).toEqual(["c", "a", "b"]);
  });
});

describe("requirement lines", () => {
  it("match the lines calls are checked against", () => {
    expect(
      requirementLines({
        salaryMinLakh: 4,
        salaryMaxLakh: 6,
        salaryFlexible: true,
        maxNoticeDays: 0,
        workMode: "hybrid",
        officeDaysPerWeek: 3,
        city: "Pune",
        mustHaves: ["Forklift licence"],
        nightShiftRequired: true,
        replyWithinWorkingDays: 3,
      }).map((l) => l.label),
    ).toEqual([
      "Expected salary within 4 to 6 lakh a year (budget is flexible)",
      "Can join immediately",
      "Can work hybrid, 3 office days a week in Pune",
      "Okay with night shifts",
      "Forklift licence",
    ]);
    expect(requirementLines(null)).toEqual([]);
  });
});
