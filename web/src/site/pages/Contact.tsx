import { BUSINESS, mailto } from '../../legal/business';
import { GrievanceBlock, IdentityTable, LegalDoc, Section } from '../Doc';

export default function Contact() {
  return (
    <LegalDoc
      title="Contact us"
      lead={
        <p>
          3xDezine is an independent product built in India. Email is the fastest way to reach us; we reply within{' '}
          {BUSINESS.supportReplyDays} working days, usually sooner.
        </p>
      }
    >
      <div className="site-contact-actions">
        <a className="btn btn-primary" href={mailto('3xDezine — support')}>
          Email support
        </a>
        <a className="btn" href={mailto('3xDezine — billing', 'Account email:\nRazorpay payment id (pay_…), if any:\nWhat happened:\n')}>
          Billing question
        </a>
        <a className="btn" href={mailto('3xDezine Business — enquiry')}>
          Sales (Business plan)
        </a>
      </div>

      <Section id="c-details" title="Business details">
        <IdentityTable />
      </Section>

      <Section id="c-billing" title="Payments and refunds">
        <p>
          For a charge you don’t recognise, a failed or double payment, or a refund, include your account email, the
          date and amount, and the Razorpay payment id from your receipt if you have it. Refunds follow the{' '}
          <a href="#/refunds">Cancellation and Refund Policy</a>.
        </p>
      </Section>

      <Section id="c-grievance" title="Grievances and privacy requests">
        <p>
          Complaints about the service, and requests about your personal data under the{' '}
          <a href="#/privacy">Privacy Policy</a>, go to our Grievance Officer:
        </p>
        <GrievanceBlock />
        <p className="site-muted">
          Homeowners: if a designer sent you a quotation through 3xDezine, the designer controls your details — ask them
          first. We will help if you write to us.
        </p>
      </Section>
    </LegalDoc>
  );
}
