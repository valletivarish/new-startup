'use client';

import { useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CommandMenu } from '@/components/layout/CommandMenu';
import { OfflineBanner } from '@/components/ui/offline-banner';
import { Toaster } from '@/components/ui/toaster';
import { isRetryable } from '@/lib/errors';
import { useOnline } from '@/lib/use-online';

export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            // Up to 2 retries with backoff for no-connection and 5xx; a 4xx won't change by asking again.
            // Offline, queries pause (networkMode 'online') and refetch on reconnect.
            retry: (failureCount, error) => failureCount < 2 && isRetryable(error),
          },
        },
      }),
  );
  const online = useOnline();

  return (
    <QueryClientProvider client={queryClient}>
      {/* Always mounted so going offline is announced; reconnecting refetches through TanStack's onlineManager. */}
      <OfflineBanner online={online} />
      {children}
      <CommandMenu />
      {/* Undo toasts: use toastUndo (8s). Decisions made in a Sheet raise theirs in the sheet's own toaster. */}
      <Toaster />
    </QueryClientProvider>
  );
}
