import type { JobRequirements, WorkMode } from "../../lib/api";

/**
 * The requirements form as typed (strings), and the sheet it saves. Limits match the API's
 * JobRequirements (apps/api/src/hiring/requirements.ts).
 */

export const MAX_MUST_HAVES = 5;
export const DEFAULT_REPLY_DAYS = 3;

export interface RequirementsForm {
  salaryMin: string;
  salaryMax: string;
  salaryFlexible: boolean;
  maxNotice: string;
  workMode: WorkMode | "";
  officeDays: string;
  city: string;
  mustHaves: string[];
  nightShift: boolean;
  replyWithin: string;
}

export type RequirementsField =
  | "salaryMin"
  | "salaryMax"
  | "maxNotice"
  | "officeDays"
  | "city"
  | "mustHaves"
  | "replyWithin";

const text = (n: number | null | undefined) => (n == null ? "" : String(n));

export function toForm(
  r: JobRequirements | null | undefined,
): RequirementsForm {
  return {
    salaryMin: text(r?.salaryMinLakh),
    salaryMax: text(r?.salaryMaxLakh),
    salaryFlexible: r?.salaryFlexible ?? false,
    maxNotice: text(r?.maxNoticeDays),
    workMode: r?.workMode ?? "",
    officeDays: text(r?.officeDaysPerWeek),
    city: r?.city ?? "",
    mustHaves: [...(r?.mustHaves ?? [])],
    nightShift: r?.nightShiftRequired ?? false,
    replyWithin: text(r?.replyWithinWorkingDays ?? DEFAULT_REPLY_DAYS),
  };
}

/** A number typed in a box: '' is unset, anything else must be a number in range. */
function readNumber(
  raw: string,
  opts: { min: number; max: number; integer?: boolean },
): { value: number | null; ok: boolean } {
  const t = raw.trim().replace(/,/g, "");
  if (!t) return { value: null, ok: true };
  const n = Number(t);
  const ok =
    Number.isFinite(n) &&
    n >= opts.min &&
    n <= opts.max &&
    (!opts.integer || Number.isInteger(n));
  return { value: ok ? n : null, ok };
}

/**
 * The sheet to save, or the errors to show. A sheet with nothing set saves as null (no
 * requirements), unless the reply time was changed from the default.
 */
export function fromForm(form: RequirementsForm): {
  requirements: JobRequirements | null;
  errors: Partial<Record<RequirementsField, string>>;
} {
  const errors: Partial<Record<RequirementsField, string>> = {};
  const min = readNumber(form.salaryMin, { min: 0, max: 1000 });
  const max = readNumber(form.salaryMax, { min: 0, max: 1000 });
  if (!min.ok) errors.salaryMin = "Enter lakh a year, for example 4.5.";
  if (!max.ok) errors.salaryMax = "Enter lakh a year, for example 6.";
  if (min.value != null && max.value != null && min.value > max.value) {
    errors.salaryMin = "The minimum is above the maximum.";
  }
  const notice = readNumber(form.maxNotice, {
    min: 0,
    max: 365,
    integer: true,
  });
  if (!notice.ok)
    errors.maxNotice = "Enter whole days, 0 to 365. 0 means joins immediately.";
  const hybrid = form.workMode === "hybrid";
  const office = readNumber(hybrid ? form.officeDays : "", {
    min: 1,
    max: 7,
    integer: true,
  });
  if (!office.ok) errors.officeDays = "Enter 1 to 7 days.";
  const city = form.city.trim();
  if (city.length > 100) errors.city = "Keep it under 100 characters.";
  const mustHaves = form.mustHaves.map((m) => m.trim()).filter(Boolean);
  if (mustHaves.length > MAX_MUST_HAVES)
    errors.mustHaves = `Up to ${MAX_MUST_HAVES} lines.`;
  else if (mustHaves.some((m) => m.length > 200))
    errors.mustHaves = "Keep each line under 200 characters.";
  const reply = readNumber(form.replyWithin, {
    min: 1,
    max: 30,
    integer: true,
  });
  if (!reply.ok) errors.replyWithin = "Enter 1 to 30 working days.";

  const requirements: JobRequirements = {
    salaryMinLakh: min.value,
    salaryMaxLakh: max.value,
    salaryFlexible: form.salaryFlexible,
    maxNoticeDays: notice.value,
    workMode: form.workMode || null,
    officeDaysPerWeek: office.value,
    city: city || null,
    mustHaves,
    nightShiftRequired: form.nightShift,
    replyWithinWorkingDays: reply.value ?? DEFAULT_REPLY_DAYS,
  };
  const nothingSet =
    min.value == null &&
    max.value == null &&
    notice.value == null &&
    !requirements.workMode &&
    !requirements.city &&
    mustHaves.length === 0 &&
    !form.nightShift &&
    requirements.replyWithinWorkingDays === DEFAULT_REPLY_DAYS;
  return { requirements: nothingSet ? null : requirements, errors };
}

/** The form as it would save, for comparing with what is saved: whitespace and blank lines don't count. */
function normal(form: RequirementsForm) {
  return JSON.stringify({
    ...form,
    salaryMin: form.salaryMin.trim(),
    salaryMax: form.salaryMax.trim(),
    maxNotice: form.maxNotice.trim(),
    officeDays: form.workMode === "hybrid" ? form.officeDays.trim() : "",
    city: form.city.trim(),
    mustHaves: form.mustHaves.map((m) => m.trim()).filter(Boolean),
    replyWithin: form.replyWithin.trim(),
  });
}

export function requirementsDirty(
  form: RequirementsForm,
  saved: JobRequirements | null | undefined,
): boolean {
  return normal(form) !== normal(toForm(saved));
}
