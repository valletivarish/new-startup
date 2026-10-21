'use client';

import { useEffect, useId, useState, type FormEvent } from 'react';
import { cn } from '../ui/cn';
import { formatApiError } from '../../lib/api';
import { looksLikeEmail, POLL_MS, VISITOR_CHAT_KEY, type Ticket } from '../../lib/support';
import { getVisitorChat, replyVisitorChat, startVisitorChat } from '../../lib/support-api';
import { siteButton } from './kit';

/*
  "Contact support" on the website and docs: a person answers, not the helper bot. Needs an
  email (replies also go there). The chat's key is kept in this browser only, so a reload finds
  the conversation again; the thread refreshes every 4 seconds while it is open.
*/

const FIELD =
  'w-full rounded-[10px] border border-site-line bg-white/[0.04] px-3.5 text-[0.9375rem] text-white placeholder:text-site-fg-3 focus-visible:border-white focus-visible:outline-none';

function readToken(): string | null {
  try {
    return window.localStorage.getItem(VISITOR_CHAT_KEY);
  } catch {
    return null;
  }
}

export function SupportChat({ className }: { className?: string }) {
  const [token, setToken] = useState<string | null>(null);
  const [chat, setChat] = useState<Ticket | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ids = useId();

  useEffect(() => setToken(readToken()), []);

  useEffect(() => {
    if (!token || !open) return;
    let stop = false;
    const load = () =>
      getVisitorChat(token)
        .then((t) => !stop && setChat(t))
        .catch(() => {
          // A chat the server no longer knows: start fresh.
          if (stop) return;
          try {
            window.localStorage.removeItem(VISITOR_CHAT_KEY);
          } catch {
            /* storage blocked */
          }
          setToken(null);
          setChat(null);
        });
    void load();
    const timer = window.setInterval(load, POLL_MS);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, [token, open]);

  async function start(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const email = String(form.get('email') ?? '').trim();
    const body = String(form.get('body') ?? '').trim();
    if (!looksLikeEmail(email)) return setError('Add the email address we should reply to.');
    if (!body) return setError('Write your question first.');
    setBusy(true);
    setError(null);
    try {
      const out = await startVisitorChat({ email, body });
      try {
        window.localStorage.setItem(VISITOR_CHAT_KEY, out.token);
      } catch {
        /* storage blocked: the chat lasts this visit */
      }
      setToken(out.token);
      setChat(out.ticket);
    } catch (err) {
      setError(formatApiError(err, 'That didn’t send. Try again in a minute.'));
    } finally {
      setBusy(false);
    }
  }

  async function reply(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const body = String(new FormData(formEl).get('body') ?? '').trim();
    if (!body || !token) return;
    setBusy(true);
    setError(null);
    try {
      await replyVisitorChat(token, body);
      formEl.reset();
      setChat(await getVisitorChat(token));
    } catch (err) {
      setError(formatApiError(err, 'That didn’t send. Try again in a minute.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="contact-support" aria-labelledby={`${ids}-h`} className={cn('grid max-w-[34rem] gap-3', className)}>
      <h2 id={`${ids}-h`} className="m-0 text-[0.8125rem] font-medium text-site-fg-3">
        Contact support
      </h2>
      {!open ? (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <p className="m-0 text-[0.9375rem] text-site-fg-2">A person on the team reads every message.</p>
          <button type="button" className={siteButton('paper', 'md')} onClick={() => setOpen(true)} aria-expanded={false}>
            {token ? 'Open your chat' : 'Write to us'}
          </button>
        </div>
      ) : chat ? (
        <div className="grid gap-3">
          <ol role="log" aria-live="polite" aria-label="Your chat with support" className="m-0 grid max-h-72 list-none gap-2 overflow-y-auto p-0">
            {(chat.messages ?? []).map((m) => (
              <li
                key={m.id}
                className={cn(
                  'max-w-[85%] whitespace-pre-wrap break-words rounded-[10px] px-3.5 py-2.5 text-[0.9375rem]',
                  m.authorKind === 'customer' && 'ml-auto bg-white text-site-black',
                  m.authorKind === 'staff' && 'border border-site-line text-white',
                  m.authorKind === 'system' && 'mx-auto text-center text-[0.8125rem] text-site-fg-3',
                )}
              >
                {m.authorKind === 'staff' ? <span className="mb-1 block text-[0.8125rem] text-site-fg-3">HRVoice support</span> : null}
                {m.body}
              </li>
            ))}
          </ol>
          <form onSubmit={reply} className="flex items-end gap-2">
            <label htmlFor={`${ids}-reply`} className="sr-only">
              Reply
            </label>
            <textarea id={`${ids}-reply`} name="body" rows={2} maxLength={5000} required className={cn(FIELD, 'min-h-11 py-2.5')} placeholder="Reply" />
            <button type="submit" className={siteButton('paper', 'md')} aria-busy={busy || undefined}>
              {busy ? 'Sending…' : 'Send'}
            </button>
          </form>
          <p className="m-0 text-[0.8125rem] text-site-fg-3">Replies also come to your email. Reference #{chat.ref}.</p>
        </div>
      ) : token ? (
        <p role="status" className="m-0 text-[0.9375rem] text-site-fg-2">
          Loading your chat…
        </p>
      ) : (
        <form onSubmit={start} noValidate className="grid gap-3">
          <div className="grid gap-1.5">
            <label htmlFor={`${ids}-email`} className="text-[0.875rem] text-site-fg-2">
              Your email
            </label>
            <input id={`${ids}-email`} name="email" type="email" autoComplete="email" required className={cn(FIELD, 'h-11')} />
          </div>
          <div className="grid gap-1.5">
            <label htmlFor={`${ids}-body`} className="text-[0.875rem] text-site-fg-2">
              Your question
            </label>
            <textarea id={`${ids}-body`} name="body" rows={3} maxLength={5000} required className={cn(FIELD, 'py-2.5')} />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" className={siteButton('paper', 'md')} aria-busy={busy || undefined}>
              {busy ? 'Sending…' : 'Send'}
            </button>
            <button type="button" className="min-h-11 text-[0.9375rem] text-site-fg-3 hover:text-white" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
      <p role="alert" className={error ? 'm-0 text-[0.875rem] text-[#ffb4a8]' : 'sr-only'}>
        {error}
      </p>
    </section>
  );
}
