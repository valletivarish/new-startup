import { describe, expect, it } from "vitest";
import { fromForm, requirementsDirty, toForm } from "./requirements";

describe("requirements form", () => {
  it("saves nothing set as no requirements", () => {
    expect(fromForm(toForm(null))).toEqual({ requirements: null, errors: {} });
  });

  it("reads the typed values and drops blank must-haves", () => {
    const form = {
      ...toForm(null),
      salaryMin: "4.5",
      salaryMax: "6",
      maxNotice: "45",
      workMode: "on_site" as const,
      officeDays: "3",
      mustHaves: [" WMS ", ""],
    };
    const { requirements, errors } = fromForm(form);
    expect(errors).toEqual({});
    expect(requirements).toMatchObject({
      salaryMinLakh: 4.5,
      salaryMaxLakh: 6,
      maxNoticeDays: 45,
      workMode: "on_site",
      // Office days only count for hybrid.
      officeDaysPerWeek: null,
      mustHaves: ["WMS"],
      replyWithinWorkingDays: 3,
    });
  });

  it("flags values the API would refuse", () => {
    const { errors } = fromForm({
      ...toForm(null),
      salaryMin: "8",
      salaryMax: "6",
      maxNotice: "1.5",
      replyWithin: "0",
    });
    expect(Object.keys(errors).sort()).toEqual([
      "maxNotice",
      "replyWithin",
      "salaryMin",
    ]);
  });

  it("is dirty only when something that saves changed", () => {
    const saved = fromForm({
      ...toForm(null),
      maxNotice: "30",
      mustHaves: ["WMS"],
    }).requirements;
    expect(
      requirementsDirty({ ...toForm(saved), mustHaves: ["WMS ", ""] }, saved),
    ).toBe(false);
    expect(
      requirementsDirty({ ...toForm(saved), maxNotice: "45" }, saved),
    ).toBe(true);
  });
});
