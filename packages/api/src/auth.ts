import { AppError, ERROR_CODES, isRole, type Role, type Row } from '@campuseats/shared';
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

export async function signUp(
  client: CampusClient,
  input: { email: string; password: string; fullName: string },
): Promise<void> {
  const weak = validatePassword(input.password);
  if (weak) throw weak;

  // Every signup is a student. Staff and partners are promoted server-side by an
  // admin, so there is no role field here to tamper with.
  const { error } = await client.auth.signUp({
    email: normaliseEmail(input.email),
    password: input.password,
    options: { data: { full_name: input.fullName.trim() } },
  });
  if (error) throw mapSupabaseError(error);
}

export async function signIn(
  client: CampusClient,
  input: { email: string; password: string },
): Promise<void> {
  const { error } = await client.auth.signInWithPassword({
    email: normaliseEmail(input.email),
    password: input.password,
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
    throw new AppError(ERROR_CODES.FORBIDDEN, { reason: 'account_disabled' });
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
