package com.threexdezine.android.ui.walk

import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.unit.dp
import com.threexdezine.android.AppContainer
import com.threexdezine.android.data.ApplyTarget
import com.threexdezine.android.data.DataOrigin
import com.threexdezine.android.data.local.BundledAssets
import com.threexdezine.android.data.model.Catalog
import com.threexdezine.android.data.model.CostBreakdown
import com.threexdezine.android.data.model.Project
import com.threexdezine.android.render.CameraRig
import com.threexdezine.android.render.HouseBuilder
import com.threexdezine.android.render.MaterialFactory
import com.threexdezine.android.render.RenderTuning
import com.threexdezine.android.render.SceneController
import com.threexdezine.android.ui.formatMoney
import io.github.sceneview.SceneView
import io.github.sceneview.rememberCameraNode
import io.github.sceneview.rememberEngine
import io.github.sceneview.rememberEnvironmentLoader
import io.github.sceneview.rememberMaterialLoader
import io.github.sceneview.rememberRenderInvalidator
import io.github.sceneview.rememberRenderer
import io.github.sceneview.rememberScene
import io.github.sceneview.rememberView
import kotlinx.coroutines.isActive

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
 * `renderInvalidator()`. `onFrame` cannot keep the loop awake, so continuous movement
 * is driven from a `withFrameNanos` loop that invalidates each step, and that loop only
 * runs while the joystick is actually deflected.
 *
 * IBL HITCH: `createHDREnvironment` decodes and prefilters the .hdr on the calling
 * thread and will visibly stall. A loading overlay stays up until it returns; this is
 * expected, not a bug, and is why the bundled HDRI is the smallest of the three in
 * `web/public/hdri/`.
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

    val startPose = remember(project.id) { HouseBuilder.suggestedStart(project) }
    val rig = remember(project.id) {
        CameraRig(startPose.first, startPose.second, startPose.third)
    }
    val cameraNode = rememberCameraNode(engine)

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

    fun syncCamera() {
        runCatching {
            cameraNode.position = rig.position()
            cameraNode.quaternion = rig.quaternion()
        }
    }

    // --- Filament View tuning. Owns the ColorGrading it creates. -----------------
    DisposableEffect(view) {
        val grading = RenderTuning.apply(engine, view)
        renderInvalidator()
        onDispose { RenderTuning.dispose(engine, view, grading) }
    }

    // --- Image-based lighting. Blocks the loading overlay because it hitches. -----
    LaunchedEffect(engine) {
        syncCamera()
        val environment = runCatching {
            environmentLoader.createHDREnvironment(assetFileLocation = BundledAssets.HDRI_FILE)
        }.getOrNull()
        if (environment != null) {
            runCatching {
                filamentScene.indirectLight = environment.indirectLight
                filamentScene.skybox = environment.skybox
            }
        }
        environmentReady = true
        renderInvalidator()
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
        renderInvalidator()
        // Textures stream in afterwards; each one that lands invalidates on its own so
        // the picture sharpens progressively instead of waiting for the whole set.
        controller.loadTextures(project, catalog) { renderInvalidator() }
    }

    // --- Continuous movement. Only runs while the stick is deflected. ------------
    val moving = strafe != 0f || forward != 0f
    LaunchedEffect(moving) {
        if (!moving) return@LaunchedEffect
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
            renderInvalidator()
        }
    }

    DisposableEffect(controller) {
        onDispose { controller.destroy() }
    }

    Box(modifier = Modifier.fillMaxSize().background(Color.Black)) {
        SceneView(
            modifier = Modifier
                .fillMaxSize()
                .pointerInput(rig) {
                    detectDragGestures { change, dragAmount ->
                        change.consume()
                        rig.look(dragAmount.x, dragAmount.y)
                        syncCamera()
                        renderInvalidator()
                    }
                },
            engine = engine,
            view = view,
            renderer = renderer,
            scene = filamentScene,
            materialLoader = materialLoader,
            environmentLoader = environmentLoader,
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
            onTeleport = { x, z, lookX, lookZ ->
                rig.teleport(x, z)
                rig.faceTowards(lookX, lookZ)
                syncCamera()
                renderInvalidator()
            },
        )

        BottomControls(
            modifier = Modifier.align(Alignment.BottomStart),
            onAxes = { s, f -> strafe = s; forward = f },
            onRise = { delta ->
                rig.raise(delta)
                syncCamera()
                renderInvalidator()
            },
            onMaterials = { showMaterials = true },
            onCost = { showCost = true },
        )

        if (!sceneReady || !environmentReady) {
            LoadingOverlay(
                message = if (!environmentReady) {
                    "Prefiltering the HDR environment…"
                } else {
                    "Building the house shell…"
                },
            )
        }
    }

    if (showMaterials) {
        MaterialSheet(
            project = project,
            catalog = catalog,
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

@Composable
private fun TopOverlay(
    project: Project,
    cost: CostBreakdown?,
    costPending: Boolean,
    onBack: () -> Unit,
    onOpenSettings: () -> Unit,
    onTeleport: (Float, Float, Float, Float) -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .statusBarsPadding()
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
                Text(
                    text = when {
                        costPending -> "Pricing…"
                        cost != null -> "${formatMoney(cost.total, cost.currency)} buffered"
                        else -> "—"
                    },
                    color = Color.White.copy(alpha = 0.8f),
                    style = MaterialTheme.typography.labelSmall,
                )
            }
            TextButton(onClick = onOpenSettings) { Text("Backend", color = Color.White) }
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
                            // the nearest wall.
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

@Composable
private fun BottomControls(
    modifier: Modifier = Modifier,
    onAxes: (Float, Float) -> Unit,
    onRise: (Float) -> Unit,
    onMaterials: () -> Unit,
    onCost: () -> Unit,
) {
    Box(modifier = modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .navigationBarsPadding()
                .padding(16.dp),
            verticalAlignment = Alignment.Bottom,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            MoveJoystick(onAxes = onAxes)
            Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    TextButton(onClick = { onRise(-0.15f) }) { Text("Lower", color = Color.White) }
                    TextButton(onClick = { onRise(0.15f) }) { Text("Raise", color = Color.White) }
                }
                Button(onClick = onCost) { Text("Cost") }
                Button(onClick = onMaterials) { Text("Materials") }
            }
        }
    }
}

@Composable
private fun LoadingOverlay(message: String) {
    Box(
        modifier = Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.72f)),
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            CircularProgressIndicator(color = Color.White)
            Text(
                message,
                color = Color.White,
                style = MaterialTheme.typography.bodyMedium,
                modifier = Modifier.padding(top = 12.dp),
            )
        }
    }
}
