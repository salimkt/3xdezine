/**
 * Unit tests for the Razorpay helpers (no stack needed):
 *   deno test --allow-env --no-lock supabase/tests/billing.test.ts   (or `npm run sb:unit`)
 *
 * The signature vector is computed independently with Node's crypto in the
 * e2e test; here we pin the gate that keeps simulation out of production.
 */
import { billingMode, constantTimeEqual, hmacSha256Hex, verifySignature } from '../functions/_shared/billing.ts';

function eq(a: unknown, b: unknown, msg: string) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
}

const KEYS = ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'BILLING_SIMULATION', 'SUPABASE_URL'];
function withEnv(env: Record<string, string>, fn: () => void) {
  const saved = Object.fromEntries(KEYS.map((k) => [k, Deno.env.get(k)]));
  for (const k of KEYS) Deno.env.delete(k);
  for (const [k, v] of Object.entries(env)) Deno.env.set(k, v);
  try {
    fn();
  } finally {
    for (const k of KEYS) saved[k] === undefined ? Deno.env.delete(k) : Deno.env.set(k, saved[k]!);
  }
}

Deno.test('billingMode: keys → RAZORPAY, even with the simulation flag', () => {
  withEnv({ RAZORPAY_KEY_ID: 'rzp_test_x', RAZORPAY_KEY_SECRET: 's', BILLING_SIMULATION: '1', SUPABASE_URL: 'http://kong:8000' }, () => {
    eq(billingMode().kind, 'RAZORPAY', 'keys win');
  });
});

Deno.test('billingMode: simulation needs the flag, no keys AND a local stack', () => {
  withEnv({ BILLING_SIMULATION: '1', SUPABASE_URL: 'http://kong:8000' }, () => eq(billingMode().kind, 'SIMULATED', 'local + flag'));
  withEnv({ BILLING_SIMULATION: '1', SUPABASE_URL: 'http://127.0.0.1:54321' }, () => eq(billingMode().kind, 'SIMULATED', 'localhost + flag'));
  withEnv({ BILLING_SIMULATION: '1', SUPABASE_URL: 'https://abcd.supabase.co' }, () => eq(billingMode().kind, 'OFF', 'hosted + flag'));
  withEnv({ BILLING_SIMULATION: '1', RAZORPAY_KEY_ID: 'rzp_test_x', SUPABASE_URL: 'http://kong:8000' }, () => eq(billingMode().kind, 'OFF', 'half-configured keys'));
  withEnv({ SUPABASE_URL: 'http://kong:8000' }, () => eq(billingMode().kind, 'OFF', 'no flag'));
  withEnv({ BILLING_SIMULATION: 'true', SUPABASE_URL: 'http://kong:8000' }, () => eq(billingMode().kind, 'OFF', 'flag must be exactly 1'));
});

Deno.test('webhook signature: HMAC-SHA256 hex of the raw body, constant-time compare', async () => {
  // RFC 4231 test case 2.
  eq(await hmacSha256Hex('Jefe', 'what do ya want for nothing?'), '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843', 'RFC 4231 #2');
  const body = '{"event":"payment.captured","payload":{}}';
  const sig = await hmacSha256Hex('whsec', body);
  eq(await verifySignature(body, sig, 'whsec'), true, 'valid');
  eq(await verifySignature(body, sig.toUpperCase(), 'whsec'), true, 'hex case-insensitive');
  eq(await verifySignature(body + ' ', sig, 'whsec'), false, 'body changed');
  eq(await verifySignature(body, sig, 'other'), false, 'wrong secret');
  eq(await verifySignature(body, null, 'whsec'), false, 'missing');
  eq(constantTimeEqual('abc', 'abcd'), false, 'length differs');
});
