-- What a student wants to know about a canteen before tapping it: how good is it, and
-- how long will it take.
--
-- Both are facts about the canteen, not about the caller, so both are aggregated here
-- rather than assembled on a phone. One row per active canteen, nulls where there is
-- not enough history to answer yet.
--
-- ---------------------------------------------------------------------------
-- Why this view is NOT security_invoker, which is the opposite of revenue_by_canteen_day
-- ---------------------------------------------------------------------------
-- `revenue_by_canteen_day` is invoker precisely so `orders_read` scopes it: money is
-- the caller's business only where RLS says so.
--
-- Here that would be actively wrong. `orders_read` limits a student to their own
-- orders, so an invoker view would compute each student a private median from the
-- handful of orders they happen to have placed -- a brand new student would see no ETA
-- at all, and two students would see different numbers for the same counter. A
-- preparation time is a property of the kitchen, the same for everyone looking at it.
--
-- That is safe only because every column below is an aggregate. No order, no student,
-- no money and no identifier other than the canteen's own id survives the GROUP BY, so
-- running as owner discloses nothing a canteen's own menu page does not. This is the
-- same call `canteens_public` makes and for the same reason: there is nothing private
-- in it. Adding a non-aggregate column here would break that argument -- don't.

create view public.canteen_stats as
  with ratings as (
    select
      r.canteen_id,
      round(avg(r.food_rating)::numeric, 1) as avg_food_rating,
      count(*)::integer                     as review_count
    from public.reviews r
    group by r.canteen_id
  ),
  timings as (
    -- Accepted -> ready is the kitchen's own clock. The queue before acceptance is
    -- the counter noticing the order, and the leg after ready belongs to delivery;
    -- folding either in would blame the kitchen for someone else's minutes.
    select
      o.canteen_id,
      (select min(h.created_at)
         from public.order_status_history h
        where h.order_id = o.id and h.to_status = 'accepted') as accepted_at,
      (select min(h.created_at)
         from public.order_status_history h
        where h.order_id = o.id and h.to_status = 'ready')    as ready_at
    from public.orders o
    -- A month, so a canteen that has got faster is judged on how it cooks now. No
    -- status filter: any order that reached `ready` was genuinely cooked, including
    -- one cancelled afterwards, and throwing those away loses real timings.
    where o.created_at > now() - interval '30 days'
  ),
  prep as (
    select
      t.canteen_id,
      -- Median, not average: one order left sitting because nobody tapped "ready"
      -- until closing drags a mean into fiction, and the median ignores it.
      round(
        percentile_cont(0.5) within group (
          order by extract(epoch from (t.ready_at - t.accepted_at)) / 60
        )::numeric
      )::integer as median_prep_minutes,
      count(*)::integer as prep_sample_size
    from timings t
    where t.accepted_at is not null
      and t.ready_at is not null
      and t.ready_at > t.accepted_at
    group by t.canteen_id
  )
  select
    c.id                     as canteen_id,
    r.avg_food_rating,
    coalesce(r.review_count, 0)     as review_count,
    p.median_prep_minutes,
    coalesce(p.prep_sample_size, 0) as prep_sample_size
  from public.canteens c
  left join ratings r on r.canteen_id = c.id
  left join prep    p on p.canteen_id = c.id
  where c.is_active;

comment on view public.canteen_stats is
  'Per-canteen rating average and median kitchen minutes, over the last 30 days.
   Deliberately NOT security_invoker: orders_read would give every student a private
   ETA computed from their own orders. Safe because every column is an aggregate --
   adding a non-aggregate column would break that and is not allowed.';

grant select on public.canteen_stats to authenticated;
