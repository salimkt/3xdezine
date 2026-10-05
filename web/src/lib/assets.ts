/**
 * Asset URLs and the texture manifest, without three.js — the shell (home
 * screen, mobile landing) needs these before the renderer chunk has loaded.
 */

export interface TextureManifestEntry {
  source: string;
  sourceId: string;
  license: string;
  tileSizeM: number;
  maps: Partial<Record<'color' | 'normal' | 'roughness' | 'ao', string>>;
}

export interface HdriEntry {
  id: string;
  label: string;
  url: string;
}

export interface TextureManifest {
  generatedAt: string;
  resolution: string;
  materials: Record<string, TextureManifestEntry>;
  hdris: HdriEntry[];
}

export const EMPTY_MANIFEST: TextureManifest = {
  generatedAt: '',
  resolution: '',
  materials: {},
  hdris: [
    { id: 'brown_photostudio_02', label: 'Soft interior', url: '/hdri/brown_photostudio_02.hdr' },
    {
      id: 'kloofendal_43d_clear_puresky',
      label: 'Clear day (exterior)',
      url: '/hdri/kloofendal_43d_clear_puresky.hdr',
    },
    { id: 'studio_small_09', label: 'Neutral studio', url: '/hdri/studio_small_09.hdr' },
  ],
};

/**
 * Resolves a root-relative asset path against the deployment base.
 *
 * GitHub Pages serves this from a subpath, so a hard-coded `/textures/...`
 * would 404 there while working fine in dev. Every texture and HDRI URL must
 * go through here. Absolute URLs are passed straight back.
 */
export function assetUrl(path: string): string {
  if (/^(https?:)?\/\//.test(path) || path.startsWith('data:')) return path;
  const base = import.meta.env.BASE_URL || '/';
  return `${base.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
}

let manifestPromise: Promise<TextureManifest> | null = null;

export function loadTextureManifest(): Promise<TextureManifest> {
  if (!manifestPromise) {
    manifestPromise = fetch(assetUrl('/textures/manifest.json'))
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((json: TextureManifest) => ({
        ...json,
        materials: json.materials ?? {},
        hdris: json.hdris?.length ? json.hdris : EMPTY_MANIFEST.hdris,
      }))
      .catch(() => EMPTY_MANIFEST);
  }
  return manifestPromise;
}
