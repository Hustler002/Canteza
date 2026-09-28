import { toAppError } from '@canteza/shared';

/**
 * Which handled errors are worth a Sentry event. Kept apart from `sentry.ts`, which loads
 * the native SDK at import, so the rule can be tested in Node.
 *
 * **Only the ones nobody planned for.** Almost every failure in this app is a sentence the
 * app already knows how to say: the canteen closed, the coupon ran out, someone else
 * claimed the delivery, the network dropped. Each has a code in `ERROR_CODES` and a
 * message on screen, and reporting them would bury the one event that matters under a
 * thousand "canteen closed at 22:00". What reaches Sentry is what `toAppError` could not
 * name -- UNKNOWN -- because that is a bug by definition: SQL raising something the app
 * has no code for, a TypeError in a query, a response shaped nothing like expected.
 *
 * Crashes are separate and always reported: the SDK catches those itself.
 */
export function shouldReport(error: unknown): boolean {
  return toAppError(error).code === 'UNKNOWN';
}
