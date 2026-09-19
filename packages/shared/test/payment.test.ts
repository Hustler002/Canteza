import { describe, expect, it } from 'vitest';
import { canTransitionPayment, initialPaymentStatus } from '../src/payment';

describe('payment state machine', () => {
  it('starts cash orders as pending and online orders as initiated', () => {
    expect(initialPaymentStatus('cod')).toBe('pending');
    expect(initialPaymentStatus('razorpay')).toBe('initiated');
  });

  it('allows a refund only after a successful payment', () => {
    expect(canTransitionPayment('success', 'refunded')).toBe(true);
    expect(canTransitionPayment('pending', 'refunded')).toBe(false);
    expect(canTransitionPayment('failed', 'refunded')).toBe(false);
  });

  it('never un-refunds or re-succeeds a settled payment', () => {
    expect(canTransitionPayment('refunded', 'success')).toBe(false);
    expect(canTransitionPayment('success', 'failed')).toBe(false);
  });

  it('allows retrying a failed payment', () => {
    expect(canTransitionPayment('failed', 'initiated')).toBe(true);
  });
});
