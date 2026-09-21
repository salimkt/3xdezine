# 3xDezine

A house and interior design platform. Draw a floor plan in 2D, walk it in photorealistic
3D, apply real building materials, and get a live, buffered material cost plus material
suggestions tuned either for looks or for value.

**[Live demo →](https://salimkt.github.io/3xdezine/)**

The demo is the web client running standalone. GitHub Pages serves static files only, so
the API is not available there: the catalog, the 3D renderer and live costing all work
from bundled data, while the suggestions panel shows its offline state. Run the backend
locally to get suggestions.

---

## What it does

- **2D floor-plan editor** — rooms, walls, doors and windows on a snapping metric grid.
  Drag a corner and every wall and room sharing it follows.
- **Photorealistic 3D** — WebGPU via three.js r186, with image-based lighting, AgX tone
  mapping, ground-truth ambient occlusion, screen-space global illumination and
  reflections, and temporal anti-aliasing. Falls back to WebGL2.
- **Real materials** — 24 building materials with colour, CC0 PBR texture sets, pricing,
  wastage factors, pack sizes and durability/sustainability/aesthetic ratings.
- **Live buffered costing** — measures every surface, converts to purchasable units
  (paint to litres, tile to boxes), applies per-material wastage and a project-wide
  contingency, and itemises the result. Recomputes on every edit.
- **Material suggestions** — three modes. *Aesthetic* scores colour harmony in OKLCH
  against the chosen style. *Cost efficiency* finds cheaper look-alikes with comparable
  durability. *Balanced* splits the difference. Every suggestion carries a plain-language
  reason, never just a score.
- **Native Android client** — Jetpack Compose + Filament, sharing the same backend.

## Repository

| Path | What |
|---|---|
| `shared/` | The domain contract, seed catalog and cost engine. Backend and web import it; Android mirrors it. |
| `backend/` | Fastify + Drizzle + PostgreSQL 18. Catalog, cost and recommendation APIs, with a generated OpenAPI 3.1 spec. |
| `web/` | React 19 + React Three Fiber + Vite. |
| `android/` | Kotlin + Jetpack Compose + SceneView/Filament. |
| `scripts/` | CC0 texture and HDRI fetcher. |
| `docs/` | Pricing sources and provenance. |

[`ARCHITECTURE.md`](ARCHITECTURE.md) covers the design decisions and the reasoning behind
them.

## Quick start

Requires Node 22.12 (see `.nvmrc`) and Docker.

```bash
nvm use
npm install

# Database
docker compose up -d

# Backend — http://localhost:4000, docs at /docs
cd backend && npm install && npm run db:migrate && npm run db:seed && npm run dev

# Web — http://localhost:5173
cd web && npm install && npm run dev
```

Textures and HDRIs are committed, so the app renders fully on a fresh clone. To refetch
or change resolution:

```bash
node scripts/fetch-assets.mjs --res 1K      # or 2K
```

The Android client needs Android Studio and a JDK; see [`android/README.md`](android/README.md).

## Costing, honestly

The cost engine is pure and deterministic, and covered by tests. The **prices are not**.

Prices are in INR, material supply only, ex-GST, excluding labour, delivery and tax. Of
the 24 materials, 3 are direct line items from the Maharashtra PWD Schedule of Rates
2022-23, 9 are derived from it with a documented adjustment, and the rest — mostly
imported and finish goods — are educated estimates from published retail ranges. Every
figure and its provenance is listed in [`docs/pricing-sources.md`](docs/pricing-sources.md).

No free API anywhere publishes absolute per-m² material prices; government sources give
indices only and commercial feeds are sales-gated. So treat the totals as a
well-structured estimate, not a quote, and replace the catalog with a supplier feed
before anyone spends money against it.

## Status

A working vertical slice, not a finished product. Known gaps:

- The roof is costed and selectable but not modelled in 3D — a gable would hide the
  interior, which is the part worth looking at.
- Single storey. `Floor.level` exists; stairs and multi-floor editing do not.
- `RectAreaLight` window lighting is not wired up (its WebGPU registration needs LTC
  texture setup), so windows light the room via the HDRI and sun rather than as emissive
  panels.
- 22 of 24 materials have PBR texture sets; the remainder render as flat colour with
  correct roughness and metalness.
- The Android client is written and cross-checked but **has never been compiled** — it
  was built on a machine with no JDK or Android SDK. Treat it as a strong starting point,
  not a shipping app. `android/README.md` lists exactly what is unverified.
- No authentication, no multi-user, no labour costing.

## Licence and attribution

Material textures are from [ambientCG](https://ambientcg.com) and HDRI environments from
[Poly Haven](https://polyhaven.com), both CC0 1.0 — public domain, no attribution
required. They are credited here because it is the decent thing to do, not because it is
demanded.
