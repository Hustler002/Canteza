-- CampusEats schema.
--
-- Conventions (ADR 003):
--   * uuid primary keys
--   * all money is `integer` paise, never float, always CHECK (>= 0)
--   * status columns are `text` + CHECK, not enums (adding a value stays a one-liner)
--   * nothing operational is hard-deleted; `is_active` disables instead
--   * orders snapshot what was charged, and keep the FK for aggregation

-- gen_random_uuid() is core Postgres since 13; no extension needed.

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------

create or replace function public.touch_updated_at() returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- people
-- ---------------------------------------------------------------------------

create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  role        text        not null default 'student'
                check (role in ('student', 'canteen', 'delivery', 'admin')),
  full_name   text        not null default '',
  phone       text,
  avatar_url  text,
  is_active   boolean     not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on column public.profiles.role is
  'Set server-side only. A client may never write this column (see RLS).';

create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

-- New signups are always students. Staff and partners are promoted by an admin.
create or replace function public.handle_new_user() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- campus
-- ---------------------------------------------------------------------------

create table public.hostels (
  id         uuid primary key default gen_random_uuid(),
  name       text        not null unique,
  blocks     text[]      not null default '{}',
  is_active  boolean     not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger hostels_touch before update on public.hostels
  for each row execute function public.touch_updated_at();

create table public.canteens (
  id                  uuid primary key default gen_random_uuid(),
  name                text        not null unique,
  description         text        not null default '',
  image_url           text,
  -- Staff's manual pause switch, independent of the schedule.
  is_accepting_orders boolean     not null default true,
  opens_at            time        not null default '08:00',
  closes_at           time        not null default '22:00',
  min_order_paise     integer     not null default 0 check (min_order_paise >= 0),
  phone               text,
  is_active           boolean     not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create trigger canteens_touch before update on public.canteens
  for each row execute function public.touch_updated_at();

-- Handles windows that cross midnight (Night Canteen: 20:00 -> 02:00).
create or replace function public.is_within_hours(p_opens time, p_closes time, p_at time)
returns boolean
language sql
immutable
as $$
  select case
    when p_opens = p_closes then true                  -- 24 hours
    when p_opens <  p_closes then p_at >= p_opens and p_at < p_closes
    else p_at >= p_opens or p_at < p_closes            -- crosses midnight
  end;
$$;

-- One campus, one timezone. Stated once here rather than relying on the database's
-- own timezone, which is UTC on Supabase and would make every canteen look shut.
create or replace function public.campus_now() returns time
language sql
stable
as $$
  select (now() at time zone 'Asia/Kolkata')::time;
$$;

-- `is_open` is derived, never stored: a stored flag goes stale the moment nobody
-- remembers to flip it. Exposed through this view, which clients read.
create view public.canteens_public as
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
    c.is_accepting_orders
  from public.canteens c
  where c.is_active;

create table public.canteen_staff (
  canteen_id uuid        not null references public.canteens (id) on delete cascade,
  profile_id uuid        not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (canteen_id, profile_id)
);

-- One staff account belongs to one canteen; the RLS helper depends on that.
create unique index canteen_staff_one_canteen on public.canteen_staff (profile_id);

create table public.delivery_partners (
  profile_id  uuid primary key references public.profiles (id) on delete cascade,
  is_approved boolean     not null default false,
  is_online   boolean     not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger delivery_partners_touch before update on public.delivery_partners
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- menu
-- ---------------------------------------------------------------------------

create table public.food_categories (
  id         uuid primary key default gen_random_uuid(),
  name       text    not null unique,
  sort_order integer not null default 0
);

create table public.menu_items (
  id           uuid primary key default gen_random_uuid(),
  canteen_id   uuid        not null references public.canteens (id) on delete cascade,
  category_id  uuid        references public.food_categories (id) on delete set null,
  name         text        not null,
  description  text        not null default '',
  price_paise  integer     not null check (price_paise > 0),
  image_url    text,
  is_veg       boolean     not null default true,
  is_available boolean     not null default true,
  is_active    boolean     not null default true,
  sort_order   integer     not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (canteen_id, name)
);

create trigger menu_items_touch before update on public.menu_items
  for each row execute function public.touch_updated_at();

create index menu_items_by_canteen on public.menu_items (canteen_id) where is_active;
create index menu_items_by_category on public.menu_items (category_id) where is_active;

-- ---------------------------------------------------------------------------
-- coupons
-- ---------------------------------------------------------------------------

create table public.coupons (
  id                  uuid primary key default gen_random_uuid(),
  code                text        not null unique,
  kind                text        not null check (kind in ('flat', 'percent')),
  amount_paise        integer     check (amount_paise > 0),
  percent_off         integer     check (percent_off between 1 and 100),
  max_discount_paise  integer     check (max_discount_paise > 0),
  min_order_paise     integer     not null default 0 check (min_order_paise >= 0),
  max_redemptions     integer     check (max_redemptions > 0),
  per_student_limit   integer     not null default 1 check (per_student_limit > 0),
  valid_from          timestamptz not null default now(),
  valid_until         timestamptz,
  is_active           boolean     not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  -- A flat coupon needs an amount; a percent coupon needs a rate and a ceiling.
  constraint coupon_shape check (
    (kind = 'flat'    and amount_paise is not null
                      and percent_off is null and max_discount_paise is null)
    or
    (kind = 'percent' and percent_off is not null and max_discount_paise is not null
                      and amount_paise is null)
  )
);

create trigger coupons_touch before update on public.coupons
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- orders
-- ---------------------------------------------------------------------------

create sequence public.order_code_seq start 101;

create table public.orders (
  id           uuid primary key default gen_random_uuid(),
  code         text        not null unique default ('#' || nextval('public.order_code_seq')),
  student_id   uuid        not null references public.profiles (id),
  canteen_id   uuid        not null references public.canteens (id),

  status       text        not null default 'pending'
                 check (status in ('pending', 'accepted', 'preparing', 'ready',
                                   'assigned', 'picked_up', 'delivered',
                                   'cancelled', 'rejected')),

  -- Snapshots: an order must stay readable after the canteen is renamed or the
  -- student changes rooms (ADR 003).
  canteen_name_snapshot text not null,
  hostel_id    uuid        references public.hostels (id),
  hostel_label text        not null,
  block        text        not null,
  room         text        not null,
  delivery_note text       not null default '',

  subtotal_paise      integer not null check (subtotal_paise >= 0),
  discount_paise      integer not null default 0 check (discount_paise >= 0),
  delivery_fee_paise  integer not null default 0 check (delivery_fee_paise >= 0),
  packaging_fee_paise integer not null default 0 check (packaging_fee_paise >= 0),
  total_paise         integer not null check (total_paise >= 0),
  partner_payout_paise integer not null default 0 check (partner_payout_paise >= 0),

  coupon_id           uuid references public.coupons (id),
  coupon_code_snapshot text,

  delivery_partner_id uuid references public.profiles (id),

  cancellation_reason text,
  idempotency_key     text not null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- The arithmetic the server computed must hold in the row itself.
  constraint order_total_consistent check (
    total_paise = subtotal_paise - discount_paise + delivery_fee_paise + packaging_fee_paise
  ),
  constraint order_discount_within_subtotal check (discount_paise <= subtotal_paise),
  -- A double-tapped "Place order" resolves to one row.
  constraint orders_idempotent unique (student_id, idempotency_key)
);

create trigger orders_touch before update on public.orders
  for each row execute function public.touch_updated_at();

create index orders_by_student on public.orders (student_id, created_at desc);
create index orders_by_canteen on public.orders (canteen_id, status);
-- The delivery pool: a small, hot, partial index.
create index orders_ready_pool on public.orders (created_at) where status = 'ready';
create index orders_by_partner on public.orders (delivery_partner_id, created_at desc)
  where delivery_partner_id is not null;

create table public.order_items (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid    not null references public.orders (id) on delete cascade,
  -- Kept for reorder and analytics; never read for a historical price.
  menu_item_id  uuid    references public.menu_items (id),
  name_snapshot text    not null,
  is_veg        boolean not null default true,
  unit_price_paise integer not null check (unit_price_paise > 0),
  quantity      integer not null check (quantity > 0),
  line_total_paise integer not null check (line_total_paise > 0),
  constraint order_item_line_total check (line_total_paise = unit_price_paise * quantity)
);

create index order_items_by_order on public.order_items (order_id);

-- Append-only audit trail. Answers "who moved this order, and when".
create table public.order_status_history (
  id          bigserial primary key,
  order_id    uuid not null references public.orders (id) on delete cascade,
  from_status text,
  to_status   text not null,
  actor       text not null check (actor in ('student', 'canteen', 'delivery', 'admin', 'system')),
  actor_id    uuid references public.profiles (id),
  reason      text,
  created_at  timestamptz not null default now()
);

create index order_status_history_by_order on public.order_status_history (order_id, created_at);

-- ---------------------------------------------------------------------------
-- the order state machine, as data
-- ---------------------------------------------------------------------------
-- Mirrors ORDER_TRANSITIONS in packages/shared/src/order-status.ts. A test compares
-- the two, so drift fails CI rather than production.

create table public.order_transitions (
  from_status text not null,
  to_status   text not null,
  actor       text not null,
  primary key (from_status, to_status, actor)
);

insert into public.order_transitions (from_status, to_status, actor) values
  ('pending',   'accepted',  'canteen'),
  ('pending',   'accepted',  'admin'),
  ('pending',   'rejected',  'canteen'),
  ('pending',   'rejected',  'admin'),
  ('pending',   'cancelled', 'student'),
  ('pending',   'cancelled', 'admin'),
  ('pending',   'cancelled', 'system'),
  ('accepted',  'preparing', 'canteen'),
  ('accepted',  'preparing', 'admin'),
  ('accepted',  'cancelled', 'admin'),
  ('accepted',  'cancelled', 'system'),
  ('preparing', 'ready',     'canteen'),
  ('preparing', 'ready',     'admin'),
  ('preparing', 'cancelled', 'admin'),
  ('ready',     'assigned',  'delivery'),
  ('ready',     'assigned',  'admin'),
  ('ready',     'cancelled', 'admin'),
  ('assigned',  'picked_up', 'delivery'),
  ('assigned',  'picked_up', 'admin'),
  ('assigned',  'ready',     'delivery'),
  ('assigned',  'ready',     'admin'),
  ('assigned',  'cancelled', 'admin'),
  ('picked_up', 'delivered', 'delivery'),
  ('picked_up', 'delivered', 'admin'),
  ('picked_up', 'cancelled', 'admin');

-- ---------------------------------------------------------------------------
-- payments
-- ---------------------------------------------------------------------------

create table public.payments (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid    not null unique references public.orders (id) on delete cascade,
  method     text    not null check (method in ('cod', 'razorpay')),
  status     text    not null check (status in ('initiated', 'pending', 'success', 'failed', 'refunded')),
  amount_paise integer not null check (amount_paise >= 0),
  -- Razorpay identifiers; the webhook is idempotent on provider_payment_id.
  provider_order_id   text,
  provider_payment_id text unique,
  failure_reason      text,
  paid_at             timestamptz,
  refunded_at         timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger payments_touch before update on public.payments
  for each row execute function public.touch_updated_at();

create index payments_by_status on public.payments (status, created_at desc);

create table public.coupon_redemptions (
  id         uuid primary key default gen_random_uuid(),
  coupon_id  uuid not null references public.coupons (id) on delete cascade,
  student_id uuid not null references public.profiles (id) on delete cascade,
  order_id   uuid not null unique references public.orders (id) on delete cascade,
  discount_paise integer not null check (discount_paise >= 0),
  created_at timestamptz not null default now()
);

create index coupon_redemptions_by_student on public.coupon_redemptions (coupon_id, student_id);

-- ---------------------------------------------------------------------------
-- engagement
-- ---------------------------------------------------------------------------

create table public.reviews (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid    not null unique references public.orders (id) on delete cascade,
  student_id uuid    not null references public.profiles (id) on delete cascade,
  canteen_id uuid    not null references public.canteens (id) on delete cascade,
  food_rating     integer not null check (food_rating between 1 and 5),
  delivery_rating integer check (delivery_rating between 1 and 5),
  comment    text    not null default '',
  created_at timestamptz not null default now()
);

create index reviews_by_canteen on public.reviews (canteen_id, created_at desc);

create table public.favorites (
  student_id   uuid not null references public.profiles (id) on delete cascade,
  menu_item_id uuid not null references public.menu_items (id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (student_id, menu_item_id)
);

create table public.notifications (
  id       uuid primary key default gen_random_uuid(),
  user_id  uuid not null references public.profiles (id) on delete cascade,
  -- Content is NOT stored: it is rendered from (audience, status) by
  -- packages/shared/src/notifications.ts, so in-app and push text cannot drift.
  audience text not null check (audience in ('student', 'canteen', 'delivery')),
  type     text not null default 'order_status',
  order_id uuid references public.orders (id) on delete cascade,
  status   text,
  read_at  timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_unread on public.notifications (user_id, created_at desc)
  where read_at is null;

create table public.support_tickets (
  id         uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  order_id   uuid references public.orders (id) on delete set null,
  subject    text not null,
  body       text not null default '',
  status     text not null default 'open' check (status in ('open', 'in_progress', 'resolved', 'closed')),
  resolution text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger support_tickets_touch before update on public.support_tickets
  for each row execute function public.touch_updated_at();

create index support_tickets_by_status on public.support_tickets (status, created_at desc);

-- ---------------------------------------------------------------------------
-- platform settings
-- ---------------------------------------------------------------------------
-- Fallbacks live in packages/shared/src/config.ts; a row here overrides one.

create table public.platform_settings (
  key        text primary key,
  value      jsonb       not null,
  updated_at timestamptz not null default now()
);

create trigger platform_settings_touch before update on public.platform_settings
  for each row execute function public.touch_updated_at();
