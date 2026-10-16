import { useEffect, useRef, useState } from 'react';
import { openPricing } from '../business/state';
import { FOOTER_LINKS, siteUrl } from '../site/routes';
import { BUSINESS } from '../legal/business';

/**
 * The studio's help menu: plans, and the public pages (pricing, terms,
 * privacy, refunds, contact, about) in a new tab — the editor itself has no
 * footer, and leaving it in the same tab would tear down the 3D view.
 */
export function HelpMenu() {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={wrap} style={{ display: 'contents' }}>
      <button className={`btn btn-ghost ${open ? 'btn-ghost-on' : ''}`} onClick={() => setOpen((o) => !o)} aria-expanded={open} title="Plans, help and policies">
        Help
      </button>
      {open && (
        <div className="popover help-menu" role="menu" aria-label="Help">
          <button
            className="btn btn-primary btn-block"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              openPricing();
            }}
          >
            Plans &amp; upgrade
          </button>
          <nav className="help-links">
            {FOOTER_LINKS.map(([route, label]) => (
              <a key={route} role="menuitem" href={siteUrl(route)} target="_blank" rel="noopener" onClick={() => setOpen(false)}>
                {label === 'Pricing' ? 'Pricing & FAQ' : label} <span aria-hidden>↗</span>
              </a>
            ))}
          </nav>
          <a className="help-mail" role="menuitem" href={`mailto:${BUSINESS.email}?subject=${encodeURIComponent('3xDezine — support')}`}>
            {BUSINESS.email}
          </a>
        </div>
      )}
    </div>
  );
}
