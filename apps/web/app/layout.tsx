import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Platform',
  description: 'AI agent platform dashboard',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily:
            'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
          margin: 0,
          background: '#f6f7f6',
          color: '#1a1f1c',
        }}
      >
        {children}
      </body>
    </html>
  );
}
