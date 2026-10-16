import { BUSINESS, GST_REGISTERED } from '../../legal/business';
import { Email, LegalDoc, Section } from '../Doc';

export default function Refunds() {
  return (
    <LegalDoc
      title="Cancellation and Refund Policy"
      lead={
        <ul className="site-short">
          <li>Cancel a subscription any time. You keep paid features until the end of the period you paid for.</li>
          <li>No refunds for partial months or years.</li>
          <li>A Project Pass is refundable within 7 days if no quotation has been issued for that project.</li>
          <li>Failed, duplicate or excess charges are refunded to the original payment method within 5–7 working days.</li>
        </ul>
      }
    >
      <Section id="r-cancel" title="1. Cancelling a subscription">
        <p>You can cancel Solo or Studio at any time, without a fee, in any of these ways:</p>
        <ul>
          <li>in the app, from your account (Account → Plans);</li>
          <li>
            by emailing <Email subject="Cancel my subscription" /> from your account email;
          </li>
          <li>by cancelling the UPI AutoPay or card mandate in your UPI app, card issuer’s app or bank.</li>
        </ul>
        <p>
          Cancelling stops future renewals. <b>Your paid features continue until the end of the current billing period</b>,
          then the account moves to Free. Your projects, quotations and issued documents are kept; features that need a
          paid plan (branded quotes, more than the Free number of projects, rate cards, the modular configurator,
          variation orders) lock until you subscribe again.
        </p>
      </Section>

      <Section id="r-partial" title="2. No refunds for partial periods">
        <p>
          Subscriptions are paid in advance for a month or a year. We don’t refund the unused part of a period when you
          cancel, downgrade or stop using the service, for monthly or yearly plans. Before each renewal you receive a
          pre-debit notice at least 24 hours ahead, so you can cancel before you are charged.
        </p>
        <p>
          The exceptions: if we materially reduce a paid feature during a period you have paid for, or close the
          service, we refund the unused part of that period; and nothing here limits a refund the law entitles you to.
        </p>
      </Section>

      <Section id="r-pass" title="3. Project Pass">
        <p>
          A Project Pass is a one-off payment for one project. You can get a <b>full refund within 7 days of purchase</b>{' '}
          as long as <b>no quotation or other document has been issued</b> for that project (issuing gives it a number and
          a client link). After 7 days, or once a document has been issued, the pass is non-refundable. When a pass is
          refunded, that project returns to Free.
        </p>
      </Section>

      <Section id="r-failed" title="4. Failed, duplicate or excess charges">
        <p>
          If money left your account but the payment failed, you were charged twice for the same thing, or you were
          charged more than the price shown, we refund the difference <b>to the original payment method within 5–7
          working days</b> of confirming it with Razorpay. Many failed payments are reversed automatically by your bank;
          your bank may take a few further days to show the credit.
        </p>
      </Section>

      <Section id="r-how" title="5. How to ask for a refund">
        <p>
          Email <Email subject="Refund request" /> from your account email, with:
        </p>
        <ul>
          <li>the email address of your 3xDezine account;</li>
          <li>the date and amount of the charge;</li>
          <li>the Razorpay payment id (it starts with <code>pay_</code> and is on your receipt), if you have it;</li>
          <li>for a Project Pass, the project name; and a line about what went wrong.</li>
        </ul>
        <p>
          We reply within {BUSINESS.supportReplyDays} working days. Approved refunds are made to the original payment
          method — we can’t refund to a different account or in cash.{' '}
          {GST_REGISTERED && 'Where GST was charged, we issue a credit note.'}
        </p>
        <p>
          If you are unhappy with our answer, you can write to our Grievance Officer (see <a href="#/contact">Contact</a>).
          Please contact us before raising a chargeback with your bank — it is usually quicker.
        </p>
      </Section>

      <Section id="r-delivery" title="6. Nothing to return">
        <p>
          3xDezine is a digital service delivered online; there are no physical goods to ship or return. See the{' '}
          <a href="#/delivery">Delivery Policy</a>.
        </p>
      </Section>
    </LegalDoc>
  );
}
