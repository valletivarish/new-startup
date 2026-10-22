/**
 * Old app URLs and where they live now. Temporary (307) so a later release can still change the
 * target; Next passes the query string through, so /candidates?stage=new keeps its filter.
 */
export function staticRedirects(): { source: string; destination: string; permanent: false }[] {
  return [
    { source: '/dashboard', destination: '/jobs', permanent: false },
    { source: '/candidates', destination: '/people', permanent: false },
    { source: '/analytics', destination: '/reports', permanent: false },
    { source: '/knowledge', destination: '/settings/company', permanent: false },
    { source: '/tools', destination: '/jobs', permanent: false },
  ];
}
