-- Revenue, aggregated where the data is.
--
-- One row per canteen per campus day of delivered orders. Grouping in Postgres rather
-- than pulling every delivered order into the dashboard keeps the page's reads bounded
-- by canteens x days instead of by how long the platform has been running.
--
-- `security_invoker = true` is the important part, and the difference from
-- `canteens_public`: this view runs with the *caller's* privileges, so `orders_read`
-- applies to it unchanged. An admin sees the platform; a canteen account would see only
-- its own rows, which is a canteen revenue page for free whenever that is wanted. A view
-- without it would have handed every caller the whole platform's takings.
--
-- Only `delivered` counts. A cancelled or rejected order consumes nothing (rule 12), and
-- an order still in someone's hands is not yet revenue.
--
-- Days are campus days. `created_at` is a timestamptz and the server runs UTC, so
-- grouping on it directly would cut each day at 05:30 IST and file every evening's orders
-- under tomorrow. Same reasoning as `campus_now()`.
--
-- On the discount column: it is reported, never netted into anybody's "revenue" here.
-- `canteen_received_paise` is the money that actually reaches the canteen, which is after
-- the discount, because `total_paise` is what the student paid. That is the settled
-- policy, not an accident: the canteen funds every coupon, including an admin-issued one,
-- and the platform's slice of the delivery fee is never touched by one (ADR 008). The
-- discount stays its own column because it is the canteen's marketing spend and worth
-- seeing on its own.

create view public.revenue_by_canteen_day
with (security_invoker = true) as
  select
    (o.created_at at time zone 'Asia/Kolkata')::date as day,
    o.canteen_id,
    c.name                                as canteen_name,
    count(*)::integer                     as orders,
    sum(o.subtotal_paise)::integer        as gross_subtotal_paise,
    sum(o.discount_paise)::integer        as discounts_paise,
    sum(o.delivery_fee_paise)::integer    as delivery_fees_paise,
    sum(o.packaging_fee_paise)::integer   as packaging_fees_paise,
    -- What the student actually handed over.
    sum(o.total_paise)::integer           as students_paid_paise,
    -- Our entire revenue line: a slice of the delivery fee, nothing on food (ADR 008).
    sum(o.platform_fee_paise)::integer    as platform_fee_paise,
    -- Everything else, which is the canteen's.
    sum(o.total_paise - o.platform_fee_paise)::integer as canteen_received_paise
  from public.orders o
  join public.canteens c on c.id = o.canteen_id
  where o.status = 'delivered'
  group by 1, 2, 3;

comment on view public.revenue_by_canteen_day is
  'Delivered orders summed per canteen per campus day. security_invoker, so RLS on
   orders decides what any caller sees. Discounts are reported, not netted into a
   revenue figure -- see ADR 008 on who funds them.';

grant select on public.revenue_by_canteen_day to authenticated;
