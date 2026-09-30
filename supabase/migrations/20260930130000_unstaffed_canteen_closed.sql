-- A canteen nobody can run takes no orders.
--
-- Found on the live project on 2026-09-30: Hostel Canteen and Night Canteen showed
-- students "open" and took their orders -- prepaid ones too -- while the only counter
-- account of each was banned (the 2026-09-29 credential rotation banned them at Auth).
-- Twelve orders sat in `pending` for days that nobody could ever accept. Nothing tied
-- "accepting orders" to "someone is there to accept them", and suspending a canteen's
-- only worker through the admin path would have produced the same thing.
--
-- `canteen_is_staffed()` is that tie: at least one counter account whose profile is
-- active and who is not banned at Auth -- both, because the emergency bans were made at
-- Auth alone and left the profiles reading active. It is used twice:
--
--   * `canteens_public.is_accepting_orders` reads false without it, so the student sees
--     the canteen as not taking orders, and the cart's blocker says so before checkout;
--   * a trigger on `orders` refuses the insert (CANTEEN_CLOSED), whatever function makes
--     it -- the same shape as orders_refuse_suspended_actor.
--
-- The counter's own pause switch is untouched: `canteens.is_accepting_orders` is still
-- theirs, and the view ANDs the two.

create or replace function public.canteen_is_staffed(p_canteen_id uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.canteen_staff cs
      join public.profiles p on p.id = cs.profile_id
      join auth.users u on u.id = cs.profile_id
     where cs.canteen_id = p_canteen_id
       and p.is_active
       and (u.banned_until is null or u.banned_until <= now())
  );
$$;

comment on function public.canteen_is_staffed(uuid) is
  'Someone can work this counter: an active profile, not banned at Auth. Only a boolean leaves it.';

-- Definer, because a student may read neither canteen_staff rows but their own nor
-- auth.users at all; what comes back is one boolean per canteen, which the view already
-- implies. The view is security_invoker, so the caller needs EXECUTE.
revoke execute on function public.canteen_is_staffed(uuid) from public, anon;
grant execute on function public.canteen_is_staffed(uuid) to authenticated, service_role;

create or replace view public.canteens_public
  with (security_invoker = true)
as
  select
    c.id,
    c.name,
    c.description,
    c.image_url,
    c.opens_at,
    c.closes_at,
    c.min_order_paise,
    c.phone,
    public.is_within_hours(c.opens_at, c.closes_at, public.campus_now()) as is_open,
    c.is_accepting_orders and public.canteen_is_staffed(c.id) as is_accepting_orders
  from public.canteens c
  where c.is_active;

create or replace function public.orders_refuse_unstaffed_canteen() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not public.canteen_is_staffed(new.canteen_id) then
    raise exception 'CANTEEN_CLOSED: nobody is working this counter' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke execute on function public.orders_refuse_unstaffed_canteen() from public, anon, authenticated;

create trigger orders_refuse_unstaffed_canteen before insert on public.orders
  for each row execute function public.orders_refuse_unstaffed_canteen();
