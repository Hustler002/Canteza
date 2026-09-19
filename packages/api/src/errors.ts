import { AppError, ERROR_CODES, toAppError, type ErrorCode } from '@campuseats/shared';

/**
 * Every failure from Supabase becomes an AppError before it reaches a screen, so no
 * component ever renders a raw Postgres or GoTrue message.
 *
 * Our SQL raises `'CODE: detail'` and toAppError() already parses that prefix. What
 * this file adds is the rest: GoTrue's prose, PostgREST's SQLSTATE codes, and the
 * fetch failures that happen on a phone with two bars of signal.
 */

/** GoTrue reports auth failures as prose; match on it rather than guessing. */
const AUTH_MESSAGES: Array<[RegExp, ErrorCode]> = [
  [/invalid login credentials/i, ERROR_CODES.INVALID_CREDENTIALS],
  [/email not confirmed/i, ERROR_CODES.EMAIL_NOT_CONFIRMED],
  [/already registered|already been registered|user already exists/i, ERROR_CODES.EMAIL_IN_USE],
  [/password should be|password is too short|weak password/i, ERROR_CODES.WEAK_PASSWORD],
  [/rate limit|too many requests/i, ERROR_CODES.RATE_LIMITED],
  [/jwt expired|invalid claim|session.*missing|refresh token/i, ERROR_CODES.UNAUTHENTICATED],
];

/** PostgREST surfaces the SQLSTATE that RLS and constraints produce. */
const SQLSTATE: Record<string, ErrorCode> = {
  '42501': ERROR_CODES.FORBIDDEN, // insufficient privilege / RLS refusal
  '23505': ERROR_CODES.DUPLICATE_REQUEST, // unique violation
  '23503': ERROR_CODES.NOT_FOUND, // foreign key violation
  '23514': ERROR_CODES.UNKNOWN, // check violation: a bug, not a user error
  PGRST301: ERROR_CODES.UNAUTHENTICATED,
  PGRST116: ERROR_CODES.NOT_FOUND, // .single() matched no rows
};

type SupabaseLikeError = {
  message?: unknown;
  code?: unknown;
  status?: unknown;
  name?: unknown;
};

export function mapSupabaseError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (!error || typeof error !== 'object') {
    return new AppError(ERROR_CODES.UNKNOWN, { raw: String(error) });
  }

  const err = error as SupabaseLikeError;
  const message = typeof err.message === 'string' ? err.message : '';
  const code = typeof err.code === 'string' ? err.code : undefined;
  const status = typeof err.status === 'number' ? err.status : undefined;

  // A dropped connection is the single most common failure on a phone, and it is
  // never the user's fault.
  if (
    err.name === 'AuthRetryableFetchError' ||
    /fetch failed|network request failed/i.test(message)
  ) {
    return new AppError(ERROR_CODES.NETWORK, { raw: message });
  }

  // Our own functions raise 'CODE: detail'; that prefix wins over everything else.
  const prefix = message.split(':')[0]?.trim();
  if (prefix && prefix in ERROR_CODES) {
    return new AppError(prefix as ErrorCode, { raw: message });
  }

  if (code && SQLSTATE[code]) {
    return new AppError(SQLSTATE[code], { raw: message, code });
  }

  for (const [pattern, mapped] of AUTH_MESSAGES) {
    if (pattern.test(message)) return new AppError(mapped, { raw: message });
  }

  if (status === 401 || status === 403) {
    return new AppError(ERROR_CODES.FORBIDDEN, { raw: message, status });
  }
  if (status === 429) return new AppError(ERROR_CODES.RATE_LIMITED, { raw: message });

  return toAppError(error);
}

/**
 * Unwraps a Supabase response, throwing a typed AppError instead of returning
 * `{ data, error }` for every caller to remember to check.
 *
 * `data: T` rather than a success/failure union on purpose: a union here makes
 * TypeScript collapse T to `never` when inferring from PostgREST's own response
 * union, which silently untypes every query that goes through it.
 */
export async function unwrap<T>(promise: PromiseLike<{ data: T; error: unknown }>): Promise<T> {
  const result = await promise;
  if (result.error) throw mapSupabaseError(result.error);
  return result.data;
}

/**
 * Same, for queries returning a set. PostgREST types `data` as `T[] | null`, but the
 * null only ever accompanies an error, which has already been thrown by here — so an
 * empty result is an empty array, not an absence the caller has to re-check.
 */
export async function unwrapList<T>(
  promise: PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const result = await promise;
  if (result.error) throw mapSupabaseError(result.error);
  return result.data ?? [];
}

/** For an RPC whose contract says it always returns a value. */
export async function unwrapRequired<T>(
  promise: PromiseLike<{ data: T | null; error: unknown }>,
  what: string,
): Promise<T> {
  const value = await unwrap(promise);
  if (value === null || value === undefined) {
    throw new AppError(ERROR_CODES.UNKNOWN, { reason: 'empty_rpc_result', what });
  }
  return value;
}
