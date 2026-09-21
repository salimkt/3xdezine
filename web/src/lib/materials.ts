import * as THREE from 'three/webgpu';
import type { Material } from '@shared/types';

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

// ---------------------------------------------------------------------------
// Texture cache
// ---------------------------------------------------------------------------

const textureLoader = new THREE.TextureLoader();
const textureCache = new Map<string, THREE.Texture>();

function loadTexture(rawUrl: string, srgb: boolean): THREE.Texture {
  const url = assetUrl(rawUrl);
  const key = `${url}|${srgb ? 'srgb' : 'linear'}`;
  const cached = textureCache.get(key);
  if (cached) return cached;

  const texture = textureLoader.load(url, undefined, undefined, () => {
    // A missing map must never break the scene — the material keeps its flat
    // catalog colour and PBR constants.
    console.warn(`[3xDezine] texture unavailable, falling back to flat colour: ${url}`);
  });
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.anisotropy = 8;
  textureCache.set(key, texture);
  return texture;
}

// ---------------------------------------------------------------------------
// Material cache
// ---------------------------------------------------------------------------

interface CacheEntry {
  material: THREE.MeshPhysicalNodeMaterial;
  ownedTextures: THREE.Texture[];
}

const materialCache = new Map<string, CacheEntry>();

/** A lightly greyed stand-in for a surface with no material assigned yet. */
export const UNASSIGNED_KEY = '__unassigned__';

function effectiveTileSize(material: Material, entry?: TextureManifestEntry): number {
  const tile = entry?.tileSizeM ?? material.texture?.tileSizeM ?? 1;
  return tile > 0 ? tile : 1;
}

/**
 * Returns a cached `MeshPhysicalNodeMaterial` for a catalog material.
 *
 * Cached by material id, so ten oak walls share one GPU texture set. Texture
 * VRAM, not polygon count, is the binding constraint here.
 *
 * Geometry UVs are authored in metres, so real-world tiling is simply
 * `repeat = 1 / tileSizeM`.
 */
export function getMaterial(
  material: Material | undefined,
  manifest: TextureManifest,
  variant = '',
): THREE.MeshPhysicalNodeMaterial {
  const key = material ? `${material.id}${variant}` : UNASSIGNED_KEY + variant;
  const cached = materialCache.get(key);
  if (cached) return cached.material;

  const node = new THREE.MeshPhysicalNodeMaterial();
  const owned: THREE.Texture[] = [];

  if (!material) {
    node.color = new THREE.Color('#9aa0a6');
    node.roughness = 0.8;
    node.metalness = 0;
  } else {
    node.color = new THREE.Color(material.color.hex);
    node.roughness = material.pbr?.roughness ?? 0.7;
    node.metalness = material.pbr?.metalness ?? 0;

    const entry = manifest.materials[material.id];
    const repeat = 1 / effectiveTileSize(material, entry);

    if (entry?.maps) {
      const apply = (texture: THREE.Texture) => {
        texture.repeat.set(repeat, repeat);
        owned.push(texture);
        return texture;
      };
      if (entry.maps.color) {
        node.map = apply(loadTexture(entry.maps.color, true));
        // A real albedo map already carries the colour; tinting it doubles up.
        node.color = new THREE.Color('#ffffff');
      }
      if (entry.maps.normal) {
        node.normalMap = apply(loadTexture(entry.maps.normal, false));
        node.normalScale = new THREE.Vector2(1, 1);
      }
      if (entry.maps.roughness) node.roughnessMap = apply(loadTexture(entry.maps.roughness, false));
      if (entry.maps.ao) node.aoMap = apply(loadTexture(entry.maps.ao, false));
    }

    // A few catalog cues the flat-colour fallback would otherwise lose.
    if (material.category === 'TILE') node.clearcoat = 0.25;
    if (material.finish === 'gloss' || material.finish === 'polished') {
      node.clearcoat = 0.6;
      node.clearcoatRoughness = 0.15;
    }
  }

  node.side = THREE.FrontSide;
  materialCache.set(key, { material: node, ownedTextures: owned });
  return node;
}

/** Glass for windows. Single instance, reused everywhere. */
let glassMaterial: THREE.MeshPhysicalNodeMaterial | null = null;
export function getGlassMaterial(): THREE.MeshPhysicalNodeMaterial {
  if (!glassMaterial) {
    glassMaterial = new THREE.MeshPhysicalNodeMaterial();
    glassMaterial.color = new THREE.Color('#dfe8ee');
    glassMaterial.roughness = 0.05;
    glassMaterial.metalness = 0;
    glassMaterial.transmission = 0.92;
    glassMaterial.thickness = 0.01;
    glassMaterial.ior = 1.5;
    glassMaterial.transparent = true;
    glassMaterial.opacity = 0.35;
    glassMaterial.side = THREE.DoubleSide;
  }
  return glassMaterial;
}

const simpleCache = new Map<string, THREE.MeshPhysicalNodeMaterial>();

/** Ad-hoc material for parametric furniture and joinery, cached by its inputs. */
export function getSimpleMaterial(
  hex: string,
  roughness = 0.7,
  metalness = 0,
): THREE.MeshPhysicalNodeMaterial {
  const key = `${hex}|${roughness}|${metalness}`;
  const cached = simpleCache.get(key);
  if (cached) return cached;
  const node = new THREE.MeshPhysicalNodeMaterial();
  node.color = new THREE.Color(hex);
  node.roughness = roughness;
  node.metalness = metalness;
  simpleCache.set(key, node);
  return node;
}

/**
 * Drops cached materials that nothing in the scene references any more, and
 * disposes their textures. Called after each scene rebuild.
 */
export function pruneMaterialCache(liveKeys: Set<string>): number {
  let freed = 0;
  for (const [key, entry] of materialCache) {
    if (liveKeys.has(key)) continue;
    for (const texture of entry.ownedTextures) {
      // Only dispose a texture no surviving material still holds.
      const stillUsed = [...materialCache].some(
        ([k, e]) => k !== key && liveKeys.has(k) && e.ownedTextures.includes(texture),
      );
      if (!stillUsed) {
        texture.dispose();
        for (const [cacheKey, cached] of textureCache) {
          if (cached === texture) textureCache.delete(cacheKey);
        }
      }
    }
    entry.material.dispose();
    materialCache.delete(key);
    freed++;
  }
  return freed;
}

export function materialCacheSize(): number {
  return materialCache.size;
}

export function textureCacheSize(): number {
  return textureCache.size;
}
