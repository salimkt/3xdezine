import { useEffect, useRef, useState, type ReactNode } from 'react';
import { BUSINESS, LEGAL_DRAFT, LEGAL_LAST_UPDATED, TO_BE_ADDED } from '../legal/business';

/** Building blocks for the legal and business pages. */

/** A config value, or a visible "To be added" — never a made-up placeholder. */
export function V({ value }: { value: string | null }) {
  return value ? <>{value}</> : <span className="site-tbd">{TO_BE_ADDED}</span>;
}

export function Email({ address = BUSINESS.email, subject }: { address?: string; subject?: string }) {
  const href = subject ? `mailto:${address}?subject=${encodeURIComponent(subject)}` : `mailto:${address}`;
  return <a href={href}>{address}</a>;
}

export function DraftBanner() {
  if (!LEGAL_DRAFT) return null;
  return (
    <p className="site-draft" role="note">
      <b>Draft</b> — to be reviewed by a lawyer before 3xDezine accepts payments.
    </p>
  );
}

/**
 * A legal page: title, draft banner, last-updated line, a contents list built
 * from the page's own section headings, then the sections.
 */
export function LegalDoc({ title, lead, children }: { title: string; lead?: ReactNode; children: ReactNode }) {
  const body = useRef<HTMLDivElement>(null);
  const [toc, setToc] = useState<Array<{ id: string; text: string }>>([]);

  useEffect(() => {
    const heads = body.current?.querySelectorAll<HTMLHeadingElement>('h2[id]') ?? [];
    setToc([...heads].map((h) => ({ id: h.id, text: h.textContent ?? '' })));
  }, []);

  return (
    <article className="site-doc">
      <DraftBanner />
      <h1>{title}</h1>
      <p className="site-updated">Last updated {LEGAL_LAST_UPDATED}</p>
      {lead && <div className="site-lead">{lead}</div>}
      {toc.length > 3 && (
        <nav className="site-toc" aria-label="Contents">
          <b>Contents</b>
          <ol>
            {toc.map((t) => (
              <li key={t.id}>
                {/* Buttons, not #anchors: the hash is the router. */}
                <button type="button" onClick={() => document.getElementById(t.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
                  {t.text}
                </button>
              </li>
            ))}
          </ol>
        </nav>
      )}
      <div ref={body}>{children}</div>
    </article>
  );
}

export function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className="site-section">
      <h2 id={id}>{title}</h2>
      {children}
    </section>
  );
}

/** The identity block printed on Contact, Terms and Privacy. */
export function IdentityTable() {
  return (
    <dl className="site-facts">
      <dt>Legal entity</dt>
      <dd>{BUSINESS.legalEntity}</dd>
      <dt>Email</dt>
      <dd>
        <Email />
      </dd>
      <dt>Phone</dt>
      <dd>
        <V value={BUSINESS.phone} />
      </dd>
      <dt>Registered address</dt>
      <dd>
        <V value={BUSINESS.address} />
      </dd>
      <dt>GSTIN</dt>
      <dd>{BUSINESS.gstin ?? <span className="site-tbd">Not yet registered — {TO_BE_ADDED.toLowerCase()}</span>}</dd>
    </dl>
  );
}

export function GrievanceBlock() {
  const g = BUSINESS.grievanceOfficer;
  return (
    <dl className="site-facts">
      <dt>Grievance Officer</dt>
      <dd>
        {g.name}, {g.designation}
      </dd>
      <dt>Email</dt>
      <dd>
        <Email address={g.email} subject="Grievance" />
      </dd>
      <dt>Phone</dt>
      <dd>
        <V value={g.phone} />
      </dd>
      <dt>Address</dt>
      <dd>
        <V value={BUSINESS.address} />
      </dd>
      <dt>Response</dt>
      <dd>
        Acknowledged within {BUSINESS.grievanceAckHours} hours; resolved within {BUSINESS.grievanceResolveDays} days.
      </dd>
    </dl>
  );
}
