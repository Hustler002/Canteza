import { describe, expect, it } from 'vitest';
import { AppError } from '@canteza/shared';
import { shouldReport } from '../src/lib/report';

/**
 * What reaches Sentry from a handled error. The line is "could any code name this?" --
 * everything the app has a message for stays on the phone, everything it does not is a
 * bug and is reported.
 */
describe('shouldReport', () => {
  it('keeps every failure the app already explains to the user', () => {
    for (const code of [
      'CANTEEN_CLOSED',
      'COUPON_INVALID',
      'DELIVERY_ALREADY_CLAIMED',
      'PAYMENT_UNAVAILABLE',
      'NETWORK',
      'FORBIDDEN',
    ] as const) {
      expect(shouldReport(new AppError(code)), code).toBe(false);
    }
  });

  it('keeps a coded SQL error, which toAppError reads off the message', () => {
    expect(shouldReport({ message: 'INVALID_TRANSITION: order 1 already moved on' })).toBe(false);
  });

  it('reports what nothing can name', () => {
    expect(
      shouldReport(new TypeError("Cannot read properties of undefined (reading 'code')")),
    ).toBe(true);
    expect(shouldReport({ message: 'relation "orderz" does not exist' })).toBe(true);
    expect(shouldReport('a bare string')).toBe(true);
    expect(shouldReport(new AppError('UNKNOWN'))).toBe(true);
  });
});
