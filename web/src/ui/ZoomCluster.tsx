import { IconFit, IconMinus, IconPlus } from './icons';

/**
 * The floating zoom control shared by the plan and the 3D viewport, so both
 * panes zoom the same way and look the same doing it.
 */
export function ZoomCluster({
  onZoomIn,
  onZoomOut,
  canZoomIn = true,
  canZoomOut = true,
  readout,
  onFit,
  fitLabel,
  fitTitle,
  zoomInTitle = 'Zoom in',
  zoomOutTitle = 'Zoom out',
  className = '',
}: {
  onZoomIn: () => void;
  onZoomOut: () => void;
  canZoomIn?: boolean;
  canZoomOut?: boolean;
  readout?: { label: string; title: string; onClick: () => void };
  onFit: () => void;
  fitLabel: string;
  fitTitle: string;
  zoomInTitle?: string;
  zoomOutTitle?: string;
  className?: string;
}) {
  return (
    <div
      className={`zoom-cluster ${className}`}
      role="toolbar"
      aria-label="Zoom"
      // The cluster floats over an interactive canvas: a press on it must not
      // also start a pan, a look-drag or a deselect underneath.
      onPointerDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="zoom-btn"
        onClick={onZoomOut}
        disabled={!canZoomOut}
        title={zoomOutTitle}
        aria-label={zoomOutTitle}
      >
        <IconMinus />
      </button>
      {readout && (
        <button
          type="button"
          className="zoom-readout mono"
          onClick={readout.onClick}
          title={readout.title}
          aria-label={readout.title}
        >
          {readout.label}
        </button>
      )}
      <button
        type="button"
        className="zoom-btn"
        onClick={onZoomIn}
        disabled={!canZoomIn}
        title={zoomInTitle}
        aria-label={zoomInTitle}
      >
        <IconPlus />
      </button>
      <span className="zoom-sep" aria-hidden />
      <button
        type="button"
        className="zoom-btn zoom-fit"
        onClick={onFit}
        title={fitTitle}
        aria-label={fitTitle}
      >
        <IconFit />
        <span>{fitLabel}</span>
      </button>
    </div>
  );
}
