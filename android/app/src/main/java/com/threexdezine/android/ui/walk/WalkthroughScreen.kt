package com.threexdezine.android.ui.walk

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.systemGestures
import androidx.compose.foundation.layout.union
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.threexdezine.android.AppContainer
import com.threexdezine.android.data.ApplyTarget
import com.threexdezine.android.data.DataOrigin
import com.threexdezine.android.data.local.BundledAssets
import com.threexdezine.android.data.model.Catalog
import com.threexdezine.android.data.model.CostBreakdown
import com.threexdezine.android.data.model.Project
import com.threexdezine.android.render.CameraMath
import com.threexdezine.android.render.CameraPose
import com.threexdezine.android.render.CameraRig
import com.threexdezine.android.render.OrbitRig
import com.threexdezine.android.render.HouseBuilder
import com.threexdezine.android.render.MaterialFactory
import com.threexdezine.android.render.RenderTuning
import com.threexdezine.android.render.SceneController
import com.threexdezine.android.ui.Motion
import com.threexdezine.android.ui.animatedDouble
import com.threexdezine.android.ui.formatMoney
import com.threexdezine.android.ui.home.finishesLockedReason
import com.threexdezine.android.ui.home.policySummary
import com.threexdezine.android.ui.tabular
import io.github.sceneview.SceneView
import io.github.sceneview.environment.Environment
import io.github.sceneview.rememberCameraNode
import io.github.sceneview.rememberEngine
import io.github.sceneview.rememberEnvironmentLoader
import io.github.sceneview.rememberMaterialLoader
import io.github.sceneview.rememberRenderInvalidator
import io.github.sceneview.rememberRenderer
import io.github.sceneview.rememberScene
import io.github.sceneview.rememberView
import kotlinx.coroutines.isActive
import kotlin.math.abs

/**
 * The 3D walkthrough.
 *
 * ---------------------------------------------------------------------------
 * HOW THIS IS PUT TOGETHER, AND WHY
 * ---------------------------------------------------------------------------
 *
 * SceneView's composable is used for the Engine/View/Renderer/Scene lifecycle and for
 * the ubershader MaterialLoader and the HDR EnvironmentLoader. EVERYTHING ELSE —
 * geometry, materials, textures, camera — goes through plain Filament in
 * [SceneController], because plain Filament is a stable API surface that can be reasoned
 * about without a compiler, and because the Scene the composable hands back is an
 * ordinary `com.google.android.filament.Scene` we can add entities to.
 *
 * RENDER-ON-DEMAND: SceneView 4.38.0 does not render every vsync. Any mutation — a
 * material swap, a texture landing, a camera step — must be followed by
 * `renderInvalidator.requestRender()`. `onFrame` cannot keep the loop awake, so continuous movement
 * is driven from a `withFrameNanos` loop that invalidates each step, and that loop only
 * runs while the joystick is actually deflected.
 *
 * IBL HITCH: `createHDREnvironment` decodes and prefilters the .hdr on the calling
 * thread and will visibly stall. A loading overlay stays up until it returns; this is
 * expected, not a bug, and is why the bundled HDRI is the smallest of the three in
 * `web/public/hdri/`.
 *
 * CAMERA: [CameraDirector] owns the walk ([CameraRig]) and overview ([OrbitRig]) cameras
 * and every eased move between them. Zoom is a lens change, expressed as
 * `cameraNode.focalLength`, because SceneView re-applies the stored focal length on
 * every surface resize — a one-off `setProjection(fov, …)` would be overwritten the
 * first time the phone rotates.
 *
 * NATIVE LIFETIME: everything created here is destroyed in DisposableEffects, in
 * reverse order of creation. SceneView only frees what SceneView allocated.
 */
@Composable
fun WalkthroughScreen(
    container: AppContainer,
    project: Project,
    catalog: Catalog,
    cost: CostBreakdown?,
    costOrigin: DataOrigin,
    costPending: Boolean,
    onApplyMaterial: (ApplyTarget, String) -> Unit,
    onBack: () -> Unit,
    onOpenSettings: () -> Unit,
) {
    val engine = rememberEngine()
    val view = rememberView(engine)
    val renderer = rememberRenderer(engine)
    val filamentScene = rememberScene(engine)
    val materialLoader = rememberMaterialLoader(engine)
    val environmentLoader = rememberEnvironmentLoader(engine)
    val renderInvalidator = rememberRenderInvalidator()
    // SceneView pushes whatever `environment` it is given onto the Filament Scene from a
    // LaunchedEffect(scene, environment), so writing indirectLight/skybox onto the Scene by
    // hand would race the default (empty) environment and could be clobbered. The loaded
    // Environment is therefore held in state and handed to SceneView instead.
    var environment by remember { mutableStateOf(Environment()) }

    val startPose = remember(project.id) { HouseBuilder.suggestedStart(project) }
    val rig = remember(project.id) {
        CameraRig(startPose.first, startPose.second, startPose.third)
    }
    val cameraNode = rememberCameraNode(engine)
    val bounds = remember(project.id) { HouseBuilder.planBounds(project) }
    val orbit = remember(bounds) { OrbitRig(bounds) }
    val scope = rememberCoroutineScope()
    val director = remember(rig, orbit) {
        // Last focal length written, so an unchanged lens is not re-projected every frame.
        var lastFocalMm = Double.NaN
        CameraDirector(rig, orbit, scope) { pose: CameraPose ->
            runCatching {
                cameraNode.position = pose.position()
                cameraNode.quaternion = pose.quaternion()
                val focal = CameraMath.focalLengthMmForVerticalFov(pose.fovDeg)
                if (lastFocalMm.isNaN() || abs(focal - lastFocalMm) > 1e-3) {
                    // CameraNode.focalLength's setter re-projects with the CURRENT
                    // viewport aspect, and SceneView calls updateProjection() again on
                    // every resize, so aspect stays right through rotation.
                    cameraNode.focalLength = focal
                    lastFocalMm = focal
                }
            }
            renderInvalidator.requestRender()
        }
    }

    val materialFactory = remember(engine) {
        MaterialFactory(
            engine = engine,
            materialLoader = materialLoader,
            httpClient = container.networkFactory.okHttpClient,
            assetBaseUrl = { container.settings.assetBaseUrl.value },
        )
    }
    val controller = remember(engine) {
        SceneController(engine, filamentScene, materialFactory)
    }

    var sceneReady by remember { mutableStateOf(false) }
    var environmentReady by remember { mutableStateOf(false) }
    var showMaterials by remember { mutableStateOf(false) }
    var showCost by remember { mutableStateOf(false) }
    var strafe by remember { mutableStateOf(0f) }
    var forward by remember { mutableStateOf(0f) }

    fun syncCamera() = director.sync()

    // --- Filament View tuning. Owns the ColorGrading it creates. -----------------
    DisposableEffect(view) {
        val grading = RenderTuning.apply(engine, view)
        renderInvalidator.requestRender()
        onDispose { RenderTuning.dispose(engine, view, grading) }
    }

    // --- Image-based lighting. Blocks the loading overlay because it hitches. -----
    LaunchedEffect(engine) {
        syncCamera()
        // Let the loading overlay reach the screen before the blocking prefilter starts,
        // otherwise the hitch lands before the first frame and the user sees nothing.
        withFrameNanos { }
        withFrameNanos { }
        val loaded = runCatching {
            environmentLoader.createHDREnvironment(assetFileLocation = BundledAssets.HDRI_FILE)
        }.getOrNull()
        if (loaded != null) environment = loaded
        environmentReady = true
        renderInvalidator.requestRender()
    }

    // --- Geometry, materials, then textures, in that order. ----------------------
    val lastBuiltKey = remember { arrayOfNulls<String>(1) }
    LaunchedEffect(project, catalog) {
        val key = project.id ?: project.name
        if (lastBuiltKey[0] != key) {
            controller.rebuild(project, catalog)
            lastBuiltKey[0] = key
        } else {
            controller.applyMaterials(project, catalog)
        }
        sceneReady = true
        syncCamera()
        renderInvalidator.requestRender()
        // Textures stream in afterwards; each one that lands invalidates on its own so
        // the picture sharpens progressively instead of waiting for the whole set.
        controller.loadTextures(project, catalog) { renderInvalidator.requestRender() }
    }

    // --- Continuous movement. Only runs while the stick is deflected. ------------
    val moving = strafe != 0f || forward != 0f
    LaunchedEffect(moving) {
        if (!moving) return@LaunchedEffect
        director.cancel()
        var previous = 0L
        while (isActive) {
            withFrameNanos { now ->
                if (previous != 0L) {
                    val dt = ((now - previous) / 1_000_000_000.0).toFloat().coerceIn(0f, 0.1f)
                    rig.move(forward = forward, strafe = strafe, seconds = dt)
                }
                previous = now
            }
            syncCamera()
            renderInvalidator.requestRender()
        }
    }

    DisposableEffect(controller) {
        onDispose { controller.destroy() }
    }

    val loading = !sceneReady || !environmentReady

    // --- Build-up intro ------------------------------------------------------------
    // Opens in the Overview with the walls flat on the slab; once loading is done they
    // rise (RISE_MS, eased) while the camera swings in and settles on the framed view
    // (INTRO_MS). Any touch anywhere skips straight to the end state, and with system
    // animations off it is skipped outright. Render-on-demand: every frame sets the rise,
    // pushes the camera and requests a render.
    val intro = remember(project.id) { IntroState() }
    fun finishIntro() {
        if (intro.done) return
        intro.done = true
        controller.setRise(1f)
        director.placeOrbit(intro.home ?: director.homeOrbit())
        renderInvalidator.requestRender()
    }
    LaunchedEffect(director) {
        // Before anything is built: flat walls, camera already outside the house, so
        // nothing pops when the loading overlay fades.
        if (!intro.done) {
            controller.setRise(0f)
            director.placeOrbit(introStart(director.homeOrbit()))
        }
    }
    LaunchedEffect(loading) {
        if (loading || intro.done) return@LaunchedEffect
        val home = director.homeOrbit()
        intro.home = home
        if (!Motion.animationsEnabled()) {
            finishIntro()
            return@LaunchedEffect
        }
        val from = introStart(home)
        var startNanos = 0L
        while (isActive && !intro.done) {
            val now = withFrameNanos { it }
            if (intro.done) break
            if (startNanos == 0L) startNanos = now
            val ms = (now - startNanos) / 1_000_000f
            controller.setRise(FastOutSlowInEasing.transform((ms / INTRO_RISE_MS).coerceIn(0f, 1f)))
            val cam = FastOutSlowInEasing.transform((ms / INTRO_TOTAL_MS).coerceIn(0f, 1f))
            director.placeOrbit(OrbitRig.lerp(from, home, cam))
            renderInvalidator.requestRender()
            if (ms >= INTRO_TOTAL_MS) break
        }
        finishIntro()
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.Black)
            .onSizeChanged { director.onViewSize(it.width, it.height) }
            // Initial pass: sees every touch (scene, buttons, chips) before the child
            // handles it, without consuming, so the first touch skips the intro and
            // still does whatever it was aimed at.
            .pointerInput(intro) {
                awaitEachGesture {
                    awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial)
                    finishIntro()
                }
            },
    ) {
        SceneView(
            modifier = Modifier
                .fillMaxSize()
                .cameraGestures(director.gestures),
            engine = engine,
            view = view,
            renderer = renderer,
            scene = filamentScene,
            materialLoader = materialLoader,
            environmentLoader = environmentLoader,
            environment = environment,
            // Without this the invalidator is never attached to the view's frame gate and
            // every requestRender() above is silently dropped: SceneView 4.38.0 is
            // render-on-demand by default.
            renderInvalidator = renderInvalidator,
            cameraNode = cameraNode,
            // null: the walkthrough camera is driven by CameraRig, and Filament's
            // orbit Manipulator would fight it for control of the transform.
            cameraManipulator = null,
        )

        TopOverlay(
            project = project,
            cost = cost,
            costPending = costPending,
            onBack = onBack,
            onOpenSettings = onOpenSettings,
            mode = director.mode,
            onToggleMode = {
                // Releasing the stick is not guaranteed when its composable leaves.
                strafe = 0f; forward = 0f
                director.toggleMode()
            },
            onTeleport = { x, z, lookX, lookZ -> director.teleport(x, z, lookX, lookZ) },
        )

        BottomControls(
            modifier = Modifier.align(Alignment.BottomStart),
            mode = director.mode,
            onAxes = { s, f -> strafe = s; forward = f },
            onRise = { delta -> director.raise(delta) },
            onZoomIn = director::zoomIn,
            onZoomOut = director::zoomOut,
            onFrameHouse = {
                strafe = 0f; forward = 0f
                director.frameHouse()
            },
            onMaterials = { showMaterials = true },
            onCost = { showCost = true },
        )

        LoadingOverlay(
            visible = loading,
            environmentReady = environmentReady,
            sceneReady = sceneReady,
        )
    }

    if (showMaterials) {
        MaterialSheet(
            project = project,
            catalog = catalog,
            lockedReason = finishesLockedReason(project),
            // The flat colour lands on the next frame; the LaunchedEffect keyed on
            // `project` then re-applies materials and streams in the new texture set.
            onApply = onApplyMaterial,
            onDismiss = { showMaterials = false },
        )
    }

    if (showCost) {
        CostPanel(
            cost = cost,
            catalog = catalog,
            origin = costOrigin,
            pending = costPending,
            onDismiss = { showCost = false },
        )
    }
}

/** Mutable holder for the intro, remembered per project. Main-thread only. */
private class IntroState {
    var done = false
    var home: OrbitRig.State? = null
}

/** Where the intro camera starts: further out, higher and swung round from [home]. */
private fun introStart(home: OrbitRig.State): OrbitRig.State = home.copy(
    yaw = home.yaw - 40f * CameraMath.DEG,
    elevation = (home.elevation + 18f * CameraMath.DEG).coerceAtMost(OrbitRig.MAX_ELEVATION),
    distance = home.distance * 1.45f,
)

private const val INTRO_RISE_MS = 1300f
private const val INTRO_TOTAL_MS = 1750f

@Composable
private fun TopOverlay(
    project: Project,
    cost: CostBreakdown?,
    costPending: Boolean,
    onBack: () -> Unit,
    onOpenSettings: () -> Unit,
    mode: CameraMode,
    onToggleMode: () -> Unit,
    onTeleport: (Float, Float, Float, Float) -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .statusBarsPadding()
            .windowInsetsPadding(sideInsets())
            .padding(horizontal = 12.dp, vertical = 8.dp),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(Color.Black.copy(alpha = 0.45f), RoundedCornerShape(12.dp))
                .padding(horizontal = 8.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            TextButton(onClick = onBack) { Text("Back", color = Color.White) }
            Column(modifier = Modifier.weight(1f)) {
                Text(project.name, color = Color.White, style = MaterialTheme.typography.titleSmall)
                val shownTotal = cost?.let { animatedDouble(it.total) }
                Text(
                    text = when {
                        costPending && cost == null -> "Pricing…"
                        cost != null && shownTotal != null ->
                            "${formatMoney(shownTotal, cost.currency)} buffered"
                        else -> "—"
                    },
                    color = Color.White.copy(alpha = if (costPending) 0.6f else 0.8f),
                    style = MaterialTheme.typography.labelSmall.tabular(),
                )
            }
            // Walk <-> Orbit. The label names the mode you will switch TO.
            TextButton(onClick = onToggleMode) {
                AnimatedContent(
                    targetState = mode,
                    transitionSpec = {
                        fadeIn(tween(Motion.SHORT_MS)) togetherWith fadeOut(tween(Motion.SHORT_MS))
                    },
                    label = "modeLabel",
                ) { m ->
                    Text(
                        if (m == CameraMode.WALK) "Overview" else "Walk",
                        color = Color.White,
                        fontWeight = FontWeight.SemiBold,
                    )
                }
            }
            TextButton(onClick = onOpenSettings) { Text("Backend", color = Color.White) }
        }

        policySummary(project)?.let { summary ->
            Text(
                summary,
                color = Color.White,
                style = MaterialTheme.typography.labelSmall,
                modifier = Modifier
                    .padding(top = 6.dp)
                    .background(Color.Black.copy(alpha = 0.45f), RoundedCornerShape(8.dp))
                    .padding(horizontal = 8.dp, vertical = 4.dp),
            )
        }

        val rooms = project.groundFloor?.rooms.orEmpty()
        if (rooms.isNotEmpty()) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState())
                    .padding(top = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                rooms.forEach { room ->
                    val cx = room.polygon.sumOf { it.x } / room.polygon.size
                    val cz = room.polygon.sumOf { it.z } / room.polygon.size
                    AssistChip(
                        onClick = {
                            // Stand in the room's centroid and look at the first corner,
                            // which reliably gives a view down the room rather than into
                            // the nearest wall. From the overview this glides you in.
                            val target = room.polygon.first()
                            onTeleport(
                                cx.toFloat(),
                                cz.toFloat(),
                                target.x.toFloat(),
                                target.z.toFloat(),
                            )
                        },
                        label = { Text(room.name) },
                    )
                }
            }
        }
    }
}

/**
 * Display cutouts and the edge back-gesture zones, horizontally. Controls hugging the
 * left or right edge would otherwise sit where a swipe means "back".
 */
@Composable
private fun sideInsets(): WindowInsets =
    WindowInsets.safeDrawing.union(WindowInsets.systemGestures).only(WindowInsetsSides.Horizontal)

@Composable
private fun BottomControls(
    modifier: Modifier = Modifier,
    mode: CameraMode,
    onAxes: (Float, Float) -> Unit,
    onRise: (Float) -> Unit,
    onZoomIn: () -> Unit,
    onZoomOut: () -> Unit,
    onFrameHouse: () -> Unit,
    onMaterials: () -> Unit,
    onCost: () -> Unit,
) {
    val walking = mode == CameraMode.WALK
    Box(modifier = modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .navigationBarsPadding()
                .windowInsetsPadding(sideInsets())
                .padding(16.dp),
            verticalAlignment = Alignment.Bottom,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            // The stick only means something in walk mode; in the overview a drag orbits.
            AnimatedVisibility(
                visible = walking,
                enter = fadeIn(tween(Motion.SHORT_MS)),
                exit = fadeOut(tween(Motion.SHORT_MS)),
            ) {
                MoveJoystick(onAxes = onAxes)
            }
            if (!walking) Box(Modifier.width(1.dp))
            Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                AnimatedVisibility(
                    visible = walking,
                    enter = fadeIn(tween(Motion.SHORT_MS)) + expandVertically(tween(Motion.SHORT_MS)),
                    exit = fadeOut(tween(Motion.SHORT_MS)) + shrinkVertically(tween(Motion.SHORT_MS)),
                ) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        TextButton(onClick = { onRise(-0.15f) }) { Text("Lower", color = Color.White) }
                        TextButton(onClick = { onRise(0.15f) }) { Text("Raise", color = Color.White) }
                    }
                }
                ZoomCluster(onZoomIn = onZoomIn, onZoomOut = onZoomOut, onFrameHouse = onFrameHouse)
                Button(onClick = onCost) { Text("Cost") }
                Button(onClick = onMaterials) { Text("Materials") }
            }
        }
    }
}

/** Zoom out, zoom in, frame the house. Each one eases the camera rather than jumping. */
@Composable
private fun ZoomCluster(onZoomIn: () -> Unit, onZoomOut: () -> Unit, onFrameHouse: () -> Unit) {
    Row(
        modifier = Modifier
            .background(Color.Black.copy(alpha = 0.45f), RoundedCornerShape(20.dp))
            .padding(horizontal = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        TextButton(onClick = onZoomOut, modifier = Modifier.size(48.dp)) {
            Text("−", color = Color.White, style = MaterialTheme.typography.titleLarge)
        }
        TextButton(onClick = onZoomIn, modifier = Modifier.size(48.dp)) {
            Text("+", color = Color.White, style = MaterialTheme.typography.titleLarge)
        }
        FilledTonalButton(onClick = onFrameHouse) { Text("Frame house") }
    }
}

/**
 * Covers the scene while the HDR prefilter and the shell build run, then fades out
 * instead of vanishing. Progress is by stage (2 steps), because the prefilter blocks
 * the main thread and an indeterminate spinner would simply freeze mid-turn.
 */
@Composable
private fun LoadingOverlay(visible: Boolean, environmentReady: Boolean, sceneReady: Boolean) {
    AnimatedVisibility(
        visible = visible,
        enter = fadeIn(tween(0)),
        exit = fadeOut(tween(450)),
    ) {
        val steps = (if (environmentReady) 1 else 0) + (if (sceneReady) 1 else 0)
        val progress by animateFloatAsState(
            targetValue = (steps + 0.35f) / 2.35f,
            animationSpec = tween(Motion.CAMERA_MS),
            label = "loadingProgress",
        )
        Box(
            modifier = Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.72f)),
            contentAlignment = Alignment.Center,
        ) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                AnimatedContent(
                    targetState = if (!environmentReady) {
                        "Prefiltering the HDR environment…"
                    } else if (!sceneReady) {
                        "Building the house shell…"
                    } else {
                        "Ready"
                    },
                    transitionSpec = {
                        fadeIn(tween(Motion.SHORT_MS)) togetherWith fadeOut(tween(Motion.SHORT_MS))
                    },
                    label = "loadingMessage",
                ) { message ->
                    Text(
                        message,
                        color = Color.White,
                        style = MaterialTheme.typography.bodyMedium,
                    )
                }
                LinearProgressIndicator(
                    progress = { progress },
                    modifier = Modifier.padding(top = 12.dp).width(180.dp),
                    color = Color.White,
                    trackColor = Color.White.copy(alpha = 0.2f),
                )
            }
        }
    }
}
