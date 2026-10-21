"use client";

import { useId } from "react";
import { Flag } from "lucide-react";
import { OriginTicket } from "@/components/shared/origin-ticket";
import { cn } from "@/components/ui/cn";
import { StatusBadge } from "@/components/ui/state-tag";
import type { CallFit, FitVerdict } from "@/lib/api";
import {
  chipText,
  OVERALL,
  overallSentence,
  rowChips,
  shortName,
  VERDICT,
  visibleFlags,
} from "./fit";

const VERDICT_ICON_TONE: Record<FitVerdict, string> = {
  met: "text-status-success-text",
  not_met: "text-status-danger-text",
  unclear: "text-text-3",
};

/** The call's overall fit: icon and word. */
export function FitChip({
  fit,
  className,
}: {
  fit: CallFit;
  className?: string;
}) {
  const look = OVERALL[fit.overall];
  return (
    <StatusBadge tone={look.tone} icon={look.icon} className={className}>
      {look.label}
    </StatusBadge>
  );
}

/** The overall chip and up to `max` requirement chips, what needs a look first. */
export function FitChips({
  fit,
  max = 3,
  className,
}: {
  fit: CallFit;
  max?: number;
  className?: string;
}) {
  const { chips, more } = rowChips(fit, max);
  return (
    <span
      className={cn("flex min-w-0 flex-wrap items-center gap-1.5", className)}
    >
      <FitChip fit={fit} />
      {chips.map((item) => {
        const Icon = VERDICT[item.verdict].icon;
        return (
          <span
            key={item.requirement}
            title={chipText(item)}
            className="inline-flex h-6 max-w-[12rem] items-center gap-1 rounded-xs border border-border bg-canvas px-1.5 text-caption text-text-2"
          >
            <Icon
              aria-hidden
              strokeWidth={2}
              className={cn("size-3 shrink-0", VERDICT_ICON_TONE[item.verdict])}
            />
            <span className="min-w-0 truncate">
              {shortName(item)}
              <span className="sr-only">
                : {VERDICT[item.verdict].label.toLowerCase()}
              </span>
            </span>
          </span>
        );
      })}
      {more > 0 ? (
        <span className="text-caption tabular-nums text-text-3">+{more}</span>
      ) : null}
    </span>
  );
}

/**
 * The drawer's Fit block, above the summary: each requirement HR set with met / not met /
 * unclear, the candidate's words and the second they said them; then what HR should know.
 */
export function FitBlock({
  fit,
  onSeek,
}: {
  fit: CallFit;
  onSeek?: (at: number) => void;
}) {
  const headingId = useId();
  const flags = visibleFlags(fit);
  return (
    <section
      aria-labelledby={headingId}
      className="rounded-card-sm border border-border bg-canvas p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h3 id={headingId} className="m-0 text-label font-semibold text-text">
          Fit
        </h3>
        <FitChip fit={fit} />
      </div>
      <p className="mb-0 mt-1 text-meta text-text-2">{overallSentence(fit)}</p>
      <ul role="list" className="m-0 mt-3 list-none divide-y divide-border p-0">
        {fit.items.map((item) => {
          const look = VERDICT[item.verdict];
          const Icon = look.icon;
          return (
            <li
              key={item.requirement}
              className="grid gap-1 py-3 first:pt-0 last:pb-0"
            >
              <div className="flex items-start justify-between gap-3">
                <p className="m-0 min-w-0 text-body text-text [overflow-wrap:anywhere]">
                  {item.label}
                </p>
                <span
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1 text-label font-medium",
                    VERDICT_ICON_TONE[item.verdict],
                  )}
                >
                  <Icon aria-hidden strokeWidth={2} className="size-4" />
                  {look.label}
                </span>
              </div>
              {item.evidence?.trim() || item.atSeconds != null ? (
                <div className="flex items-start justify-between gap-3">
                  {item.evidence?.trim() ? (
                    <q className="min-w-0 text-meta text-text-2 [overflow-wrap:anywhere]">
                      {item.evidence.trim()}
                    </q>
                  ) : (
                    <span />
                  )}
                  {item.atSeconds != null ? (
                    <OriginTicket at={item.atSeconds} onSeek={onSeek} />
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      {flags.length > 0 ? (
        <div className="mt-3 border-t border-border pt-3">
          <h4 className="m-0 text-meta font-medium text-text-2">
            Worth knowing
          </h4>
          <ul role="list" className="m-0 mt-2 grid list-none gap-2 p-0">
            {flags.map((flag, i) => (
              <li key={i} className="flex items-start justify-between gap-3">
                <span className="inline-flex min-w-0 items-start gap-2 text-body text-text">
                  <Flag
                    aria-hidden
                    strokeWidth={1.75}
                    className="mt-1 size-3.5 shrink-0 text-status-warning-text"
                  />
                  <span className="[overflow-wrap:anywhere]">{flag.text}</span>
                </span>
                {flag.atSeconds != null ? (
                  <OriginTicket at={flag.atSeconds} onSeek={onSeek} />
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
