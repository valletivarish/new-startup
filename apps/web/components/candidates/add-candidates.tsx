'use client';

import { useId, useState, type FormEvent } from 'react';
import { CircleCheck, TriangleAlert, Upload, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FileInput, Input, Textarea } from '@/components/ui/input';
import { Alert, type AlertKind } from '@/components/ui/notice';
import { PhoneField } from '@/components/PhoneField';
import {
  confirmCandidateImport,
  createCandidate,
  previewCandidateImport,
  type CandidateImportRow,
} from '@/lib/api';
import { toUserMessage, type UserMessage } from '@/lib/errors';
import { splitE164 } from '@/lib/phone-field';
import { labelImportIssues } from '@/lib/status-labels';
import { ACCEPT_DOCUMENT, fileToBase64, resolveUploadContentType } from '@/lib/upload';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** One candidate: name, mobile, and a resume file or pasted resume (the number can come from it). */
export function AddCandidateDialog({
  open,
  onOpenChange,
  jobId,
  jobTitle,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: string;
  jobTitle: string;
  /** After the candidate is saved: refresh the list. */
  onAdded: () => void;
}) {
  const formId = useId();
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [resumeText, setResumeText] = useState('');
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<{ name?: string; phone?: string }>({});
  const [failure, setFailure] = useState<UserMessage | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const name = fullName.trim();
    const mobile = phone.trim();
    const next = {
      name: name ? undefined : 'Enter their full name.',
      phone: mobile || resumeText.trim() || resumeFile ? undefined : 'Add a mobile number, or a resume that has one.',
    };
    setErrors(next);
    if (next.name || next.phone || busy) return;
    setBusy(true);
    setFailure(null);
    try {
      await createCandidate({
        jobId,
        fullName: name,
        phone: mobile || undefined,
        countryCode: mobile ? `+${splitE164(mobile).dial}` : '+91',
        resumeText: resumeText.trim() || undefined,
        resumeFile: resumeFile
          ? {
              name: resumeFile.name,
              contentType: resolveUploadContentType(resumeFile),
              content: await fileToBase64(resumeFile),
              contentEncoding: 'base64',
            }
          : undefined,
      });
      toast.success(`Added ${name}`);
      setFullName('');
      setPhone('');
      setResumeText('');
      setResumeFile(null);
      onOpenChange(false);
      onAdded();
    } catch (e) {
      setFailure(toUserMessage(e, 'add this candidate'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        // The file picker starts empty when the dialog opens again, so the chosen file goes too.
        if (!next) setResumeFile(null);
        onOpenChange(next);
      }}
    >
      <DialogContent className="w-[min(30rem,calc(100vw-2rem))]">
        <DialogHeader>
          <DialogTitle>Add a candidate</DialogTitle>
          <DialogDescription>
            They join {jobTitle}. HRVoice calls the mobile number you add here.
          </DialogDescription>
        </DialogHeader>
        <form id={formId} noValidate onSubmit={(e) => void submit(e)} className="grid gap-4">
          {failure ? (
            <Alert kind="error" title={failure.title}>
              {failure.detail}
            </Alert>
          ) : null}
          <Field label="Full name" error={errors.name}>
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="off" />
          </Field>
          <Field
            label="Mobile number"
            hint="Needed to call them. Leave it empty if their resume has it."
            error={errors.phone}
          >
            <PhoneField value={phone} onChange={setPhone} placeholder="Mobile number" />
          </Field>
          <Field label="Resume (optional)" hint="PDF, Word, PowerPoint or text.">
            <FileInput accept={ACCEPT_DOCUMENT} onFileChange={setResumeFile} emptyLabel="No file chosen" />
          </Field>
          <Field label="Or paste their resume (optional)">
            <Textarea value={resumeText} onChange={(e) => setResumeText(e.target.value)} rows={3} />
          </Field>
        </form>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="secondary" disabled={busy}>
              Cancel
            </Button>
          </DialogClose>
          <Button type="submit" form={formId} loading={busy}>
            <UserPlus aria-hidden strokeWidth={1.5} />
            Add candidate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type Message = { kind: AlertKind; title: string; body?: string };
type EditableField = 'fullName' | 'countryCode' | 'phone' | 'email';

const COLUMNS: { key: EditableField; label: string; width: string; issue: (row: CandidateImportRow) => boolean }[] = [
  { key: 'fullName', label: 'Full name', width: 'min-w-[8.5rem]', issue: (r) => r.issues.includes('missing_full_name') },
  {
    key: 'countryCode',
    label: 'Country code',
    width: 'w-[4.5rem]',
    issue: (r) => r.issues.includes('missing_country_code'),
  },
  {
    key: 'phone',
    label: 'Phone',
    width: 'w-[8rem]',
    issue: (r) =>
      r.issues.some((i) => i === 'missing_phone' || i === 'invalid_phone' || i.startsWith('duplicate')),
  },
  { key: 'email', label: 'Email', width: 'min-w-[9rem]', issue: (r) => r.issues.includes('invalid_email') },
];

/** Re-checks what can be checked here; the server's own findings stay until rows are checked again. */
function patched(row: CandidateImportRow, patch: Partial<Pick<CandidateImportRow, EditableField>>): CandidateImportRow {
  const next = { ...row, ...patch };
  const issues: CandidateImportRow['issues'] = [];
  if (!next.fullName?.trim()) issues.push('missing_full_name');
  if (!next.countryCode?.trim()) issues.push('missing_country_code');
  if (!next.phone?.trim()) issues.push('missing_phone');
  for (const issue of row.issues) {
    if (
      issue === 'duplicate_in_batch' ||
      issue === 'duplicate_on_job' ||
      issue === 'invalid_phone' ||
      issue === 'invalid_email'
    ) {
      issues.push(issue);
    }
  }
  return { ...next, issues, valid: issues.length === 0 };
}

/** Many candidates from a CSV: check the rows, fix them in place, add the ready ones. */
export function ImportCandidatesDialog({
  open,
  onOpenChange,
  jobId,
  jobTitle,
  onImported,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: string;
  jobTitle: string;
  /** After candidates are added: refresh the list. */
  onImported: () => void;
}) {
  const [text, setText] = useState('');
  const [rows, setRows] = useState<CandidateImportRow[] | null>(null);
  const [busy, setBusy] = useState<'check' | 'add' | null>(null);
  const [message, setMessage] = useState<Message | null>(null);
  const ready = rows?.filter((r) => r.valid && r.fullName && r.countryCode && r.phone) ?? [];
  const needFix = (rows?.length ?? 0) - (rows?.filter((r) => r.valid).length ?? 0);

  async function check() {
    const csvText = text.trim();
    if (!csvText || busy) return;
    setBusy('check');
    setMessage(null);
    try {
      const result = await previewCandidateImport(jobId, csvText);
      setRows(result.rows.map((r) => ({ ...r, issues: [...r.issues] })));
      if (result.summary.valid === 0) {
        setMessage({
          kind: 'warning',
          title: 'None of these rows can be added yet',
          body: 'Fix the highlighted cells, then check the rows again.',
        });
      }
    } catch (e) {
      const m = toUserMessage(e, 'check these rows');
      setMessage({ kind: 'error', title: m.title, body: m.detail });
    } finally {
      setBusy(null);
    }
  }

  async function readFile(file: File | null) {
    if (!file) return;
    try {
      setText(await file.text());
      setRows(null);
      setMessage(null);
    } catch {
      setMessage({ kind: 'error', title: 'Couldn’t read that file.', body: 'Choose it again, or paste the rows.' });
    }
  }

  async function add() {
    if (!rows || busy) return;
    if (ready.length === 0) {
      setMessage({
        kind: 'warning',
        title: 'No rows are ready yet',
        body: 'Fix the highlighted cells, then check the rows again.',
      });
      return;
    }
    setBusy('add');
    setMessage(null);
    try {
      const result = await confirmCandidateImport(
        jobId,
        ready.map((r) => ({
          fullName: r.fullName!,
          countryCode: r.countryCode!,
          phone: r.phone!,
          ...(r.email ? { email: r.email } : {}),
        })),
      );
      const created = result.created.length;
      const skipped = result.skipped;
      if (created > 0) toast.success(`Added ${plural(created, 'candidate', 'candidates')} to ${jobTitle}`);
      const createdPhones = new Set(result.created.map((c) => c.phone));
      const remaining = rows.filter((r) => !(r.valid && r.phone && createdPhones.has(r.phone)));
      setRows(remaining.length > 0 ? remaining : null);
      if (skipped > 0) {
        setMessage({
          kind: 'warning',
          title: `${plural(skipped, 'row was', 'rows were')} left out`,
          body: 'They aren’t valid, or the person is already on this job. Fix them below, or close.',
        });
      } else if (remaining.length > 0) {
        setMessage({
          kind: 'info',
          title: `Added ${plural(created, 'candidate', 'candidates')}`,
          body: 'The rows below still need a fix. Fix them and check the rows again, or close.',
        });
      } else if (created > 0) {
        setText('');
        onOpenChange(false);
      }
      onImported();
    } catch (e) {
      const m = toUserMessage(e, 'add these candidates');
      setMessage({ kind: 'error', title: m.title, body: m.detail });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="w-[min(52rem,calc(100vw-2rem))]">
        <DialogHeader>
          <DialogTitle>Upload a CSV</DialogTitle>
          <DialogDescription>
            Add many candidates to {jobTitle} at once: one person per row, with their full name, country code and
            phone. Columns named Name, Mobile or Dial code work too.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <Field label="CSV file">
            <FileInput
              accept=".csv,text/csv,text/plain"
              variant="dropzone"
              onFileChange={(file) => void readFile(file)}
              buttonLabel="Choose CSV"
              emptyLabel="Drop a CSV here, or choose one"
            />
          </Field>
          <Field label="Or paste rows" hint="The first row names the columns.">
            <Textarea
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setRows(null);
                setMessage(null);
              }}
              rows={5}
              spellCheck={false}
              placeholder="Full name,Country code,Phone,Email"
            />
          </Field>
          {message ? (
            <Alert kind={message.kind} title={message.title}>
              {message.body}
            </Alert>
          ) : null}
          {rows && rows.length > 0 ? (
            <div className="grid gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="m-0 text-label font-medium tabular-nums text-text">
                  {[
                    rows.length > needFix ? `${plural(rows.length - needFix, 'row', 'rows')} ready to add` : null,
                    needFix > 0 ? `${plural(needFix, 'row', 'rows')} to fix` : null,
                  ]
                    .filter(Boolean)
                    .join(', ')}
                </p>
                {rows.some((r) => !r.countryCode?.trim()) ? (
                  <Button
                    type="button"
                    variant="tertiary"
                    size="sm"
                    disabled={busy !== null}
                    onClick={() =>
                      setRows((prev) =>
                        prev ? prev.map((r) => (r.countryCode?.trim() ? r : patched(r, { countryCode: '+91' }))) : prev,
                      )
                    }
                  >
                    Use +91 where the code is missing
                  </Button>
                ) : null}
              </div>
              <div className="overflow-x-auto rounded-card-sm border border-border">
                <table className="w-full min-w-[42rem] border-collapse text-left text-body">
                  <thead>
                    <tr className="border-b border-border bg-subtle text-caption font-medium text-text-3">
                      <th scope="col" className="px-3 py-2.5 font-medium">
                        Row
                      </th>
                      {COLUMNS.map((c) => (
                        <th key={c.key} scope="col" className="px-2 py-2.5 font-medium">
                          {c.label}
                        </th>
                      ))}
                      <th scope="col" className="px-3 py-2.5 font-medium">
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {rows.map((row) => (
                      <tr key={row.rowIndex} className={row.valid ? undefined : 'bg-status-danger-bg'}>
                        <td className="px-3 py-2 align-middle tabular-nums text-text-3">{row.rowIndex}</td>
                        {COLUMNS.map((c) => {
                          const bad = c.issue(row);
                          return (
                            <td key={c.key} className="px-2 py-2 align-middle">
                              <Input
                                value={row[c.key] ?? ''}
                                aria-label={`${c.label}, row ${row.rowIndex}`}
                                aria-invalid={bad || undefined}
                                onChange={(e) =>
                                  setRows((prev) =>
                                    prev
                                      ? prev.map((r) =>
                                          r.rowIndex === row.rowIndex
                                            ? patched(r, { [c.key]: e.target.value || null })
                                            : r,
                                        )
                                      : prev,
                                  )
                                }
                                className={cn('h-9 px-2.5 [@media(pointer:coarse)]:h-11', c.width)}
                              />
                            </td>
                          );
                        })}
                        <td className="px-3 py-2 align-middle">
                          {row.valid ? (
                            <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-meta font-medium text-status-success-text">
                              <CircleCheck aria-hidden strokeWidth={1.75} className="size-4 shrink-0" />
                              Ready
                            </span>
                          ) : (
                            <span className="inline-flex min-w-[8rem] items-start gap-1.5 text-meta font-medium text-status-danger-text">
                              <TriangleAlert aria-hidden strokeWidth={1.75} className="mt-px size-4 shrink-0" />
                              {labelImportIssues(row.issues)}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="m-0 text-meta text-text-3">
                Missing names and codes can be fixed here. For anything else, fix the rows above and check them
                again.
              </p>
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="secondary" disabled={busy !== null}>
              Close
            </Button>
          </DialogClose>
          <Button
            type="button"
            variant="secondary"
            loading={busy === 'check'}
            disabled={!text.trim() || busy === 'add'}
            onClick={() => void check()}
          >
            Check rows
          </Button>
          <Button
            type="button"
            loading={busy === 'add'}
            disabled={ready.length === 0 || busy === 'check'}
            onClick={() => void add()}
          >
            <Upload aria-hidden strokeWidth={1.5} />
            {ready.length > 0 ? `Add ${plural(ready.length, 'candidate', 'candidates')}` : 'Add candidates'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
