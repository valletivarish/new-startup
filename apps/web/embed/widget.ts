/**
 * The "Apply with a quick call" form, rendered inside a Shadow DOM so the host page's CSS can't
 * reach it. Used by embed.ts on careers pages and by the job page's live preview.
 */

import { accentColours, confirmation, consentLabel, serverMessage, validate, type FormErrors, type FormValues } from './form';

export interface MountOptions {
  /** The publishable key. Not needed for a preview. */
  key?: string;
  /** API base, e.g. "https://nexstopp.com/backend". */
  api?: string;
  accent?: string;
  /** Preview: no network; submitting only shows the thank-you. */
  preview?: { companyName: string; jobTitle: string };
}

const CSS = `
:host{all:initial;display:block;font-family:inherit;font-size:16px;line-height:1.5;color:#111827}
*{box-sizing:border-box;font:inherit;color:inherit}
.card{background:#fff;border:1px solid #D1D5DB;border-radius:16px;padding:24px;max-width:560px}
h2{margin:0;font-size:1.25rem;line-height:1.3;font-weight:600}
p{margin:0}
.sub{margin-top:6px;color:#4B5563}
form{display:grid;gap:16px;margin-top:20px}
label{font-weight:500}
.f{display:grid;gap:6px}
input[type=text],input[type=tel],input[type=email]{width:100%;min-height:44px;padding:10px 12px;border:1px solid #6B7280;border-radius:10px;background:#fff}
.tel{display:flex}
.tel span{display:flex;align-items:center;padding:0 12px;border:1px solid #6B7280;border-right:0;border-radius:10px 0 0 10px;background:#F3F4F6;color:#374151}
.tel input{border-radius:0 10px 10px 0}
[aria-invalid=true]{border-color:#B42318;border-width:2px}
.err{color:#B42318;font-size:.875rem}
.chk{display:flex;gap:12px;align-items:flex-start;min-height:44px;cursor:pointer;font-weight:400}
.chk input{flex:none;width:20px;height:20px;margin:2px 0 0;accent-color:var(--a)}
button{min-height:48px;padding:0 20px;border:0;border-radius:10px;background:var(--a);color:var(--on);font-weight:600;cursor:pointer}
button[disabled]{opacity:.7;cursor:progress}
:focus-visible{outline:2px solid var(--ring);outline-offset:2px}
.note{font-size:.875rem;color:#4B5563}
.alert{padding:10px 12px;border-radius:10px;background:#FEF3F2;color:#912018}
.hp{position:absolute;left:-10000px;width:1px;height:1px;overflow:hidden}
.done:focus{outline:none}
`;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function shell(el: HTMLElement, accent: string | undefined): ShadowRoot {
  const root = el.shadowRoot ?? el.attachShadow({ mode: 'open' });
  const c = accentColours(accent);
  root.innerHTML = `<style>${CSS}</style><div class="card" style="--a:${c.accent};--on:${c.onAccent};--ring:${c.ring}"></div>`;
  return root;
}

const card = (root: ShadowRoot) => root.querySelector('.card') as HTMLElement;

function message(root: ShadowRoot, text: string) {
  card(root).innerHTML = `<p class="sub" role="status">${esc(text)}</p>`;
}

export async function mountForm(el: HTMLElement, opts: MountOptions): Promise<void> {
  const root = shell(el, opts.accent);
  let job = opts.preview ?? null;
  if (!job) {
    if (!opts.key || !opts.api) {
      console.error('HRVoice: add data-key="hrv_pub_…" to the script tag.');
      return message(root, 'This form isn’t set up yet.');
    }
    message(root, 'Loading…');
    try {
      const res = await fetch(`${opts.api}/public/embed/${encodeURIComponent(opts.key)}`);
      if (!res.ok) {
        console.warn(
          res.status === 403
            ? `HRVoice: ${location.origin} isn’t on this form’s list of websites. Add it on the job page in HRVoice.`
            : `HRVoice: this form’s key doesn’t work (${res.status}). It may have been revoked.`,
        );
        return message(root, 'This form isn’t taking applications right now.');
      }
      const d = (await res.json()) as { companyName: string; jobTitle: string; open: boolean };
      if (!d.open) return message(root, 'This job isn’t taking applications any more.');
      job = d;
    } catch {
      return message(root, 'This form couldn’t load. Please refresh the page to try again.');
    }
  }
  renderForm(root, job, opts);
}

function renderForm(root: ShadowRoot, job: { companyName: string; jobTitle: string }, opts: MountOptions) {
  const field = (name: keyof FormValues, label: string, input: string, hint = '') => `
    <div class="f">
      <label for="${name}">${label}</label>${hint}
      ${input}
      <p class="err" id="${name}-err" hidden></p>
    </div>`;
  card(root).innerHTML = `
    <h2 id="t">Apply with a quick call</h2>
    <p class="sub">${esc(job.jobTitle)} at ${esc(job.companyName)}. Leave your number and our screening assistant will call you for a short chat about the role.</p>
    <form novalidate aria-labelledby="t">
      ${field('fullName', 'Your name', '<input id="fullName" name="fullName" type="text" autocomplete="name" maxlength="200" required>')}
      ${field('phone', 'Mobile number', '<div class="tel"><span aria-hidden="true">+91</span><input id="phone" name="phone" type="tel" inputmode="tel" autocomplete="tel-national" maxlength="20" required aria-label="Mobile number, India +91"></div>')}
      ${field('email', 'Email <span class="note">(optional)</span>', '<input id="email" name="email" type="email" autocomplete="email" maxlength="320">')}
      <div class="hp" aria-hidden="true"><label for="website">Website</label><input id="website" name="website" tabindex="-1" autocomplete="off"></div>
      <div>
        <label class="chk"><input id="consent" name="consent" type="checkbox" required><span>${esc(consentLabel(job.companyName))}</span></label>
        <p class="err" id="consent-err" hidden></p>
      </div>
      <p class="alert" role="alert" hidden></p>
      <button type="submit">Request my call</button>
      <p class="note">Calls are made between 9 am and 8 pm India time.</p>
    </form>`;

  const form = root.querySelector('form')!;
  const input = (n: string) => root.getElementById(n) as HTMLInputElement;
  const alert = root.querySelector('.alert') as HTMLElement;
  const button = root.querySelector('button')!;

  function show(errors: FormErrors, formError = '') {
    for (const n of ['fullName', 'phone', 'email', 'consent'] as const) {
      const el = input(n);
      const err = root.getElementById(`${n}-err`)!;
      const msg = errors[n];
      err.textContent = msg ?? '';
      err.hidden = !msg;
      if (msg) {
        el.setAttribute('aria-invalid', 'true');
        el.setAttribute('aria-describedby', `${n}-err`);
      } else {
        el.removeAttribute('aria-invalid');
        el.removeAttribute('aria-describedby');
      }
    }
    alert.textContent = formError;
    alert.hidden = !formError;
    const first = (['fullName', 'phone', 'email', 'consent'] as const).find((n) => errors[n]);
    if (first) input(first).focus();
  }

  function done(fullName: string, callAfter: string | null) {
    card(root).innerHTML = `<h2>Application sent</h2><p class="sub done" role="status" tabindex="-1">${esc(confirmation(fullName, callAfter))}</p>`;
    (root.querySelector('.done') as HTMLElement).focus();
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const values: FormValues = {
      fullName: input('fullName').value,
      phone: input('phone').value,
      email: input('email').value,
      consent: input('consent').checked,
    };
    const errors = validate(values);
    show(errors);
    if (Object.keys(errors).length) return;
    if (opts.preview) return done(values.fullName, null);

    button.disabled = true;
    button.textContent = 'Sending…';
    try {
      const res = await fetch(`${opts.api}/public/embed/${encodeURIComponent(opts.key!)}/applications`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          fullName: values.fullName.trim(),
          phone: values.phone,
          ...(values.email.trim() ? { email: values.email.trim() } : {}),
          consent: true,
          website: input('website').value,
        }),
      });
      const body = (await res.json().catch(() => null)) as { callAfter?: string | null; code?: string } | null;
      if (res.ok) return done(values.fullName, body?.callAfter ?? null);
      const fieldErrors: FormErrors = {};
      let formError = '';
      for (const m of serverMessage(res.status, body as Parameters<typeof serverMessage>[1])) {
        if (m.field) fieldErrors[m.field] = m.message;
        else formError = m.message;
      }
      show(fieldErrors, formError);
    } catch {
      show({}, 'We couldn’t send your details. Check your connection and try again.');
    }
    button.disabled = false;
    button.textContent = 'Request my call';
  });
}
