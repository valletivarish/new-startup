"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Plus, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { IconButton } from "@/components/ui/icon-button";
import { Field, Input, Select } from "@/components/ui/input";
import { Alert } from "@/components/ui/notice";
import { requirementLines } from "@/components/candidates/fit";
import {
  draftJobRequirements,
  formatApiError,
  saveJobRequirements,
  type JobRequirements,
  type WorkMode,
} from "@/lib/api";
import {
  fromForm,
  MAX_MUST_HAVES,
  toForm,
  type RequirementsField,
  type RequirementsForm,
} from "./requirements";

/*
  The job's requirements sheet: what every call is checked against afterwards. All optional.
  "Fill from description" only fills the form; nothing is saved until Save.
*/

const WORK_MODE_LABEL: Record<WorkMode, string> = {
  on_site: "On-site",
  hybrid: "Hybrid",
  remote: "Remote",
};

export function RequirementsEditor({
  jobId,
  form,
  setForm,
  dirty,
  hasDescription,
  onSaved,
}: {
  jobId: string;
  form: RequirementsForm;
  setForm: (update: (prev: RequirementsForm) => RequirementsForm) => void;
  dirty: boolean;
  /** A saved description of 20+ characters: Fill from description reads only that. */
  hasDescription: boolean;
  onSaved: (requirements: JobRequirements | null) => void;
}) {
  const [errors, setErrors] = useState<
    Partial<Record<RequirementsField, string>>
  >({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [drafting, setDrafting] = useState(false);

  const set = <K extends keyof RequirementsForm>(
    key: K,
    value: RequirementsForm[K],
  ) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => (key in prev ? { ...prev, [key]: undefined } : prev));
  };

  async function onDraft() {
    if (!hasDescription) {
      setError(
        "Save the job description as text first. The requirements are read from it.",
      );
      return;
    }
    setDrafting(true);
    setError(null);
    try {
      const { requirements } = await draftJobRequirements(jobId);
      // The reply time is ours, not the description's: keep what is in the form.
      setForm((prev) => ({
        ...toForm(requirements),
        replyWithin: prev.replyWithin,
      }));
      setErrors({});
      toast.success(
        requirementLines(requirements).length > 0
          ? "Filled from the description. Check each one, then save."
          : "The description doesn’t state any requirements. Fill them in yourself.",
      );
    } catch (e) {
      setError(
        formatApiError(
          e,
          "Couldn’t read requirements from the description. Fill them in yourself.",
        ),
      );
    } finally {
      setDrafting(false);
    }
  }

  async function onSave() {
    const { requirements, errors: found } = fromForm(form);
    setErrors(found);
    if (Object.values(found).some(Boolean)) {
      setError("Fix the highlighted fields, then save.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const saved = await saveJobRequirements(jobId, requirements);
      setForm(() => toForm(saved.requirements));
      onSaved(saved.requirements);
      toast.success(
        saved.requirements
          ? "Requirements saved. Calls from now on are checked against them."
          : "Requirements cleared. Calls won’t be sorted.",
      );
    } catch (e) {
      setError(formatApiError(e, "Couldn’t save the requirements. Try again."));
    } finally {
      setSaving(false);
    }
  }

  const busy = saving || drafting;

  return (
    <div className="grid gap-5">
      <fieldset className="m-0 grid gap-3 border-0 p-0">
        <legend className="mb-1.5 p-0 text-label font-medium text-text">
          Salary budget, lakh a year
        </legend>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-[8rem_8rem_auto] sm:items-end">
          <Field
            label={<span className="font-normal text-text-2">From</span>}
            error={errors.salaryMin}
            announce={false}
          >
            <Input
              inputMode="decimal"
              value={form.salaryMin}
              onChange={(e) => set("salaryMin", e.target.value)}
            />
          </Field>
          <Field
            label={<span className="font-normal text-text-2">Up to</span>}
            error={errors.salaryMax}
            announce={false}
          >
            <Input
              inputMode="decimal"
              value={form.salaryMax}
              onChange={(e) => set("salaryMax", e.target.value)}
            />
          </Field>
          <Checkbox
            label="The budget is flexible"
            checked={form.salaryFlexible}
            onChange={(e) => set("salaryFlexible", e.target.checked)}
            className="col-span-2 justify-self-start sm:col-span-1"
          />
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field
          label="Longest notice period, days"
          hint="0 means joins immediately."
          error={errors.maxNotice}
          announce={false}
        >
          <Input
            inputMode="numeric"
            value={form.maxNotice}
            onChange={(e) => set("maxNotice", e.target.value)}
          />
        </Field>
        <Field label="Work mode">
          <Select
            value={form.workMode}
            onChange={(e) => set("workMode", e.target.value as WorkMode | "")}
          >
            <option value="">Not set</option>
            {(Object.keys(WORK_MODE_LABEL) as WorkMode[]).map((m) => (
              <option key={m} value={m}>
                {WORK_MODE_LABEL[m]}
              </option>
            ))}
          </Select>
        </Field>
        {form.workMode === "hybrid" ? (
          <Field
            label="Office days a week"
            error={errors.officeDays}
            announce={false}
          >
            <Input
              inputMode="numeric"
              value={form.officeDays}
              onChange={(e) => set("officeDays", e.target.value)}
            />
          </Field>
        ) : null}
        {form.workMode !== "remote" ? (
          <Field label="City" error={errors.city} announce={false}>
            <Input
              value={form.city}
              onChange={(e) => set("city", e.target.value)}
              maxLength={100}
              autoComplete="off"
              placeholder="For example, Pune"
            />
          </Field>
        ) : null}
        <Checkbox
          label="Night shifts are part of the job"
          checked={form.nightShift}
          onChange={(e) => set("nightShift", e.target.checked)}
          className="justify-self-start sm:col-span-3"
        />
      </div>

      <div className="border-t border-border pt-5">
        <fieldset className="m-0 grid gap-2 border-0 p-0">
          <legend className="mb-1 p-0 text-label font-medium text-text">
            Must-have skills or experience
          </legend>
          <p className="m-0 text-meta text-text-3">
            Up to {MAX_MUST_HAVES} short lines, for example “3+ years running a
            warehouse”.
          </p>
          {form.mustHaves.map((m, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input
                value={m}
                onChange={(e) =>
                  set(
                    "mustHaves",
                    form.mustHaves.map((x, j) =>
                      j === i ? e.target.value : x,
                    ),
                  )
                }
                maxLength={200}
                aria-label={`Must-have ${i + 1}`}
                className="min-w-0 flex-1"
              />
              <IconButton
                label={`Remove must-have ${i + 1}`}
                variant="quiet"
                onClick={() =>
                  set(
                    "mustHaves",
                    form.mustHaves.filter((_, j) => j !== i),
                  )
                }
              >
                <X aria-hidden strokeWidth={1.5} />
              </IconButton>
            </div>
          ))}
          {errors.mustHaves ? (
            <p className="m-0 text-meta text-status-danger-text">
              {errors.mustHaves}
            </p>
          ) : null}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="justify-self-start"
            disabled={form.mustHaves.length >= MAX_MUST_HAVES}
            onClick={() => set("mustHaves", [...form.mustHaves, ""])}
          >
            <Plus aria-hidden strokeWidth={1.5} />
            Add a must-have
          </Button>
        </fieldset>
      </div>

      <div className="border-t border-border pt-5">
        <Field
          label="Reply within, working days"
          hint="Each call closes by saying the team will get back within this time."
          error={errors.replyWithin}
          announce={false}
          className="sm:w-64"
        >
          <Input
            inputMode="numeric"
            value={form.replyWithin}
            onChange={(e) => set("replyWithin", e.target.value)}
          />
        </Field>
      </div>

      {error ? <Alert kind="error">{error}</Alert> : null}

      <div className="flex flex-col gap-2 border-t border-border pt-5 sm:flex-row sm:items-center">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          loading={drafting}
          disabled={busy}
          onClick={() => void onDraft()}
        >
          <Sparkles aria-hidden strokeWidth={1.5} />
          Fill from description
        </Button>
        <Button
          type="button"
          variant={dirty ? "primary" : "secondary"}
          className="sm:ml-auto"
          loading={saving}
          disabled={busy}
          onClick={() => void onSave()}
        >
          Save requirements
        </Button>
      </div>
    </div>
  );
}

/** For people who can't edit the job: the requirements as the lines calls are checked against. */
export function RequirementsSummary({
  requirements,
}: {
  requirements: JobRequirements | null | undefined;
}) {
  const lines = requirementLines(requirements);
  if (lines.length === 0) {
    return (
      <p className="m-0 text-text-2">
        No requirements set. Calls aren’t sorted by fit.
      </p>
    );
  }
  return (
    <ul className="m-0 list-disc space-y-1.5 pl-5 text-text marker:text-text-3">
      {lines.map((l) => (
        <li key={l.requirement}>{l.label}</li>
      ))}
    </ul>
  );
}
