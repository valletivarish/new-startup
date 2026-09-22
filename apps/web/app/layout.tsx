import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { DM_Sans, Syne } from 'next/font/google';
import { AppProviders } from '../components/layout/AppProviders';
import './globals.css';

const display = Syne({
  subsets: ['latin'],
  variable: '--font-syne',
  display: 'swap',
  weight: ['500', '600', '700', '800'],
});

const body = DM_Sans({
  subsets: ['latin'],
  variable: '--font-dm',
  display: 'swap',
  weight: ['400', '500', '600', '700'],
});

export const metadata: Metadata = {
  title: 'Hiring desk — phone screens for every open role',
  description:
    'Create a job, add candidates, and run phone screens with that role’s description.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${body.variable}`}
      suppressHydrationWarning
    >
      <body className="min-h-dvh font-sans antialiased">
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
