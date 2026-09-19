-- A student's usual delivery address.
--
-- Phase 4: checkout prefills from this so repeat ordering is two taps instead of
-- five. It is a *default*, not the address of record -- `orders` still snapshots
-- hostel/block/room at purchase (ADR 003), so changing rooms next term does not
-- rewrite where last month's food actually went.
--
-- Deliberately not a separate `addresses` table: a student has one room, and a
-- one-row-per-user table is a join for nothing. If ordering to a friend's room ever
-- needs remembering, that is a table then, not speculation now.

alter table public.profiles
  add column default_hostel_id uuid references public.hostels (id) on delete set null,
  add column default_block     text,
  add column default_room      text;

comment on column public.profiles.default_hostel_id is
  'Prefills checkout. The authoritative address for any order is the snapshot on orders.';

-- Either the address is fully set or it is absent. A half-filled default would
-- prefill a checkout that cannot be submitted, which reads as a broken form.
alter table public.profiles
  add constraint profile_default_address_complete check (
    (default_hostel_id is null and default_block is null and default_room is null)
    or (default_hostel_id is not null and default_block is not null and default_room is not null)
  );

-- The student owns these three columns, unlike `role`, which still has no grant.
grant update (default_hostel_id, default_block, default_room) on public.profiles to authenticated;
