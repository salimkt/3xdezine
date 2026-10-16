import { BUSINESS } from '../../legal/business';
import { Email, LegalDoc, Section } from '../Doc';

export default function Delivery() {
  return (
    <LegalDoc
      title="Delivery Policy"
      lead={
        <p>
          3xDezine is software delivered online. <b>There is no physical product and nothing is shipped.</b>
        </p>
      }
    >
      <Section id="d-how" title="1. How you receive the service">
        <p>
          The web app runs in your browser at <a href={BUSINESS.website}>{BUSINESS.website.replace(/^https:\/\//, '')}</a>.
          The Android app is a direct download. Both are available as soon as you open them — the Free plan needs no
          account or payment.
        </p>
      </Section>
      <Section id="d-when" title="2. When paid features start">
        <p>
          <b>Access is instant.</b> A subscription or Project Pass is switched on as soon as Razorpay confirms your
          payment, normally within a minute. You will see your new plan in the app, and a receipt by email.
        </p>
        <p>
          If a paid plan hasn’t appeared 30 minutes after a successful payment, email <Email subject="Payment not activated" />{' '}
          with your account email and Razorpay payment id and we will activate it or refund you.
        </p>
      </Section>
      <Section id="d-where" title="3. Where we sell">
        <p>
          Plans are sold in Indian rupees to customers in India. The app itself can be used from anywhere with an
          internet connection.
        </p>
      </Section>
      <Section id="d-returns" title="4. Cancellations and refunds">
        <p>
          As nothing is shipped, there is nothing to return. Cancellations and refunds follow the{' '}
          <a href="#/refunds">Cancellation and Refund Policy</a>.
        </p>
      </Section>
    </LegalDoc>
  );
}
