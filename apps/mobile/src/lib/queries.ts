import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  addFavorite,
  claimDelivery,
  countOrdersByStatus,
  createMenuItem,
  createReview,
  createTicket,
  getActiveOrder,
  getOrderReview,
  getCanteen,
  getOrder,
  getShiftState,
  invalidationRoots,
  listActiveDeliveries,
  listCanteenMenu,
  listCanteenOrders,
  listCanteenStats,
  listCanteens,
  listCoupons,
  listCompletedDeliveries,
  listDeliveryQueue,
  listFavorites,
  listHostels,
  listMenu,
  listMyOrders,
  listTickets,
  orderFilters,
  placeOrder,
  queryKeys,
  releaseDelivery,
  searchMenuItems,
  removeFavorite,
  saveDefaultAddress,
  setOnline,
  subscribeToOrders,
  summariseDeliveries,
  transitionOrder,
  updateMenuItem,
  type DefaultAddress,
  type PlaceOrderInput,
} from '@canteza/api';
import type { Insert, OrderStatus, Update } from '@canteza/shared';
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

/**
 * Ratings and kitchen speed for every canteen.
 *
 * Cached for ten minutes, which is the point of it being a separate query from
 * `useCanteens`: a 30-day median does not move between two taps, while whether a
 * canteen is open has to be current. Refetching this on every home-screen visit
 * would pay for the expensive aggregate to learn nothing.
 */
export function useCanteenStats() {
  return useQuery({
    queryKey: queryKeys.canteenStats(),
    queryFn: () => listCanteenStats(supabase),
    staleTime: 10 * 60 * 1000,
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

/**
 * Dish search across every canteen.
 *
 * `enabled` below two characters is what stops a query firing on every keystroke of
 * "ma" on the way to "maggi"; TanStack then caches per term, so backspacing to a
 * term already typed is instant rather than another round trip. `keepPreviousData`
 * via `placeholderData` means the list does not blink empty between letters.
 */
export function useMenuSearch(term: string) {
  const cleaned = term.trim();
  return useQuery({
    queryKey: queryKeys.menuSearch(cleaned),
    queryFn: () => searchMenuItems(supabase, cleaned),
    enabled: cleaned.length >= 2,
    placeholderData: (previous) => previous,
    staleTime: 30 * 1000,
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

/**
 * Everything this student has ordered, newest first.
 *
 * RLS limits it to their own; there is no student id in the query because there is
 * nothing a `where` clause here could add to `orders_read`. The tracker on the home
 * screen is the live one — this is the list you scroll to find last Tuesday's biryani.
 */
export function useMyOrders() {
  return useQuery({
    queryKey: queryKeys.myOrders(),
    queryFn: () => listMyOrders(supabase),
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

/**
 * Counts for the counter's tab badges, across every live status in one request.
 *
 * The key sits under the `orders` root, so the realtime subscription that already
 * refreshes the board refreshes these too — a student placing an order bumps the
 * "New" badge with no extra socket and no polling.
 */
export function useCanteenOrderCounts(canteenId: string, statuses: readonly OrderStatus[]) {
  return useQuery({
    queryKey: queryKeys.canteenOrderCounts(canteenId),
    queryFn: () => countOrdersByStatus(supabase, statuses),
    enabled: Boolean(canteenId),
  });
}

/**
 * The counter's own menu, retired items included.
 *
 * A separate key from `useMenu`: the same canteen id would otherwise cache the
 * student's filtered list and the counter's full one over each other, and whichever
 * screen loaded second would show the wrong one.
 */
export function useCanteenMenu(canteenId: string) {
  return useQuery({
    queryKey: queryKeys.canteenMenu(canteenId),
    queryFn: () => listCanteenMenu(supabase, canteenId),
    enabled: Boolean(canteenId),
  });
}

/** Both menu writes invalidate the whole canteen root, so the student's list follows. */
function useMenuInvalidation() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: invalidationRoots.canteens });
  };
}

export function useCreateMenuItem() {
  const invalidate = useMenuInvalidation();
  return useMutation({
    mutationFn: (item: Insert<'menu_items'>) => createMenuItem(supabase, item),
    onSuccess: invalidate,
  });
}

/** A price edit, the sold-out switch and retiring are all one patch. */
export function useUpdateMenuItem() {
  const invalidate = useMenuInvalidation();
  return useMutation({
    mutationFn: ({ itemId, patch }: { itemId: string; patch: Update<'menu_items'> }) =>
      updateMenuItem(supabase, itemId, patch),
    onSuccess: invalidate,
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

/* ------------------------------------------------------------------ delivery */

export function useDeliveryQueue(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.deliveryQueue(),
    queryFn: () => listDeliveryQueue(supabase),
    enabled,
  });
}

export function useActiveDeliveries(partnerId: string) {
  return useQuery({
    queryKey: queryKeys.myDeliveries(partnerId),
    queryFn: () => listActiveDeliveries(supabase, partnerId),
    enabled: Boolean(partnerId),
  });
}

export function useDeliveryHistory(partnerId: string) {
  return useQuery({
    queryKey: queryKeys.deliveryHistory(partnerId),
    queryFn: async () => {
      const completed = await listCompletedDeliveries(supabase, partnerId);
      return { orders: completed, stats: summariseDeliveries(completed) };
    },
    enabled: Boolean(partnerId),
  });
}

export function useClaimDelivery() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (orderId: string) => claimDelivery(supabase, orderId),
    // Losing the race is a real outcome the partner must see. Invalidate either way
    // so the queue stops showing an order someone else already took.
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: invalidationRoots.orders });
    },
  });
}

export function useReleaseDelivery() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (orderId: string) => releaseDelivery(supabase, orderId),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: invalidationRoots.orders });
    },
  });
}

export function useShift(partnerId: string) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: queryKeys.shift(partnerId),
    queryFn: () => getShiftState(supabase, partnerId),
    enabled: Boolean(partnerId),
  });

  const mutation = useMutation({
    mutationFn: (online: boolean) => setOnline(supabase, partnerId, online),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.shift(partnerId) });
      // Going on or off shift changes what the queue policy returns.
      void queryClient.invalidateQueries({ queryKey: invalidationRoots.orders });
    },
  });

  return { query, setOnline: mutation };
}

/* -------------------------------------------------------------- engagement */

/**
 * Whether this order has been rated, and with what.
 *
 * `reviews.order_id` is unique, so "has it been rated" and "what does it say" are
 * the same question and one query answers both.
 */
export function useOrderReview(orderId: string) {
  return useQuery({
    queryKey: queryKeys.orderReview(orderId),
    queryFn: () => getOrderReview(supabase, orderId),
    enabled: Boolean(orderId),
  });
}

export function useCreateReview(orderId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (review: Insert<'reviews'>) => createReview(supabase, review),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.orderReview(orderId) });
    },
  });
}

export function useFavorites() {
  return useQuery({
    queryKey: queryKeys.favorites(),
    queryFn: () => listFavorites(supabase),
  });
}

/**
 * One switch rather than an add hook and a remove hook, because the button is one
 * button and the caller already knows which way it is going.
 */
export function useToggleFavorite(studentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ menuItemId, on }: { menuItemId: string; on: boolean }) =>
      on
        ? addFavorite(supabase, studentId, menuItemId)
        : removeFavorite(supabase, studentId, menuItemId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: invalidationRoots.favorites });
    },
  });
}

/** Display only. `place_order` re-reads the coupon and is the one that decides. */
export function useCoupons() {
  return useQuery({
    queryKey: queryKeys.coupons(),
    queryFn: () => listCoupons(supabase),
    staleTime: 10 * 60 * 1000,
  });
}

export function useMyTickets() {
  return useQuery({
    queryKey: queryKeys.tickets(),
    queryFn: () => listTickets(supabase),
  });
}

export function useCreateTicket() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ticket: Insert<'support_tickets'>) => createTicket(supabase, ticket),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: invalidationRoots.tickets });
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
