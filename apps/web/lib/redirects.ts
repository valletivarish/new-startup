import { LEGACY_SECTION } from '../app/settings/sections';

type Redirect = {
  source: string;
  destination: string;
  permanent: false;
  has?: { type: 'query'; key: string; value: string }[];
};

/**
 * Old app URLs and where they live now. Temporary (307) so a later release can still change the
 * target; Next passes the query string through, so /candidates?stage=new keeps its filter.
 */
export function staticRedirects(): Redirect[] {
  return [
    { source: '/dashboard', destination: '/jobs', permanent: false },
    { source: '/candidates', destination: '/people', permanent: false },
    { source: '/analytics', destination: '/reports', permanent: false },
    { source: '/knowledge', destination: '/settings/company', permanent: false },
    { source: '/tools', destination: '/jobs', permanent: false },
    // /settings used to be one page with ?section= tabs. Real redirects, so they work before any
    // client code runs; other params (?invite=1, ?zoho=…) travel with the request. Next cannot drop
    // the matched ?section= itself; the Settings pages ignore it.
    ...Object.entries(LEGACY_SECTION).map(([legacy, slug]): Redirect => ({
      source: '/settings',
      has: [{ type: 'query', key: 'section', value: legacy }],
      destination: `/settings/${slug}`,
      permanent: false,
    })),
    { source: '/settings', destination: '/settings/company', permanent: false },
  ];
}
