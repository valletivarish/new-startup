import type { Metadata } from 'next';
import type { ReactNode } from 'react';

// The page is a client component, so its tab title is set here: "Home | Voice platform".
export const metadata: Metadata = { title: 'Home' };

export default function HomeLayout({ children }: { children: ReactNode }) {
  return children;
}
