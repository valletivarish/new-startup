'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  Briefcase,
  CircleCheck,
  Clock,
  Ellipsis,
  FileCheckCorner,
  House,
  Phone,
  PhoneMissed,
  Plus,
  RotateCw,
  Trash2,
  Upload,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { BrandLink, LogoMark } from '@/components/brand/logo-mark';
import { HiringVoiceFace } from '@/components/fx/HiringVoiceFace';
import { PhoneField } from '@/components/PhoneField';
import { AnswersList, type Answer } from '@/components/shared/answers-list';
import { JobHeader } from '@/components/shared/job-header';
import { LiveCallStrip } from '@/components/shared/live-call-strip';
import { OriginTicket } from '@/components/shared/origin-ticket';
import { RecordingPlayer, type RecordingPlayerHandle } from '@/components/shared/recording-player';
import { Transcript, type TranscriptTurn } from '@/components/shared/transcript';
import { UserInitials } from '@/components/shared/user-initials';
import { Badge } from '@/components/ui/badge';
import { Bay, BayBoard } from '@/components/ui/bay';
import { Breadcrumb } from '@/components/ui/breadcrumb';
import { Button, buttonVariants } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandLoading,
  CommandSeparator,
} from '@/components/ui/command';
import { ConfirmDialog, ConfirmInline } from '@/components/ui/confirm';
import { CopyField } from '@/components/ui/copy-field';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { IconButton } from '@/components/ui/icon-button';
import { Field, FileInput, Input, PasswordInput, Select, Textarea } from '@/components/ui/input';
import { Kbd } from '@/components/ui/kbd';
import {
  DataList,
  DataListBody,
  DataListHeader,
  DataListMeta,
  DataListRow,
  DataListTitle,
} from '@/components/ui/list';
import { Notice } from '@/components/ui/notice';
import { OfflineBanner } from '@/components/ui/offline-banner';
import { PageHeader, PageMain } from '@/components/ui/page-header';
import { Segmented } from '@/components/ui/segmented';
import {
  Sheet,
  SheetBody,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { SkeletonBoard, SkeletonPage, SkeletonStrips } from '@/components/ui/skeleton';
import { StateTag, StatusTag, type StateFamily } from '@/components/ui/state-tag';
import { StatusIndicator, type VoiceStatus } from '@/components/ui/status-indicator';
import { Strip, StripCell, StripList, StripPrimary } from '@/components/ui/strip';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SHEET_TOASTER, toastUndo } from '@/components/ui/toaster';
import { Tooltip } from '@/components/ui/tooltip';
import { formatPhoneMasked } from '@/lib/format';
import { getStateMeta, STATE_MAP, type StateDomain } from '@/lib/status-labels';
import { cn } from '@/lib/utils';

/* Sample data. Every name, number and link on this page is made up. */

const JOB = 'Java backend developer, Bengaluru';
const PHONE = '+919000000001';
const MB = 1024 * 1024;

const TURNS: TranscriptTurn[] = [
  { speaker: 'agent', at: 4, text: 'Hello, this is the hiring agent calling about the Java backend developer role. Is now a good time for a few questions?' },
  { speaker: 'contact', name: 'Priya Sharma', at: 11, text: 'Yes, I have a few minutes.' },
  { speaker: 'agent', at: 15, text: 'How many years have you worked with Spring Boot?' },
  { speaker: 'contact', name: 'Priya Sharma', at: 21, text: 'About four years, mostly on payment services.' },
  { speaker: 'agent', at: 34, text: 'What is your notice period?' },
  { speaker: 'contact', name: 'Priya Sharma', at: 38, text: 'Thirty days.' },
  { speaker: 'agent', at: 44, text: 'The role is hybrid, three days a week in the Bengaluru office. Does that work for you?' },
  { speaker: 'contact', name: 'Priya Sharma', at: 52, text: 'Yes, I already live in Bengaluru.' },
  { speaker: 'contact', name: 'Priya Sharma', at: 56, text: 'I also have another offer, so I would like to hear back soon.' },
  { speaker: 'agent', at: 63, text: 'Thank you. The team will read this call and get back to you.' },
];

const ANSWERS: Answer[] = [
  { question: 'Spring Boot experience', answer: 'About four years, mostly on payment services.', at: 21 },
  { question: 'Notice period', answer: 'Thirty days.', at: 38 },
  { question: 'Current location or relocation', answer: 'Already lives in Bengaluru.', at: 52 },
  { question: 'Expected salary', answer: null },
  { question: 'Available for a technical round', answer: null },
  { question: 'Other offers', answer: 'Has another offer and would like to hear back soon.', at: 56, extra: true },
];

const PEOPLE = [
  { id: 'priya', name: 'Priya Sharma', phone: '+919000000001', source: 'From a file', answered: '3 of 5 answered', call: 'ready_for_review' },
  { id: 'rahul', name: 'Rahul Verma', phone: '+919000000002', source: 'Added by hand', answered: '5 of 5 answered', call: 'ready_for_review' },
  { id: 'asha', name: 'Asha Rao', phone: '+919000000003', source: 'From a CSV', answered: null, call: 'no_answer' },
  { id: 'arjun', name: 'Arjun Nair', phone: '+919000000004', source: 'From a CSV', answered: null, call: 'not_called' },
] as const;

const FAMILIES: { family: StateFamily; word: string; glyph: LucideIcon | 'live' }[] = [
  { family: 'queued', word: 'Not called yet', glyph: Clock },
  { family: 'live', word: 'On call', glyph: 'live' },
  { family: 'review', word: 'Ready for review', glyph: FileCheckCorner },
  { family: 'decided', word: 'Moved forward', glyph: CircleCheck },
  { family: 'failed', word: 'No answer', glyph: PhoneMissed },
];

const DOMAINS: Record<StateDomain, string> = {
  candidate: 'Candidate stage',
  call: 'Call',
  voice: 'Test call',
  job: 'Job',
  agent: 'Agent',
  invite: 'Invite',
};

const VOICE: VoiceStatus[] = [
  'idle',
  'connecting',
  'connected',
  'listening',
  'processing',
  'speaking',
  'interrupted',
  'reconnecting',
  'completed',
  'failed',
];

const SECTIONS = [
  ['brand', 'Brand'],
  ['buttons', 'Buttons'],
  ['fields', 'Fields'],
  ['filters', 'Filters and tabs'],
  ['overlays', 'Dialogs, sheets and toasts'],
  ['feedback', 'Notices and page states'],
  ['loading', 'Loading'],
  ['states', 'State tags'],
  ['strips', 'Strips'],
  ['bays', 'Bays'],
  ['headers', 'Page headers'],
  ['evidence', 'Call evidence'],
  ['live', 'Live calls'],
  ['search', 'Search'],
  ['legacy', 'Legacy wrappers'],
] as const;

/** Silent 8-bit mono WAV, so the recording player has something real to play and seek. */
function silentWav(seconds: number, rate = 8000): Blob {
  const samples = seconds * rate;
  const view = new DataView(new ArrayBuffer(44 + samples));
  const text = (at: number, s: string) => [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples, true);
  text(8, 'WAVEfmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate, true); // bytes per second
  view.setUint16(32, 1, true); // bytes per frame
  view.setUint16(34, 8, true); // bits per sample
  text(36, 'data');
  view.setUint32(40, samples, true);
  new Uint8Array(view.buffer, 44).fill(128); // 8-bit silence sits at the midpoint
  return new Blob([view.buffer], { type: 'audio/wav' });
}

/** Resolves a sample request after a short pause, like a real round trip. */
function later(fn: () => void) {
  window.setTimeout(fn, 1200);
}

function Section({ id, title, note, children }: { id: string; title: string; note?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-6 border-t border-line pt-8">
      <h2 id={`${id}-title`} className="m-0 text-section font-bold stretch-announce">
        {title}
      </h2>
      {note ? <p className="mb-0 mt-1 max-w-[65ch] text-ink-2">{note}</p> : null}
      <div className="mt-6 grid gap-8">{children}</div>
    </section>
  );
}

function Specimen({ title, className, children }: { title: string; className?: string; children: ReactNode }) {
  return (
    <div className="grid min-w-0 gap-3">
      <h3 className="m-0 text-label font-semibold text-ink-2">{title}</h3>
      <div className={cn('flex flex-wrap items-center gap-3', className)}>{children}</div>
    </div>
  );
}

/** A board-coloured frame for samples that bring their own page furniture. */
function Frame({ children }: { children: ReactNode }) {
  return <div className="min-w-0 border border-line bg-board p-4 sm:p-6">{children}</div>;
}

function BrandSection() {
  return (
    <Section id="brand" title="Brand">
      <Specimen title="LogoMark: sm, md, lg">
        <LogoMark size="sm" />
        <LogoMark size="md" />
        <LogoMark size="lg" />
      </Specimen>
      <Specimen title="Wordmark link">
        <BrandLink href="#brand" />
      </Specimen>
      <Specimen title="User initials: two words, one word, no name">
        <UserInitials name="Priya Sharma" />
        <UserInitials name="Rahul" />
        <UserInitials name={null} />
      </Specimen>
    </Section>
  );
}

const VARIANTS = [
  ['primary', 'Primary', 'Create job'],
  ['secondary', 'Secondary', 'Import CSV'],
  ['quiet', 'Quiet', 'Discard changes'],
  ['danger', 'Danger', 'Remove from workspace'],
] as const;

function ButtonsSection() {
  return (
    <Section
      id="buttons"
      title="Buttons"
      note="Each variant at rest, with an icon, small, loading and disabled. Hover, press and tab through them."
    >
      {VARIANTS.map(([variant, name, label]) => (
        <Specimen key={variant} title={name}>
          <Button variant={variant}>{label}</Button>
          <Button variant={variant}>
            <Plus strokeWidth={1.75} aria-hidden />
            {label}
          </Button>
          <Button variant={variant} size="sm">
            {label}
          </Button>
          <Button variant={variant} loading>
            <Upload strokeWidth={1.75} aria-hidden />
            Saving
          </Button>
          <Button variant={variant} disabled>
            {label}
          </Button>
        </Specimen>
      ))}
      <Specimen title="On a rail: primary stays yellow, secondary turns on-rail">
        <div data-surface="rail" className="flex flex-wrap items-center gap-3 bg-rail p-4">
          <Button>Start a pilot</Button>
          <Button variant="on-rail">Sign in</Button>
          <Button variant="on-rail" loading>
            Signing in
          </Button>
          <Button variant="on-rail" disabled>
            Sign in
          </Button>
        </div>
      </Specimen>
      <Specimen title="Icon buttons with tooltips, a link drawn as a button, a key hint">
        <IconButton label="Delete candidate">
          <Trash2 strokeWidth={1.75} aria-hidden />
        </IconButton>
        <IconButton label="More actions" variant="secondary">
          <Ellipsis strokeWidth={1.75} aria-hidden />
        </IconButton>
        <IconButton label="Retry" disabled>
          <RotateCw strokeWidth={1.75} aria-hidden />
        </IconButton>
        <Link href="#buttons" className={buttonVariants({ variant: 'secondary' })}>
          Link drawn as a button
        </Link>
        <Tooltip content="Opens search from anywhere">
          <Button variant="quiet">
            Search <Kbd>⌘K</Kbd>
          </Button>
        </Tooltip>
      </Specimen>
      <Specimen title="Legacy variant names still render: default, outline, ghost, destructive, link">
        <Button variant="default">Default</Button>
        <Button variant="outline">Outline</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="destructive">Destructive</Button>
        <Button variant="link">Link</Button>
      </Specimen>
    </Section>
  );
}

function FieldsSection() {
  const [phone, setPhone] = useState(PHONE);
  const [publish, setPublish] = useState(true);
  const [copy, setCopy] = useState(false);
  const [all, setAll] = useState<'some' | 'all' | 'none'>('some');
  return (
    <Section
      id="fields"
      title="Fields"
      note="Label above, hint under the label, error under the control. Hints and errors are tied to the control with aria-describedby; errors also set aria-invalid."
    >
      <div className="grid gap-6 md:grid-cols-2">
        <Field label="Work email" hint="We send the invite here.">
          <Input type="email" placeholder="name@example.com" autoComplete="off" />
        </Field>
        <Field label="Job title" error="Add a job title." announce={false}>
          <Input />
        </Field>
        <Field label="Company name" hint="Shown to your team, e.g. Sharma Logistics">
          <Input defaultValue="Sample Logistics" disabled />
        </Field>
        <Field label="Voice and language">
          <Select defaultValue="en">
            <option value="en">English</option>
            <option value="hi">Hindi</option>
          </Select>
        </Field>
        <Field label="Job description (used on calls)" hint="What candidates hear about the role." className="md:col-span-2">
          <Textarea placeholder="What the role involves, where it is based, how the team works." />
        </Field>
        <Field label="Password" hint="At least 8 characters.">
          <PasswordInput autoComplete="new-password" />
        </Field>
        <Field label="Mobile number" hint="India (+91) is preselected.">
          <PhoneField value={phone} onChange={setPhone} />
        </Field>
        <Field label="Resume" hint="PDF or DOCX, up to 10 MB. Larger or other files are refused with a reason.">
          <FileInput accept=".pdf,.docx" maxBytes={10 * MB} />
        </Field>
        <Field label="Job description file" hint="Drop a file here or choose one." className="md:col-span-2">
          <FileInput accept=".pdf,.docx,.pptx,.txt,.md" maxBytes={10 * MB} variant="dropzone" />
        </Field>
      </div>
      <Specimen title="Checkboxes: on, off, some selected, disabled, named for screen readers only">
        <Checkbox label="Publish when saved" checked={publish} onChange={(e) => setPublish(e.target.checked)} />
        <Checkbox label="Email me a copy" checked={copy} onChange={(e) => setCopy(e.target.checked)} />
        <Checkbox
          label="Select all"
          checked={all === 'all'}
          indeterminate={all === 'some'}
          onChange={() => setAll(all === 'all' ? 'none' : 'all')}
        />
        <Checkbox label="Locked off" disabled />
        <Checkbox label="Locked on" disabled defaultChecked />
        <Checkbox aria-label="Select Priya Sharma" />
      </Specimen>
    </Section>
  );
}

function FiltersSection() {
  const [filter, setFilter] = useState<'open' | 'draft' | 'closed' | 'all'>('open');
  return (
    <Section
      id="filters"
      title="Filters and tabs"
      note="Segmented filters a list (a radio group: arrow keys, Home, End). Tabs switch panels. Never one in place of the other."
    >
      <Specimen title="Segmented, with counts only where they are known">
        <Segmented
          label="Filter jobs"
          value={filter}
          onValueChange={setFilter}
          options={[
            { value: 'open', label: 'Open', count: 12 },
            { value: 'draft', label: 'Draft', count: 3 },
            { value: 'closed', label: 'Closed', count: 8 },
            { value: 'all', label: 'All' },
          ]}
        />
      </Specimen>
      <Specimen title="Tabs, one disabled" className="block">
        <Tabs defaultValue="answers" className="max-w-2xl">
          <TabsList aria-label="Candidate sections">
            <TabsTrigger value="answers">Answers</TabsTrigger>
            <TabsTrigger value="calls">Calls</TabsTrigger>
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="history" disabled>
              History
            </TabsTrigger>
          </TabsList>
          <TabsContent value="answers">
            <p className="m-0 text-ink-2">3 of 5 questions answered on the latest call.</p>
          </TabsContent>
          <TabsContent value="calls">
            <p className="m-0 text-ink-2">Two calls: one ended, one didn’t connect.</p>
          </TabsContent>
          <TabsContent value="details">
            <p className="m-0 text-ink-2">Name and phone number, editable.</p>
          </TabsContent>
          <TabsContent value="history">
            <p className="m-0 text-ink-2">Stage changes, each with its reason.</p>
          </TabsContent>
        </Tabs>
      </Specimen>
    </Section>
  );
}

function OverlaysSection() {
  const [createOpen, setCreateOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [titleError, setTitleError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [confirm, setConfirm] = useState<'call' | 'remove' | null>(null);
  const [busy, setBusy] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const failNext = useRef(true);
  const [revoking, setRevoking] = useState(false);
  const [revokeBusy, setRevokeBusy] = useState(false);
  const [sheetRemoving, setSheetRemoving] = useState(false);

  useEffect(() => {
    if (!blocked) return;
    const timer = window.setTimeout(() => setBlocked(false), 4000);
    return () => window.clearTimeout(timer);
  }, [blocked]);

  function closeCreate(open: boolean) {
    setCreateOpen(open);
    if (!open) {
      setTitle('');
      setTitleError(null);
    }
  }

  return (
    <Section
      id="overlays"
      title="Dialogs, sheets and toasts"
      note="Focus moves in, stays in, and returns to whatever opened it. Errors show inside the dialog. Real-world and destructive actions confirm first."
    >
      <Specimen title="Dialog with an error inside it (submit it empty)">
        <Dialog open={createOpen} onOpenChange={closeCreate}>
          <DialogTrigger asChild>
            <Button>
              <Plus strokeWidth={1.75} aria-hidden />
              Create job
            </Button>
          </DialogTrigger>
          <DialogContent>
            <form
              noValidate
              className="grid gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                if (!title.trim()) {
                  setTitleError('Add a job title.');
                  return;
                }
                closeCreate(false);
                toast.success('Job created', { description: 'Sample only. Nothing was saved.' });
              }}
            >
              <DialogHeader>
                <DialogTitle>Create job</DialogTitle>
                <DialogDescription>Give the job a title. You add the description and questions next.</DialogDescription>
              </DialogHeader>
              <Field label="Job title" error={titleError}>
                <Input
                  value={title}
                  placeholder="Java backend developer"
                  onChange={(event) => {
                    setTitle(event.target.value);
                    setTitleError(null);
                  }}
                />
              </Field>
              <DialogFooter>
                <DialogClose asChild>
                  <Button type="button" variant="secondary">
                    Cancel
                  </Button>
                </DialogClose>
                <Button type="submit">Create job</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </Specimen>

      <Specimen title="Sheet that can't close while its request is in flight">
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="secondary">Open candidate sheet</Button>
          </SheetTrigger>
          <SheetContent closeBlockedReason={blocked ? 'The call is connecting. Close once it has.' : undefined}>
            <SheetHeader>
              <SheetTitle>Priya Sharma</SheetTitle>
              <SheetDescription>{JOB} (sample)</SheetDescription>
            </SheetHeader>
            <SheetBody className="grid content-start gap-4">
              <div className="flex flex-wrap items-center gap-3">
                <StatusTag domain="candidate" value="new" />
                <span className="text-label tabular-nums text-ink-2">{formatPhoneMasked(PHONE)}</span>
              </div>
              <p className="m-0 text-ink-2">
                Start a request, then try Escape, a click outside, the close button or Close. For 4 seconds
                none of them close the sheet, and the close button says why.
              </p>
              <Button variant="secondary" className="justify-self-start" loading={blocked} onClick={() => setBlocked(true)}>
                Start a request
              </Button>
              <p className="m-0 text-ink-2">
                Move forward raises its Undo toast inside the sheet, so Tab reaches Undo. Escape in the
                inline confirmation cancels it and leaves the sheet open.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={() =>
                    toastUndo('Moved forward', () => toast('Move undone', { toasterId: SHEET_TOASTER }), {
                      description: 'Priya Sharma (sample)',
                      toasterId: SHEET_TOASTER,
                    })
                  }
                >
                  Move forward
                </Button>
                {sheetRemoving ? null : (
                  <Button id="sample-sheet-remove" variant="danger" onClick={() => setSheetRemoving(true)}>
                    Remove from this job
                  </Button>
                )}
              </div>
              {sheetRemoving ? (
                <ConfirmInline
                  tone="danger"
                  message="Remove Priya from this job?"
                  confirmLabel="Remove from this job"
                  onCancel={() => setSheetRemoving(false)}
                  onConfirm={() => {
                    setSheetRemoving(false);
                    toast.success('Removed from this job', {
                      description: 'Sample only. Nothing changed.',
                      toasterId: SHEET_TOASTER,
                    });
                  }}
                />
              ) : null}
            </SheetBody>
            <SheetFooter>
              <SheetClose asChild>
                <Button variant="secondary">Close</Button>
              </SheetClose>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      </Specimen>

      <Specimen title="Confirm dialogs: real-world, and danger that fails once">
        <Button onClick={() => setConfirm('call')}>Call now</Button>
        <Button variant="danger" onClick={() => setConfirm('remove')}>
          Remove from this job
        </Button>
        <ConfirmDialog
          open={confirm === 'call'}
          onOpenChange={(open) => !open && setConfirm(null)}
          tone="real-world"
          title="Call Priya now?"
          body={`This places a real phone call to ${formatPhoneMasked(PHONE)}.`}
          confirmLabel="Call now"
          busy={busy}
          onConfirm={() => {
            setBusy(true);
            later(() => {
              setBusy(false);
              setConfirm(null);
              toast.success('Calling Priya Sharma', { description: 'Sample only. No call was placed.' });
            });
          }}
        />
        <ConfirmDialog
          open={confirm === 'remove'}
          onOpenChange={(open) => {
            if (open) return;
            setConfirm(null);
            setRemoveError(null);
          }}
          tone="danger"
          title="Remove Rahul from this job?"
          body="Their calls and answers stay in Calls."
          confirmLabel="Remove from this job"
          busy={busy}
          error={removeError}
          onConfirm={() => {
            setBusy(true);
            setRemoveError(null);
            later(() => {
              setBusy(false);
              if (failNext.current) {
                failNext.current = false;
                setRemoveError('Couldn’t remove Rahul. Check your connection, then retry.');
                return;
              }
              failNext.current = true;
              setConfirm(null);
              toast.success('Removed from this job', { description: 'Sample only. Nothing changed.' });
            });
          }}
        />
      </Specimen>

      <Specimen title="Inline confirmation in a row">
        {revoking ? (
          <ConfirmInline
            className="w-full max-w-xl"
            message="Revoke this invite? The link stops working."
            confirmLabel="Revoke invite"
            tone="danger"
            busy={revokeBusy}
            onConfirm={() => {
              setRevokeBusy(true);
              later(() => {
                setRevokeBusy(false);
                setRevoking(false);
                toast.success('Invite revoked', { description: 'Sample only.' });
              });
            }}
            onCancel={() => setRevoking(false)}
          />
        ) : (
          <Button id="sample-revoke-invite" variant="secondary" onClick={() => setRevoking(true)}>
            Revoke invite
          </Button>
        )}
      </Specimen>

      <Specimen title="Toasts: success with Undo, error, warning, info, plain">
        <Button
          variant="secondary"
          onClick={() =>
            toastUndo('Moved forward', () => toast('Move undone'), { description: 'Priya Sharma (sample)' })
          }
        >
          Success with Undo
        </Button>
        <Button
          variant="secondary"
          onClick={() => toast.error('Couldn’t save changes.', { description: 'Check your connection, then retry.' })}
        >
          Error
        </Button>
        <Button
          variant="secondary"
          onClick={() => toast.warning('This job has no questions yet.', { description: 'Calls only cover the basics.' })}
        >
          Warning
        </Button>
        <Button variant="secondary" onClick={() => toast.info('Invite link copied.')}>
          Info
        </Button>
        <Button variant="secondary" onClick={() => toast('Draft restored.')}>
          Plain
        </Button>
      </Specimen>

      <Specimen title="Copy field" className="block">
        <CopyField
          label="Invite link"
          value="https://example.com/invitations/accept?token=sample-token"
          className="max-w-xl"
        />
      </Specimen>
    </Section>
  );
}

function FeedbackSection() {
  const [retrying, setRetrying] = useState(false);
  const [offline, setOffline] = useState(false);
  const retry = () => {
    setRetrying(true);
    later(() => setRetrying(false));
  };
  return (
    <Section id="feedback" title="Notices and page states">
      <Specimen title="Notice: info, success, warning, error" className="grid items-stretch">
        <Notice kind="info" title="Phone calls start once your line is connected.">
          Until then, start a test call in your browser.
        </Notice>
        <Notice kind="success" title="Changes saved." />
        <Notice kind="warning" title="Unsaved changes." action={<Button size="sm">Save changes</Button>}>
          Save before you leave this page, or your edits are lost.
        </Notice>
        <Notice
          kind="error"
          title="Couldn’t load candidates."
          action={
            <Button variant="secondary" size="sm" loading={retrying} onClick={retry}>
              Retry
            </Button>
          }
        >
          Check your connection, then retry.
        </Notice>
      </Specimen>
      <Specimen title="Error state: a server error with its support reference, then offline" className="grid items-stretch">
        <ErrorState
          title="Couldn’t load candidates."
          cause="Something failed on our side."
          nextStep="Retry in a minute."
          onRetry={retry}
          retrying={retrying}
          supportRef="4F2A91C3"
        />
        <ErrorState variant="offline" onRetry={retry} retrying={retrying} />
      </Specimen>
      <Specimen title="Empty state" className="block">
        <EmptyState
          title="No candidates on this job yet."
          description="Add one person, or import a CSV."
          action={
            <Button>
              <Plus strokeWidth={1.75} aria-hidden />
              Add candidates
            </Button>
          }
        />
      </Specimen>
      <Specimen title="Offline banner (the live one sits at the top of every page)" className="grid items-stretch">
        <Checkbox label="Show it here" checked={offline} onChange={(e) => setOffline(e.target.checked)} />
        <OfflineBanner online={!offline} />
      </Specimen>
    </Section>
  );
}

function LoadingSection() {
  return (
    <Section
      id="loading"
      title="Loading"
      note="Placeholders mirror the loaded geometry, appear after 300ms, pulse only when motion is allowed, and add “Still loading…” after 8 seconds."
    >
      <Specimen title="Strips with a checkbox column" className="block">
        <SkeletonStrips rows={3} checkbox />
      </Specimen>
      <Specimen title="Bay board" className="block">
        <SkeletonBoard bays={3} rows={2} />
      </Specimen>
      <Specimen title="Page header and strips" className="block">
        <SkeletonPage rows={2} />
      </Specimen>
    </Section>
  );
}

const STAMP_CYCLE = ['dialing', 'active', 'results_pending', 'ready_for_review'] as const;

function StatesSection() {
  const [step, setStep] = useState(0);
  const value = STAMP_CYCLE[step % STAMP_CYCLE.length];
  return (
    <Section
      id="states"
      title="State tags"
      note="Every entry in the one state map (spec 2.6): tint, edge, glyph and word, never colour alone. The raw value sits beside each for reference."
    >
      {(Object.keys(STATE_MAP) as StateDomain[]).map((domain) => (
        <Specimen key={domain} title={DOMAINS[domain]} className="grid items-start gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {Object.keys(STATE_MAP[domain]).map((raw) => (
            <div key={raw} className="flex min-w-0 items-center gap-2">
              <StatusTag domain={domain} value={raw} />
              <code className="truncate text-meta text-ink-3">{raw}</code>
            </div>
          ))}
        </Specimen>
      ))}
      <Specimen title="A missing value, and a stamp on each real change">
        <StatusTag domain="call" value={null} />
        <StatusTag domain="call" value={value} stamped={value} />
        <Button variant="secondary" size="sm" onClick={() => setStep((s) => s + 1)}>
          Next call state
        </Button>
      </Specimen>
      <Specimen title="StateTag by family">
        {FAMILIES.map(({ family, word, glyph }) => (
          <StateTag key={family} family={family} glyph={glyph}>
            {word}
          </StateTag>
        ))}
      </Specimen>
    </Section>
  );
}

function StripsSection() {
  const [open, setOpen] = useState('rahul');
  const [checked, setChecked] = useState<Record<string, boolean>>({ asha: true });
  return (
    <Section
      id="strips"
      title="Strips"
      note="Hover or focus a name to see the open affordance. Click a name to select its row; tick a box to fill its row."
    >
      <Specimen title="Holder colours" className="block">
        <StripList>
          <Strip>
            <StripPrimary title="No family" meta="Plain grey holder, for rows without a state" />
          </Strip>
          <Strip holder="hatched">
            <StripPrimary title="CustomerVoice" meta="Hatched holder: a module that is not live yet. No link, no hover." />
            <StripCell kind="tag">
              <StateTag family="queued" glyph={Clock}>
                Not live yet
              </StateTag>
            </StripCell>
          </Strip>
          {FAMILIES.map(({ family, word, glyph }) => (
            <Strip key={family} family={family}>
              <StripPrimary title={word} meta={`Family: ${family}`} />
              <StripCell kind="tag">
                <StateTag family={family} glyph={glyph}>
                  {word}
                </StateTag>
              </StripCell>
            </Strip>
          ))}
        </StripList>
      </Specimen>
      <Specimen title="A list: opens on click, one selected, one checked, aligned columns from md" className="block">
        {/* One template for the list: cells share its tracks, so columns line up without fixed widths. */}
        <StripList columns="auto minmax(0,1fr) auto auto auto auto">
          {PEOPLE.map((person) => {
            const { family } = getStateMeta('call', person.call);
            return (
              <Strip
                key={person.id}
                family={family}
                selected={open === person.id}
                checkbox={
                  <Checkbox
                    aria-label={`Select ${person.name}`}
                    checked={Boolean(checked[person.id])}
                    onChange={(e) => setChecked((c) => ({ ...c, [person.id]: e.target.checked }))}
                  />
                }
              >
                <StripPrimary title={person.name} meta={person.source} onOpen={() => setOpen(person.id)} />
                <StripCell>{formatPhoneMasked(person.phone)}</StripCell>
                <StripCell className={person.answered ? undefined : 'text-ink-3'}>
                  {person.answered ?? 'Not asked yet'}
                </StripCell>
                <StripCell kind="tag">
                  <StatusTag domain="call" value={person.call} />
                </StripCell>
                <StripCell kind="actions">
                  {family === 'failed' ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => toast.info('Call again confirms first. Try it under Live calls.')}
                    >
                      Call again
                    </Button>
                  ) : null}
                </StripCell>
              </Strip>
            );
          })}
        </StripList>
      </Specimen>
    </Section>
  );
}

const READY = ['Priya Sharma', 'Rahul Verma', 'Neha Gupta', 'Karan Mehta', 'Divya Pillai', 'Sanjay Rao'];

function BaysSection() {
  const [shown, setShown] = useState(3);
  const [waiting, setWaiting] = useState(14);
  return (
    <Section
      id="bays"
      title="Bays"
      note="The rail carries the label and the true count, counted before any slicing. A count that changes stamps, never rolls. Columns from lg, stacked below."
    >
      <div>
        <Button variant="secondary" onClick={() => setWaiting((n) => n + 1)}>
          <Plus strokeWidth={1.75} aria-hidden />
          Add a candidate (sample)
        </Button>
      </div>
      <BayBoard>
        <Bay
          title="Ready for review"
          count={READY.length}
          moreCount={READY.length - shown}
          onShowMore={() => setShown(READY.length)}
          headingLevel={3}
        >
          <StripList>
            {READY.slice(0, shown).map((name) => (
              <Strip key={name} family="review">
                <StripPrimary title={name} meta={JOB} onOpen={() => toast(`Opened ${name} (sample)`)} />
                <StripCell kind="tag">
                  <StatusTag domain="call" value="ready_for_review" />
                </StripCell>
              </Strip>
            ))}
          </StripList>
        </Bay>
        <Bay title="Calls that didn’t connect" count={2} headingLevel={3}>
          <StripList>
            <Strip family="failed">
              <StripPrimary title="Asha Rao" meta={JOB} />
              <StripCell kind="tag">
                <StatusTag domain="call" value="no_answer" />
              </StripCell>
            </Strip>
            <Strip family="failed">
              <StripPrimary title="Vikram Singh" meta={JOB} />
              <StripCell kind="tag">
                <StatusTag domain="call" value="voicemail" />
              </StripCell>
            </Strip>
          </StripList>
        </Bay>
        <Bay title="Not called yet" count={waiting} moreCount={waiting - 2} moreHref="#bays" headingLevel={3}>
          <StripList>
            <Strip family="queued">
              <StripPrimary title="Arjun Nair" meta={JOB} />
              <StripCell kind="tag">
                <StatusTag domain="candidate" value="new" />
              </StripCell>
            </Strip>
            <Strip family="queued">
              <StripPrimary title="Kavya Menon" meta={JOB} />
              <StripCell kind="tag">
                <StatusTag domain="candidate" value="new" />
              </StripCell>
            </Strip>
          </StripList>
        </Bay>
      </BayBoard>
      <BayBoard>
        <Bay title="On hold (folded away)" count={1} collapsible defaultCollapsed headingLevel={3}>
          <StripList>
            <Strip family="decided">
              <StripPrimary title="Sana Khan" meta={JOB} />
              <StripCell kind="tag">
                <StatusTag domain="candidate" value="screening" />
              </StripCell>
            </Strip>
          </StripList>
        </Bay>
        <Bay title="Count not known yet" collapsible headingLevel={3}>
          <StripList>
            <Strip>
              <StripPrimary title="No count shows until it is real" meta="Never a 0 stand-in" />
            </Strip>
          </StripList>
        </Bay>
      </BayBoard>
    </Section>
  );
}

function HeadersSection() {
  return (
    <Section id="headers" title="Page headers" note="Each sample renders its own h1, as it would on a real page.">
      <Specimen title="Page header with breadcrumb, description and actions" className="block">
        <Frame>
          <PageHeader
            className="mb-0"
            breadcrumb={<Breadcrumb items={[{ label: 'Settings', href: '#headers' }, { label: 'Team' }]} />}
            title="Team"
            description="Invite people and choose what each role can do."
            actions={
              <Button>
                <Plus strokeWidth={1.75} aria-hidden />
                Invite people
              </Button>
            }
          />
        </Frame>
      </Specimen>
      <Specimen title="Breadcrumb on its own">
        <Breadcrumb
          items={[
            { label: 'Jobs', href: '#headers' },
            { label: JOB, href: '#headers' },
            { label: 'Candidates' },
          ]}
        />
      </Specimen>
      <Specimen title="Job header (its tabs link to the real job routes)" className="block">
        <Frame>
          <JobHeader
            className="mb-0"
            jobId="sample-job"
            title={JOB}
            status="open"
            current="candidates"
            readiness={<span className="text-label text-ink-2">Ready for calls. Agent and 5 questions saved.</span>}
            actions={
              <Button>
                <Plus strokeWidth={1.75} aria-hidden />
                Add candidates
              </Button>
            }
          />
        </Frame>
      </Specimen>
    </Section>
  );
}

function EvidenceSection() {
  const player = useRef<RecordingPlayerHandle>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [time, setTime] = useState<number>();
  const [writeIn, setWriteIn] = useState(false);

  useEffect(() => {
    const url = URL.createObjectURL(silentWav(75));
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, []);

  const seek = (at: number) => {
    player.current?.seek(at);
    setTime(at);
  };

  return (
    <Section
      id="evidence"
      title="Call evidence"
      note="A silent sample recording drives the transcript. Origin tickets and Play from here seek it, and the turn being spoken is highlighted."
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <div className="grid min-w-0 content-start gap-4">
          {src ? <RecordingPlayer ref={player} src={src} onTimeChange={setTime} label="Sample call recording" /> : <div className="h-11" />}
          <Checkbox label="Write-in mode, as on the website" checked={writeIn} onChange={(e) => setWriteIn(e.target.checked)} />
          <Transcript turns={TURNS} currentTime={time} onPlayFrom={seek} writeIn={writeIn} label="Sample transcript" />
        </div>
        <div className="grid min-w-0 content-start gap-4">
          <AnswersList items={ANSWERS} onSeek={seek} />
          <p className="m-0 flex flex-wrap items-center gap-2 text-label text-ink-2">
            Origin ticket with no recording to seek: <OriginTicket at={134} />
          </p>
        </div>
      </div>
      <Specimen title="A recording that fails to load" className="block">
        <RecordingPlayer src="data:audio/wav;base64,AAAA" label="Broken sample recording" />
      </Specimen>
    </Section>
  );
}

type RetryCall = { state: string; reason: string | null };
const FAILED_CALL: RetryCall = { state: 'failed', reason: 'no_answer' };

function LiveSection() {
  const [startedAt, setStartedAt] = useState(() => new Date(Date.now() - 47_000).toISOString());
  const [endState, setEndState] = useState<'active' | 'ended'>('active');
  const [ending, setEnding] = useState(false);
  const [retryCall, setRetryCall] = useState<RetryCall>(FAILED_CALL);
  const [retrying, setRetrying] = useState(false);

  return (
    <Section
      id="live"
      title="Live calls"
      note="End call and Call again confirm first; afterwards focus lands on the call's state. The timer runs only while a call is in progress. Each state change stamps and is read out politely, with the name. Calling again is not offered when it can't work."
    >
      <StripList>
        <LiveCallStrip
          name="Rahul Verma"
          workLabel={JOB}
          phone="+919000000002"
          state={endState}
          stage="new"
          hasResults={false}
          startedAt={startedAt}
          ending={ending}
          onEnd={() => {
            setEnding(true);
            later(() => {
              setEnding(false);
              setEndState('ended');
            });
          }}
        />
        <LiveCallStrip
          name="Asha Rao"
          workLabel={JOB}
          phone="+919000000003"
          state={retryCall.state}
          failureReason={retryCall.reason}
          retrying={retrying}
          onRetry={() => {
            setRetrying(true);
            later(() => {
              setRetrying(false);
              setRetryCall({ state: 'dialing', reason: null });
            });
          }}
        />
        <LiveCallStrip name="Arjun Nair" workLabel={JOB} state="dialing" />
        <LiveCallStrip name="Kavya Menon" workLabel={JOB} state="transferring" startedAt={startedAt} />
        <LiveCallStrip name="Sana Khan" workLabel={JOB} state="completed" stage="new" hasResults={false} />
        <LiveCallStrip name="Neha Gupta" workLabel={JOB} state="completed" stage="screening" />
        <LiveCallStrip name="Farah Ali" workLabel={JOB} state="completed" stage="reviewed" />
        <LiveCallStrip name="Vikram Singh" workLabel={JOB} state="failed" failureReason="voicemail" />
        <LiveCallStrip name="Divya Pillai" workLabel={JOB} state="failed" failureReason="busy" />
        <LiveCallStrip
          name="Meera Iyer"
          workLabel={JOB}
          state="failed"
          failureReason="invalid_number"
          onRetry={() => undefined}
        />
        <LiveCallStrip
          name="Rohan Das"
          workLabel={JOB}
          state="failed"
          failureReason="line_not_connected"
          onRetry={() => undefined}
        />
        <LiveCallStrip name="Karan Mehta" workLabel={JOB} state="failed" />
      </StripList>
      <div>
        <Button
          variant="secondary"
          onClick={() => {
            setStartedAt(new Date(Date.now() - 47_000).toISOString());
            setEndState('active');
            setRetryCall(FAILED_CALL);
          }}
        >
          <RotateCw strokeWidth={1.75} aria-hidden />
          Reset the samples
        </Button>
      </div>
    </Section>
  );
}

const GO: { label: string; icon: LucideIcon }[] = [
  { label: 'Home', icon: House },
  { label: 'Jobs', icon: Briefcase },
  { label: 'Candidates', icon: Users },
  { label: 'Calls', icon: Phone },
];

function SearchSection() {
  const [loading, setLoading] = useState(false);
  return (
    <Section
      id="search"
      title="Search"
      note={
        <>
          The command menu’s parts, inline. Press <Kbd>⌘K</Kbd> or <Kbd>Ctrl K</Kbd> for the real one.
        </>
      }
    >
      <Checkbox label="Show the loading row" checked={loading} onChange={(e) => setLoading(e.target.checked)} />
      <Command label="Sample search" className="h-auto max-w-xl rounded-sheet border-[1.5px] border-ink">
        <CommandInput placeholder="Search jobs and candidates" />
        <CommandList>
          {loading ? <CommandLoading>Searching…</CommandLoading> : null}
          <CommandEmpty>No jobs or candidates match.</CommandEmpty>
          <CommandGroup heading="Go to">
            {GO.map(({ label, icon: Icon }) => (
              <CommandItem key={label} onSelect={() => toast(`Go to ${label} (sample)`)}>
                <Icon strokeWidth={1.75} aria-hidden />
                {label}
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="Create">
            <CommandItem onSelect={() => toast('Create job (sample)')}>
              <Plus strokeWidth={1.75} aria-hidden />
              Create job
            </CommandItem>
            <CommandItem disabled>
              <Plus strokeWidth={1.75} aria-hidden />
              Invite people (needs a permission you lack)
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    </Section>
  );
}

const ROWS = 'grid-cols-[minmax(0,1fr)_7rem_9rem]';

function LegacySection() {
  return (
    <Section
      id="legacy"
      title="Legacy wrappers"
      note="Old names kept so pages awaiting rebuild still compile, drawn in the new world. New code uses the components above."
    >
      <Specimen title="Badge tones: neutral, accent, success, warning, danger">
        <Badge tone="neutral">Neutral</Badge>
        <Badge tone="accent">Accent</Badge>
        <Badge tone="success">Success</Badge>
        <Badge tone="warning">Warning</Badge>
        <Badge tone="danger">Danger</Badge>
      </Specimen>
      <Specimen title="StatusIndicator, every voice state">
        {VOICE.map((status) => (
          <StatusIndicator key={status} status={status} />
        ))}
      </Specimen>
      <Specimen title="Agent tile and a call being written up">
        <HiringVoiceFace size={40} />
        <StatusTag domain="call" value="results_pending" />
      </Specimen>
      <Specimen title="DataList rows, drawn as strips: a link row and a selected button row" className="block">
        <DataList>
          <DataListHeader className={ROWS}>
            <span>Job</span>
            <span>Candidates</span>
            <span>Status</span>
          </DataListHeader>
          <DataListBody>
            <DataListRow href="#legacy" className={ROWS}>
              <div className="min-w-0">
                <DataListTitle>{JOB}</DataListTitle>
                <DataListMeta>Created 1 Oct, 14:05</DataListMeta>
              </div>
              <span className="text-label text-ink-2">24</span>
              <StatusTag domain="job" value="open" />
            </DataListRow>
            <DataListRow onClick={() => toast('Opened a legacy row (sample)')} selected className={ROWS}>
              <div className="min-w-0">
                <DataListTitle>Frontend developer, Pune</DataListTitle>
                <DataListMeta>Created 28 Sep, 09:30</DataListMeta>
              </div>
              <span className="text-label text-ink-2">7</span>
              <StatusTag domain="job" value="draft" />
            </DataListRow>
          </DataListBody>
        </DataList>
      </Specimen>
    </Section>
  );
}

/** Development showcase of the Strip Board system. Sample data only. */
export function Showcase() {
  return (
    <PageMain>
      <PageHeader
        title="Design system"
        description="Every Strip Board primitive and shared component, in every state. Development only: this route returns 404 in production. Every name, number and link here is a sample."
      />
      <nav aria-label="Sections">
        <ul role="list" className="m-0 flex list-none flex-wrap gap-x-1 p-0">
          {SECTIONS.map(([id, label]) => (
            <li key={id}>
              <a
                href={`#${id}`}
                className="inline-flex min-h-11 items-center px-2 text-label text-ink-2 underline underline-offset-4 hover:text-ink"
              >
                {label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <BrandSection />
      <ButtonsSection />
      <FieldsSection />
      <FiltersSection />
      <OverlaysSection />
      <FeedbackSection />
      <LoadingSection />
      <StatesSection />
      <StripsSection />
      <BaysSection />
      <HeadersSection />
      <EvidenceSection />
      <LiveSection />
      <SearchSection />
      <LegacySection />
    </PageMain>
  );
}
