import { BUSINESS } from '../../legal/business';
import { LegalDoc, Section } from '../Doc';

export default function About() {
  return (
    <LegalDoc
      title="About 3xDezine"
      lead={
        <p className="site-big">
          Plan → 3D → a defensible, GST-ready quotation your client approves on WhatsApp — for the independent designer
          who today does this in AutoCAD, Excel and screenshots.
        </p>
      }
    >
      <Section id="a-who" title="Who it’s for">
        <p>
          Solo interior designers and design-and-build studios of one to five people, doing residential jobs — the
          studios that quote a fixed price and absorb the overruns when a quantity was guessed or a line was left out.
          Most homes in India are done by studios like these, not by the big platforms.
        </p>
      </Section>
      <Section id="a-what" title="What it does">
        <ul>
          <li>
            <b>Draw the plan, see it in 3D.</b> A 2D floor-plan editor with a real-time 3D view, finishes and lighting.
          </li>
          <li>
            <b>Price it as you draw.</b> Every surface is priced live in rupees, with a buffer for wastage, from editable
            rate cards.
          </li>
          <li>
            <b>Check it.</b> Automated checks against selected National Building Code provisions, with suggested fixes.
          </li>
          <li>
            <b>Quote it properly.</b> A BOQ from the drawing — trade lines in sq ft, rft, points or numbers, quantities traced
            to the plan, GST split by place of supply, payment milestones, exclusions, A4 print.
          </li>
          <li>
            <b>Get it approved.</b> A no-login link where the client sees the quote, plan and 3D and approves it — pinned to
            the exact version they saw, then locked. Changes come as variation orders.
          </li>
          <li>
            <b>Modular kitchens and wardrobes</b> placed on the plan’s walls, priced by running foot or front area.
          </li>
        </ul>
      </Section>
      <Section id="a-not" title="What it isn’t">
        <p>
          3xDezine is not a marketplace or a contractor. We don’t take a cut of your projects, contact your clients or
          sell leads. You pay for the software — see <a href="#/pricing">pricing</a> — and the free plan is the whole
          design tool.
        </p>
        <p>
          Rates and plan checks are there to help you work carefully; they are planning aids, not professional advice
          (see section 10 of the <a href="#/terms">Terms</a>).
        </p>
      </Section>
      <Section id="a-us" title="Who we are">
        <p>
          3xDezine is built and operated in India by {BUSINESS.operator}. Write to us any time — <a href="#/contact">contact details</a>.
        </p>
      </Section>
    </LegalDoc>
  );
}
