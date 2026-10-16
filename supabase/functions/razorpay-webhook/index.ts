// razorpay-webhook — PUBLIC, called by Razorpay. Not a JSON-in/JSON-out
// client function: it must see the RAW body to check the signature.
//
//   X-Razorpay-Signature = hex(HMAC-SHA256(RAZORPAY_WEBHOOK_SECRET, raw body))
//   X-Razorpay-Event-Id  = unique per event; deliveries may repeat
//
// Bad or missing signature → 401. A processed event id → 200 { duplicate: true }
// without touching anything. Handled: payment.captured (Project Pass orders),
// subscription.authenticated/activated/charged/pending/halted/cancelled/
// completed/paused/resumed/updated. Any failure → 500 so Razorpay retries.
import { Fail, errorResponse, json } from '../_shared/http.ts';
import {
  alreadyProcessed, markProcessed, processEvent, sha256Hex, verifySignature, type RazorpayEvent,
} from '../_shared/billing.ts';

const MAX_BODY = 1_000_000;

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') throw new Fail('INVALID', 'Use POST.');
    const secret = (Deno.env.get('RAZORPAY_WEBHOOK_SECRET') ?? '').trim();
    if (!secret) {
      console.error('razorpay-webhook: RAZORPAY_WEBHOOK_SECRET is not set');
      throw new Fail('INTERNAL', 'Webhook is not configured.');
    }
    const raw = await req.text();
    if (raw.length > MAX_BODY) throw new Fail('INVALID', 'Payload too large.');
    if (!(await verifySignature(raw, req.headers.get('x-razorpay-signature'), secret))) {
      throw new Fail('UNAUTHENTICATED', 'Invalid signature.');
    }
    let evt: RazorpayEvent;
    try {
      evt = JSON.parse(raw);
    } catch {
      throw new Fail('INVALID', 'Body is not JSON.');
    }
    if (!evt || typeof evt.event !== 'string' || typeof evt.payload !== 'object') throw new Fail('INVALID', 'Not a Razorpay event.');
    // The header is the documented idempotency key; the body hash is a fallback.
    const eventId = (req.headers.get('x-razorpay-event-id') ?? '').trim() || `body_${await sha256Hex(raw)}`;

    if (await alreadyProcessed(eventId)) return json(req, 200, { ok: true, duplicate: true });
    const result = await processEvent(evt, eventId);
    const fresh = await markProcessed(eventId, evt.event);
    return json(req, 200, { ok: true, duplicate: !fresh, handled: result.handled, note: result.note });
  } catch (err) {
    return errorResponse(req, err);
  }
});
