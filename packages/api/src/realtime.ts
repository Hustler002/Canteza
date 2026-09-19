import type { RealtimeChannel } from '@supabase/supabase-js';
import type { CampusClient } from './client';

/**
 * Realtime subscriptions.
 *
 * The handler is deliberately given no payload (ADR 004): an event means "this data
 * changed", and the caller responds by invalidating a query key. Patching component
 * state from the payload would create a second path to rendered data that drifts
 * from the fetched one the moment a socket drops.
 *
 * Realtime applies the same RLS policies as a query, so a subscription cannot
 * deliver a row the subscriber could not have selected.
 */

export type OrderChannelOptions = {
  /** PostgREST filter syntax, e.g. `student_id=eq.<uuid>` or `canteen_id=eq.<uuid>`. */
  filter?: string;
  /** Called on any insert or update to a matching row. */
  onChange: () => void;
  /** Surfaced so a screen can tell the user it is showing possibly-stale data. */
  onStatus?: (connected: boolean) => void;
};

export function subscribeToOrders(
  client: CampusClient,
  { filter, onChange, onStatus }: OrderChannelOptions,
): () => void {
  // A unique name per subscription: reusing one silently replaces the other.
  const channel: RealtimeChannel = client
    .channel(`orders:${filter ?? 'all'}:${Math.random().toString(36).slice(2)}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'orders', ...(filter ? { filter } : {}) },
      () => onChange(),
    )
    .subscribe((status) => {
      onStatus?.(status === 'SUBSCRIBED');
    });

  return () => {
    void client.removeChannel(channel);
  };
}

export const orderFilters = {
  forStudent: (studentId: string) => `student_id=eq.${studentId}`,
  forCanteen: (canteenId: string) => `canteen_id=eq.${canteenId}`,
  byId: (orderId: string) => `id=eq.${orderId}`,
} as const;
