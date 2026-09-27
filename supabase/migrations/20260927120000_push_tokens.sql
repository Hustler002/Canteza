-- Expo push: where to send.
--
-- Phase 8's other half of the notification system. `notify_order` has written a row per
-- transition since Phase 2 and the in-app inbox reads them; push is the same row, sent to
-- a phone. Nothing about *what* to say is stored here or anywhere -- the row is
-- `(audience, status, order_id)` and the wording comes from `orderNotification()`, which
-- the `send-push` Edge Function calls exactly as the inbox does.
--
-- So all this migration adds is the address book: which devices belong to whom.

create table public.push_tokens (
  -- The token is the key, not (user, token). A token names a *device*, and a device has
  -- one person signed in at a time: when someone else signs in on the same phone, the
  -- row moves to them. Keyed on (user, token), the previous owner would keep receiving
  -- pushes on a phone that is no longer theirs -- someone else's order updates, on the
  -- lock screen of a phone they handed back.
  token        text primary key
               check (token ~ '^Expo(nent)?PushToken\[[^][:space:]]+\]$'),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  platform     text not null check (platform in ('android', 'ios')),
  created_at   timestamptz not null default now(),
  -- Refreshed on every app start, so a token nobody has used in months can be pruned
  -- without waiting for Expo to report it dead.
  last_seen_at timestamptz not null default now()
);

create index push_tokens_by_user on public.push_tokens (user_id);

alter table public.push_tokens enable row level security;

-- Your own devices, and nobody else's. Reading them is harmless (it is your address);
-- deleting one is signing a device out of push, which the app does at sign-out.
create policy push_tokens_own_read on public.push_tokens
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy push_tokens_own_delete on public.push_tokens
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- No INSERT or UPDATE grant. Registering goes through the function below, because moving
-- a token from its previous owner means writing a row the caller does not own, which no
-- policy may allow without allowing a great deal more.
grant select, delete on public.push_tokens to authenticated;

-- ---------------------------------------------------------------------------
-- register_push_token
-- ---------------------------------------------------------------------------
-- Called by the app on every start while signed in. Idempotent: the same device and the
-- same person just refreshes `last_seen_at`.
--
-- The one thing this lets a caller do that a policy would not: take a token from another
-- account. That is the point -- it is how a shared or handed-down phone stops delivering
-- the previous owner's notifications -- and it cannot be used to *receive* anyone's
-- messages: claiming a token sends your own notifications to that device, not theirs to
-- you. An Expo push token is also not something another app or person can read off a
-- phone.

create or replace function public.register_push_token(
  p_token    text,
  p_platform text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED: sign in first' using errcode = 'P0001';
  end if;

  insert into public.push_tokens (token, user_id, platform)
  values (trim(p_token), v_uid, p_platform)
  on conflict (token) do update
     set user_id      = excluded.user_id,
         platform     = excluded.platform,
         last_seen_at = now();
end;
$$;

revoke all on function public.register_push_token(text, text) from public;
grant execute on function public.register_push_token(text, text) to authenticated;

comment on table public.push_tokens is
  'One row per device: the Expo push token and whoever is signed in on it now. Written
   only by register_push_token; read by the send-push Edge Function with the service role.';
