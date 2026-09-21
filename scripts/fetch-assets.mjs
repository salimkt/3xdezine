#!/usr/bin/env node
/**
 * Fetches CC0 PBR texture sets and HDRI environment maps for the 3xDezine
 * material catalog.
 *
 *   node scripts/fetch-assets.mjs [--res 1K|2K|4K] [--only <materialId>] [--force]
 *
 * Sources (both CC0 1.0 — commercial use and redistribution permitted, no
 * attribution required):
 *   - ambientCG   https://ambientcg.com/api/v3/assets   (PBR material maps)
 *   - Poly Haven  https://api.polyhaven.com             (HDRI environments)
 *
 * Output:
 *   web/public/textures/<materialId>/{color,normal,roughness,ao}.jpg
 *   web/public/hdri/<name>.hdr
 *   web/public/textures/manifest.json
 *
 * The manifest is what the renderer actually reads, so a material with no
 * downloaded maps simply falls back to its flat colour + PBR constants rather
 * than breaking the scene.
 */

import { mkdir, writeFile, readFile, rm, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const CATALOG = join(ROOT, 'shared', 'catalog.seed.json');
const TEX_DIR = join(ROOT, 'web', 'public', 'textures');
const HDRI_DIR = join(ROOT, 'web', 'public', 'hdri');
const CACHE_DIR = join(ROOT, 'assets', 'cache');

const ACG_API = 'https://ambientcg.com/api/v3/assets';
const PH_API = 'https://api.polyhaven.com';

/**
 * Pinned ambientCG asset IDs, verified to exist against the v3 API.
 * Materials absent from this map are resolved at runtime by searching the API
 * with the catalog's `texture.assetHint`, so nothing here is load-bearing —
 * a wrong or retired ID degrades to a search, then to flat colour.
 */
const PINNED = {
  'oak-hardwood': 'WoodFloor051',
  'laminate-oak': 'WoodFloor064',
  'bamboo-floor': 'WoodFloor070',
  'wood-plank-ceiling': 'WoodFloor043',
  'wood-panel-walnut': 'WoodFloor040',
  'polished-concrete': 'Concrete034',
  'carpet-loop-beige': 'Carpet016',
  'cedar-cladding': 'WoodSiding008',
  'metal-standing-seam': 'CorrugatedSteel009',
  'fiber-cement-siding': 'Concrete046',
  'ceramic-tile-grey': 'Tiles141',
  'subway-tile-white': 'Tiles139',
  'marble-carrara': 'Marble012',
  'exposed-brick': 'Bricks104',
  'brick-veneer-red': 'Bricks097',
  'stucco-white': 'Plaster001',
  'venetian-plaster': 'PaintedPlaster017',
  'gypsum-ceiling': 'PaintedPlaster017',
  'paint-white-matte': 'PaintedPlaster017',
  'paint-warm-grey': 'PaintedPlaster017',
  'paint-sage': 'PaintedPlaster017',
  'paint-navy': 'PaintedPlaster017',
  'asphalt-shingle': 'RoofingTiles013A',
  'clay-tile-roof': 'RoofingTiles014A',
};

/** HDRIs for image-based lighting. Poly Haven slugs. */
const HDRIS = [
  { id: 'kloofendal_43d_clear_puresky', res: '2k', label: 'Clear day (exterior)' },
  { id: 'studio_small_09', res: '2k', label: 'Neutral studio (material preview)' },
  { id: 'brown_photostudio_02', res: '2k', label: 'Soft interior' },
];

/**
 * ambientCG packs each zip with a predictable filename convention:
 *   <Id>_<Res>-JPG_Color.jpg, _NormalGL.jpg, _Roughness.jpg, _AmbientOcclusion.jpg
 * We deliberately take NormalGL (OpenGL, green-up) — three.js expects that
 * convention, and taking NormalDX would invert lighting on every bump.
 */
const MAP_SUFFIXES = {
  color: ['Color'],
  normal: ['NormalGL'],
  roughness: ['Roughness'],
  ao: ['AmbientOcclusion'],
};

// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : (args[i + 1] ?? true);
};
const RES = String(flag('res', '1K')).toUpperCase();
const ONLY = flag('only', null);
const FORCE = args.includes('--force');

if (!['1K', '2K', '4K'].includes(RES)) {
  console.error(`Invalid --res "${RES}". Use 1K, 2K or 4K.`);
  process.exit(1);
}

const log = (...m) => console.log(...m);
const warn = (...m) => console.warn('  !', ...m);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * ambientCG rate-limits a burst of sequential requests with `508 Loop Detected`.
 * Twenty-four back-to-back lookups will lose about half the catalog, so back off
 * and retry rather than treating a throttle as a missing asset.
 */
async function getJson(url, attempt = 0) {
  const res = await fetch(url, { headers: { 'User-Agent': '3xDezine/0.1 asset-fetcher' } });
  if (res.status === 508 || res.status === 429 || res.status >= 500) {
    if (attempt < 4) {
      const wait = 2000 * 2 ** attempt;
      warn(`${res.status} from API, backing off ${wait / 1000}s...`);
      await sleep(wait);
      return getJson(url, attempt + 1);
    }
  }
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

async function download(url, dest) {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: { 'User-Agent': '3xDezine/0.1 asset-fetcher' },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, buf);
  return buf.length;
}

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/**
 * Resolve a catalog material to an ambientCG asset id.
 *
 * Every catalog material is pinned above, so the search below is only a safety
 * net for when a pinned id is retired. Note the API's `q` is effectively a
 * single-keyword match — "cedar wood siding" returns nothing while "siding"
 * returns 13 results — so we probe one keyword at a time, longest first.
 */
async function resolveAcgId(material) {
  if (PINNED[material.id]) return PINNED[material.id];

  const keywords = material.texture.assetHint
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .sort((a, b) => b.length - a.length);

  for (const word of keywords) {
    try {
      const data = await getJson(
        `${ACG_API}?type=Material&q=${encodeURIComponent(word)}&limit=1&sort=popular`,
      );
      const hit = data?.assets?.[0]?.id;
      if (hit) {
        log(`  resolved "${material.texture.assetHint}" via "${word}" -> ${hit}`);
        return hit;
      }
    } catch (err) {
      warn(`search "${word}" failed for ${material.id}: ${err.message}`);
    }
  }
  return null;
}

/** Ask the API for the real download URL rather than hand-building one. */
async function resolveDownload(acgId, res) {
  const data = await getJson(`${ACG_API}?id=${encodeURIComponent(acgId)}&include=downloads`);
  const asset = data?.assets?.[0];
  if (!asset) throw new Error(`asset ${acgId} not found`);
  const want = `${res}-JPG`;
  const dl = (asset.downloads ?? []).find((d) => d.attributes === want);
  if (!dl?.url) {
    const available = (asset.downloads ?? []).map((d) => d.attributes).join(', ');
    throw new Error(`${acgId} has no ${want} (available: ${available || 'none'})`);
  }
  return { url: dl.url, size: dl.size ?? 0 };
}

/** Rebuild the manifest entry for a material whose maps are already on disk. */
async function mapsFromDisk(material) {
  const outDir = join(TEX_DIR, material.id);
  const maps = {};
  for (const kind of Object.keys(MAP_SUFFIXES)) {
    if (existsSync(join(outDir, `${kind}.jpg`))) {
      maps[kind] = `/textures/${material.id}/${kind}.jpg`;
    }
  }
  return maps;
}

async function fetchMaterial(material) {
  const outDir = join(TEX_DIR, material.id);
  if (!FORCE && existsSync(join(outDir, 'color.jpg'))) {
    // Must still return the maps: a cache hit that reported nothing would be
    // silently dropped from the manifest and render as flat colour despite the
    // textures sitting right there on disk.
    const maps = await mapsFromDisk(material);
    log(`  ${material.id}: already present (${Object.keys(maps).join(', ')})`);
    return { cached: true, acgId: PINNED[material.id] ?? null, maps, bytes: 0 };
  }

  const acgId = await resolveAcgId(material);
  if (!acgId) {
    warn(`${material.id}: no texture source found, will render as flat colour`);
    return null;
  }

  const zipPath = join(CACHE_DIR, `${acgId}_${RES}-JPG.zip`);

  let bytes = 0;
  if (FORCE || !existsSync(zipPath)) {
    const { url, size } = await resolveDownload(acgId, RES);
    log(`  ${material.id}: downloading ${acgId} @ ${RES} (${mb(size)})...`);
    bytes = await download(url, zipPath);
  } else {
    bytes = (await stat(zipPath)).size;
    log(`  ${material.id}: using cached zip ${acgId} (${mb(bytes)})`);
  }

  // macOS/Linux ship unzip; avoids pulling a zip library into the toolchain.
  const extractDir = join(CACHE_DIR, `${acgId}_${RES}`);
  await rm(extractDir, { recursive: true, force: true });
  await mkdir(extractDir, { recursive: true });
  await execFileAsync('unzip', ['-qo', zipPath, '-d', extractDir]);

  const files = await readdir(extractDir);
  const maps = {};
  await mkdir(outDir, { recursive: true });

  for (const [kind, suffixes] of Object.entries(MAP_SUFFIXES)) {
    const match = files.find((f) =>
      suffixes.some((s) => f.toLowerCase().endsWith(`_${s.toLowerCase()}.jpg`)),
    );
    if (!match) continue;
    const src = join(extractDir, match);
    const dst = join(outDir, `${kind}.jpg`);
    await writeFile(dst, await readFile(src));
    maps[kind] = `/textures/${material.id}/${kind}.jpg`;
  }

  await rm(extractDir, { recursive: true, force: true });

  if (!maps.color) {
    warn(`${material.id}: zip had no Color map (${files.length} files), flat colour fallback`);
    return null;
  }
  log(`  ${material.id}: ok (${Object.keys(maps).join(', ')})`);
  return { acgId, maps, bytes };
}

async function fetchHdris() {
  log('\nHDRI environments (Poly Haven):');
  const out = [];
  for (const { id, res, label } of HDRIS) {
    const dest = join(HDRI_DIR, `${id}.hdr`);
    if (!FORCE && existsSync(dest)) {
      log(`  ${id}: already present, skipping`);
      out.push({ id, label, url: `/hdri/${id}.hdr` });
      continue;
    }
    try {
      const files = await getJson(`${PH_API}/files/${id}`);
      const url = files?.hdri?.[res]?.hdr?.url;
      if (!url) {
        warn(`${id}: no ${res} hdr in API response`);
        continue;
      }
      const bytes = await download(url, dest);
      log(`  ${id}: ok (${mb(bytes)})`);
      out.push({ id, label, url: `/hdri/${id}.hdr` });
    } catch (err) {
      warn(`${id}: ${err.message}`);
    }
  }
  return out;
}

async function main() {
  const catalog = JSON.parse(await readFile(CATALOG, 'utf8'));
  const materials = ONLY
    ? catalog.materials.filter((m) => m.id === ONLY)
    : catalog.materials;

  if (materials.length === 0) {
    console.error(`No material matched --only ${ONLY}`);
    process.exit(1);
  }

  await mkdir(CACHE_DIR, { recursive: true });
  await mkdir(TEX_DIR, { recursive: true });
  await mkdir(HDRI_DIR, { recursive: true });

  log(`Fetching ${materials.length} material(s) at ${RES} from ambientCG (CC0)...\n`);

  const manifest = { generatedAt: new Date().toISOString(), resolution: RES, materials: {}, hdris: [] };
  let total = 0;
  let ok = 0;

  for (const material of materials) {
    try {
      const result = await fetchMaterial(material);
      // Be a good citizen: ambientCG is run by one person and pays for the
      // bandwidth. Pace real fetches; cache hits cost them nothing.
      if (result && !result.cached) await sleep(1500);
      if (result?.maps) {
        manifest.materials[material.id] = {
          source: 'ambientCG',
          sourceId: result.acgId,
          license: 'CC0-1.0',
          tileSizeM: material.texture.tileSizeM,
          maps: result.maps,
        };
        total += result.bytes ?? 0;
        ok += 1;
      }
    } catch (err) {
      warn(`${material.id}: ${err.message}`);
    }
  }

  manifest.hdris = await fetchHdris();

  await writeFile(
    join(TEX_DIR, 'manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
  );

  log(`\nDone. ${ok}/${materials.length} materials textured, ~${mb(total)} downloaded.`);
  log(`Manifest: web/public/textures/manifest.json`);
  if (ok < materials.length) {
    log(`${materials.length - ok} material(s) will render with flat colour + PBR constants.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
