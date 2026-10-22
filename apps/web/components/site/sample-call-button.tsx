import { Play } from 'lucide-react';
import { cn } from '../ui/cn';
import { DURATION } from './sample-call-timeline';

/**
 * "Hear a sample call": a glass pill that looks like an audio control, a play glyph in a soft
 * ring, the label and the length. The player's dialog (SampleCallDialog) finds it by its
 * data attribute, so this stays a server component. While the dialog is open the ring rests
 * (see .sample-btn-ring in globals.css).
 */
export function SampleCallButton({ className }: { className?: string }) {
  return (
    <button
      type="button"
      data-sample-call-open
      aria-haspopup="dialog"
      className={cn(
        'site-frost group inline-flex h-12 shrink-0 select-none items-center gap-3 whitespace-nowrap rounded-full py-0 pl-1.5 pr-5 text-[0.9375rem] font-medium text-white',
        'transition-[background-color,border-color,scale] duration-200 hover:border-white/45 hover:bg-white/25 motion-safe:active:[scale:0.98]',
        'focus-visible:outline-white focus-visible:[box-shadow:0_0_0_2px_#050505]',
        className,
      )}
    >
      <span className="sample-btn-ring relative grid size-9 place-items-center rounded-full bg-white/15 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.3)] transition-colors duration-200 group-hover:bg-white group-hover:text-site-black">
        <Play aria-hidden strokeWidth={1.5} className="size-3.5 translate-x-px fill-current" />
      </span>
      Hear a sample call
      <span aria-hidden className="h-3.5 w-px bg-white/30" />
      <span className="tabular-nums text-white/75">{DURATION} sec</span>
    </button>
  );
}
