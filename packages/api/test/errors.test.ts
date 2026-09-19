import { describe, expect, it } from 'vitest';
import { AppError } from '@campuseats/shared';
import { mapSupabaseError, unwrap } from '../src/errors';

describe('mapSupabaseError', () => {
  it('keeps the code our own SQL functions raise', () => {
    expect(mapSupabaseError({ message: 'DELIVERY_ALREADY_CLAIMED: order 123' }).code).toBe(
      'DELIVERY_ALREADY_CLAIMED',
    );
    expect(mapSupabaseError({ message: 'PAYMENT_UNVERIFIED: order 123' }).code).toBe(
      'PAYMENT_UNVERIFIED',
    );
  });

  it('turns an RLS refusal into FORBIDDEN rather than a Postgres sentence', () => {
    const err = mapSupabaseError({ code: '42501', message: 'permission denied for table orders' });
    expect(err.code).toBe('FORBIDDEN');
    expect(err.userMessage).not.toMatch(/table|postgres|permission denied/i);
  });

  it('maps a lost connection to NETWORK, not to the user being wrong', () => {
    expect(
      mapSupabaseError({ name: 'AuthRetryableFetchError', message: 'fetch failed' }).code,
    ).toBe('NETWORK');
    expect(mapSupabaseError({ message: 'Network request failed' }).code).toBe('NETWORK');
  });

  it('reads GoTrue prose', () => {
    expect(mapSupabaseError({ message: 'Invalid login credentials' }).code).toBe(
      'INVALID_CREDENTIALS',
    );
    expect(mapSupabaseError({ message: 'User already registered' }).code).toBe('EMAIL_IN_USE');
    expect(mapSupabaseError({ message: 'Email not confirmed' }).code).toBe('EMAIL_NOT_CONFIRMED');
  });

  it('does not reveal whether an email exists when the password is wrong', () => {
    const err = mapSupabaseError({ message: 'Invalid login credentials' });
    expect(err.userMessage).toBe('That email and password do not match.');
  });

  it('treats a .single() miss as NOT_FOUND', () => {
    expect(mapSupabaseError({ code: 'PGRST116', message: 'no rows' }).code).toBe('NOT_FOUND');
  });

  it('falls back to UNKNOWN without leaking the internal message', () => {
    const err = mapSupabaseError({ message: 'pq: relation "secret_table" does not exist' });
    expect(err.code).toBe('UNKNOWN');
    expect(err.userMessage).toBe('Something went wrong. Please try again.');
    expect(err.details?.raw).toContain('secret_table'); // kept for logs only
  });

  it('passes an AppError through untouched', () => {
    const original = new AppError('CART_EMPTY');
    expect(mapSupabaseError(original)).toBe(original);
  });
});

describe('unwrap', () => {
  it('returns data when there is no error', async () => {
    await expect(unwrap(Promise.resolve({ data: { id: '1' }, error: null }))).resolves.toEqual({
      id: '1',
    });
  });

  it('throws a typed AppError when there is one', async () => {
    await expect(
      unwrap(Promise.resolve({ data: null, error: { code: '42501', message: 'denied' } })),
    ).rejects.toThrow(AppError);
  });
});
