'use client';

import { useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import { Toaster } from 'sonner';
import { CommandMenu } from '@/components/layout/CommandMenu';

export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem>
      <QueryClientProvider client={queryClient}>
        {children}
        <CommandMenu />
        <Toaster
          position="top-right"
          closeButton
          theme="system"
          toastOptions={{
            className:
              '!border-[var(--separator)] !bg-[var(--surface)] !text-[var(--foreground)] !shadow-md font-sans text-sm',
            classNames: {
              success: '!border-[color-mix(in_srgb,var(--success)_35%,var(--separator))]',
              error: '!border-[color-mix(in_srgb,var(--danger)_35%,var(--separator))]',
            },
          }}
        />
      </QueryClientProvider>
    </ThemeProvider>
  );
}
