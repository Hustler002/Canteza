import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { AppError } from '@canteza/shared';
import { reportIfUnexpected } from './sentry';

/**
 * Server state lives here (ADR 004). Realtime invalidates keys; it never patches
 * component state, so there is one code path to rendered data.
 */
export const queryClient = new QueryClient({
  // Every read and write in the app passes through here, so this is the one place a
  // handled failure is offered to Sentry -- which keeps only the ones no code names.
  queryCache: new QueryCache({ onError: reportIfUnexpected }),
  mutationCache: new MutationCache({ onError: reportIfUnexpected }),
  defaultOptions: {
    queries: {
      // Campus data changes often enough that a long stale window shows lies, and
      // rarely enough that refetching constantly wastes a hostel's wifi.
      staleTime: 30_000,
      retry: (failureCount, error) => {
        // Retrying a refused permission or a closed canteen just delays the message.
        if (error instanceof AppError && error.code !== 'NETWORK') return false;
        return failureCount < 2;
      },
    },
    mutations: { retry: false },
  },
});
