import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getActiveOrder,
  getCanteen,
  getOrder,
  invalidationRoots,
  listCanteenOrders,
  listCanteens,
  listHostels,
  listMenu,
  orderFilters,
  placeOrder,
  queryKeys,
  saveDefaultAddress,
  subscribeToOrders,
  transitionOrder,
  type DefaultAddress,
  type PlaceOrderInput,
} from '@campuseats/api';
import type { OrderStatus } from '@campuseats/shared';
import { supabase } from './supabase';

/**
 * Typed data hooks. Screens call these; no screen touches `supabase` directly.
 *
 * Realtime events invalidate query keys rather than patching state (ADR 004), so
 * there is one path to rendered data whether it arrived by socket or by refetch.
 * If the socket drops, refetch-on-focus still shows the truth.
 */

export function useCanteens() {
  return useQuery({
    queryKey: queryKeys.canteens(),
    queryFn: () => listCanteens(supabase),
  });
}

export function useCanteen(canteenId: string) {
  return useQuery({
    queryKey: queryKeys.canteen(canteenId),
    queryFn: () => getCanteen(supabase, canteenId),
    enabled: Boolean(canteenId),
  });
}

export function useMenu(canteenId: string) {
  return useQuery({
    queryKey: queryKeys.menu(canteenId),
    queryFn: () => listMenu(supabase, canteenId),
    enabled: Boolean(canteenId),
  });
}

export function useHostels() {
  return useQuery({
    queryKey: queryKeys.hostels(),
    queryFn: () => listHostels(supabase),
    // Hostels change roughly never; refetching them is wasted hostel wifi.
    staleTime: 60 * 60 * 1000,
  });
}

export function useActiveOrder() {
  return useQuery({
    queryKey: [...queryKeys.myOrders(), 'active'],
    queryFn: () => getActiveOrder(supabase),
  });
}

export function useOrder(orderId: string) {
  return useQuery({
    queryKey: queryKeys.order(orderId),
    queryFn: () => getOrder(supabase, orderId),
    enabled: Boolean(orderId),
  });
}

export function useCanteenOrders(canteenId: string, statuses: readonly OrderStatus[]) {
  return useQuery({
    queryKey: queryKeys.canteenOrders(canteenId, statuses.join(',')),
    queryFn: () => listCanteenOrders(supabase, statuses),
    enabled: Boolean(canteenId),
  });
}

export function usePlaceOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: PlaceOrderInput) => placeOrder(supabase, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: invalidationRoots.orders });
    },
  });
}

export function useTransitionOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ orderId, to, reason }: { orderId: string; to: OrderStatus; reason?: string }) =>
      transitionOrder(supabase, orderId, to, reason),
    // Not optimistic: losing a race to another staff member is a real outcome the
    // user has to see, and a rolled-back optimistic update reads as a glitch.
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: invalidationRoots.orders });
    },
  });
}

export function useSaveDefaultAddress(userId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (address: DefaultAddress) => saveDefaultAddress(supabase, userId, address),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.profile(userId) });
    },
  });
}

/**
 * Keeps order queries fresh over Realtime.
 *
 * `filter` is PostgREST syntax built by `orderFilters`; Realtime applies the same
 * RLS as a query, so this cannot deliver a row the subscriber could not select.
 */
export function useOrdersRealtime(filter: string | null) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!filter) return;
    return subscribeToOrders(supabase, {
      filter,
      onChange: () => {
        void queryClient.invalidateQueries({ queryKey: invalidationRoots.orders });
      },
    });
  }, [filter, queryClient]);
}

export { orderFilters };
