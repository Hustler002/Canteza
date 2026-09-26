import { describe, expect, it } from 'vitest';
import { estimatedMinutes, PLATFORM_DEFAULTS } from '../src/config';

const { deliveryMinutes, defaultPrepMinutes, minPrepSampleSize } = PLATFORM_DEFAULTS;

describe('estimatedMinutes', () => {
  it('adds the walk to the kitchen median once there is enough history', () => {
    // 20 cooking + 10 walking = 30, already a multiple of five.
    expect(estimatedMinutes(20, 50)).toBe(30);
  });

  it('rounds up to the nearest five, because nobody quotes 23 minutes', () => {
    // 13 + 10 = 23 -> 25.
    expect(estimatedMinutes(13, 50)).toBe(25);
    // 16 + 10 = 26 -> 30.
    expect(estimatedMinutes(16, 50)).toBe(30);
  });

  it('ignores a median built from too few orders', () => {
    const fallback = Math.ceil((defaultPrepMinutes + deliveryMinutes) / 5) * 5;
    // A wildly fast median from one order must not be quoted.
    expect(estimatedMinutes(2, minPrepSampleSize - 1)).toBe(fallback);
    // The same median is trusted the moment the sample reaches the floor.
    expect(estimatedMinutes(2, minPrepSampleSize)).not.toBe(fallback);
  });

  it('falls back when a canteen has never been timed', () => {
    const fallback = Math.ceil((defaultPrepMinutes + deliveryMinutes) / 5) * 5;
    expect(estimatedMinutes(null, 0)).toBe(fallback);
    expect(estimatedMinutes(undefined, undefined)).toBe(fallback);
  });

  it('treats a nonsensical zero or negative median as no data', () => {
    const fallback = Math.ceil((defaultPrepMinutes + deliveryMinutes) / 5) * 5;
    expect(estimatedMinutes(0, 100)).toBe(fallback);
    expect(estimatedMinutes(-5, 100)).toBe(fallback);
  });

  it('never quotes less than the walk itself', () => {
    expect(estimatedMinutes(1, 100)).toBeGreaterThanOrEqual(deliveryMinutes);
  });
});
