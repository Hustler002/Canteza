import { describe, expect, it } from 'vitest';
import { awaitingPayment, canTransitionPayment, initialPaymentStatus } from '../src/payment';

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

describe('awaitingPayment', () => {
  const unpaid = { method: 'razorpay', status: 'initiated' };

  it('is true only for a pending order whose online payment has not succeeded', () => {
    expect(awaitingPayment('pending', unpaid)).toBe(true);
    expect(awaitingPayment('pending', { method: 'razorpay', status: 'failed' })).toBe(true);
    expect(awaitingPayment('pending', { method: 'razorpay', status: 'success' })).toBe(false);
  });

  it('is never true for cash, which is settled at the door', () => {
    expect(awaitingPayment('pending', { method: 'cod', status: 'pending' })).toBe(false);
  });

  it('is never true once the order has moved on, paid or not', () => {
    for (const status of ['accepted', 'cancelled', 'rejected', 'delivered']) {
      expect(awaitingPayment(status, unpaid)).toBe(false);
    }
  });

  it('is false when the order carries no payment at all', () => {
    expect(awaitingPayment('pending', null)).toBe(false);
  });
});
