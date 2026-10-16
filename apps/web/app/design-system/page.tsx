import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Showcase } from './showcase';

export const metadata: Metadata = {
  title: 'Design system',
  robots: { index: false, follow: false },
};

/** Development only: every primitive and shared component in every state, with sample data. */
export default function DesignSystemPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <Showcase />;
}
