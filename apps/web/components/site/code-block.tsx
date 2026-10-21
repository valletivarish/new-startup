'use client';

import { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';

/**
 * A code sample on the website: its language on a small bar, a Copy button, and the code,
 * which scrolls sideways on a phone rather than wrapping. The region is focusable so the
 * keyboard can scroll it too.
 */
export function CodeBlock({ code, label }: { code: string; label: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  useEffect(() => {
    if (state === 'idle') return;
    const t = window.setTimeout(() => setState('idle'), 2000);
    return () => window.clearTimeout(t);
  }, [state]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setState('copied');
    } catch {
      setState('failed');
    }
  }

  return (
    <figure className="m-0 mt-4 overflow-hidden rounded-[14px] border border-site-line bg-site-raised">
      <figcaption className="flex items-center justify-between gap-3 border-b border-site-line pl-4 pr-1.5">
        <span className="text-[0.8125rem] font-medium text-site-fg-3">{label}</span>
        <button
          type="button"
          onClick={() => void copy()}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-[8px] px-3 text-[0.8125rem] text-site-fg-2 transition-colors duration-200 hover:bg-white/10 hover:text-white focus-visible:outline-white"
        >
          {state === 'copied' ? <Check aria-hidden className="size-4" /> : <Copy aria-hidden className="size-4" />}
          {state === 'copied' ? 'Copied' : state === 'failed' ? 'Select and copy' : 'Copy'}
          <span className="sr-only"> {label} code</span>
        </button>
      </figcaption>
      <pre
        tabIndex={0}
        aria-label={`${label} code`}
        className="m-0 overflow-x-auto p-4 font-mono text-[0.8125rem] leading-[1.7] text-[#e6e8eb] focus-visible:outline-white"
      >
        <code>{code}</code>
      </pre>
      <span aria-live="polite" className="sr-only">
        {state === 'copied' ? 'Copied' : ''}
      </span>
    </figure>
  );
}
