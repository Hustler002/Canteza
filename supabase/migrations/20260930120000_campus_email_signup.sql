-- Student sign-up by college email only: one mailbox, one account.
--
-- Sign-up was open to any address, and with "Confirm email" off nobody had to own the
-- address either, so one student could hold as many accounts as they could type
-- addresses -- each with its own five open orders (security_hardening) and its own
-- first-order coupon. From here a student account needs a mailbox at the college's
-- domain, proven by a code sent to it (the code is GoTrue's; this file is the domain).
--
-- Three pieces:
--
--   1. `is_campus_email(text)`: the rule. Mirrored in packages/shared/src/campus-email.ts
--      for the form; campus-email.test.ts runs both over the same addresses.
--   2. `hook_before_user_created(jsonb)`: Supabase's "Before User Created" auth hook,
--      which GoTrue calls before inserting a user on public sign-up and on invites --
--      read in its source (signup.go, invite.go). It is NOT called by the admin API
--      (admin.go's adminUserCreate), which is how staff accounts are made: canteen
--      workers and delivery partners do not have college mailboxes. The hook must be
--      switched on in the dashboard (Authentication -> Hooks); a migration cannot.
--   3. A trigger refusing to move a college account to any other address. Otherwise a
--      student could sign up, change the email to a personal one, and sign up again
--      with the college mailbox now free -- a second account on one mailbox.

create or replace function public.is_campus_email(email text) returns boolean
language sql
immutable
set search_path = ''
as $$
  -- Exactly the college domain (no subdomains), and no `+tag`: the college mail is
  -- Google Workspace, where name+1@ and name+2@ both land in name@.
  select coalesce(lower(trim(email)) ~ '^[a-z0-9._-]+@mnnit\.ac\.in$', false);
$$;

comment on function public.is_campus_email(text) is
  'A student mailbox at the college domain. Mirrored in packages/shared/src/campus-email.ts.';

-- ---------------------------------------------------------------------------
-- 2. the sign-up hook
-- ---------------------------------------------------------------------------

-- Returns '{}' to allow, or an error object GoTrue hands to the client as the sign-up's
-- answer. The message starts with the error code, which mapSupabaseError reads as it
-- reads our SQL's 'CODE: detail'. An empty email (phone or anonymous sign-up) is refused
-- too: neither is a way in for a student.
create or replace function public.hook_before_user_created(event jsonb) returns jsonb
language plpgsql
stable
set search_path = ''
as $$
begin
  if public.is_campus_email(event -> 'user' ->> 'email') then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object(
    'error', jsonb_build_object(
      'http_code', 403,
      'message', 'EMAIL_NOT_ALLOWED: sign up with your college email (@mnnit.ac.in)'
    )
  );
end;
$$;

-- GoTrue calls the hook as supabase_auth_admin, and nobody else should: over RPC it would
-- only tell a caller what the rule is, but it has no business on the API surface.
grant usage on schema public to supabase_auth_admin;
grant execute on function public.is_campus_email(text) to supabase_auth_admin;
grant execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;
revoke execute on function public.is_campus_email(text) from public, anon, authenticated;
revoke execute on function public.hook_before_user_created(jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. a college account keeps a college address
-- ---------------------------------------------------------------------------

-- GoTrue writes a requested address to `email_change` first and moves it into `email`
-- once confirmed, so both are guarded: refused at the request, and again at the move if
-- anything slipped past. Moving between two college addresses is allowed -- the new one
-- still has to be confirmed from its own mailbox. Staff accounts (not college addresses)
-- are untouched.
create or replace function public.keep_campus_email() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not public.is_campus_email(old.email) then
    return new;
  end if;
  if new.email is distinct from old.email and not public.is_campus_email(new.email) then
    raise exception 'EMAIL_NOT_ALLOWED: a college account keeps a college email';
  end if;
  if coalesce(new.email_change, '') <> ''
     and new.email_change is distinct from old.email_change
     and not public.is_campus_email(new.email_change) then
    raise exception 'EMAIL_NOT_ALLOWED: a college account keeps a college email';
  end if;
  return new;
end;
$$;

revoke execute on function public.keep_campus_email() from public, anon, authenticated;

create trigger keep_campus_email before update of email, email_change on auth.users
  for each row execute function public.keep_campus_email();
