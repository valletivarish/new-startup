/**
 * nexstopp.com/embed.js: the careers-page snippet.
 *
 *   <script src="https://nexstopp.com/embed.js" data-key="hrv_pub_…" async></script>
 *   <div data-hrvoice-apply></div>          (optional: where the form goes)
 *
 * Every [data-hrvoice-apply] element gets a form; a mount may carry its own data-key (one form
 * per job on the same page). With no mount, the form goes right after the script tag.
 * data-accent="#0B6E4F" colours the button. The form posts to the same site's /backend.
 */

import { mountForm } from './widget';

const script = document.currentScript as HTMLScriptElement | null;
const api = script?.dataset['api'] ?? (script?.src ? `${new URL(script.src).origin}/backend` : '');

function mount(el: HTMLElement) {
  if (el.dataset['hrvoiceMounted']) return;
  el.dataset['hrvoiceMounted'] = '1';
  const key = el.dataset['key'] ?? script?.dataset['key'];
  const accent = el.dataset['accent'] ?? script?.dataset['accent'];
  void mountForm(el, { api, ...(key ? { key } : {}), ...(accent ? { accent } : {}) });
}

function init() {
  const mounts = document.querySelectorAll<HTMLElement>('[data-hrvoice-apply]');
  if (mounts.length) mounts.forEach(mount);
  else if (script) {
    const el = document.createElement('div');
    script.after(el);
    mount(el);
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
