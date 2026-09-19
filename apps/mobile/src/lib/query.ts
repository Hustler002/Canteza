import { QueryClient } from '@tanstack/react-query';
import { AppError } from '@campuseats/shared';

/**
 * Server state lives here (ADR 004). Realtime invalidates keys; it never patches
 * component state, so there is one code path to rendered data.
 */
export const queryClient = new QueryClient({
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
