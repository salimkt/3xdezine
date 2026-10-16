import { useEffect, useState } from 'react';
import type { QuotationDocument, QuoteStatus } from '@shared/business';
import { formatINR } from '../engines';
import { DOC_TITLE } from '../doc/QuoteDoc';
import { listProjectQuotes, type QuoteRow } from '../api';
import { quoteShareUrl } from '../state';
import { ErrorLine, ago } from '../../cloud/ui/common';

export const STATUS_LABEL: Record<QuoteStatus, string> = {
  DRAFT: 'Draft',
  ISSUED: 'Issued',
  APPROVED: 'Approved',
  CHANGES_REQUESTED: 'Changes requested',
  SUPERSEDED: 'Superseded',
  CANCELLED: 'Cancelled',
};

export function StatusBadge({ status }: { status: QuoteStatus }) {
  return <span className={`biz-status biz-status-${status.toLowerCase()}`}>{STATUS_LABEL[status]}</span>;
}

export function whatsappText(doc: QuotationDocument, url: string) {
  const who = doc.recipient.legalName ? `Hi ${doc.recipient.legalName.split(' ')[0]}, ` : 'Hi, ';
  const studio = doc.supplier.tradeName || doc.supplier.legalName || 'your designer';
  const what = `${DOC_TITLE[doc.docType].toLowerCase()} ${doc.number ?? ''}`.trim();
  return `${who}here is your ${what} from ${studio} for ${formatINR(doc.grandTotal, { paise: false })}. Review the items and approve or ask for changes here: ${url}`;
}

/** Copy link + WhatsApp: the way a quote actually reaches an Indian homeowner. */
export function ShareBox({ token, doc }: { token: string; doc: QuotationDocument }) {
  const url = quoteShareUrl(token);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const el = document.getElementById(`share-${token}`) as HTMLInputElement | null;
      el?.select();
      document.execCommand?.('copy');
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };
  return (
    <div className="biz-share">
      <input id={`share-${token}`} className="input mono" readOnly value={url} aria-label="Approval link" onFocus={(e) => e.target.select()} />
      <div className="biz-share-actions">
        <button className="btn btn-small" onClick={() => void copy()}>
          {copied ? 'Copied' : 'Copy link'}
        </button>
        <a className="btn btn-small biz-wa" href={`https://wa.me/?text=${encodeURIComponent(whatsappText(doc, url))}`} target="_blank" rel="noopener noreferrer">
          WhatsApp
        </a>
        <a className="btn btn-small btn-ghost" href={url} target="_blank" rel="noopener noreferrer">
          Open
        </a>
      </div>
    </div>
  );
}

export function QuotesList({
  projectId,
  rev,
  currentId,
  onRevise,
  onVariation,
  onView,
  canVariation,
}: {
  projectId: string;
  /** Bump to re-read. */
  rev: number;
  currentId?: string;
  onRevise: (row: QuoteRow) => void;
  onVariation: (row: QuoteRow) => void;
  onView: (row: QuoteRow) => void;
  canVariation: boolean;
}) {
  const [rows, setRows] = useState<QuoteRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shareFor, setShareFor] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    listProjectQuotes(projectId)
      .then((r) => live && (setRows(r), setError(null)))
      .catch((e) => live && setError((e as Error).message));
    return () => {
      live = false;
    };
  }, [projectId, rev]);

  if (error) return <ErrorLine text={error} />;
  if (!rows) return <p className="hint">Loading quotes…</p>;
  if (!rows.length) return <p className="hint">No saved quotes for this project yet. Save a draft to keep it in the cloud.</p>;

  return (
    <ul className="biz-quotes">
      {rows.map((row) => {
        const q = row.quote;
        const open = shareFor === q.id;
        return (
          <li key={q.id} className={`biz-quote-row ${currentId === q.id ? 'is-current' : ''}`}>
            <div className="biz-quote-row-head">
              <span className="biz-quote-row-title">
                <b className="mono">{q.number ?? 'Draft'}</b>
                <small>
                  {DOC_TITLE[q.docType]} · v{q.version}
                  {row.updatedAt ? ` · ${ago(row.updatedAt)}` : ''}
                </small>
              </span>
              <StatusBadge status={q.status} />
              <span className="mono biz-quote-row-amt">{formatINR(q.grandTotal, { paise: false })}</span>
            </div>
            {q.approvals.length > 0 && (
              <p className="hint biz-quote-row-appr">
                {q.approvals[q.approvals.length - 1].decision === 'APPROVED' ? 'Approved' : 'Changes requested'} by{' '}
                <b>{q.approvals[q.approvals.length - 1].byName}</b> · {ago(q.approvals[q.approvals.length - 1].at)}
                {q.approvals[q.approvals.length - 1].comment && <> — “{q.approvals[q.approvals.length - 1].comment}”</>}
              </p>
            )}
            <div className="biz-quote-row-actions">
              <button className="btn btn-small btn-ghost" onClick={() => onView(row)}>
                View
              </button>
              {row.shareToken && q.status !== 'SUPERSEDED' && q.status !== 'DRAFT' && (
                <button className={`btn btn-small btn-ghost ${open ? 'btn-ghost-on' : ''}`} onClick={() => setShareFor(open ? null : q.id)}>
                  Share
                </button>
              )}
              {(q.status === 'ISSUED' || q.status === 'CHANGES_REQUESTED') && (
                <button className="btn btn-small" onClick={() => onRevise(row)}>
                  Revise
                </button>
              )}
              {q.status === 'APPROVED' && q.docType !== 'VARIATION_ORDER' && (
                <button className="btn btn-small" onClick={() => onVariation(row)} title={canVariation ? undefined : 'Variation orders are part of Solo'}>
                  Variation order{canVariation ? '' : ' · Solo'}
                </button>
              )}
            </div>
            {open && row.shareToken && <ShareBox token={row.shareToken} doc={q} />}
          </li>
        );
      })}
    </ul>
  );
}
