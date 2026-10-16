import { useEffect, useMemo, useRef, useState } from 'react';
import type { RateCard, RateCardEntry, Trade } from '@shared/business';
import { formatINR } from '../engines';
import { UNIT_LABEL } from '../doc/QuoteDoc';
import { TRADE_LABEL } from './model';

export function ConfidenceBadge({ c }: { c: RateCardEntry['source']['confidence'] }) {
  return (
    <span className={`biz-conf biz-conf-${c.toLowerCase()}`} title={c === 'LOW' ? 'Planning figure from thin or conflicting sources — check it against your own rates' : `${c.toLowerCase()} confidence`}>
      {c}
    </span>
  );
}

/** Search the rate card by text and trade, pick a room, add a line. */
export function AddFromCard({
  card,
  rooms,
  defaultRoomId,
  onAdd,
  onClose,
}: {
  card: RateCard;
  rooms: Array<{ id: string; name: string }>;
  defaultRoomId?: string;
  onAdd: (entry: RateCardEntry, roomId?: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const [trade, setTrade] = useState<Trade | 'ALL'>('ALL');
  const [roomId, setRoomId] = useState<string>(defaultRoomId ?? '');
  const [added, setAdded] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => !box.current?.contains(e.target as Node) && onClose();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const trades = useMemo(() => [...new Set(card.entries.map((e) => e.trade))], [card]);
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return card.entries.filter(
      (e) =>
        (trade === 'ALL' || e.trade === trade) &&
        (!needle || `${e.description} ${e.id} ${TRADE_LABEL[e.trade]} ${(e.makeList ?? []).join(' ')}`.toLowerCase().includes(needle)),
    );
  }, [card, q, trade]);

  return (
    <div ref={box} className="popover biz-addcard" role="dialog" aria-label="Add from rate card">
      <div className="biz-addcard-head">
        <input className="input" autoFocus placeholder="Search the rate card — e.g. gypsum, putty, point" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search rate card" />
        <select className="input select" value={roomId} onChange={(e) => setRoomId(e.target.value)} aria-label="Add to room">
          <option value="">Whole house</option>
          {rooms.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </div>
      <div className="biz-trade-chips" role="toolbar" aria-label="Filter by trade">
        <button className={`chip ${trade === 'ALL' ? 'chip-on' : ''}`} onClick={() => setTrade('ALL')}>
          All
        </button>
        {trades.map((t) => (
          <button key={t} className={`chip ${trade === t ? 'chip-on' : ''}`} onClick={() => setTrade(t)}>
            {TRADE_LABEL[t]}
          </button>
        ))}
      </div>
      <ul className="biz-addcard-list">
        {list.map((e) => (
          <li key={e.id}>
            <button
              className={`biz-entry ${added === e.id ? 'biz-entry-added' : ''}`}
              onClick={() => {
                onAdd(e, roomId || undefined);
                setAdded(e.id);
              }}
            >
              <span className="biz-entry-main">
                <b>{e.description}</b>
                <small>
                  {TRADE_LABEL[e.trade]} · {e.id}
                  {e.defaultRule.kind !== 'MANUAL' && e.defaultRule.kind !== 'FIXED' ? ' · qty from plan' : ''}
                </small>
              </span>
              <span className="biz-entry-rate mono">
                {formatINR(e.materialRate + e.labourRate, { paise: false })}
                <small>/{UNIT_LABEL[e.unit]}</small>
              </span>
              <ConfidenceBadge c={e.source.confidence} />
            </button>
          </li>
        ))}
        {list.length === 0 && <li className="hint biz-empty">Nothing matches. Add a manual line instead.</li>}
      </ul>
    </div>
  );
}
