import type { MetadataRoute } from 'next';

const SITE = (process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').replace(/\/+$/, '');

export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: `${SITE}/` }, { url: `${SITE}/developers` }, { url: `${SITE}/login` }];
}
