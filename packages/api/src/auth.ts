import { AppError, ERROR_CODES, isCampusEmail, isRole, type Role, type Row } from '@canteza/shared';
import type { CampusClient } from './client';
import { mapSupabaseError, unwrap } from './errors';

/**
 * Authentication and identity.
 *
 * The role is read from the user's own `profiles` row, never asserted by the client.
 * It decides which navigation tree mounts; the database enforces the same boundary
 * independently, so a tampered client gets a prettier menu and no extra access.
 */

export type Profile = Row<'profiles'>;

export type Identity = {
  userId: string;
  email: string | null;
  profile: Profile;
  role: Role;
  /** Set for canteen staff and delivery partners; null for students and admins. */
  canteenId: string | null;
};

const MIN_PASSWORD_LENGTH = 8;

/** Matches what GoTrue will accept, so the user is told before the round trip. */
export function validatePassword(password: string): AppError | null {
  if (password.length < MIN_PASSWORD_LENGTH || !/[a-z]/i.test(password) || !/\d/.test(password)) {
    return new AppError(ERROR_CODES.WEAK_PASSWORD, { minLength: MIN_PASSWORD_LENGTH });
  }
  return null;
}

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * What a CAPTCHA widget handed back, for GoTrue to verify with the provider.
 *
 * Optional because the check is switched on in the Supabase dashboard, not here: with it
 * off GoTrue ignores the token, and with no site key configured the app sends none. Each
 * token is good for **one** request, so a screen asks for a fresh one after every
 * attempt, successful or not.
 */
type Captcha = { captchaToken?: string | null | undefined };

function captchaOption(input: Captcha): { captchaToken?: string } {
  return input.captchaToken ? { captchaToken: input.captchaToken } : {};
}

/**
 * Creates the account and says whether it is already signed in.
 *
 * With "Confirm email" off, GoTrue answers a sign-up with a session, so there is nothing
 * left to do — and nothing to spend a second CAPTCHA token on. With it on there is no
 * session until the address is confirmed.
 */
export async function signUp(
  client: CampusClient,
  input: { email: string; password: string; fullName: string } & Captcha,
): Promise<{ signedIn: boolean }> {
  const weak = validatePassword(input.password);
  if (weak) throw weak;
  // The database refuses anything else too (the Before User Created hook); this only
  // saves the student a round trip and a CAPTCHA token.
  if (!isCampusEmail(input.email)) throw new AppError(ERROR_CODES.EMAIL_NOT_ALLOWED);

  // Every signup is a student. Staff and partners are promoted server-side by an
  // admin, so there is no role field here to tamper with.
  const { data, error } = await client.auth.signUp({
    email: normaliseEmail(input.email),
    password: input.password,
    options: { data: { full_name: input.fullName.trim() }, ...captchaOption(input) },
  });
  if (error) throw mapSupabaseError(error);
  return { signedIn: Boolean(data.session) };
}

/**
 * Confirms the address with the code from the email, which also signs the student in.
 *
 * Then sets the password they just typed. GoTrue answers a second sign-up for an
 * unconfirmed address by re-sending the code **without** touching the password (read in
 * its `signup.go`), so whoever signed up first chose the password — possibly not the
 * mailbox's owner. The code proves who owns the mailbox; this makes the password theirs
 * too. When it is already theirs GoTrue answers `same_password`, which is the good case.
 */
export async function verifySignUpCode(
  client: CampusClient,
  input: { email: string; code: string; password: string },
): Promise<void> {
  const { error } = await client.auth.verifyOtp({
    email: normaliseEmail(input.email),
    token: input.code.replace(/\s+/g, ''),
    type: 'signup',
  });
  if (error) throw mapSupabaseError(error);

  const { error: passwordError } = await client.auth.updateUser({ password: input.password });
  if (passwordError && passwordError.code !== 'same_password') {
    throw mapSupabaseError(passwordError);
  }
}

/**
 * Sends a fresh code. GoTrue guards `/resend` with the CAPTCHA like sign-up, and allows
 * one email per address per minute (its "minimum interval"), so the screen waits too.
 */
export async function resendSignUpCode(
  client: CampusClient,
  input: { email: string } & Captcha,
): Promise<void> {
  const { error } = await client.auth.resend({
    type: 'signup',
    email: normaliseEmail(input.email),
    ...(input.captchaToken ? { options: { captchaToken: input.captchaToken } } : {}),
  });
  if (error) throw mapSupabaseError(error);
}

export async function signIn(
  client: CampusClient,
  input: { email: string; password: string } & Captcha,
): Promise<void> {
  const captcha = captchaOption(input);
  const { error } = await client.auth.signInWithPassword({
    email: normaliseEmail(input.email),
    password: input.password,
    ...(captcha.captchaToken ? { options: captcha } : {}),
  });
  if (error) throw mapSupabaseError(error);
}

export async function signOut(client: CampusClient): Promise<void> {
  const { error } = await client.auth.signOut();
  if (error) throw mapSupabaseError(error);
}

/**
 * Resolves who is signed in, or null. Throws only on real failures — being signed
 * out is an answer, not an error.
 */
export async function getIdentity(client: CampusClient): Promise<Identity | null> {
  const { data, error } = await client.auth.getUser();
  if (error) {
    const mapped = mapSupabaseError(error);
    if (mapped.code === ERROR_CODES.UNAUTHENTICATED) return null;
    throw mapped;
  }
  const user = data.user;
  if (!user) return null;

  const profile = await unwrap(client.from('profiles').select('*').eq('id', user.id).maybeSingle());

  // The trigger creates the profile on signup, so this means the row was deleted or
  // the account is mid-creation. Either way there is no identity to act as.
  if (!profile) return null;
  if (!profile.is_active) {
    throw new AppError(ERROR_CODES.ACCOUNT_SUSPENDED);
  }
  if (!isRole(profile.role)) {
    throw new AppError(ERROR_CODES.UNKNOWN, { reason: 'unknown_role', role: profile.role });
  }

  return {
    userId: user.id,
    email: user.email ?? null,
    profile,
    role: profile.role,
    canteenId: await resolveCanteenId(client, profile.role),
  };
}

/**
 * Which canteen this account belongs to. Both lookups are RLS-scoped to the caller's
 * own row, so this cannot be used to discover anyone else's posting.
 */
async function resolveCanteenId(client: CampusClient, role: Role): Promise<string | null> {
  if (role === 'canteen') {
    const staff = await unwrap(client.from('canteen_staff').select('canteen_id').maybeSingle());
    return staff?.canteen_id ?? null;
  }
  if (role === 'delivery') {
    const posting = await unwrap(
      client
        .from('delivery_partners')
        .select('canteen_id')
        .eq('is_active', true)
        .eq('is_approved', true)
        .maybeSingle(),
    );
    return posting?.canteen_id ?? null;
  }
  return null;
}

/**
 * A canteen or delivery account with no posting cannot do its job — the admin has
 * not finished onboarding it. Screens use this to explain that, rather than showing
 * an empty list that looks broken.
 */
export function isAwaitingOnboarding(identity: Identity): boolean {
  return (identity.role === 'canteen' || identity.role === 'delivery') && !identity.canteenId;
}
