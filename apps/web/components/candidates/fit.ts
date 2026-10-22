import {
  CircleCheck,
  CircleHelp,
  CircleMinus,
  CircleX,
  type LucideIcon,
} from "lucide-react";
import type {
  CallFit,
  CandidateStageHistoryEvent,
  FitLane,
  FitOverall,
  FitTotals,
  FitVerdict,
  JobRequirements,
} from "../../lib/api";
import type { StatusTone } from "../ui/notice";

/*
  The fit sheet in recruiter words. Every verdict is about one of HR's own requirements, with
  an icon and a word (never colour alone). Mirrors apps/api/src/hiring/requirements.ts.
*/

/** The lanes the dashboard shows. "not_screened" is still stored; it has no lane or chip in the UI. */
export const FIT_LANES: readonly FitLane[] = [
  "meets_all",
  "check",
  "doesnt_meet",
];

const STORED_LANES: readonly FitLane[] = [...FIT_LANES, "not_screened"];

export const LANE_LABEL: Record<FitLane, string> = {
  meets_all: "Meets all",
  check: "Needs a look",
  doesnt_meet: "Doesn’t meet",
  not_screened: "", // no answers, no chip: nothing to say
};

export const isFitLane = (v: unknown): v is FitLane =>
  (FIT_LANES as readonly unknown[]).includes(v);

export interface Look {
  label: string;
  tone: StatusTone;
  icon: LucideIcon;
}

export const OVERALL: Record<FitOverall, Look> = {
  meets_all: { label: "Meets all", tone: "success", icon: CircleCheck },
  check: { label: "Needs a look", tone: "warning", icon: CircleHelp },
  doesnt_meet: { label: "Doesn’t meet", tone: "danger", icon: CircleX },
};

export const VERDICT: Record<FitVerdict, Look> = {
  met: { label: "Met", tone: "success", icon: CircleCheck },
  not_met: { label: "Not met", tone: "danger", icon: CircleX },
  unclear: { label: "Unclear", tone: "neutral", icon: CircleMinus },
};

/** The lane's count while it is the server's; null (no number shown) when unknown. */
export function laneCount(
  totals: FitTotals | undefined | null,
  lane: FitLane | "all",
): number | null {
  if (!totals) return null;
  if (lane === "all")
    return STORED_LANES.reduce((n, l) => n + (totals[l] ?? 0), 0);
  return totals[lane] ?? 0;
}

/** A short name for a requirement, for chips on a row: "Salary", "Notice", or the must-have itself. */
export function shortName(item: {
  requirement: string;
  label: string;
}): string {
  switch (item.requirement) {
    case "salary":
      return "Salary";
    case "notice":
      return "Notice";
    case "work_mode":
      return "Work mode";
    case "night_shift":
      return "Night shifts";
    default:
      return item.label.length > 24
        ? `${item.label.slice(0, 23).trimEnd()}…`
        : item.label;
  }
}

const ATTENTION: Record<FitVerdict, number> = {
  not_met: 0,
  unclear: 1,
  met: 2,
};

/** Up to `max` requirement chips for a row, what needs a look first; `more` is how many are left out. */
export function rowChips(fit: CallFit | null | undefined, max = 3) {
  if (!fit) return { chips: [], more: 0 };
  const sorted = fit.items
    .map((item, i) => ({ item, i }))
    .sort(
      (a, b) =>
        ATTENTION[a.item.verdict] - ATTENTION[b.item.verdict] || a.i - b.i,
    )
    .map(({ item }) => item);
  return {
    chips: sorted.slice(0, max),
    more: Math.max(0, sorted.length - max),
  };
}

/** "Salary: not met", for a chip's accessible name and title. */
export function chipText(item: {
  requirement: string;
  label: string;
  verdict: FitVerdict;
}): string {
  return `${shortName(item)}: ${VERDICT[item.verdict].label.toLowerCase()}`;
}

/** One line for the Fit block's heading. */
export function overallSentence(fit: CallFit): string {
  const n = fit.items.length;
  const met = fit.items.filter((i) => i.verdict === "met").length;
  const notMet = fit.items.filter((i) => i.verdict === "not_met").length;
  const of = `${n} requirement${n === 1 ? "" : "s"}`;
  if (fit.overall === "meets_all") return `Meets all ${of} you set.`;
  if (fit.overall === "doesnt_meet")
    return `${notMet} of ${of} not met. Waiting for you to decide.`;
  const unclear = n - met - notMet;
  const parts = [
    met && `${met} met`,
    notMet && `${notMet} not met`,
    unclear && `${unclear} unclear`,
  ].filter(Boolean);
  return `${parts.join(", ")}. Worth a look before you decide.`;
}

/** Flags worth showing: without transcript access their words are removed, so they drop out. */
export function visibleFlags(fit: CallFit | null | undefined) {
  return (fit?.flags ?? []).filter((f) => f.text.trim());
}

/** The drawer's note when the latest decision was made by auto-advance; null otherwise. */
export function autoAdvanceNote(
  events: readonly Pick<
    CandidateStageHistoryEvent,
    "automatic" | "reason" | "status"
  >[],
  fit: CallFit | null | undefined,
): string | null {
  const latest = events[0];
  if (!latest?.automatic) return null;
  const reason = latest.reason?.trim();
  if (reason?.startsWith("Moved forward automatically")) return reason;
  const n = fit?.items.length ?? 0;
  return n > 0
    ? `Moved forward automatically: met all ${n} requirement${n === 1 ? "" : "s"}`
    : "Moved forward automatically";
}

/** Meets-all first, otherwise the order given (stable). */
export function meetsAllFirst<T extends { fit?: CallFit | null }>(
  items: readonly T[],
): T[] {
  return items
    .map((item, i) => ({ item, i }))
    .sort(
      (a, b) =>
        Number(b.item.fit?.overall === "meets_all") -
          Number(a.item.fit?.overall === "meets_all") || a.i - b.i,
    )
    .map(({ item }) => item);
}

// --- Requirement lines (mirrors requirementList on the API) ---------------------------------

const num = (n: number) => String(Math.round(n * 100) / 100);

/** The requirements HR set, as the lines each call is checked against. Empty when none are set. */
export function requirementLines(
  r: JobRequirements | null | undefined,
): { requirement: string; label: string }[] {
  if (!r) return [];
  const out: { requirement: string; label: string }[] = [];
  const min = r.salaryMinLakh;
  const max = r.salaryMaxLakh;
  if (min != null || max != null) {
    const range =
      min != null && max != null
        ? min === max
          ? `around ${num(max)} lakh a year`
          : `within ${num(min)} to ${num(max)} lakh a year`
        : max != null
          ? `up to ${num(max)} lakh a year`
          : `from ${num(min!)} lakh a year`;
    out.push({
      requirement: "salary",
      label: `Expected salary ${range}${r.salaryFlexible ? " (budget is flexible)" : ""}`,
    });
  }
  if (r.maxNoticeDays != null) {
    out.push({
      requirement: "notice",
      label:
        r.maxNoticeDays === 0
          ? "Can join immediately"
          : `Notice period of ${r.maxNoticeDays} days or less`,
    });
  }
  const where = r.city ? ` in ${r.city}` : "";
  if (r.workMode === "on_site")
    out.push({ requirement: "work_mode", label: `Can work on-site${where}` });
  else if (r.workMode === "hybrid") {
    const d = r.officeDaysPerWeek;
    const days = d ? `, ${d} office day${d === 1 ? "" : "s"} a week` : "";
    out.push({
      requirement: "work_mode",
      label: `Can work hybrid${days}${where}`,
    });
  } else if (r.workMode === "remote")
    out.push({ requirement: "work_mode", label: "Okay working remotely" });
  else if (r.city)
    out.push({ requirement: "work_mode", label: `Can work from ${r.city}` });
  if (r.nightShiftRequired)
    out.push({ requirement: "night_shift", label: "Okay with night shifts" });
  (r.mustHaves ?? []).forEach((m, i) =>
    out.push({ requirement: `must_have_${i + 1}`, label: m }),
  );
  return out;
}
