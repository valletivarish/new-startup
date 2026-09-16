import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Plus_Jakarta_Sans } from 'next/font/google';
import './globals.css';

const sans = Plus_Jakarta_Sans({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
  weight: ['400', '500', '600', '700'],
});

export const metadata: Metadata = {
  title: 'ai voice agent - AI phone agents for Indian businesses',
  description:
    'Let AI handle routine hiring calls so your team can focus on people who matter.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={sans.variable}>
      <body style={{ fontFamily: 'var(--font-sans), system-ui, sans-serif' }}>
        {children}
      </body>
    </html>
  );
}
