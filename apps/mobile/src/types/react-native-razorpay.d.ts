/**
 * `react-native-razorpay` 3.0.0 ships no type declarations of its own (its `main` is a
 * plain `.js` file). This declares the one method the app calls, from the package's own
 * `src/types.ts`, and nothing more -- see `src/lib/razorpay.ts`.
 */
declare module 'react-native-razorpay' {
  export type RazorpayOptions = {
    key: string;
    amount: number | string;
    currency?: string;
    name?: string;
    description?: string;
    order_id?: string;
    prefill?: { name?: string; email?: string; contact?: string };
    notes?: Record<string, string>;
    theme?: { color?: string };
    timeout?: number;
  };

  export type PaymentSuccessData = {
    razorpay_payment_id: string;
    razorpay_order_id?: string;
    razorpay_signature?: string;
  };

  const RazorpayCheckout: {
    open(options: RazorpayOptions): Promise<PaymentSuccessData>;
  };
  export default RazorpayCheckout;
}
