/**
 * /settings used to be one page with ?section= tabs. Old links (the shell's "Invite people",
 * "Your account", the Zoho sign-in return) land on the matching route; other params
 * (?invite=1, ?zoho=…) travel with them.
 */

import { redirect } from 'next/navigation';
import { LEGACY_SECTION } from './sections';

export default async function SettingsIndex({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { section, ...rest } = await searchParams;
  const slug = typeof section === 'string' ? LEGACY_SECTION[section] : undefined;
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(rest)) {
    for (const v of Array.isArray(value) ? value : value === undefined ? [] : [value]) qs.append(key, v);
  }
  redirect(`/settings/${slug ?? 'company'}${qs.size ? `?${qs}` : ''}`);
}
