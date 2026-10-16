/**
 * Turns an uploaded logo into a data URL of at most 64 KB (decoded), so it
 * can live inside the studio profile — no asset hosting. Raster images are
 * redrawn on a canvas at a letterhead-sized resolution, PNG first (keeps
 * transparency), then JPEG at falling quality on a white ground.
 */

export const LOGO_MAX_BYTES = 64 * 1024;

export function dataUrlBytes(url: string): number {
  const comma = url.indexOf(',');
  const body = url.slice(comma + 1);
  if (!/;base64,/.test(url.slice(0, comma + 1))) return decodeURIComponent(body).length;
  const pad = body.endsWith('==') ? 2 : body.endsWith('=') ? 1 : 0;
  return Math.floor((body.length * 3) / 4) - pad;
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('Couldn’t read that file.'));
    r.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('That file isn’t an image this browser can read.'));
    img.src = src;
  });
}

export async function downscaleLogo(file: File): Promise<string> {
  if (!/^image\//.test(file.type)) throw new Error('Choose a PNG, JPEG or SVG image.');
  const original = await readAsDataUrl(file);
  // A small SVG is already ideal: sharp at any size and tiny.
  if (file.type === 'image/svg+xml' && dataUrlBytes(original) <= LOGO_MAX_BYTES) return original;

  const img = await loadImage(original);
  const w0 = img.naturalWidth || 400;
  const h0 = img.naturalHeight || 200;
  for (const maxSide of [480, 360, 260, 180]) {
    const k = Math.min(1, maxSide / Math.max(w0, h0));
    const w = Math.max(1, Math.round(w0 * k));
    const h = Math.max(1, Math.round(h0 * k));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('This browser can’t resize images.');
    ctx.drawImage(img, 0, 0, w, h);
    const png = canvas.toDataURL('image/png');
    if (dataUrlBytes(png) <= LOGO_MAX_BYTES) return png;
    ctx.globalCompositeOperation = 'destination-over';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    for (const q of [0.9, 0.8, 0.7, 0.6]) {
      const jpg = canvas.toDataURL('image/jpeg', q);
      if (dataUrlBytes(jpg) <= LOGO_MAX_BYTES) return jpg;
    }
  }
  throw new Error('That logo is too detailed to fit in 64 KB. Try a simpler or smaller image.');
}
