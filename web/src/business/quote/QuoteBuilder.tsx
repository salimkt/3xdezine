import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { DocType, QuotationDocument, QuoteLine, SaveQuoteDraftRequest } from '@shared/business';
import { diffQuotes } from '@shared/quote';
import { allowedDocTypes } from '@shared/gst';
import { useStore } from '../../store';
import { CLOUD_ENABLED, useCloud } from '../../cloud/state';
import { ErrorLine, useAction, withEngine } from '../../cloud/ui/common';
import { createVariationOrder, isSignedIn, issueQuote, saveQuoteDraft, type QuoteRow } from '../api';
import { PLAN_LABEL, openPricing, useBiz } from '../state';
import { normaliseStudio } from '../defaults';
import { formatINR, toSqft } from '../engines';
import { DOC_TITLE, QuoteDoc } from '../doc/QuoteDoc';
import { patchDraft, projectKey, setDraft, useDraft, useProjectKey, useWorkspace, type QuoteDraft } from '../workspace';
import {
  activeCard,
  builtUpSqm,
  carpetSqm,
  draftInput,
  issuableDocTypes,
  lineFromCard,
  liveLines,
  makeListFor,
  manualLine,
  newDraft,
  previewDoc,
  projectEntitlements,
  seedLines,
  variationLines,
} from './model';
import { LineTable, groupLines, type Group } from './LineTable';
import { DraftSettings, Section, TotalsPanel } from './QuoteSidebar';
import { AddFromCard } from './AddFromCard';
import { QuotesList, ShareBox, StatusBadge } from './CloudQuotes';
import '../business.css';

/**
 * The studio's Quote tab: a BOQ seeded from the plan and the rate card,
 * edited line by line, priced live with the same engine the server runs, and
 * printed as an A4 quotation. With cloud: saved, issued with a number, shared
 * by link and WhatsApp, revised, and amended by variation order.
 */
export default function QuoteBuilder() {
  const key = useProjectKey();
  const draft = useDraft();
  const ctx = useQuoteContext();
  const { project, catalog, studio, card, docTypes } = ctx;

  if (!draft) {
    const start = () => setDraft(key, newDraft(project, card, catalog, studio, docTypes[0] ?? 'QUOTATION'));
    return (
      <div className="biz-quote biz-quote-empty">
        <div className="biz-start">
          <h2>Quotation for {project.name}</h2>
          <p>
            Start from the plan: every room gets its trade lines from the <b>{card.name}</b> — flooring, painting,
            ceiling, electrical points — with quantities measured off the drawing. Then edit anything.
          </p>
          <button className="btn btn-primary" onClick={start}>
            Start quote from the plan
          </button>
          {!studio.legalName && (
            <p className="hint">
              Tip: add your studio details first, so the letterhead is right.{' '}
              <button className="btn btn-small" onClick={() => useBiz.setState({ dialog: 'settings' })}>
                Studio settings
              </button>
            </p>
          )}
        </div>
      </div>
    );
  }
  return <Builder key={key} projectKey={key} draft={draft} ctx={ctx} />;
}

function useQuoteContext() {
  const project = useStore((s) => s.project);
  const catalog = useStore((s) => s.catalog);
  const active = useCloud((s) => s.active);
  const status = useCloud((s) => s.status);
  const rawEnts = useBiz((s) => s.entitlements);
  const storedStudio = useBiz((s) => s.studio);
  const ents = useMemo(() => projectEntitlements(rawEnts, active?.id), [rawEnts, active?.id]);
  const studio = useMemo(() => normaliseStudio(storedStudio), [storedStudio]);
  const { card, overrides } = useMemo(() => activeCard(ents), [ents]);
  const docTypes = useMemo(() => issuableDocTypes(ents, studio), [ents, studio]);
  return { project, catalog, active, status, ents, studio, card, overrides, docTypes };
}

type QuotationView = { doc: QuotationDocument; title: string };

function Builder({ projectKey: key, draft, ctx }: { projectKey: string; draft: QuoteDraft; ctx: ReturnType<typeof useQuoteContext> }) {
  const { project, catalog, active, status, ents, studio, card, overrides, docTypes } = ctx;
  useBiz((s) => s.studioSource);
  const [preview, setPreview] = useState(false);
  const [adding, setAdding] = useState(false);
  const [viewing, setViewing] = useState<QuotationView | null>(null);
  const [listRev, setListRev] = useState(0);
  const [confirmReseed, setConfirmReseed] = useState(false);
  const [serverNote, setServerNote] = useState<string | null>(null);
  const { busy, error, setError, run } = useAction();
  const patch = useCallback((p: Partial<QuoteDraft>) => patchDraft(key, p), [key]);
  const isVO = Boolean(draft.amendsId && draft.amendsDoc);

  // A doc type the plan or registration no longer allows falls back to the first allowed one.
  useEffect(() => {
    if (!isVO && docTypes.length && !docTypes.includes(draft.docType)) patch({ docType: docTypes[0] });
  }, [docTypes, draft.docType, isVO, patch]);

  const live = useMemo(() => liveLines(draft.lines, project, draft.modular), [draft.lines, project, draft.modular]);
  const revised = useMemo(() => live.map((l) => l.line), [live]);
  // A variation order's own lines are the change against the approved quote.
  const docLines = useMemo(() => (isVO ? variationLines(draft.amendsDoc!, revised) : revised), [isVO, draft.amendsDoc, revised]);
  const pv = useMemo(
    () => previewDoc({ ...draft, docType: isVO ? 'VARIATION_ORDER' : draft.docType }, docLines, project, card, overrides, studio, ents),
    [draft, docLines, project, card, overrides, studio, ents, isVO],
  );
  // The full revised scope, for the diff panel of a variation order.
  const scope = useMemo(
    () => (isVO ? previewDoc({ ...draft, docType: draft.amendsDoc!.docType === 'VARIATION_ORDER' ? 'QUOTATION' : draft.amendsDoc!.docType }, revised, project, card, overrides, studio, ents).doc : null),
    [isVO, draft, revised, project, card, overrides, studio, ents],
  );
  const diff = useMemo(() => (isVO && scope ? diffQuotes(draft.amendsDoc!, scope) : null), [isVO, scope, draft.amendsDoc]);

  const doc = pv.doc;
  const lineNos = useMemo(() => new Map((doc?.sections ?? []).flatMap((s) => s.lines.map((l) => [l.id, l.lineNo] as const))), [doc]);
  const groups = useMemo(() => groupLines(live, draft.view, project), [live, draft.view, project]);
  const rooms = useMemo(() => project.floors.flatMap((f) => f.rooms.map((r) => ({ id: r.id, name: r.name }))), [project]);
  const sqft = useMemo(() => ({ carpet: toSqft(carpetSqm(project)), builtUp: toSqft(builtUpSqm(project)) }), [project]);

  const lockedDocTypes = useMemo(() => {
    const reg = new Set(allowedDocTypes(studio.gstRegistration));
    return (['PROFORMA', 'TAX_INVOICE', 'BILL_OF_SUPPLY', 'PLAIN_INVOICE'] as DocType[])
      .filter((t) => !docTypes.includes(t))
      .map((type) => ({ type, why: !ents.docTypes.includes(type) ? 'needs Solo' : reg.has(type) ? 'not available' : studio.gstRegistration === 'REGULAR' ? 'not for registered studios' : 'needs GST registration' }));
  }, [docTypes, ents, studio.gstRegistration]);

  // --- line edits -----------------------------------------------------------
  const setLines = (lines: QuoteLine[]) => patch({ lines });
  const onChange = (id: string, p: object) => setLines(draft.lines.map((l) => (l.id === id ? ({ ...l, ...p } as QuoteLine) : l)));
  const onDelete = (id: string) => setLines(draft.lines.filter((l) => l.id !== id));
  const onMove = (id: string, dir: -1 | 1, g: Group) => {
    const idx = g.rows.findIndex((r) => r.line.id === id);
    const other = g.rows[idx + dir]?.line.id;
    if (!other) return;
    const lines = [...draft.lines];
    const a = lines.findIndex((l) => l.id === id);
    const b = lines.findIndex((l) => l.id === other);
    [lines[a], lines[b]] = [lines[b], lines[a]];
    setLines(lines);
  };
  const onEditModular = (itemId: string) => {
    const item = draft.modular.find((m) => m.id === itemId);
    if (item) useStore.getState().select('room', item.roomId);
    useWorkspace.setState({ editingModularId: itemId });
    useBiz.setState({ quoteOpen: false });
  };

  const reseed = () => {
    const keep = draft.lines.filter((l) => l.kind === 'MODULAR' || (l.kind === 'TRADE' && !l.rateCardEntryId));
    const lines = [...seedLines(project, card, catalog), ...keep];
    patch({ lines, makeList: makeListFor(lines, card) });
    setConfirmReseed(false);
  };

  // --- cloud ----------------------------------------------------------------
  const signedIn = status === 'signedIn';
  const cloudProject = active && !active.link ? active : null;
  const canQuoteCloud = Boolean(cloudProject && cloudProject.role !== 'VIEW');
  const input = (): SaveQuoteDraftRequest['input'] => draftInput({ ...draft, docType: isVO ? 'VARIATION_ORDER' : draft.docType }, docLines, project);

  const problems = [
    !draft.recipient.legalName.trim() && 'the client’s name',
    !/^[1-9][0-9]{5}$/.test(draft.siteAddress.pin) && 'the site PIN',
    !draft.siteAddress.line1.trim() && 'the site address',
    !draft.siteAddress.city.trim() && 'the site city',
    !/^[1-9][0-9]{5}$/.test(draft.recipient.address.pin) && 'the client’s PIN',
    !draft.recipient.address.line1.trim() && 'the client’s address',
    !draft.recipient.address.city.trim() && 'the client’s city',
    !studio.legalName.trim() && 'your studio details (Studio settings)',
    studio.legalName.trim() && useBiz.getState().studioSource !== 'cloud' && 'your studio saved to your account (Studio → Save studio)',
    draft.exclusions.length === 0 && 'at least one exclusion',
    !doc && 'a valid quote',
  ].filter(Boolean) as string[];

  const save = () =>
    run(async () => {
      if (!cloudProject) throw new Error('Save this plan to the cloud first.');
      let quote: QuotationDocument;
      if (isVO && !draft.cloudQuoteId) {
        quote = await createVariationOrder({ approvedQuoteId: draft.amendsId!, input: input() });
      } else {
        quote = await saveQuoteDraft({ projectId: cloudProject.id, ...(draft.cloudQuoteId ? { quoteId: draft.cloudQuoteId } : {}), input: input() });
      }
      patch({ cloudQuoteId: quote.id, ...(quote.supersedesId ? { supersedesId: quote.supersedesId } : {}) });
      // The server is authoritative; say so when its total differs from the preview (e.g. plan rules on rates).
      setServerNote(
        doc && quote.grandTotal !== doc.grandTotal
          ? `The server priced this at ${formatINR(quote.grandTotal, { paise: false })} (preview ${formatINR(doc.grandTotal, { paise: false })}).${!ents.rateCards ? ' On the Free plan, rate-card lines are saved at the default card’s rates — upgrade to keep your own rates.' : ''}`
          : null,
      );
      setListRev((n) => n + 1);
      return quote;
    });

  const issue = () =>
    void run(async () => {
      const saved = await save();
      if (!saved) return;
      const r = await issueQuote(saved.id);
      // Further edits become a revision of what was just issued.
      patch({ cloudQuoteId: r.quote.id, lastIssued: { quoteId: r.quote.id, token: r.shareToken, number: r.quote.number } });
      setListRev((n) => n + 1);
      setViewing({ doc: r.quote, title: `${DOC_TITLE[r.quote.docType]} ${r.quote.number ?? ''}` });
    });

  const fromRow = (row: QuoteRow, extra: Partial<QuoteDraft>): QuoteDraft => {
    const inp = row.input;
    if (!inp) return { ...draft, ...extra };
    const modular = inp.lines.flatMap((l) => (l.kind === 'MODULAR' ? [l.item] : []));
    return {
      ...draft,
      lines: inp.lines.filter((l) => !(l.id.endsWith('~omit') || l.id.endsWith('~rev'))),
      modular: modular.length ? modular : draft.modular,
      view: inp.view,
      designFee: inp.designFee,
      discount: inp.discount,
      milestones: inp.milestones,
      makeList: inp.makeList,
      inclusions: inp.inclusions,
      exclusions: inp.exclusions,
      terms: inp.terms,
      docType: inp.docType,
      validityDays: inp.validityDays,
      recipient: inp.recipient,
      siteAddress: inp.siteAddress,
      areaBasisKind: inp.areaBasis?.kind === 'BUILT_UP' ? 'BUILT_UP' : 'CARPET',
      ...extra,
    };
  };

  const onRevise = (row: QuoteRow) => {
    setDraft(key, fromRow(row, { cloudQuoteId: row.quote.id, amendsId: undefined, amendsDoc: undefined }));
    setViewing(null);
  };
  const onVariation = (row: QuoteRow) => {
    if (!ents.variationOrders) {
      openPricing({ reason: 'Variation orders — the only way to change an approved quote — are part of Solo.', projectId: cloudProject?.id });
      return;
    }
    const { stash: _s, ...working } = draft;
    setDraft(key, fromRow(row, { cloudQuoteId: undefined, lastIssued: undefined, amendsId: row.quote.id, amendsDoc: row.quote, docType: 'VARIATION_ORDER', stash: draft.amendsId ? draft.stash : working }));
    setViewing(null);
  };

  // --- print ----------------------------------------------------------------
  const printDoc = viewing?.doc ?? doc;
  const print = () => {
    if (!printDoc) return;
    const title = document.title;
    const name = [DOC_TITLE[printDoc.docType], printDoc.number ?? 'draft', printDoc.recipient.legalName].filter(Boolean).join(' - ');
    document.title = name.replace(/[\\/:*?"<>|]+/g, '-');
    const restore = () => {
      document.title = title;
      window.removeEventListener('afterprint', restore);
    };
    window.addEventListener('afterprint', restore);
    window.print();
  };

  const freePlan = !ents.brandedQuotes;
  const passOffer = freePlan && cloudProject?.role === 'OWNER' && CLOUD_ENABLED;
  const warnings = doc?.warnings ?? [];

  return (
    <div className="biz-quote">
      <header className="biz-quote-bar">
        <div className="biz-quote-title">
          <h2>{isVO ? 'Variation order' : 'Quote'}</h2>
          <small>
            {isVO ? `amends ${draft.amendsDoc?.number ?? 'approved quote'}` : project.name}
            {draft.cloudQuoteId && !isVO && ' · saved'}
          </small>
        </div>
        <div className="segmented" role="radiogroup" aria-label="Group lines">
          {(['ROOM_WISE', 'TRADE_WISE'] as const).map((v) => (
            <button key={v} role="radio" aria-checked={draft.view === v} className={`seg ${draft.view === v ? 'seg-on' : ''}`} onClick={() => patch({ view: v })}>
              {v === 'ROOM_WISE' ? 'Room-wise' : 'Trade-wise'}
            </button>
          ))}
        </div>
        <div className="biz-addwrap">
          <button className="btn" onClick={() => setAdding(!adding)} aria-expanded={adding}>
            Add from rate card
          </button>
          {adding && (
            <AddFromCard
              card={card}
              rooms={rooms}
              onClose={() => setAdding(false)}
              onAdd={(entry, roomId) => setLines([...draft.lines, lineFromCard(entry, project, roomId)])}
            />
          )}
        </div>
        <button className="btn btn-ghost" onClick={() => setLines([...draft.lines, manualLine()])}>
          Add line
        </button>
        {confirmReseed ? (
          <span className="biz-confirm">
            Replace rate-card lines with fresh ones from the plan?
            <button className="btn btn-small" onClick={() => setConfirmReseed(false)}>
              Cancel
            </button>
            <button className="btn btn-small btn-primary" onClick={reseed}>
              Replace
            </button>
          </span>
        ) : (
          <button className="btn btn-ghost" onClick={() => setConfirmReseed(true)} title="Re-seed rate-card lines from the current plan (manual and modular lines are kept)">
            Re-seed
          </button>
        )}
        <span className="topbar-spacer" />
        {freePlan ? (
          <button className="badge badge-warn biz-plan-badge" onClick={() => openPricing({ projectId: cloudProject?.id })} title="Free quotes carry “Made with 3xDezine”. Upgrade for branded quotes.">
            {PLAN_LABEL[ents.plan]} · watermarked
          </button>
        ) : (
          <span className="badge badge-ok">{ents.passProjectIds.includes(cloudProject?.id ?? '') && ents.plan === 'FREE' ? 'Project Pass' : PLAN_LABEL[ents.plan]}</span>
        )}
        {passOffer && (
          <button
            className="btn btn-ghost"
            onClick={() => openPricing({ projectId: cloudProject!.id, reason: 'Unlock this project with a Project Pass: unbranded quotes with your letterhead, every document type, 90 days.' })}
          >
            Project Pass ₹499
          </button>
        )}
        <button className="btn btn-ghost" onClick={() => useBiz.setState({ dialog: 'settings' })}>
          Studio
        </button>
        <button className="btn btn-ghost" onClick={() => useBiz.setState({ dialog: 'ratecard' })}>
          Rate card
        </button>
        <button className={`btn btn-ghost ${preview ? 'btn-ghost-on' : ''}`} aria-pressed={preview} onClick={() => (setPreview(!preview), setViewing(null))}>
          Preview
        </button>
        <button className="btn" onClick={print} disabled={!printDoc}>
          Print / PDF
        </button>
      </header>

      <div className="biz-quote-body">
        <main className="biz-quote-main">
          {viewing ? (
            <div className="biz-paper">
              <div className="biz-paper-bar">
                <b>{viewing.title}</b>
                <StatusBadge status={viewing.doc.status} />
                <span className="topbar-spacer" />
                <button className="btn btn-small" onClick={() => setViewing(null)}>
                  Close
                </button>
              </div>
              <QuoteDoc doc={viewing.doc} variant="preview" />
            </div>
          ) : preview ? (
            <div className="biz-paper">
              {doc ? (
                <QuoteDoc doc={doc} variant="preview" draftNote={<>Draft preview — not yet issued. Totals are computed with the same engine the server uses.</>} />
              ) : (
                <ErrorLine text={pv.error ?? 'This quote can’t be built yet.'} />
              )}
            </div>
          ) : (
            <>
              {isVO && diff && (
                <div className="biz-vo">
                  <b>Changes against {draft.amendsDoc?.number}</b>
                  <ul>
                    {diff.added.map((a) => (
                      <li key={a.id} className="biz-vo-add">
                        + {a.description} <span className="mono">{formatINR(a.amount, { paise: false })}</span>
                      </li>
                    ))}
                    {diff.removed.map((a) => (
                      <li key={a.id} className="biz-vo-rm">
                        − {a.lineNo} {a.description} <span className="mono">−{formatINR(a.amount, { paise: false })}</span>
                      </li>
                    ))}
                    {diff.changed.map((c) => (
                      <li key={c.id} className="biz-vo-chg">
                        ~ {c.lineNo} {c.description} <small>({c.fields.join(', ')})</small>{' '}
                        <span className="mono">
                          {c.delta >= 0 ? '+' : '−'}
                          {formatINR(Math.abs(c.delta), { paise: false })}
                        </span>
                      </li>
                    ))}
                    {!diff.added.length && !diff.removed.length && !diff.changed.length && <li className="hint">No changes yet — edit the lines below.</li>}
                  </ul>
                  <span className="hint">
                    Revised scope {formatINR(scope?.grandTotal ?? 0, { paise: false })} vs approved {formatINR(draft.amendsDoc!.grandTotal, { paise: false })} · variation{' '}
                    <b className="mono">{formatINR(doc?.grandTotal ?? 0, { paise: false })}</b> incl. GST
                  </span>
                  <button className="btn btn-small btn-ghost" onClick={() =>
                      draft.stash
                        ? setDraft(key, { ...draft.stash })
                        : patch({ amendsId: undefined, amendsDoc: undefined, cloudQuoteId: undefined, lastIssued: undefined, docType: docTypes[0] ?? 'QUOTATION' })
                    }>
                    Leave variation order
                  </button>
                </div>
              )}
              <LineTable groups={groups} lineNos={lineNos} rooms={rooms} onChange={onChange} onMove={onMove} onDelete={onDelete} onEditModular={onEditModular} />
              <p className="hint biz-legend">
                <span className="biz-geo-dot" /> quantity follows the plan — hover for the measurement. Markup is internal: it is folded into the printed rate and
                never shown to the client. Opt = optional (shown, not totalled); CS = client supplies the material (labour only).
              </p>
            </>
          )}
        </main>

        <aside className="biz-quote-side">
          <TotalsPanel doc={doc} error={pv.error} freePlan={freePlan} />
          {warnings.length > 0 && (
            <ul className="biz-warnings">
              {warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}

          <Section title="Issue & share" defaultOpen badge={draft.lastIssued ? <span className="badge badge-ok">issued</span> : undefined}>
            {!CLOUD_ENABLED ? (
              <p className="hint">
                This site runs without an account: draft, preview and print work here, with the 3xDezine watermark. Issuing numbered quotes and client approval links needs the cloud version — sign in there to issue and share.
              </p>
            ) : !signedIn ? (
              <div className="biz-stack">
                <p className="hint">Your draft is kept in this browser. Sign in to issue numbered quotes and send the client an approval link.</p>
                <button className="btn btn-primary" onClick={() => useCloud.setState({ dialog: 'signin' })}>
                  Sign in to issue and share
                </button>
              </div>
            ) : !cloudProject ? (
              <div className="biz-stack">
                <p className="hint">Quotes are issued against a cloud project, so the client sees the exact plan you priced.</p>
                <button className="btn btn-primary" disabled={busy} onClick={() =>
                    void run(async () => {
                      const before = draft;
                      await withEngine((e) => e.saveCurrentToCloud());
                      // The draft follows the plan into the cloud project.
                      const next = projectKey();
                      if (next !== key && !useWorkspace.getState().drafts[next]) setDraft(next, { ...before, cloudQuoteId: undefined, lastIssued: undefined });
                    })
                  }>
                  Save plan to cloud
                </button>
              </div>
            ) : !canQuoteCloud ? (
              <p className="hint">You can view this project but not prepare quotes for it.</p>
            ) : (
              <div className="biz-stack">
                {problems.length > 0 && <p className="hint">Before issuing, add {problems.join(', ')}.</p>}
                <div className="cloud-actions">
                  <button className="btn" disabled={busy || !doc} onClick={() => void save()}>
                    {busy ? 'Working…' : draft.cloudQuoteId ? 'Save draft' : isVO ? 'Save variation order' : 'Save draft'}
                  </button>
                  <button className="btn btn-primary" disabled={busy || problems.length > 0} onClick={issue}>
                    {isVO ? 'Issue variation order' : `Issue ${DOC_TITLE[draft.docType].toLowerCase()}`}
                  </button>
                </div>
                {draft.lastIssued && doc && (
                  <>
                    <p className="hint">
                      Issued <b className="mono">{draft.lastIssued.number}</b>. Send the client this link — they can approve or ask for changes without an account.
                      Editing now creates a revision.
                    </p>
                    <ShareBox token={draft.lastIssued.token} doc={{ ...doc, number: draft.lastIssued.number }} />
                  </>
                )}
                {serverNote && <p className="biz-warn">{serverNote}</p>}
                <ErrorLine text={error} />
                {error && /studio/i.test(error) && (
                  <button className="btn btn-small" onClick={() => (setError(null), useBiz.setState({ dialog: 'settings' }))}>
                    Open studio settings
                  </button>
                )}
                {error && /upgrade|Solo/i.test(error) && (
                  <button className="btn btn-small btn-primary" onClick={() => openPricing({ projectId: cloudProject.id })}>
                    See plans
                  </button>
                )}
              </div>
            )}
          </Section>

          {cloudProject && signedIn && isSignedIn() && (
            <Section title="Quotes for this project" defaultOpen>
              {draft.cloudQuoteId && !isVO && (
                <button
                  className="btn btn-small btn-ghost"
                  title="Keep these lines but save them as a separate new quote, not a revision"
                  onClick={() => patch({ cloudQuoteId: undefined, lastIssued: undefined, supersedesId: undefined })}
                >
                  Save as a new quote instead
                </button>
              )}
              <QuotesList
                projectId={cloudProject.id}
                rev={listRev}
                currentId={draft.cloudQuoteId}
                canVariation={ents.variationOrders}
                onRevise={onRevise}
                onVariation={onVariation}
                onView={(row) => setViewing({ doc: row.quote, title: `${DOC_TITLE[row.quote.docType]} ${row.quote.number ?? '(draft)'}` })}
              />
            </Section>
          )}

          <DraftSettings draft={draft} patch={patch} doc={doc} docTypes={docTypes} lockedDocTypes={lockedDocTypes} onUpgrade={() => openPricing({ projectId: cloudProject?.id })} sqft={sqft} />
        </aside>
      </div>

      {printDoc &&
        createPortal(
          <div className="qd-print-root">
            <QuoteDoc doc={printDoc} variant="print" />
          </div>,
          document.body,
        )}
    </div>
  );
}
