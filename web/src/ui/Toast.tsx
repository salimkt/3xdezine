import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { IconInfo, IconLock } from './icons';

/** One line, bottom centre, gone on its own. Never blocks anything. */
export function Toast() {
  const notice = useStore((s) => s.notice);
  const [shown, setShown] = useState<typeof notice>(null);

  useEffect(() => {
    if (!notice) return;
    setShown(notice);
    const timer = window.setTimeout(() => setShown((n) => (n?.at === notice.at ? null : n)), 2800);
    return () => window.clearTimeout(timer);
  }, [notice]);

  if (!shown) return null;
  return (
    <div key={shown.at} className={`toast toast-${shown.tone}`} role="status" aria-live="polite">
      {shown.tone === 'warn' ? <IconLock size={13} /> : <IconInfo size={13} />}
      <span>{shown.text}</span>
    </div>
  );
}
