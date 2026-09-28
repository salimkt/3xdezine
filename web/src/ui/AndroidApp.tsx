import { useEffect, useRef, useState } from 'react';
import { assetUrl } from '../lib/materials';
import { IconAndroid, IconDownload, IconInfo } from './icons';

/**
 * Rolling release asset. It is built by CI and may legitimately not exist yet —
 * nothing here probes it, waits on it, or changes layout depending on it, so a
 * 404 costs the user one wasted tap and never makes the app look broken.
 *
 * Routed through `assetUrl` like every other asset URL; absolute URLs come back
 * unchanged, so this keeps working if the release ever moves to our own origin.
 */
export const APK_URL = assetUrl(
  'https://github.com/salimkt/3xdezine/releases/download/android-latest/3xdezine.apk',
);

const INSTALL_NOTE =
  'Android will ask for permission to install apps from your browser — that prompt is expected, not an error.';

const DISMISS_KEY = 'dezine.mobile-gate.dismissed';

/** True on phone-sized viewports, kept live so a rotation is handled. */
export function useHandheld(): boolean {
  const [handheld, setHandheld] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 860px)').matches,
  );
  useEffect(() => {
    const query = window.matchMedia('(max-width: 860px)');
    const update = () => setHandheld(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return handheld;
}

function ApkLink({ className = 'btn btn-primary btn-block' }: { className?: string }) {
  return (
    <a
      className={`apk-link ${className}`}
      href={APK_URL}
      target="_blank"
      rel="noopener noreferrer"
      download
    >
      <IconDownload size={14} />
      Download the Android app
    </a>
  );
}

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

/**
 * Phone landing. A precision drafting tool is the wrong thing to hand a 390px
 * touch screen, so lead with the app — but never trap anyone: the web build
 * stays one tap away and the choice survives the session.
 */
export function MobileGate({ projectName }: { projectName: string }) {
  const handheld = useHandheld();
  const [dismissed, setDismissed] = useState(() => {
    try {
      return sessionStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      return false;
    }
  });

  if (!handheld || dismissed) return null;

  const dismiss = () => {
    try {
      sessionStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* private mode — the choice just does not persist */
    }
    setDismissed(true);
  };

  return (
    <div className="mobile-gate">
      <div className="brand">
        <span className="brand-mark">3×</span>
        <span className="brand-text">
          Dezine
          <small>{projectName}</small>
        </span>
      </div>

      <div className="mobile-hero">
        <h1>
          The studio is built
          <br />
          for a big screen.
        </h1>
        <p>
          3xDezine draws floor plans, renders them in real time and prices every surface as you
          work. On a phone, the Android app is the better tool.
        </p>
        <ul className="mobile-points">
          <li>
            <i />
            Plans, finishes and the live estimate
          </li>
          <li>
            <i />
            Works on site without a laptop
          </li>
          <li>
            <i />
            Same catalogue, same rupee pricing
          </li>
        </ul>
      </div>

      <div className="mobile-actions">
        <ApkLink className="btn btn-apk btn-block" />
        <p className="apk-fineprint" style={{ borderTop: 0, paddingTop: 0 }}>
          <IconInfo size={13} />
          <span>{INSTALL_NOTE}</span>
        </p>
        <button className="mobile-continue" onClick={dismiss}>
          Continue to the web studio anyway
        </button>
      </div>
    </div>
  );
}
