# 3xDezine — Android client

Kotlin + Jetpack Compose + SceneView/Filament client for the 3xDezine house-design
platform. Project list → photorealistic 3D walkthrough, with a material browser that
applies finishes live and a cost panel driven by `POST /api/cost/estimate`.

> ## ⚠️ READ THIS FIRST — THIS CODE HAS NEVER BEEN COMPILED
>
> It was written on a machine with **no JDK and no Android SDK**. Every file has been
> re-read and cross-checked by hand, but *nothing here has been through a compiler, a
> linker, an emulator or a device.* Do not treat "it is written" as "it builds".
>
> The section [Unverified — needs a real build](#unverified--needs-a-real-build) lists
> every API call that could not be checked, ranked by how likely it is to break, with
> the fix for each. Expect to spend a session getting a first green build.

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
- `render/CameraRig.kt` — first-person walkthrough camera, pure trigonometry.
- `render/SceneController.kt` — owns every Filament resource this app creates, and frees
  all of it from a `DisposableEffect`.

### UI
- Project list with an offline banner and the catalog's `priceBasis` disclaimer.
- 3D walkthrough: drag to look, thumb-stick to walk, room chips to teleport, raise/lower
  eye height.
- Material bottom sheet: pick a surface → pick a target (every floor, or just the
  kitchen) → pick a material. Applies live.
- Cost bottom sheet: itemised line items showing raw → buffered quantity and the wastage
  factor per line, both buffering stages separated, measured quantities, buffered total,
  and the "material supply only, no labour" disclaimer repeated.

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
camera step — is followed by `renderInvalidator()`. `onFrame` cannot keep the loop awake,
so continuous movement runs from a `withFrameNanos` loop that invalidates each step, and
that loop only spins while the thumb-stick is deflected.

### IBL hitches, on purpose

`createHDREnvironment` decodes and prefilters the `.hdr` on the calling thread and will
visibly stall. A loading overlay stays up until it returns. The bundled
`assets/hdri/environment.hdr` is the smallest of the three in `web/public/hdri/`
(`kloofendal_43d_clear_puresky.hdr`, 4.6 MB, CC0 from Poly Haven).

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

## Unverified — needs a real build

Everything below is an API this code calls that **could not be checked**. Grouped by
risk. If the first build fails, start at the top.

### High risk — SceneView 4.38.0 Compose API surface

All in `ui/walk/WalkthroughScreen.kt`, all in one screen on purpose so a fix is local.

| Call | Risk | If it fails |
|---|---|---|
| `io.github.sceneview.SceneView(...)` as a **composable** | The brief says `SceneView` is the current composable name and `Scene` is a deprecated alias. There is also an Android `View` class called `io.github.sceneview.SceneView`, so the name may resolve to the constructor instead. | Change the import and call to `io.github.sceneview.Scene(...)`. Same parameters. |
| Named parameters `engine`, `view`, `renderer`, `scene`, `materialLoader`, `environmentLoader`, `cameraNode`, `cameraManipulator` | Named args were used precisely so a positional reshuffle cannot silently misbind — but a *renamed* parameter is a compile error. | Check the composable's signature and rename. Every other parameter is left at its default. |
| `rememberEngine()`, `rememberView()`, `rememberRenderer()`, `rememberScene()`, `rememberMaterialLoader()`, `rememberEnvironmentLoader()`, `rememberCameraNode(engine)` | Standard SceneView Compose remembers, but arities are from memory. | Match the real signatures. |
| `rememberRenderInvalidator()` returning something invocable as `renderInvalidator()` | Named in the brief; the return type is a guess. | If it returns an object, call its method instead. **Do not delete these calls** — without them, render-on-demand means nothing updates. |
| `cameraNode.position = Float3` and `cameraNode.quaternion = Quaternion` | SceneView `Node` property names. | If `transform: Mat4` is the only writable property, build the matrix from `CameraRig` (it already exposes position + quaternion). |
| `environmentLoader.createHDREnvironment(assetFileLocation = "hdri/environment.hdr")` | Parameter name and return shape (`.indirectLight`, `.skybox`). | The brief also names `rememberHDREnvironment`. Wrapped in `runCatching`, so a *runtime* failure only loses IBL — but a signature mismatch is still a compile error. |
| `materialLoader.createColorInstance(color =, metallic =, roughness =, reflectance =)` in `render/MaterialFactory.kt` | Parameter names are from memory. | Check `MaterialLoader`'s signature. This is the only SceneView call in the whole render layer. |
| `io.github.sceneview.math.Color` used as `Color(r, g, b, a)` | Assumed to be a typealias for `Float4`. | Substitute whatever `createColorInstance` actually takes. |

### Medium risk — Filament Java API details

| Call | Where | Note |
|---|---|---|
| `View.ScreenSpaceReflectionsOptions()`, `TemporalAntiAliasingOptions()`, `AmbientOcclusionOptions()`, `BloomOptions()` and their `enabled` fields | `RenderTuning.kt` | Each is individually wrapped in `runCatching`, so a *runtime* problem degrades the picture. A missing **class** is still a compile error. |
| `view.shadowType = View.ShadowType.PCSS` | `RenderTuning.kt` | PCSS exists in Filament 1.72; the enum's exact location is the assumption. |
| `ToneMapper.AgX()` no-arg constructor | `RenderTuning.kt` | May require an `AgxLook` argument. |
| `view.colorGrading = null` in `dispose` | `RenderTuning.kt` | Assumes the setter is `@Nullable`. If not, drop the line — destroying the ColorGrading is the part that matters. |
| `vertexBuffer.setBufferAt(engine, i, ByteBuffer)` and `indexBuffer.setBuffer(engine, ByteBuffer)` | `FilamentMesh.kt` | Direct `ByteBuffer`s in native order. Overload selection is the assumption. |
| `RenderableManager.Builder(1).boundingBox(...).geometry(...).material(...).castShadows(...).receiveShadows(...).culling(...)` | `FilamentMesh.kt` | Builder method names. |
| `TextureHelper.setBitmap(engine, texture, 0, bitmap)` from `com.google.android.filament.android` | `MaterialFactory.kt` | Argument order is the assumption. |
| `TextureSampler(MinFilter, MagFilter, WrapMode)` three-arg constructor | `MaterialFactory.kt` | |
| `Texture.InternalFormat.SRGB8_A8` / `RGBA8` | `MaterialFactory.kt` | |
| `engine.renderableManager.setMaterialInstanceAt(instance, 0, mi)` | `FilamentMesh.kt` | |

### Lower risk — but unproven all the same

- **The whole texture pipeline.** Which sampler parameters SceneView's precompiled
  `.filamat` ubershaders actually expose is unknown, so `MaterialFactory` *probes*
  candidate names (`baseColorMap`, `baseColorTexture`, `albedoMap`, …) via Filament's
  stable `Material.hasParameter`. **If none match, materials render as flat colour + PBR
  constants and the app still works** — ARCHITECTURE.md sanctions exactly that
  degradation. But it means *PBR maps may simply never appear on a first run.* The real
  fix, if so, is to source the material instance from gltfio's ubershader (load a
  minimal glTF via SceneView's `ModelLoader` and clone its `MaterialInstance`) rather
  than from `MaterialLoader.createColorInstance`.
- **Winding and normal directions.** Every quad's winding was derived by hand from
  cross products and the derivations are written out in comments at each call site, but
  nobody has *seen* the scene. If surfaces are invisible from inside the house, a face
  is wound backwards.
- **Opening positions.** `t` is interpreted as 0..1 along the wall to the opening's
  *centre*, per the contract. Visual check needed.
- **The interior/exterior face probe** in `HouseBuilder.buildWalls` tests a point
  0.12 m outside each wall face against the room polygons. Untested on plans where
  rooms do not tile the footprint.
- **`LocalCostEngine` totals** have not been checked against `shared/cost.test.ts` or
  the backend. Two documented approximations (roof footprint as the sum of room areas;
  overhang allowance as exterior-wall length × overhangM) may put it a few percent off.
  The backend is authoritative and this is labelled "offline estimate" in the UI.
- **Retrofit converter import**:
  `retrofit2.converter.kotlinx.serialization.asConverterFactory` with a `MediaType`
  argument. Retrofit 3 may expose a no-arg overload instead.
- **`okhttp3.Response.body`** is treated as nullable (`?.bytes()`). In OkHttp 5 it is
  non-null, which makes that a warning, not an error.
- **R8 / release build.** `proguard-rules.pro` keeps Filament, SceneView,
  kotlinx-serialization and Retrofit, but only a real `assembleRelease` proves it.
- **Configuration cache** is on in `gradle.properties`. If AGP 9 + SceneView disagree
  with it, set `org.gradle.configuration-cache=false`.
- **`androidResources { noCompress += ... }`** — the DSL property name on AGP 9.
- **No tests.** `LocalCostEngine`, `Triangulator` and `CameraRig` are all pure and were
  written to be unit-testable; there is no test source set yet.

---

## Not built (deliberate)

Per ARCHITECTURE.md's non-goals plus this slice's scope: multi-storey stairs, structural
validation, labour costing, collaboration, accounts. Also not built on Android
specifically: the `POST /api/suggestions` recommendation UI (the repository method
exists and is wired, but no screen consumes it), saving a project back to the backend
(`DesignRepository.saveProject` exists, unused), authored `.glb` furniture, KTX2/Basis
compressed textures, and the Vulkan debug toggle.
