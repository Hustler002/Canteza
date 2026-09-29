import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The web checkout, with the browser and Razorpay's script stood in for. What is worth
 * pinning is the contract with the order screen: the promise ends only on "finished" or
 * "closed", a declined card does not end it, and the sheet is opened against the order
 * and key the server handed back -- never an amount or key of the page's own.
 */

const session = {
  keyId: 'rzp_test_key',
  providerOrderId: 'order_ABC',
  amountPaise: 10000,
  currency: 'INR' as const,
  orderCode: '#170',
};
const options = {
  brandName: 'Canteza',
  description: 'Order #170',
  color: '#E8590C',
  prefill: { name: 'Riya', email: '', contact: null },
};

/** The options the sheet was opened with, as far as these tests read them. */
type SheetOptions = {
  key: string;
  order_id: string;
  amount: number;
  prefill: Record<string, string>;
  handler: (response: { razorpay_payment_id?: string }) => void;
  modal: { ondismiss: () => void };
};
type Captured = { options: SheetOptions; failed?: (r: unknown) => void; opened: boolean };
let sheets: Captured[];
let appended: Array<{ src: string; onload?: () => void; onerror?: () => void }>;

function installRazorpay() {
  vi.stubGlobal(
    'Razorpay',
    class {
      captured: Captured;
      constructor(o: SheetOptions) {
        this.captured = { options: o, opened: false };
        sheets.push(this.captured);
      }
      on(_event: string, handler: (r: unknown) => void) {
        this.captured.failed = handler;
      }
      open() {
        this.captured.opened = true;
      }
    },
  );
}

beforeEach(() => {
  vi.resetModules();
  sheets = [];
  appended = [];
  vi.stubGlobal('document', {
    createElement: () => ({ src: '', async: false, remove: vi.fn() }),
    head: {
      appendChild: (el: { src: string; onload?: () => void; onerror?: () => void }) => {
        appended.push(el);
      },
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const load = () => import('../src/lib/razorpay.web');

describe('the web checkout', () => {
  it('opens on the server’s order and key, with a trimmed prefill', async () => {
    installRazorpay();
    const { openRazorpaySheet } = await load();
    void openRazorpaySheet(session, options);
    await vi.waitFor(() => expect(sheets).toHaveLength(1));

    const o = sheets[0]!.options;
    expect(o.key).toBe('rzp_test_key');
    expect(o.order_id).toBe('order_ABC');
    expect(o.amount).toBe(10000);
    expect(o.prefill).toEqual({ name: 'Riya' });
    expect(sheets[0]!.opened).toBe(true);
  });

  it('reports "submitted" when the student finishes', async () => {
    installRazorpay();
    const { openRazorpaySheet } = await load();
    const result = openRazorpaySheet(session, options);
    await vi.waitFor(() => expect(sheets).toHaveLength(1));
    sheets[0]!.options.handler({ razorpay_payment_id: 'pay_1' });
    await expect(result).resolves.toEqual({ kind: 'submitted', paymentId: 'pay_1' });
  });

  it('reports "closed" when the student backs out', async () => {
    installRazorpay();
    const { openRazorpaySheet } = await load();
    const result = openRazorpaySheet(session, options);
    await vi.waitFor(() => expect(sheets).toHaveLength(1));
    sheets[0]!.options.modal.ondismiss();
    await expect(result).resolves.toEqual({ kind: 'closed' });
  });

  it('keeps waiting after a declined card, which Razorpay lets them retry', async () => {
    installRazorpay();
    const { openRazorpaySheet } = await load();
    let settled = false;
    void openRazorpaySheet(session, options).then(() => (settled = true));
    await vi.waitFor(() => expect(sheets).toHaveLength(1));
    sheets[0]!.failed?.({ error: { description: 'Card declined' } });
    await new Promise((r) => setTimeout(r, 10));
    expect(settled).toBe(false);
  });

  it('loads checkout.js on first use, once', async () => {
    const { loadCheckoutScript, CHECKOUT_SCRIPT } = await load();
    const first = loadCheckoutScript();
    const second = loadCheckoutScript();
    expect(appended).toHaveLength(1);
    expect(appended[0]!.src).toBe(CHECKOUT_SCRIPT);
    installRazorpay();
    appended[0]!.onload?.();
    await Promise.all([first, second]);
  });

  it('says online payment is unavailable if the script will not load, and tries again next time', async () => {
    const { loadCheckoutScript } = await load();
    const attempt = loadCheckoutScript();
    appended[0]!.onerror?.();
    await expect(attempt).rejects.toMatchObject({ code: 'PAYMENT_UNAVAILABLE' });

    void loadCheckoutScript();
    expect(appended).toHaveLength(2);
  });
});
