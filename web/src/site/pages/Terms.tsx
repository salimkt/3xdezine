import { BUSINESS, GST_RATE_PCT, GST_REGISTERED } from '../../legal/business';
import { Email, GrievanceBlock, IdentityTable, LegalDoc, Section, V } from '../Doc';

export default function Terms() {
  const city = BUSINESS.jurisdictionCity;
  return (
    <LegalDoc
      title="Terms and Conditions"
      lead={
        <p>
          These terms are the agreement between you and {BUSINESS.legalEntity} (“3xDezine”, “we”, “us”) for using the
          3xDezine web app, Android app and related services. They are written to be read. Where something matters
          most — billing, the limits of our estimates and plan checks, and who owns your work — it is said plainly.
        </p>
      }
    >
      <Section id="t-agreement" title="1. The agreement">
        <p>
          By creating an account, buying a plan, or using 3xDezine, you agree to these terms, the{' '}
          <a href="#/privacy">Privacy Policy</a> and the <a href="#/refunds">Cancellation and Refund Policy</a>. If you
          use 3xDezine for a studio or company, you accept them on its behalf and confirm you may do so.
        </p>
        <p>
          You must be at least 18 and able to enter a binding contract under the Indian Contract Act, 1872. 3xDezine is
          a tool for professionals and businesses; it is not meant for children.
        </p>
      </Section>

      <Section id="t-service" title="2. What 3xDezine is">
        <p>
          3xDezine is software for interior designers and design-and-build studios. It lets you draw floor plans, see
          them in 3D, estimate material and labour costs, check plans against selected National Building Code
          provisions, prepare quotations and other documents, and share them with your clients through approval links.
        </p>
        <p>
          The studio works in your browser without an account; that work stays in your browser. Cloud features —
          saving projects online, sharing, team seats, approval links and paid plans — need an account.
        </p>
        <p>
          We improve the service continuously and may add, change or remove features. If we materially reduce a paid
          feature during a period you have already paid for, you may cancel and we will refund the unused part of that
          period.
        </p>
      </Section>

      <Section id="t-accounts" title="3. Your account">
        <ul>
          <li>Give accurate details and keep them up to date — particularly your email, studio name, address and GSTIN, which print on your documents.</li>
          <li>Keep access to your email (sign-in links are sent there) and any Google account you sign in with secure. You are responsible for what happens under your account.</li>
          <li>A seat is for one named person. Don’t share a login between people; add a seat instead.</li>
          <li>Tell us straight away at <Email subject="Account security" /> if you think someone else has accessed your account.</li>
        </ul>
      </Section>

      <Section id="t-billing" title="4. Plans, prices and billing">
        <p>
          Plans and prices are shown on the <a href="#/pricing">pricing page</a> in Indian rupees.{' '}
          {GST_REGISTERED
            ? `Prices exclude GST; GST at ${GST_RATE_PCT}% is added at checkout and shown on your invoice.`
            : `Prices exclude GST. 3xDezine is not yet GST-registered and does not charge GST; once registered, GST at ${GST_RATE_PCT}% will be added, with notice as described below.`}
        </p>
        <ul>
          <li>
            <b>Free</b> costs nothing and has the limits shown on the pricing page. Documents and links made on Free carry a
            “Made with 3xDezine” mark; please don’t remove or hide it.
          </li>
          <li>
            <b>Project Pass</b> is a one-off payment that gives one project the paid features for 90 days. It does not
            renew.
          </li>
          <li>
            <b>Solo and Studio</b> are subscriptions billed monthly or yearly in advance. <b>They renew automatically</b>{' '}
            at the end of each period, at the then-current price, until you cancel.
          </li>
          <li>
            <b>Business</b> is agreed in writing with us; that agreement prevails over these terms where they differ.
          </li>
        </ul>
        <h3>Payments and e-mandates</h3>
        <p>
          Payments are processed by Razorpay. When you subscribe, you authorise a recurring payment mandate (UPI AutoPay,
          card or bank e-mandate) for the plan amount and interval you chose, under the Reserve Bank of India’s rules on
          e-mandates for recurring transactions. Under those rules:
        </p>
        <ul>
          <li>you receive a pre-debit notification at least 24 hours before each charge, with the amount and date, and can opt out of that charge or the mandate;</li>
          <li>charges above ₹15,000 need your additional authentication (for example your UPI PIN or a card OTP) each time — this applies to the Studio yearly plan;</li>
          <li>you can cancel the mandate at any time from your UPI app, card issuer or bank, without any fee from us.</li>
        </ul>
        <p>
          If a renewal payment fails, we and Razorpay may retry it over a few days and will tell you. If it still fails,
          your account moves to Free; your projects are kept, and paid-only features lock until you pay again.
        </p>
        <h3>Price changes</h3>
        <p>
          We will give you at least <b>30 days’ notice</b> by email before a price change — including adding GST once we
          register — affects you. The new price applies from your next renewal after the notice period. If you don’t
          want to continue, cancel before then. Where the change needs a new or amended mandate, you will be asked to
          approve it; we will not debit a higher amount without that approval.
        </p>
        <h3>Invoices and receipts</h3>
        <p>
          {GST_REGISTERED
            ? 'You receive a GST tax invoice for every payment. Enter your GSTIN before paying to claim input tax credit.'
            : 'You receive a payment receipt for every payment. Once we are GST-registered you will receive GST tax invoices.'}
        </p>
      </Section>

      <Section id="t-cancel" title="5. Cancellation and refunds">
        <p>
          You can cancel a subscription at any time. Access continues until the end of the period you have paid for and
          then the subscription does not renew. We do not refund partial periods. A Project Pass can be refunded within
          7 days if no quotation has been issued for its project, and failed or duplicate charges are always refunded.
          The <a href="#/refunds">Cancellation and Refund Policy</a> has the details and forms part of these terms.
        </p>
      </Section>

      <Section id="t-use" title="6. Acceptable use">
        <p>Don’t use 3xDezine to:</p>
        <ul>
          <li>break any law, including tax, consumer-protection and data-protection law;</li>
          <li>issue false, misleading or fraudulent quotations or invoices, or impersonate another business;</li>
          <li>upload content you have no right to use, or that is unlawful, defamatory or infringes someone else’s rights;</li>
          <li>enter other people’s personal data without a lawful basis to do so (see section 8);</li>
          <li>probe, attack or overload the service, introduce malware, or get around plan limits, security or the watermark;</li>
          <li>copy, resell or sublicense the service, or scrape it, except as the law expressly allows.</li>
        </ul>
        <p>We may remove content or suspend access that breaks these rules (see section 13).</p>
      </Section>

      <Section id="t-content" title="7. Your work belongs to you">
        <p>
          <b>You own what you create</b>: your floor plans, designs, quotations, rate cards, branding and the documents
          you issue. You give us a limited licence to store, process, display and transmit that content only to run the
          service for you — for example to render your plan, compute your quote, and show it to the client you send a
          link to. The licence ends when the content is deleted, subject to the legal retention in section 9.
        </p>
        <p>
          We don’t sell your content, show it to anyone you haven’t shared it with, or use it for advertising. Templates,
          default rate cards, the plan-check rules and the software itself remain ours; you may use them in your work
          while you use 3xDezine.
        </p>
        <p>If you send us feedback or suggestions, we may use them without obligation to you.</p>
      </Section>

      <Section id="t-processing" title="8. Your clients’ personal data">
        <p>
          When you enter a client’s details (name, phone, email, site address, GSTIN, plans of their home) or your client
          responds on an approval link, <b>you are the data fiduciary</b> for that data under the Digital Personal Data
          Protection Act, 2023, and <b>3xDezine is your data processor</b>. You decide why and how it is used. You
          confirm that you have given your clients any notice the law requires and have a lawful basis to share their
          data with us for this purpose.
        </p>
        <p>For that data, we will:</p>
        <ul>
          <li>process it only to provide the service to you and on your instructions — never for our own marketing;</li>
          <li>keep it confidential and limit access to people who need it to run the service;</li>
          <li>protect it with reasonable security safeguards (see the Privacy Policy);</li>
          <li>use only the sub-processors listed in the Privacy Policy, and tell you before adding a new one;</li>
          <li>help you respond to your clients’ requests to access, correct or erase their data;</li>
          <li>tell you without undue delay if we become aware of a personal data breach affecting it;</li>
          <li>delete it when you delete it or close your account, except what the law requires to be kept (section 9).</li>
        </ul>
      </Section>

      <Section id="t-retention" title="9. Tax records are kept">
        <p>
          Tax invoices, bills of supply and other invoices you issue through 3xDezine are your accounting records. The
          CGST Act, 2017 (section 36, read with Rule 56) requires them to be kept for 72 months from the due date of the
          annual return for the year they relate to. 3xDezine therefore keeps issued tax documents for that period and
          blocks deleting a project that contains them, even if you close your account. Drafts and quotations can be
          deleted at any time.
        </p>
      </Section>

      <Section id="t-advisory" title="10. Estimates, plan checks and tax maths are advisory">
        <p>
          3xDezine helps you work faster and more carefully. <b>It is not professional, engineering or legal advice</b>,
          and its outputs are not a substitute for your own judgement:
        </p>
        <ul>
          <li>
            <b>Cost estimates and default rates are planning estimates.</b> They come from published sources of varying
            confidence, are shown with a buffer, and can differ widely from what materials and labour actually cost in
            your city. Every rate is editable. You are responsible for the prices on the quotations you issue.
          </li>
          <li>
            <b>Plan checks are automated checks against selected provisions of the National Building Code of India.</b>{' '}
            They do not cover your local building bye-laws, development control regulations, society rules, structural,
            fire or accessibility requirements, and they don’t replace review and approval by a licensed architect,
            engineer or the local authority.
          </li>
          <li>
            <b>The GST calculations encode rules, not advice.</b> 3xDezine applies the place-of-supply, rate and invoice
            rules it encodes to the details you enter. Whether a rule applies to your business, which HSN/SAC code or
            registration type is right, and your returns are for you and your chartered accountant.
          </li>
          <li>
            <b>Approval records are evidence, not a contract.</b> An approval link records who responded, when, and the
            exact version of the document they saw. Use a signed agreement where the law or the size of the job calls
            for one.
          </li>
        </ul>
      </Section>

      <Section id="t-availability" title="11. Availability">
        <p>
          We work to keep 3xDezine available and your data safe, but we don’t promise uninterrupted service. We may pause
          it briefly for maintenance. The 3D view needs a browser with WebGPU or WebGL 2; on older devices, plans and
          quotations still work without 3D. Keep your own copies (print or PDF) of documents you rely on.
        </p>
      </Section>

      <Section id="t-liability" title="12. Liability">
        <p>
          The service is provided on an “as is” and “as available” basis to the extent the law allows. Nothing in these
          terms limits rights you have under the Consumer Protection Act, 2019 or any other law that cannot be excluded
          by contract.
        </p>
        <p>To the extent the law allows:</p>
        <ul>
          <li>
            we are not liable for indirect or consequential loss, lost profits or business, project cost overruns, or
            decisions made on the basis of estimates, plan checks or tax calculations;
          </li>
          <li>
            our total liability arising from these terms or the service is limited to the amount you paid us in the 12
            months before the event that gave rise to the claim, or ₹1,000 if you paid nothing.
          </li>
        </ul>
        <p>These limits don’t apply to fraud, or to liability that cannot lawfully be limited.</p>
        <p>
          You are responsible for the documents you issue to your clients and for your compliance with the law, and you
          will compensate us for losses we suffer because of a claim arising from your content or your breach of these
          terms or the law.
        </p>
      </Section>

      <Section id="t-termination" title="13. Suspension and termination">
        <p>
          You can stop using 3xDezine at any time and ask us to close your account by writing to <Email subject="Close my account" />.
        </p>
        <p>
          We may suspend or close an account that seriously or repeatedly breaks these terms, that we are required to
          act on by law, or whose payment has failed as described in section 4. Except where the law or a security risk
          prevents it, we will tell you first and give you a reasonable chance to fix the problem and to export your
          work. After an account is closed we keep its data for 30 days in case it was a mistake, then delete it, except
          what section 9 and the law require us to keep.
        </p>
      </Section>

      <Section id="t-law" title="14. Governing law and disputes">
        <p>
          These terms are governed by the laws of India. If something goes wrong, please contact us or the Grievance
          Officer first — most problems are fixed fastest that way. If a dispute is not resolved within 30 days, the
          courts at{' '}
          {city ? <b>{city}</b> : <V value={null} />}, India have exclusive jurisdiction, without affecting your right to
          approach a Consumer Disputes Redressal Commission under the Consumer Protection Act, 2019.
        </p>
      </Section>

      <Section id="t-changes" title="15. Changes to these terms">
        <p>
          We may update these terms as the product and the law change. For material changes we will give at least 30
          days’ notice by email or in the app before they take effect. The “last updated” date at the top always shows
          the current version. If you keep using 3xDezine after a change takes effect, the new terms apply; if you don’t
          agree, you can cancel before then.
        </p>
      </Section>

      <Section id="t-general" title="16. General">
        <p>
          These terms, with the policies they refer to, are the whole agreement between us about the service. If a part
          is found unenforceable, the rest still applies. Not enforcing a right straight away doesn’t waive it. We may
          transfer these terms to a successor business on notice to you. Neither of us is responsible for delays caused
          by events beyond reasonable control. We send notices to your account email; send yours to <Email />.
        </p>
      </Section>

      <Section id="t-contact" title="17. Who we are and grievances">
        <IdentityTable />
        <p>
          In line with the Information Technology Act, 2000 and the rules under it, and the Consumer Protection
          (E-Commerce) Rules, 2020, complaints can be sent to our Grievance Officer:
        </p>
        <GrievanceBlock />
      </Section>
    </LegalDoc>
  );
}
