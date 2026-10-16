import type { CreateCheckoutResponse } from '@shared/business';
import { authedCall } from '../api';

/**
 * Razorpay Checkout, loaded only when someone clicks pay — never on page load,
 * never on the approval page, and never without cloud.
 */

const SCRIPT = 'https://checkout.razorpay.com/v1/checkout.js';

interface RazorpayCtor {
  new (options: Record<string, unknown>): { open: () => void; on: (event: string, cb: (r: unknown) => void) => void };
}

let scriptPromise: Promise<RazorpayCtor> | null = null;

function loadScript(): Promise<RazorpayCtor> {
  const w = window as Window & { Razorpay?: RazorpayCtor };
  if (w.Razorpay) return Promise.resolve(w.Razorpay);
  scriptPromise ??= new Promise<RazorpayCtor>((resolve, reject) => {
    const el = document.createElement('script');
    el.src = SCRIPT;
    el.async = true;
    el.onload = () => (w.Razorpay ? resolve(w.Razorpay) : reject(new Error('Razorpay didn’t load.')));
    el.onerror = () => {
      scriptPromise = null;
      el.remove();
      reject(new Error('Couldn’t load Razorpay Checkout. Check your connection and try again.'));
    };
    document.head.appendChild(el);
  });
  return scriptPromise;
}

/** Opens Checkout. Resolves true once Razorpay reports success, false if dismissed. */
export async function openRazorpay(checkout: CreateCheckoutResponse, label: string): Promise<boolean> {
  const Razorpay = await loadScript();
  return new Promise<boolean>((resolve, reject) => {
    const rzp = new Razorpay({
      key: checkout.keyId,
      amount: checkout.amount,
      currency: 'INR',
      name: '3xDezine',
      description: label,
      ...(checkout.orderId ? { order_id: checkout.orderId } : {}),
      ...(checkout.subscriptionId ? { subscription_id: checkout.subscriptionId } : {}),
      theme: { color: '#1c8593' },
      handler: () => resolve(true),
      modal: { ondismiss: () => resolve(false) },
    });
    rzp.on('payment.failed', (r) => {
      const msg = (r as { error?: { description?: string } })?.error?.description;
      reject(new Error(msg ? `Payment failed: ${msg}` : 'Payment failed.'));
    });
    rzp.open();
  });
}

/**
 * Local dev without Razorpay keys: the backend simulates the purchase. The
 * confirmation goes back to create-checkout with `simulateSuccess` and the
 * simulated order/subscription, which runs the same processing code a
 * verified webhook would.
 */
export async function confirmSimulated(checkout: CreateCheckoutResponse): Promise<void> {
  await authedCall('create-checkout', {
    simulateSuccess: true,
    ...(checkout.orderId ? { orderId: checkout.orderId } : {}),
    ...(checkout.subscriptionId ? { subscriptionId: checkout.subscriptionId } : {}),
  });
}
