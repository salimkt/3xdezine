# 3xDezine — Architecture

A house/interior design platform: draw a floor plan in 2D, walk it in photorealistic
3D, apply real building materials, and get a live, buffered material cost plus
material suggestions tuned for looks or for value.

Three clients, one contract:

```
                    ┌────────────────────────────┐
                    │  backend/  Node + Postgres │
                    │  catalog · cost · suggest  │
                    └─────────────┬──────────────┘
                          REST/JSON│
                  ┌────────────────┴───────────────┐
                  │                                │
        ┌─────────▼──────────┐          ┌──────────▼─────────┐
        │ web/  React + R3F  │          │ android/  Compose  │
        │ three.js WebGPU    │          │ SceneView/Filament │
        │ 2D plan → 3D walk  │          │ native 3D viewer   │
        └────────────────────┘          └────────────────────┘
                  │                                │
                  └───────► shared/types.ts ◄──────┘
                        (Kotlin mirrors it)
```

## Repository layout

| Path | Contents |
|---|---|
| `shared/types.ts` | The domain contract. Backend and web import it; Android mirrors it as `@Serializable` data classes. |
| `shared/catalog.seed.json` | 24 materials, 8 components, 5 style presets. Seeds the database. |
| `shared/sample-project.json` | An 80 m² five-room apartment used as demo content and as a test fixture. |
| `scripts/fetch-assets.mjs` | Downloads CC0 PBR texture sets + HDRIs. Writes `web/public/textures/manifest.json`. |
| `backend/` | REST API, cost engine, recommendation engine, Postgres schema + migrations. |
| `web/` | Vite + React 19 + React Three Fiber client. |
| `android/` | Kotlin + Jetpack Compose + SceneView client. |

## Conventions

These are not negotiable across clients, because breaking them means the two
renderers disagree about the same house:

- **Units are metres.** Areas are m². Money is a decimal number in the project currency.
- **The floor plane is XZ, Y is up.** Matches glTF and three.js, so nothing needs
  axis-flipping between web and Filament.
- **Room polygons are closed loops** with the first point *not* repeated.
- **Opening position `t` is 0..1 along the wall** from `start` to `end`, measured to
  the opening's centre.
- **Texture tiling is driven by `texture.tileSizeM`** — the real-world size of one
  repeat. Both renderers compute UV scale from surface dimensions ÷ tileSizeM. This
  is what stops a 1 m² tile texture looking like wallpaper on a 4 m wall.

---

## Toolchain

Node **22.12** (see `.nvmrc`). Not Homebrew's 26 — Vite 8 and gltf-transform predate it
and nothing here is validated against Node 26.

```bash
nvm use            # 22.12
docker compose up -d   # Postgres 18 on host port 5433
```

Port 5433 deliberately avoids colliding with a locally-installed Postgres on 5432.

---

## Web client

Verified current as of 2026-09-21.

| Package | Version | Why pinned |
|---|---|---|
| `three` | 0.186.0 | r186 dropped the `(wip)` marker from the WebGPU examples. ESM-only; no CJS build. |
| `@react-three/fiber` | 9.7.0 | Peer range caps React at `<19.3`. |
| `react` / `react-dom` | **19.2.8** | **React 19.3 breaks R3F** — it ships `scheduler@0.28` while R3F's reconciler pins `^0.27`, giving two schedulers under one renderer. Enforced via `overrides`. |
| `@react-three/drei` | 10.7.8 | Geometry/controls/loaders only — see below. |
| `vite` | 8.3.0 | Requires Node `^20.19 \|\| >=22.12`. |
| `typescript` | 5.9.3 | TS 7.0 is GA and much faster but has no stable programmatic compiler API until 7.1, which blocks typescript-eslint. Revisit at 7.1. |

**Renderer: WebGPU first, WebGL2 as a degradation tier.** `WebGPURenderer` from
`three/webgpu`, node materials from `three/tsl`. The same `MeshPhysicalNodeMaterial`
compiles to GLSL on the WebGL2 backend, so there is one material codebase.
`renderer.init()` is async — the scene must sit behind `<Suspense>`.

**Post-processing does not use `@react-three/postprocessing`.** That library and
`pmndrs/postprocessing` drive `WebGLRenderer` internals directly and cannot run on a
WebGPU canvas. We use three.js's own `PostProcessing` class composed from TSL nodes in
`three/addons/tsl/display/*`. This is the single biggest architectural consequence of
choosing WebGPU, and it is why the effect stack is hand-wired rather than declarative.

**Photorealism stack for interiors:**

- **IBL** — HDRI via `RGBELoader`, `ImportanceSampledEnvironment` under WebGPU.
- **Tone mapping** — `AgXToneMapping` as the default; it handles blown-out window
  highlights gracefully, which is the characteristic interior failure case. Expose
  `NeutralToneMapping` as a "material-accurate" mode, because a user who picks a
  specific marble expects to see *that* marble. Avoid ACES Filmic as a default; it
  desaturates.
- **AO** — `GTAONode` (better in corners than SSAO), on top of baked AO maps.
- **Bounce light** — `SSGINode`. The biggest single realism win for interiors.
- **Reflections** — `SSRNode` for floors. Note drei's `MeshReflectorMaterial` is broken
  under WebGPU and was closed as "not planned".
- **AA** — `TRAANode`, falling back to `SMAANode`.
- **Windows** — `RectAreaLight` (its WebGPU registration API changed: import from
  addons and call `renderer.library.addLight()`). RectAreaLights cast no shadows, so
  pair each with a shadow-casting light.
- **Shadows** — r186's `SunLight` with cascaded shadow maps.

**Known shadow trap:** extruded floor plans produce long thin wall geometry, which is
a classic source of shadow acne and peter-panning. Walls must be built with real
thickness — never single-sided planes — and `normalBias` scaled to wall thickness.

**A "Render" button** for a final still is a roadmap item, deliberately isolated behind
an interface. `three-gpu-pathtracer@0.0.24` is the obvious candidate but is pre-1.0,
WebGL-only (so it needs a second renderer), and has had no code commits since March
2026. The cheaper first move is to accumulate ~256 frames of the existing WebGPU
pipeline with SSAA + high-sample SSGI, which needs no second material system.

### Texture memory is the binding constraint

Not polygon count. A 4K albedo+normal+ARM set is roughly 130 MB of VRAM *per material*;
twenty materials will crash a tab. Mitigations, in order of importance:

1. Fetch at **1K** by default (`scripts/fetch-assets.mjs --res 1K`, ~120 MB for the
   full catalog; 2K is ~380 MB).
2. Cache materials by ID so ten oak walls share one GPU texture.
3. Tile via `texture.repeat` / `KHR_texture_transform`, never by duplicating textures.
4. `texture.dispose()` on material swap.
5. KTX2/Basis compression is the real fix and stays compressed in VRAM — a follow-up,
   since it needs the `toktx` binary in the pipeline.

---

## Android client

Verified current as of 2026-09-21.

| | Version |
|---|---|
| SceneView | 4.38.0 |
| Filament | **1.72.1, transitively via SceneView** |
| AGP / Gradle / Kotlin | 9.4.1 / 9.7.1 / 2.4.20 |
| compileSdk / targetSdk / minSdk | 37 / 36 / 26 |
| Compose BOM | 2026.09.00 (material3 → 1.4.0) |
| Retrofit / OkHttp / kotlinx-serialization | 3.0.0 / 5.5.0 / 1.11.0 |

**Never declare a Filament dependency alongside SceneView.** SceneView ships
*precompiled* `.filamat` ubershaders built against Filament 1.72.1, and releases
1.73/1.75/1.76/1.77 each carry a "Recompile Materials / New Material Version" warning.
Force-upgrading Filament makes materials fail to load at runtime.

**AGP 9 breaks older build scripts** in ways that matter here:
- Do **not** apply `org.jetbrains.kotlin.android` — AGP 9 removed support for it and
  built-in Kotlin is on by default.
- `android { kotlinOptions { } }` is gone; use top-level `kotlin { compilerOptions { } }`.
- `namespace` must be set explicitly.
- Set `targetSdk` explicitly or you silently inherit compileSdk 37.

**Backend: OpenGL ES, not Vulkan.** GL is Filament's default and battle-tested path on
Android; Vulkan is still seeing device-specific fixes. Offer Vulkan as a debug toggle.

**Geometry:** build the shell at runtime, load contents as glTF. SceneView's
`generateShape(polygonPath, polygonHoles, …)` wraps Earcut triangulation *with holes* —
exactly the floor/ceiling operation — and `generateExtrude` handles skirting and door
frames. Furniture stays authored `.glb` loaded via gltfio. Runtime shell generation is
what makes material swaps instant instead of a re-download.

**Tangent gotcha:** SceneView's `normalToTangent` computes `cross(+Y, normal)` and never
looks at UVs. For vertical walls that is correct. For floors and ceilings (normal = ±Y)
it hits a degenerate fallback with an arbitrary tangent basis, so directional normal
maps — plank grain, brick courses, herringbone — can light from the wrong direction.
Either orient floor UVs to the fallback basis or write the `TANGENTS` buffer directly.

**Texture tiling** is `setBaseColorUvMatrix(Mat3)` on the ubershader instance, derived
from surface size ÷ `tileSizeM`, mirroring the web client.

Filament photorealism knobs SceneView's `RenderQuality` presets do *not* cover, and that
we set on `view.*` directly: SSR, TAA, `ShadowType.PCSS`, DoF, fog, vignette. Note a
preset change clobbers manual tweaks, since presets re-apply in a `LaunchedEffect`.

---

## Backend

Verified current as of 2026-09-21.

| Package | Version | Why |
|---|---|---|
| `fastify` | 5.12.5 | Schema-first: one Zod declaration drives validation, response serialization *and* the OpenAPI doc. |
| `zod` | 4.6.5 | Zod 4 has native `z.toJSONSchema()`, so no `zod-to-openapi` shim. |
| `fastify-type-provider-zod` | 7.0.0 | Peers cap at Fastify 5 — another reason not to jump to the Fastify 6 alpha. |
| `drizzle-orm` / `drizzle-kit` | 0.45.3 / 0.31.11 | Relational API for catalog CRUD, raw parameterised SQL for the analytical paths, without leaving the type system. |
| `postgres` | 3.4.9 | postgres.js — faster than `pg`, native pipelining. |
| `culori` | 4.0.2 | OKLCH colour work for the recommender. |

**The Android client is what shapes this.** A Kotlin client cannot consume tRPC — its
"type safety" is TypeScript inference over a TS import, with no wire schema to generate
from. So OpenAPI 3.1 is the deliverable, which rules out tRPC and makes Hono's RPC mode
irrelevant. Once OpenAPI is the contract, Fastify's schema pipeline is the best fit
rather than a compromise.

**Three majors are in flight — pin exactly, no carets.** Drizzle has a 1.0-rc that moves
relational queries to a new API, Prisma 8 GA is imminent, and Fastify 6 is in alpha and
unsupported by the Zod type provider.

**No pgvector.** A "style embedding" would be a lossy re-encoding of style tags we
already have structured, cosine similarity over it is strictly worse than querying the
tags, and — decisively — it destroys explainability. "Cosine similarity 0.87" is not a
reason a user can act on. The catalog is thousands of rows, not millions, so a scored
full scan is sub-millisecond. The one genuinely vector-shaped part, colour similarity,
is 3-dimensional OKLab and needs no ANN index. Revisit only for collaborative filtering
on real interaction data, or image embeddings of textures.

## Pricing data

**No free API anywhere gives absolute per-m² material prices.** Government sources
publish *indices only*; every commercial source with real prices is sales-gated. The
seeded figures are therefore researched indicative estimates, labelled as such in
`catalog.meta.priceBasis`, and the UI must repeat that caveat.

The path to defensible numbers, in order of effort:

1. **Curated price bands** per material class × tier, stored as `{low, mid, high}` with a
   currency and an `as_of` date. Show the band, not a point value — false precision in a
   cost tool invites "your prices are wrong" as a credibility problem.
2. **Escalate monthly from a free index.** US BLS PPI is public domain and redistributable
   (`WPU1344` clay tile, `WPU062101` architectural coatings, `WPU08120401` hardwood
   flooring, `WPU1361` asphalt roofing). Per-class escalation matters: Aug-2020→Aug-2026,
   paint rose 51.8% while tile rose 14.7%, so a single CPI factor would be badly wrong.
3. **For INR, anchor to CPWD DAR** (Delhi Analysis of Rates), which decomposes each item
   into material quantities and rates — government-blessed and free, though PDF only. The
   **Maharashtra PWD SSR 2022-23 spreadsheet** is the one genuinely machine-readable
   Indian source found: a `Material Rates` sheet of ~2,300 priced line items with units,
   ex-GST.

**Currency is a catalog partition, not a display transform.** Indian material prices are
not US prices times an FX rate — the markets differ structurally in tile pricing, labour
bundling and product availability. If INR is needed, curate native INR bands rather than
converting. Note the Indian trade convention is per sq ft; store per m² and convert at
the presentation edge only, never store both.

## REST API

Base path `/api`. JSON in, JSON out. Errors use `ApiError` from `shared/types.ts`.
Zod schemas generate an OpenAPI 3.1 document at `/openapi.json`, browsable at `/docs`,
from which the Kotlin and TypeScript clients can both be generated.

| Method | Path | Body → Response |
|---|---|---|
| `GET` | `/health` | → `{ status, version, db }` |
| `GET` | `/catalog` | → `Catalog` — one call for clients that want everything |
| `GET` | `/materials` | query `category, surface, tier, style, maxPrice, q` → `Material[]` |
| `GET` | `/materials/:id` | → `Material` |
| `GET` | `/components` | → `ComponentProduct[]` |
| `GET` | `/styles` | → `StylePreset[]` |
| `POST` | `/cost/estimate` | `Project` → `CostBreakdown` |
| `POST` | `/suggestions` | `SuggestionRequest` → `SuggestionResponse` |
| `GET` | `/projects` | → `Project[]` (summaries) |
| `POST` | `/projects` | `Project` → `Project` with `id` |
| `GET` | `/projects/:id` | → `Project` |
| `PUT` | `/projects/:id` | `Project` → `Project` |
| `DELETE` | `/projects/:id` | → `204` |

Cost estimation is a `POST` of the whole project rather than a lookup by id, so the web
client can price an unsaved design on every edit. It must be pure and fast.

Dev: backend on **4000**, web on **5173** with Vite proxying `/api` → `localhost:4000`.

---

## Cost engine

Deterministic and pure. Given a `Project`, it must return the same `CostBreakdown`
every time — it is called on every edit, and it is the number a user might actually
spend money against.

**Quantities**

```
floorArea(room)    = shoelaceArea(room.polygon)
ceilingArea(room)  = floorArea(room)

wallLength(w)      = |w.end - w.start|
grossFace(w)       = wallLength(w) * w.heightM
openings(w)        = Σ (o.widthM * o.heightM) for o where o.wallId == w.id
netFace(w)         = max(0, grossFace(w) - openings(w))

interior wall  → interiorMaterialId applied to netFace × 2   (both sides)
exterior wall  → interiorMaterialId applied to netFace × 1
                 exteriorMaterialId applied to netFace × 1

roofArea           = FLAT      : footprint
                     GABLE/HIP : footprint / cos(pitchDeg) + overhang allowance
```

**Unit conversion.** For `unit: LITER` materials (paint):

```
litres = area × coatsRecommended / coveragePerUnit
```

**Buffering — the two-stage margin.** This is the "a bit buffered" requirement, and the
two stages are deliberately separate so the UI can explain them:

```
bufferedQuantity = roundUp(rawQuantity × (1 + material.wastageFactor))
subtotal         = bufferedQuantity × material.pricePerUnit

materialsSubtotal = Σ subtotal                      // per-material cutting waste
contingencyAmount = materialsSubtotal × project.contingencyBuffer
total             = materialsSubtotal + contingencyAmount
```

`wastageFactor` is per-material physical waste — offcuts, breakage, pattern matching —
so tile (10–12%) carries more than sheet goods (5%). `contingencyBuffer` is one
project-wide commercial margin, default 8%.

**`roundUp` respects pack sizes.** Tile ships by the box, paint by the can, flooring by
the pack. Quoting 23.4 m² of tile that comes in 1.44 m² boxes is wrong — you buy 17
boxes, so 24.48 m². Materials carrying `packSize` round up to a whole number of packs;
`EACH` rounds to whole items; anything genuinely sold by continuous measure rounds to
2 dp. **Order matters**: wastage is applied *before* pack rounding, never after, or the
order comes up short. Getting this wrong is reportedly the most common source of
"your estimate was wrong" complaints in estimating tools.

Money is handled as rounded decimal at each line rather than integer minor units. For
an *estimator* summing tens of lines that is well within tolerance, and the test suite
asserts line items reconcile to the subtotal. If this ever becomes an invoicing path
rather than an estimating one, move to integer minor units first.

**Scope:** material supply only. No labour, delivery or tax. The catalog says so in
`meta.priceBasis`, and the UI must repeat it — a cost tool that silently omits labour
is worse than no cost tool.

---

## Recommendation engine

Returns ranked `SuggestionItem`s, each carrying a plain-language `reason` and a
`breakdown` of component scores. Explainability is a hard requirement: "cheaper" is
not useful advice, "same durability and visually close, 34% less" is.

Three modes: `AESTHETIC`, `COST_EFFICIENCY`, `BALANCED`. Scoring detail and the colour
harmony approach are specified in `backend/README.md`.

---

## Asset pipeline

```bash
node scripts/fetch-assets.mjs --res 1K          # whole catalog, ~120 MB
node scripts/fetch-assets.mjs --only oak-hardwood --force
```

Sources are **ambientCG** (PBR material maps) and **Poly Haven** (HDRIs), both CC0 1.0 —
commercial use and redistribution permitted, no attribution required. All 24 materials
are pinned to verified asset IDs; the keyword search is only a fallback for a retired
ID, and a material with no maps degrades to its flat colour plus PBR constants rather
than breaking the scene.

Two things learned by testing the APIs rather than assuming:
- ambientCG returns `assets[].id` (not `foundAssets[].assetId`), and download URLs come
  from its `downloads[]` array so resolution availability is checked, not guessed.
- Its `q` search is effectively single-keyword: `"cedar wood siding"` returns nothing
  while `"siding"` returns 13 results.

Normal maps are taken as **NormalGL** (OpenGL, green-up), which is what three.js and
Filament expect. Taking NormalDX would invert lighting on every bump.

---

## Deliberate non-goals for this slice

Multi-storey stairs, structural/code validation, labour costing, real-time
collaboration, and user accounts. The data model leaves room for each — `Floor.level`
exists, `Project` has timestamps — but none are built.
