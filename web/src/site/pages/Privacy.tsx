import { BUSINESS } from '../../legal/business';
import { GOOGLE_ENABLED } from '../../cloud/state';
import { Email, GrievanceBlock, LegalDoc, Section, V } from '../Doc';

export default function Privacy() {
  return (
    <LegalDoc
      title="Privacy Policy"
      lead={
        <>
          <p>
            This policy explains what personal data {BUSINESS.legalEntity} (“3xDezine”, “we”) collects, why, who it is
            shared with, how long it is kept and how you can exercise your rights. It is written for the Digital
            Personal Data Protection Act, 2023 (“DPDP Act”) and the Digital Personal Data Protection Rules, 2025, whose
            main duties apply from May 2027; until then the Information Technology Act, 2000 and the SPDI Rules, 2011
            also apply. We aim to meet the DPDP standard now.
          </p>
          <ul className="site-short">
            <li>Without an account, your plans stay in your browser. We never see them.</li>
            <li>With an account, we store what you save so the service can work — and nothing for advertising.</li>
            <li>Card and UPI details go to Razorpay; they never reach our servers.</li>
            <li>For your clients’ details, you are in charge: you are the data fiduciary, we are your processor.</li>
            <li>No advertising trackers, no analytics cookies, and we don’t sell data.</li>
          </ul>
        </>
      }
    >
      <Section id="p-roles" title="1. Who is responsible">
        <p>
          <b>For your own account</b> — sign-up, profile, studio details, billing — 3xDezine is the <b>data fiduciary</b>{' '}
          (the party that decides why and how the data is processed).
        </p>
        <p>
          <b>For your clients’ data</b> — the homeowner details a designer enters into a project or quotation, and what a
          client types on an approval link — the <b>designer or studio is the data fiduciary</b> and 3xDezine acts as
          their <b>data processor</b>, processing it only to provide the service to them. If you are a homeowner and
          want to access, correct or erase your details, contact the designer who sent you the link; you may also write
          to us and we will pass your request on and help them respond. Our duties as a processor are set out in
          section 8 of the <a href="#/terms">Terms</a>.
        </p>
      </Section>

      <Section id="p-local" title="2. Using 3xDezine without an account">
        <p>
          The studio runs in your browser. Your working plan, preferences, studio profile, local quotations and rate
          edits are kept in your browser’s local storage on your device and are not sent to us. Loading the web app
          still means your browser contacts GitHub Pages (which serves the app) and Google Fonts (which serves the
          typefaces); like any web server, they see your IP address and browser details.
        </p>
      </Section>

      <Section id="p-collect" title="3. What we collect">
        <div className="site-table-wrap">
          <table className="site-table site-table-doc">
            <thead>
              <tr>
                <th scope="col">Data</th>
                <th scope="col">Examples</th>
                <th scope="col">Where it comes from</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Account</th>
                <td>Email address, display name, avatar colour, preferences; your Google account id and name if you sign in with Google</td>
                <td>You</td>
              </tr>
              <tr>
                <th scope="row">Studio profile</th>
                <td>Studio and trade name, logo, address, GSTIN, PAN, phone, bank or UPI details you choose to print, default terms</td>
                <td>You</td>
              </tr>
              <tr>
                <th scope="row">Projects</th>
                <td>Floor plans, finishes, versions, proposals and comments, members and their roles, share links</td>
                <td>You and the people you invite</td>
              </tr>
              <tr>
                <th scope="row">Quotations and documents</th>
                <td>Line items, rates, rate cards, totals, document numbers, issued documents</td>
                <td>You</td>
              </tr>
              <tr>
                <th scope="row">Client details (processor role)</th>
                <td>
                  Client name, phone or email, billing and site address, GSTIN; on an approval link, the name and contact
                  the client types, their decision and comment, the time, the document version (hash) and their browser
                  type
                </td>
                <td>The designer, and the client on the approval page</td>
              </tr>
              <tr>
                <th scope="row">Payments</th>
                <td>
                  Plan, amount, currency, dates and status; Razorpay order, subscription and payment ids; the payment
                  method type. <b>Card numbers, CVV, UPI PIN and bank logins are entered on Razorpay’s checkout and never reach us.</b>
                </td>
                <td>You and Razorpay</td>
              </tr>
              <tr>
                <th scope="row">Technical and security</th>
                <td>IP address, browser and device type, sign-in and access logs, error logs</td>
                <td>Your browser and our providers’ servers</td>
              </tr>
              <tr>
                <th scope="row">Messages</th>
                <td>Emails you send us and our replies</td>
                <td>You</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          We don’t collect precise location, contacts, biometrics or government ID numbers other than the GSTIN and PAN
          you choose to print on your documents.
        </p>
      </Section>

      <Section id="p-why" title="4. Why we use it, and on what basis">
        <ul>
          <li>
            <b>To provide the service you asked for</b> — sign you in, save and sync your projects, compute quotations,
            share links, run team seats. You provide this data voluntarily for that purpose (DPDP Act, section 7(a)), and
            you consent to it when you create an account (section 6).
          </li>
          <li>
            <b>To take payments and manage plans</b> — create orders and subscriptions, verify payments, send renewal
            and pre-debit notices, issue receipts or invoices.
          </li>
          <li><b>To keep the service secure</b> — detect abuse, investigate incidents and keep the logs the law requires.</li>
          <li><b>To meet legal obligations</b> — tax and accounting records, responding to lawful requests from authorities.</li>
          <li><b>To support you</b> — answer your emails and grievances.</li>
          <li>
            <b>Product news</b> — only if you opt in, and you can opt out from any such email. Service emails (sign-in
            links, receipts, renewal and security notices) are part of the service.
          </li>
        </ul>
        <p>
          You can withdraw your consent at any time, as easily as you gave it, by deleting your data or account or by
          writing to us. Withdrawal doesn’t affect processing already done, and we may need to keep some records as
          described in section 7.
        </p>
      </Section>

      <Section id="p-share" title="5. Who we share it with">
        <p>We use these service providers (sub-processors) to run 3xDezine. Each receives only what it needs:</p>
        <div className="site-table-wrap">
          <table className="site-table site-table-doc">
            <thead>
              <tr>
                <th scope="col">Provider</th>
                <th scope="col">What for</th>
                <th scope="col">Data</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Supabase</th>
                <td>Database, sign-in, sign-in emails, file storage and server functions</td>
                <td>Everything you save to the cloud; account and log data. Region: <V value={BUSINESS.dataRegion} /></td>
              </tr>
              <tr>
                <th scope="row">Razorpay</th>
                <td>Payments, subscriptions and mandates (India)</td>
                <td>Your email, the plan and amount; payment details you enter on Razorpay’s checkout</td>
              </tr>
              <tr>
                <th scope="row">GitHub (GitHub Pages and Releases)</th>
                <td>Serving the web app and the Android app download</td>
                <td>IP address and browser details in standard web-server logs</td>
              </tr>
              <tr>
                <th scope="row">Google Fonts</th>
                <td>Serving the typefaces the app uses</td>
                <td>IP address and browser details</td>
              </tr>
              <tr>
                <th scope="row">Google sign-in</th>
                <td>{GOOGLE_ENABLED ? 'Signing in, only if you choose “Continue with Google”' : 'Only if Google sign-in is enabled and you choose it (it is not enabled today)'}</td>
                <td>Your Google account email, name and id</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          We share data with others only when you ask us to (for example, sending a quotation to your client), when the
          law requires it, or to protect people and the service from harm or fraud. If 3xDezine is sold or merged, the
          data would move to the successor under this policy, with notice to you. <b>We do not sell personal data.</b>
        </p>
      </Section>

      <Section id="p-where" title="6. Where it is stored">
        <p>
          Cloud data is stored with Supabase in the region shown above. Some providers may process data outside India.
          The DPDP Act allows this except to countries the Government of India restricts by notification; we will
          follow any such restriction.
        </p>
      </Section>

      <Section id="p-retention" title="7. How long we keep it">
        <div className="site-table-wrap">
          <table className="site-table site-table-doc">
            <thead>
              <tr>
                <th scope="col">Data</th>
                <th scope="col">Kept for</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Account, profile, projects, drafts and quotations</th>
                <td>While your account is open. Deleted 30 days after you delete them or close your account. Older versions beyond your plan’s history window may be removed sooner.</td>
              </tr>
              <tr>
                <th scope="row">Issued tax invoices, bills of supply and other invoices</th>
                <td>
                  <b>72 months</b> from the due date of the annual return for the year they relate to, as the CGST Act, 2017
                  (section 36, read with Rule 56) requires. The database enforces this: a project with issued tax
                  documents cannot be deleted until then, even if you close your account.
                </td>
              </tr>
              <tr>
                <th scope="row">Our own billing records</th>
                <td>As long as tax and accounting law requires — at least 72 months under the CGST Act once we are registered, and as the Income-tax Act requires.</td>
              </tr>
              <tr>
                <th scope="row">Approval records</th>
                <td>With the quotation they belong to.</td>
              </tr>
              <tr>
                <th scope="row">Security and access logs</th>
                <td>At least one year, as the DPDP Rules require, then deleted.</td>
              </tr>
              <tr>
                <th scope="row">Support emails</th>
                <td>As long as needed to resolve your request and keep a record of it.</td>
              </tr>
              <tr>
                <th scope="row">Data in your browser</th>
                <td>Until you clear it, or your browser does.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Section>

      <Section id="p-rights" title="8. Your rights">
        <p>Under the DPDP Act you can:</p>
        <ul>
          <li><b>access</b> a summary of the personal data we process about you and the processing we do (section 11);</li>
          <li><b>correct, complete or update</b> it, and <b>erase</b> it when it is no longer needed, unless the law requires us to keep it (section 12);</li>
          <li><b>withdraw consent</b> at any time (section 6);</li>
          <li><b>have a grievance redressed</b> by us (section 13);</li>
          <li><b>nominate</b> someone to exercise these rights if you die or become incapable (section 14).</li>
        </ul>
        <p>
          Most profile and project data can be corrected or deleted in the app. For anything else, write to <Email subject="Privacy request" />{' '}
          from your account email. We may need to verify that the request is yours. We acknowledge requests within{' '}
          {BUSINESS.grievanceAckHours} hours and respond within {BUSINESS.grievanceResolveDays} days. If you are not
          satisfied, you may complain to the Data Protection Board of India after using our grievance process.
        </p>
      </Section>

      <Section id="p-security" title="9. Security">
        <p>
          Data is encrypted in transit (HTTPS) and at rest by our hosting provider. Access to cloud data is controlled
          per user by database row-level security, server keys are never sent to browsers, payment webhooks are verified
          by signature, and issued documents are fingerprinted so changes are detectable. No system is perfectly secure;
          we review our safeguards as the product grows.
        </p>
      </Section>

      <Section id="p-breach" title="10. If there is a breach">
        <p>
          If a personal data breach affects you, we will tell you without delay — what happened, the likely
          consequences, what we are doing about it, what you can do, and whom to contact. We will report it to the Data
          Protection Board of India as the DPDP Rules require, including a detailed report within 72 hours of becoming
          aware of it. Where the breach affects client data we process for a designer, we will inform that designer
          without delay so they can meet their own duties.
        </p>
      </Section>

      <Section id="p-children" title="11. Children">
        <p>
          3xDezine is for adults using it for work. You must be 18 or older to create an account. We don’t knowingly
          process children’s data or track or target children; if we learn that an account belongs to someone under 18,
          we will delete it.
        </p>
      </Section>

      <Section id="p-storage" title="12. Cookies and local storage">
        <p>
          3xDezine sets <b>no advertising or analytics cookies</b> and uses no third-party trackers. It uses your
          browser’s local storage for things that make the app work:
        </p>
        <ul>
          <li>your working plan and recent edits, so a reload doesn’t lose your work;</li>
          <li>preferences, your name on proposals, your studio profile, local quotations and rate edits;</li>
          <li>your sign-in session, if you use an account;</li>
          <li>small choices such as dismissing the phone banner (session storage, cleared when you close the tab).</li>
        </ul>
        <p>
          You can clear these at any time in your browser settings; the app will start fresh. Razorpay’s checkout, when
          you open it to pay, may set its own cookies for fraud prevention under Razorpay’s privacy policy.
        </p>
      </Section>

      <Section id="p-grievance" title="13. Grievance Officer and contact">
        <GrievanceBlock />
        <p>Legal entity: {BUSINESS.legalEntity}.</p>
      </Section>

      <Section id="p-changes" title="14. Changes to this policy">
        <p>
          We will update this policy when what we do changes, and tell you by email or in the app before a material
          change takes effect. The date at the top shows the current version.
        </p>
      </Section>
    </LegalDoc>
  );
}
