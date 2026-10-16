import { useEffect, useRef, useState } from 'react';
import { ApkLink, INSTALL_NOTE } from './AndroidApp';
import { IconAndroid, IconInfo } from './icons';

// Its own module so the desktop menu ships with the studio chunk, not the shell.

/** Desktop affordance: a quiet icon button in the top bar with a popover. */
export function AndroidMenu() {
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
      <button
        className={`btn btn-ghost ${open ? 'btn-ghost-on' : ''}`}
        onClick={() => setOpen((o) => !o)}
        title="Get 3xDezine for Android"
        aria-expanded={open}
      >
        <IconAndroid size={14} />
        Android
      </button>

      {open && (
        <div className="popover apk-menu" role="dialog" aria-label="3xDezine for Android">
          <h3>3xDezine for Android</h3>
          <p>
            Review plans, finishes and the live estimate on site. Installed from a signed APK
            published straight from CI.
          </p>
          <ApkLink />
          <p className="apk-fineprint">
            <IconInfo size={13} />
            <span>{INSTALL_NOTE}</span>
          </p>
        </div>
      )}
    </div>
  );
}
