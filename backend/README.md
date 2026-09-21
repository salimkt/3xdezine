# 3xDezine — backend

REST API for the 3xDezine house-design platform: the material catalog, the
cost engine, and the recommendation engine.

Fastify 5 + Zod 4 + Drizzle + Postgres 18, run directly from TypeScript with
`tsx`. Nothing is compiled or bundled; `tsc` is used only as a type checker.

---

## Setup

```bash
nvm use                      # Node 22.12 (see ../.nvmrc) — not Homebrew's 26
npm install

docker compose up -d         # from the REPO ROOT: Postgres 18 on host port 5433
npm run db:migrate           # apply drizzle/*.sql
npm run db:seed              # idempotent; safe to re-run

npm run dev                  # http://localhost:4000, watch mode
npm test                     # node:test via tsx
npm run typecheck            # tsc --noEmit
```

| Script | What it does |
|---|---|
| `dev` / `start` | Run the server on port 4000 (`dev` watches). |
| `db:generate` | Diff `src/db/schema.ts` and write a new migration into `drizzle/`. |
| `db:migrate` | Apply pending migrations. |
| `db:seed` | Load `shared/catalog.seed.json` + `shared/sample-project.json`. |
| `test` | Run every `src/**/*.test.ts`. |

Configuration is all environment, with dev defaults in `src/config.ts`:
`PORT` (4000), `HOST`, `DATABASE_URL`
(`postgresql://dezine:dezine@localhost:5433/dezine`), `LOG_LEVEL`, `NODE_ENV`.

Port **5433**, not 5432 — deliberately, so the container cannot collide with a
locally installed Postgres.

### Importing the shared contract

There is no npm workspace linking `backend/` to `shared/`. The contract is
imported by relative path with its real extension:

```ts
import { estimateCost } from '../../shared/cost.ts';
import type { Project } from '../../shared/types.ts';
```

That needs `allowImportingTsExtensions`, `verbatimModuleSyntax`,
`module: nodenext` and `noEmit` in `tsconfig.json`, and it only runs under
`tsx`. All of it is funnelled through `src/shared.ts` so the relative depth is
written down exactly once.

The cost engine is **imported, never reimplemented**. `POST /api/cost/estimate`
is a thin wrapper around `estimateCost()` from `shared/cost.ts` — the same
function the web client calls locally — which is the only way the two can be
guaranteed not to disagree about a number someone might spend money against.

---

## Endpoints

Base path `/api`. Errors always use the `ApiError` shape from
`shared/types.ts`: `{ error, message, details? }`.

| Method | Path | Body → Response |
|---|---|---|
| `GET` | `/health` | → `{ status, version, db }` |
| `GET` | `/catalog` | → `Catalog` |
| `GET` | `/materials` | query `category, surface, tier, style, maxPrice, q` → `Material[]` |
| `GET` | `/materials/:id` | → `Material` |
| `GET` | `/components` | → `ComponentProduct[]` |
| `GET` | `/styles` | → `StylePreset[]` |
| `POST` | `/cost/estimate` | `Project` → `CostBreakdown` |
| `POST` | `/suggestions` | `SuggestionRequest` → `SuggestionResponse` |
| `GET` | `/projects` | → `ProjectSummary[]` |
| `POST` | `/projects` | `Project` → `Project` (201, with `id`) |
| `GET` | `/projects/:id` | → `Project` |
| `PUT` | `/projects/:id` | `Project` → `Project` |
| `DELETE` | `/projects/:id` | → `204` |

- **OpenAPI 3.1**: `GET /openapi.json`
- **Docs (Scalar)**: `GET /docs`

Every request and response is declared once as a Zod schema in
`src/schemas.ts` and wired through `fastify-type-provider-zod`, so validation,
response serialization and the OpenAPI document all come from that single
declaration. Zod 4 emits JSON Schema natively — there is no
`zod-to-openapi` shim. `z.date()` has no JSON Schema representation, so
timestamps cross the boundary as `z.iso.datetime()` strings.

`src/schemas.ts` ends with a block of `Conforms<Contract, Inferred>` type
aliases. They emit nothing at runtime and exist purely so that `tsc` fails if a
schema drifts from `shared/types.ts`.

Filters on `/materials` hit real indexed columns, not a JSON blob:
`surface` and `style` use Postgres array operators against GIN indexes
(`@>` and `&&` respectively), `q` is a case-insensitive match over name,
description and subtype. `style` accepts either a bare tag (`warm`) or a
`StylePreset` id (`modern-warm`), which expands to that preset's tag set.

---

## Data model

Four tables: `materials`, `components`, `style_presets`, `projects`
(`src/db/schema.ts`, migrations in `drizzle/`).

The split between columns and JSON is deliberate:

- **The catalog is relational where it is queried.** `category`, `tier`,
  `price_per_unit`, `applicable_surfaces` (`text[]`) and `style_tags`
  (`text[]`) are real, indexed columns because they drive `/materials`.
  Sub-objects only ever read whole — `color`, `texture`, `pbr` — stay `jsonb`.
- **Project geometry is a document.** `projects.data` is `jsonb` holding
  `{ floors, roof }`. It is always written and read as a unit, never filtered
  on, and its shape is owned by `shared/types.ts`. Shredding walls, rooms and
  openings into tables would buy nothing and would create a second, drifting
  copy of the contract.
- **Project ids are `uuidv7()`**, native in Postgres 18. Time-ordered, so index
  locality is good and rows sort by creation without a sequence.
- **`Catalog.meta`** (currency, price basis, the scoring legend) is static
  configuration shipped with the contract, so it is read from the seed file
  rather than shredded into a table.

The seeder inserts with `ON CONFLICT DO NOTHING` and never updates. Re-running
it is a no-op, and it cannot silently overwrite something edited through the
API. To pick up a changed catalog, reset the volume (`npm run db:reset` at the
repo root) and seed again.

### Pack sizes

`shared/catalog.seed.json` carries `packSize` / `packLabel` on the sixteen
materials genuinely sold in discrete increments — tile by the box
(1.25–1.44 m²), flooring and cladding by the pack (1.5–2.22 m²), paint in 5 L
and 10 L cans, shingles by the bundle. Render, plaster, polished concrete and
carpet are sold by continuous measure and carry neither.

The cost engine rounds the *buffered* quantity up to a whole number of packs,
in that order. Rounding to packs before adding wastage would under-order.

---

## Cost engine

Delegated entirely to `shared/cost.ts`; see ARCHITECTURE.md > Cost engine for
the quantity formulas. The two things worth repeating at the API boundary:

```
bufferedQuantity = roundUpToPacks(rawQuantity × (1 + material.wastageFactor))
materialsSubtotal = Σ (bufferedQuantity × pricePerUnit)
total             = materialsSubtotal × (1 + project.contingencyBuffer)
```

Both buffers are reported separately so the UI can explain them, and the scope
is **material supply only** — no labour, delivery or tax.

---

## Recommendation engine

`src/suggest.ts`. Pure: `suggest(request, catalog)` does no I/O.

Two rules shape it.

**Gates are not scores.** A material whose `applicableSurfaces` does not
include the surface is removed before any scoring and reported under
`exclusions` with a reason. Folding a hard constraint into a weighted sum makes
it possible for an attractive wall tile to out-rank an actual floor.

**Every score decomposes.** Each term is independently normalised to [0,1] and
kept on the candidate, so `reason` is generated from whichever terms actually
drove the ranking, and `breakdown` is returned for the UI.

### Colour: OKLCH, not HSL

HSL's hue is an artefact of the sRGB cube. Equal hue steps are not equal
perceptual steps and `L` is not perceptual lightness, so an HSL
"complementary" pair often is not one. OKLCH is perceptually uniform, which is
what lets a fixed 18° tolerance mean the same thing at every hue. Colour work
uses `culori`; look-alike distance is Euclidean in **Oklab**.

### AESTHETIC

Each term is [0,1]; the weights sum to 1.

```
Harmony  = exp(-(Δh / 18°)²)

           Δh = circular distance from the NEAREST harmony target of the
           anchor hue — complementary +180, analogous ±30, triadic ±120,
           monochrome +0. Gaussian, not a step: 19° off should score almost
           the same as 18°, because that is how it looks.

StyleFit = |m.styleTags ∩ style.styleTags| / |style.styleTags|
Tone     = clamp(|m.L − anchor.L| / 0.45, 0, 1)        # tonal SEPARATION
Chroma   = 1 − clamp(|m.C − anchor.C| / 0.20, 0, 1)    # chroma AGREEMENT
Aesth    = m.aestheticScore / 5

score = 0.35·Harmony + 0.30·StyleFit + 0.15·Tone + 0.10·Chroma + 0.10·Aesth
```

The **anchor** is the user's `current` material for that surface; failing that,
the style preset's `recommended` material; failing that, the first palette
swatch. Greys have no hue and pair with everything, so an achromatic anchor or
candidate short-circuits `Harmony` to a fixed, deliberately un-decisive `0.8`
rather than inventing an angle.

Whether the anchor is the user's own choice matters beyond wording: only a
user's choice can be *replaced*, so `replaces`, `estimatedSavings` and the
"cheaper look-alike" test are all suppressed when the anchor came from a style
preset.

### COST_EFFICIENCY

```
EffPrice = pricePerUnit × (1 + wastageFactor)           # per pricing unit
EffPerM² = EffPrice × unitsPerSqm(m)                    # per m² of finished surface
Quality  = 0.45·(durability/5) + 0.30·(aesthetic/5) + 0.25·(sustainability/5)
value    = Quality / normLog(EffPerM²)
score    = clamp(value × 0.4, 0, 1)
```

Three decisions are doing the work here:

- **Wastage is in the price.** A tile with 12% wastage costs 12% more than the
  shelf price to cover the same square metre. That is the comparison the user
  actually wants.
- **Everything is converted to cost per m² of finished surface.**
  `unitsPerSqm` is `coats / coveragePerUnit` for `LITER` materials and 1
  otherwise. A litre of emulsion at $11 covers 11 m² over two coats, so it is
  about $2.10 per m², not "cheaper than a $34 tile by a factor of three".
  Ranking on `pricePerUnit` alone silently compares litres with square metres
  and gets every paint-versus-tile question backwards.
- **`normLog` is min-maxed over the category-wide population, not the filtered
  result set.** Normalising over the result set means the same material scores
  0.9 in one query and 0.4 in another purely because an unrelated filter
  changed the min and max. Users read that as a bug, and they are right to.
  Prices are logged first because material price distributions are strongly
  right-skewed — one $165 marble beside a cluster at $26–46 would otherwise
  squash the whole cluster into the bottom few percent.

`normLog` maps into `[0.4, 1]` rather than `[0, 1]`. The floor stops the
cheapest material in a category dividing by zero, and it fixes the dynamic
range: at equal quality the cheapest material is worth 2.5× the dearest. The
final rescale is by that same fixed constant, **not** a min-max over the
candidates — min-maxing the value itself pins the best member of every category
at exactly 1.0, which makes a cheap tile and a cheap plank indistinguishable
and makes the number meaningless across categories.

### BALANCED

```
score = 0.5 · aesthetic + 0.5 · costEfficiency
```

### Cheaper look-alikes

When `current` supplies a material for the surface, a candidate is a cheaper
look-alike when all three hold:

- Oklab ΔE from the current material ≤ **0.06**
- durability at most **1** point below it
- strictly cheaper effective price per m²

The threshold is calibrated against the seed catalog: oak hardwood to oak
laminate is ΔE 0.009 and to strand-woven bamboo 0.039 (both genuine
look-alikes), while oak to polished concrete is 0.096 and to wool carpet 0.114
— visibly different materials that a looser window would wrongly pair. Oak
laminate is *excluded* by the durability gate despite being a near-perfect
colour match, because recommending a 3/5 laminate as a substitute for 5/5
hardwood is the advice that gets a floor replaced in five years. It is still
offered, just argued on price rather than on likeness.

`estimatedSavings` and `estimatedSavingsPct` are reported per m² of covered
surface, so they stay true across units.

### Budget

With both `project` and `budget`, the engine prices the top pick per surface,
then greedily swaps in cheaper still-ranked options — largest saving first —
until the projection fits or it runs out of moves. Greedy deliberately: an
exact knapsack would be slower and no more defensible, because the scores it
optimises are themselves estimates. `note` always says which way the total
moved and whether the cap was met.

### Reasons

`reason` is assembled from the top three contributing terms by weight, joined
with `·`. "Cheaper" alone is not a reason — a money claim always names what it
is cheaper *than*, by how much, and what it costs on the other axes:

```
Reads as the same colour as your european oak hardwood · 37% cheaper per m²
covered for 1 point less durability · matches 4 of 4 'modern warm' tags
```

```
Hue sits 33° from the coastal mediterranean white render / stucco (analogous) ·
matches 2 of 4 'coastal mediterranean' tags · gives strong light/dark contrast
```

A candidate that *is* the anchor would compare perfectly with itself, which
says nothing, so it is named for what it is instead:
`The coastal mediterranean palette's own pick for this surface · …`

All tunable constants live in one exported `TUNING` object at the top of
`src/suggest.ts`, and the tests assert against it rather than restating the
numbers.

---

## Tests

`node:test` run through `tsx`, matching `shared/cost.test.ts`.

- `src/suggest.test.ts` — colour primitives, every scoring term, the
  category-wide normalisation property, gating, look-alikes, budget trimming,
  determinism. No database.
- `src/routes.test.ts` — schema validation, the OpenAPI document (including
  that every `$ref` resolves), and every endpoint via `app.inject()`.

Tests needing Postgres are gated on a reachability probe and **skip** with a
reason rather than fail, so `npm test` is green without Docker running:

```
ok 4 - catalog endpoints # SKIP Postgres is not reachable on localhost:5433 …
```

---

## Layout

```
src/
  app.ts            Fastify factory: plugins, OpenAPI, error handler, routes
  server.ts         Binds port 4000, graceful shutdown
  config.ts         Env with dev defaults
  schemas.ts        Zod mirrors of shared/types.ts + contract conformance checks
  shared.ts         The single relative-path bridge to ../../shared
  suggest.ts        Recommendation engine (pure)
  repo.ts           Queries and row → domain mappers
  db/
    schema.ts       Drizzle tables
    client.ts       Lazy postgres-js pool, health probe
    seed.ts         Idempotent seeder
  routes/           health, catalog, cost, suggestions, projects
drizzle/            Generated SQL migrations (committed)
```
