# 3xDezine — Android client

Kotlin + Jetpack Compose + SceneView/Filament client for the 3xDezine house-design
platform. Project list → photorealistic 3D walkthrough, with a material browser that
applies finishes live and a cost panel driven by `POST /api/cost/estimate`.

> ## ⚠️ READ THIS FIRST — THIS COMPILES, BUT IT HAS NEVER RUN
>
> As of the CI run that produced release tag `android-latest`, `:app:assembleDebug`
> **succeeds** and publishes a ~40 MB debug APK. Every API this code calls therefore
> resolves against SceneView 4.38.0 / Filament 1.72.1 / AGP 9.4.1 / Kotlin 2.4.20.
>
> **Nothing here has ever been on a device or an emulator.** Not one frame has been
> rendered, not one HTTP call made, not one material applied. Compiling is not working.
> [Unverified — needs a real device](#unverified--needs-a-real-device) is the honest
> list of what is still unknown, and it is long.
>
> There is also still no Gradle wrapper in the repo — CI provisions Gradle itself.

---

## Build

| | Version |
|---|---|
| JDK to **run Gradle** | **21** (Android Studio's bundled JBR is fine) |
| JDK **target** | 17 (`compileOptions` + `kotlin { jvmToolchain(17) }`) |
| Android Studio | **Otter (2025.2.x) or newer** — AGP 9.x needs a Studio that understands it. Narwhal/Ladybug will refuse to sync. |
| Gradle | 9.7.1 (wrapper, `-bin` distribution) |
| AGP | 9.4.1 |
| Kotlin | 2.4.20 |
| compileSdk / targetSdk / minSdk | 37 / 36 / 26 |
| Compose BOM | 2026.09.00 (→ material3 1.4.0) |
| SceneView | 4.38.0 (brings **Filament 1.72.1** transitively) |

### CI is the reference build

`.github/workflows/android.yml` builds `:app:assembleDebug` on `ubuntu-latest` with
JDK 21, a provisioned Gradle 9.7.1 and the runner's preinstalled Android SDK, then
publishes the APK to the rolling release tag `android-latest`:

<https://github.com/salimkt/3xdezine/releases/download/android-latest/3xdezine.apk>

Note on `compileSdk = 37`: `sdkmanager "platforms;android-37"` does **not** resolve —
the published packages are `android-37.0`, `android-37.1`, `android-37.2`. The runner
already ships them, so the build works; do not "fix" the workflow by pinning
`platforms;android-37`.

### The Gradle wrapper JAR is missing

`gradle/wrapper/gradle-wrapper.properties` is pinned to `gradle-9.7.1-bin.zip`, but
`gradle-wrapper.jar`, `gradlew` and `gradlew.bat` are **not** in the repo — they are
binaries/scripts that could not be produced without a JDK on the authoring machine.

Generate them once, either way:

```bash
# with a system Gradle >= 9
cd android && gradle wrapper --gradle-version 9.7.1 --distribution-type bin
```

or just open `android/` in Android Studio, which offers to create the wrapper on first
sync.

### First build

```bash
cd android
./gradlew :app:assembleDebug         # after generating the wrapper
./gradlew :app:installDebug
```

Install prerequisites: SDK Platform 37, Build-Tools for 37, and an emulator image at
API 34+ with **hardware GL** (Filament needs real OpenGL ES 3.0 — the software renderer
will either crash or run at one frame per second).

---

## Pointing the app at a backend

Two URLs are configurable at runtime, from the **Backend** button on either screen.
They are separate because in dev they are two different processes:

| Setting | Default | Serves |
|---|---|---|
| REST API base URL | `http://10.0.2.2:4000/api/` | everything in ARCHITECTURE.md > REST API |
| Static asset base URL | `http://10.0.2.2:5173/` | `/textures/manifest.json` and the PBR map sets |

### Emulator

`10.0.2.2` is the emulator's alias for the **host machine's loopback**, so the defaults
work as-is when `backend` is on `localhost:4000` and Vite on `localhost:5173`. Nothing to
change.

Alternative, if you prefer `localhost` inside the app:

```bash
adb reverse tcp:4000 tcp:4000
adb reverse tcp:5173 tcp:5173
# then set the URLs to http://localhost:4000/api/ and http://localhost:5173/
```

### Physical device

1. Put the phone and the dev machine on the same Wi-Fi.
2. Make the backend bind to `0.0.0.0`, not `127.0.0.1` — this is the single most common
   reason "it works on the emulator but not my phone".
   Vite: `npm run dev -- --host 0.0.0.0`.
3. Find the machine's LAN address (`ipconfig getifaddr en0` on macOS).
4. In the app: **Backend** → `http://192.168.x.y:4000/api/` and `http://192.168.x.y:5173/`.

Cleartext HTTP is allowed by `res/xml/network_security_config.xml`. It currently permits
cleartext for **all** hosts (`base-config`) so an arbitrary LAN IP works during
development. **Delete that `base-config` line before shipping anything**; the explicit
`domain-config` for `10.0.2.2` / `localhost` is what you actually want to keep.

### No backend at all

The app is fully demonstrable offline. `shared/catalog.seed.json` and
`shared/sample-project.json` are bundled verbatim in `app/src/main/assets/`, and every
remote call falls back to them. The UI says "Offline — using the bundled sample" rather
than pretending. Cost is then computed by the on-device `LocalCostEngine`, which is
labelled "offline estimate" in the cost panel.

To refresh the bundled copies after `shared/` changes:

```bash
cp shared/catalog.seed.json shared/sample-project.json \
   android/app/src/main/assets/
```

---

## What is implemented

### Data
- `data/model/Domain.kt` — `@Serializable` mirrors of **every** type in
  `shared/types.ts`, with JSON field names kept identical. Two Kotlin-side *type* renames
  only: `Unit` → `PricingUnit` (clashes with `kotlin.Unit`) and `Material` →
  `DesignMaterial` (clashes with `com.google.android.filament.Material`).
- `data/remote/ApiService.kt` — Retrofit 3 interface covering all twelve endpoints in
  ARCHITECTURE.md.
- `data/remote/Network.kt` — OkHttp 5 with a **256 MB disk cache** (the PBR texture sets
  are the real payload), kotlinx-serialization converter, configurable base URL.
- `data/DesignRepository.kt` — every call degrades to the bundled assets and reports
  which source the data came from, so "offline" is never silent.
- `cost/LocalCostEngine.kt` — an offline mirror of the backend cost engine, implementing
  the formulas in ARCHITECTURE.md verbatim (shoelace areas, ×2 for interior wall faces,
  litres = area × coats / coverage, pack-size rounding, two-stage buffering).

### Rendering
- `render/HouseBuilder.kt` — the shell is generated **at runtime** from the floor plan, so
  material changes never re-download geometry. Floors/ceilings are ear-clipped polygons;
  walls are real extruded boxes with thickness (never single-sided planes — that is the
  classic shadow-acne / peter-panning source), with door and window openings cut as
  genuine holes plus four reveal faces each.
- `render/Triangulator.kt` — ear clipping with hole bridging, on the XZ plane.
- `render/MeshBuilder.kt` — normals and **hand-written TANGENTS** (see below).
- `render/FilamentMesh.kt` — VertexBuffer/IndexBuffer/RenderableManager, and the
  matching `destroy()`.
- `render/MaterialFactory.kt` — one ubershader instance per catalog material, LRU-cached
  with eviction that never touches an in-use instance; PBR maps downsampled to 1K
  (a 2K set is ~64 MB per material uncompressed) and fetched from the asset server's
  manifest; graceful degradation to flat colour + PBR constants.
- `render/RenderTuning.kt` — PCSS shadows, SSR, TAA, SSAO, bloom, and an **AgX** tone
  mapper (Filament's default is ACESLegacy; AgX rolls off blown window highlights, which
  is the characteristic interior failure case, and matches the web client).
- `render/CameraRig.kt` — first-person walkthrough camera, pure trigonometry, plus the
  walk-mode field of view.
- `render/OrbitRig.kt` — overview camera: target, yaw, elevation, distance → pose.
  Framing, orbit, dolly and pan limits are all derived from the plan's bounding box.
- `render/CameraMath.kt` — shared pose type, shortest-arc interpolation, FOV ↔ focal
  length, screen rays, frustum fitting. Covered by `app/src/test` (JVM, runs in CI).
- `render/SceneController.kt` — owns every Filament resource this app creates, and frees
  all of it from a `DisposableEffect`.

### UI
- Project list with an offline banner and the catalog's `priceBasis` disclaimer.
- 3D walkthrough with two cameras — **Walk** (first person) and **Overview** (orbit
  the whole house from outside) — see [Controls](#controls).
- Material bottom sheet: pick a surface → pick a target (every floor, or just the
  kitchen) → pick a material. Applies live.
- Cost bottom sheet: itemised line items showing raw → buffered quantity and the wastage
  factor per line, both buffering stages separated, measured quantities, buffered total,
  and the "material supply only, no labour" disclaimer repeated.

---

## Controls

| Gesture / control | Walk | Overview |
|---|---|---|
| One-finger drag | Look around | Orbit the house (elevation clamped 3°–85°, never below ground) |
| Pinch | Zoom the lens: vertical FOV 30°–80°, starts at 46.4° (the camera never moves, so it cannot clip through a wall) | Dolly in/out, clamped between limits derived from the plan's size |
| Two-finger drag | — (ignored; two fingers only zoom) | Pan the orbit target across the floor |
| Double-tap | Ease the lens back to the default FOV | Zoom toward the tapped spot on the floor (distance ×0.5); tapping sky/lawn re-frames the house |
| Thumb-stick | Walk | Hidden |
| **−** / **+** | Ease the FOV out/in by ×1.4 | Ease the dolly out/in by ×1.4 |
| **Frame house** | Glide out to the overview, framed | Glide back to the framed three-quarter view |
| **Overview** / **Walk** (top bar) | Switch camera, eased | Switch camera, eased |
| Room chip | Glide to the room | Glide down into the room (switches to Walk) |

A pinch never also counts as a drag: once a second finger lands, the rest of that
gesture is pinch-only, including after one finger lifts. A new touch, button or stick
push cancels any camera animation in flight; cancelling a Walk ↔ Overview glide lands on
the destination camera.

**Framing** comes from the ground floor's bounding box (rooms and walls, padded by half
a wall thickness): a three-quarter view from the +X/+Z corner at 30° elevation, like the
web client's orbit default, pulled back until the bounding sphere fits the narrower of
the horizontal and vertical FOV — so portrait phones frame by width.

**Motion.** Camera moves run for 400 ms on `FastOutSlowInEasing` (no overshoot) and push
the pose and call `requestRender()` on every frame. The list ↔ walkthrough change is an
`AnimatedContent` cross-fade; the cost totals count to their new value on a reprice
(tabular figures) and each line item has an animated share-of-subtotal bar; the
material sheet resizes smoothly and the tapped card pulses; the loading overlay fades
out with a two-stage progress bar. With the system animator scale set to 0 (Developer
options, or Accessibility → Remove animations), everything — camera tweens included —
jumps to its end state.

**How zoom is applied.** Zoom is written as `cameraNode.focalLength` (Filament's lens
model: 24 mm sensor, vertical FOV = 2·atan(12 mm / f)), not with a one-off
`setProjection(fov, …)`. SceneView's `CameraNode` stores the focal length and calls
`updateProjection()` — which recomputes the aspect from the new viewport — on every
surface resize, so a direct `setProjection` would be silently replaced by the 28 mm
default the first time the phone rotated.

**Why the walkthrough never fades.** It renders into a SurfaceView (SceneView's default
and fastest surface), which composites behind the window and ignores Compose alpha and
scale. The project list is therefore always drawn above it: entering, the list fades
and scales away to reveal the 3D view; leaving, the list fades back in over it and the
walkthrough (and its Filament engine) is disposed once, when that finishes.

---

## Rendering decisions worth knowing about

### Tangents — we write the TANGENTS buffer ourselves

ARCHITECTURE.md's "tangent gotcha": SceneView's `normalToTangent` computes
`cross(+Y, normal)` and never looks at UVs. Correct for vertical walls; for floors and
ceilings (normal = ±Y) it hits a degenerate fallback with an arbitrary tangent basis, so
directional normal maps (plank grain, brick courses, herringbone) can light from the
wrong direction.

**We took the second option: `MeshBuilder` writes TANGENTS directly.** Tangents come
from the real UV derivatives (Lengyel's method), accumulated per vertex, Gram-Schmidt
orthogonalised against the geometric normal, with handedness recovered from the
accumulated bitangent, then packed to a quaternion following Filament's own
`packTangentFrame` convention (positive `w`, whole quaternion negated when the frame is
mirrored, `w` nudged off exactly zero).

The consequence is that **floor UVs did not have to be bent to suit a fallback basis** —
they stay honest world-space metres, which is also what makes the tiling maths below
physically correct.

### Texture tiling — baked into UV0, not `setBaseColorUvMatrix`

The brief specifies `setBaseColorUvMatrix(Mat3)` on the ubershader instance. **We did not
use it.** `HouseBuilder` emits UV0 in **metres**, and `SceneController` uploads a
UV-scaled copy (`uv × 1/tileSizeM`) whenever a surface's material changes. That is
numerically identical to a uniform-scale baseColor UV matrix and mirrors the web
client's `surface size ÷ tileSizeM`, but it only uses Filament APIs that this code
already depends on, instead of a SceneView extension function whose exact name and
signature could not be checked without a compiler.

A uniform positive UV scale does not change tangent direction or handedness, so the
TANGENTS quaternions are reused rather than recomputed.

**To switch to the Mat3 route**: set `[1/tile, 0, 0, 0, 1/tile, 0, 0, 0, 1]` on the
instance in `MaterialFactory` and stop calling `MeshData.withUvScale` in
`SceneController.applyMaterials`. It is a two-line change in one file.

### Polygon triangulation — ours, not `generateShape`

Same reasoning. `Triangulator` is ~200 lines of ear clipping with hole bridging and has
no external API surface to get wrong. Swap the body of `Triangulator.triangulate` for
SceneView's `generateShape(polygonPath, polygonHoles, …)` if you prefer; nothing else
depends on how the indices are produced.

### `RenderQuality.Cinematic` is not used

A `RenderQuality` preset re-applies in a `LaunchedEffect` and clobbers manual `view.*`
tweaks. Rather than set a preset and then race it, `RenderTuning` writes every relevant
setting explicitly, once, and nothing else touches `view.*`. If you reintroduce a preset,
apply it **first** and call `RenderTuning.apply` afterwards in the same effect.

### Render-on-demand

SceneView 4.38.0 renders on demand. Every mutation — material swap, texture landing,
camera step — is followed by `renderInvalidator.requestRender()`, and the invalidator is
passed to `SceneView(renderInvalidator = ...)` — without that it is never attached to the
view's frame gate and every request is silently dropped. `onFrame` cannot keep the loop awake,
so continuous movement runs from a `withFrameNanos` loop that invalidates each step, and
that loop only spins while the thumb-stick is deflected.

### IBL hitches, on purpose

`createHDREnvironment` decodes and prefilters the `.hdr` on the calling thread and will
visibly stall. A loading overlay stays up until it returns. The bundled
`assets/hdri/environment.hdr` is the smallest of the three in `web/public/hdri/`
(`kloofendal_43d_clear_puresky.hdr`, 4.6 MB, CC0 from Poly Haven).

The loaded `Environment` is held in Compose state and handed to
`SceneView(environment = ...)` rather than written onto the Filament `Scene` directly:
SceneView pushes its own `environment` parameter onto the scene, so a manual assignment
races the default empty one.

### Filament is never declared as a dependency

SceneView 4.38.0 pins Filament 1.72.1 and ships **precompiled** `.filamat` ubershaders
built against it. Filament 1.73/1.75/1.76/1.77 each carry a "Recompile Materials / New
Material Version" warning, so force-upgrading makes materials fail to load at runtime.
There is deliberately no `com.google.android.filament:*` entry in
`gradle/libs.versions.toml`. **Do not add one, and do not add a resolution strategy that
bumps it.**

### Other deliberate choices

- **OpenGL ES backend**, Filament's Android default. Vulkan is not forced. (A Vulkan
  debug toggle is a roadmap item, not implemented.)
- **The roof is priced but not rendered** — this is an interior walkthrough, and a roof
  over the camera just makes the scene black.
- **WINDOW openings are left open** (no glass mesh) so the IBL actually lights the
  interior through them. DOOR openings get a thin inset leaf.
- **Furniture is boxes at catalog dimensions**, not authored `.glb`. There are no `.glb`
  assets in this repo; gltfio via SceneView's `ModelLoader` is the intended upgrade.
- **No `androidx.navigation`** — two destinations and one dialog is a nullable field, not
  a back stack.
- **No dynamic colour.** This app's job is to show what a real material looks like;
  recolouring the chrome from the wallpaper is the wrong trade. Material 3 **Expressive
  is not used** — it is not stable.
- **ABIs limited to `arm64-v8a` and `armeabi-v7a`.** Filament ships four and the `.so`
  files are large.

---

## Verified by the build

`:app:assembleDebug` is green, so every API call in this module resolves and type-checks
against the real artifacts. Getting there took four corrections, all in the render path.
Each was checked against the published sources (`sceneview-4.38.0-sources.jar`,
`sceneview-core-4.38.0-sources.jar`, `filament-android-1.72.1-sources.jar`) rather than
guessed:

| Was | Actually is |
|---|---|
| `view.shadowType = View.ShadowType.PCSS` | Filament's `View` has `setShadowType(ShadowType)` and **no getter**, so Kotlin synthesises no property. Must be `view.setShadowType(View.ShadowType.PCSS)`. PCSS itself is fine and is still what we use. |
| `ToneMapper.AgX()` | The class is `ToneMapper.Agx` — lower-case `x`. The no-arg constructor exists (`AgxLook.NONE`). |
| `renderInvalidator()` | `rememberRenderInvalidator()` returns a `RenderInvalidator` **object**, not a function. Invalidate with `renderInvalidator.requestRender()`. |
| invalidator not passed to `SceneView` | `SceneView(renderInvalidator = ...)` is what attaches it to the frame gate. Without it every `requestRender()` is dropped and, because 4.38.0 defaults to `FrameRatePolicy.OnDemand`, the picture would have frozen after the first frame. This would have compiled and silently misbehaved. |

One further correction, made for correctness rather than to compile: the HDR environment
is now handed to `SceneView(environment = ...)` instead of being written onto the Filament
`Scene` by hand. SceneView pushes its own `environment` parameter onto the scene from a
`LaunchedEffect(scene, environment)`, so the manual assignment was racing the default
empty environment and could have been clobbered.

Everything the previous revision of this file listed as "medium risk Filament Java API
details" — the `View.*Options` classes and their `enabled` fields, `Texture.Builder`,
`TextureHelper.setBitmap(engine, texture, level, bitmap)`, the three-arg `TextureSampler`,
`Texture.InternalFormat.SRGB8_A8`, the `VertexBuffer`/`IndexBuffer`/`RenderableManager`
builders, `setMaterialInstanceAt` — is correct as written. So are the SceneView Compose
remembers, `materialLoader.createColorInstance(color =, metallic =, roughness =,
reflectance =)`, `io.github.sceneview.math.Color` (it is a `typealias` for `Float4`),
`cameraNode.position` / `.quaternion`, and
`environmentLoader.createHDREnvironment(assetFileLocation = ...)`.

**Nothing was degraded.** PCSS shadows, SSR, TAA, SSAO, bloom, AgX tone mapping and the
full texture/PBR path are all still in.

---

## Unverified — needs a real device

Nobody has run this. The build proves the code *resolves*; it proves nothing about what
appears on screen. In rough order of how likely each is to bite:

- **Whether anything renders at all.** The Engine/View/Renderer/Scene wiring, the
  surface lifecycle, and the interaction between our directly-created Filament entities
  and SceneView's own scene management are all untested.
- **Render-on-demand coverage.** Every mutation site we know about calls
  `renderInvalidator.requestRender()`. A missed one shows up as a frozen or stale
  picture, not as an error. If the scene looks stuck, the diagnostic is to switch to
  `SceneView(frameRatePolicy = FrameRatePolicy.Continuous())` — if that fixes it, an
  invalidation is missing, not the renderer.
- **The whole texture pipeline.** `MaterialFactory` *probes* sampler parameter names
  (`baseColorMap`, `baseColorTexture`, `albedoMap`, …) against
  `Material.hasParameter`, because which parameters SceneView's precompiled `.filamat`
  ubershaders expose is a runtime fact. If none match, materials render as flat colour +
  PBR constants and the app still works — but **PBR maps may simply never appear.** The
  fix, if so, is to source the instance from gltfio's ubershader (load a minimal glTF via
  `ModelLoader` and clone its `MaterialInstance`) rather than from
  `MaterialLoader.createColorInstance`.
- **Winding and normal directions.** Every quad's winding was derived by hand from cross
  products, with the derivation written out at each call site, but nobody has *seen* the
  scene. If surfaces are invisible from inside the house, a face is wound backwards.
- **Tangents.** `MeshBuilder` packs the TANGENTS quaternion following Filament's
  `packTangentFrame` convention. Wrong handedness shows up only as normal maps lighting
  from the wrong direction, which needs an eye on a device to spot.
- **Opening positions.** `t` is interpreted as 0..1 along the wall to the opening's
  *centre*. Visual check needed.
- **The interior/exterior face probe** in `HouseBuilder.buildWalls` tests a point 0.12 m
  outside each wall face against the room polygons. Untested on plans where rooms do not
  tile the footprint.
- **The IBL hitch.** `createHDREnvironment` decodes and prefilters on the calling thread.
  How long the loading overlay actually sits there is unmeasured.
- **Native lifetime.** Every Filament resource this app creates is freed from a
  `DisposableEffect`. Double-frees and use-after-free in Filament are native crashes, not
  exceptions; rotating the device and backing out of the walkthrough is the test.
- **Texture memory.** 1K downsampling plus a 16-entry LRU is a guess at a budget, not a
  measurement.
- **Every network path.** No REST call has ever been made from this app. The offline
  fallback to the bundled assets has never been exercised either.
- **`LocalCostEngine` totals** have not been checked against `shared/cost.test.ts` or the
  backend. Two documented approximations (roof footprint as the sum of room areas;
  overhang allowance as exterior-wall length × overhangM) may put it a few percent off.
- **Release build / R8.** Only `assembleDebug` is built in CI. `proguard-rules.pro` keeps
  Filament, SceneView, kotlinx-serialization and Retrofit, but only a real
  `assembleRelease` proves it.
- **Hardware GL requirement.** Filament needs real OpenGL ES 3.0; an emulator on the
  software renderer will crash or crawl.
- **Camera gestures and animation.** Only the maths is tested (`app/src/test`, run in
  CI). Whether drag/pinch/double-tap feel right, whether a stray third finger or a
  pinch that starts on a button misbehaves, how the right-edge controls interact with
  the system back gesture, and whether every animation frame actually reaches the
  screen under render-on-demand are all unobserved. If a camera glide looks like a
  jump, suspect a missed invalidation before suspecting the tween.
- **FOV through rotation.** Zoom relies on SceneView re-applying the stored focal
  length on resize (read from its source, not observed).
- **Screen transition.** The SurfaceView-under-the-list ordering is reasoned from how
  SurfaceView composites; a one-frame black flash on entering or a brief second Filament
  engine while re-opening during an exit are possible and unmeasured.
- **Tests are thin.** `CameraMath` and `OrbitRig` have JVM unit tests. `LocalCostEngine`
  and `Triangulator` are pure and testable but still have none.

---

## Not built (deliberate)

Per ARCHITECTURE.md's non-goals plus this slice's scope: multi-storey stairs, structural
validation, labour costing, collaboration, accounts. Also not built on Android
specifically: the `POST /api/suggestions` recommendation UI (the repository method
exists and is wired, but no screen consumes it), saving a project back to the backend
(`DesignRepository.saveProject` exists, unused), authored `.glb` furniture, KTX2/Basis
compressed textures, and the Vulkan debug toggle.
