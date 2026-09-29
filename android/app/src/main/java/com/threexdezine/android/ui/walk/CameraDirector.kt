package com.threexdezine.android.ui.walk

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.geometry.Offset
import com.threexdezine.android.render.CameraMath
import com.threexdezine.android.render.CameraPose
import com.threexdezine.android.render.CameraRig
import com.threexdezine.android.render.OrbitRig
import com.threexdezine.android.ui.Motion
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

enum class CameraMode { WALK, ORBIT }

/**
 * Owns which camera is live and every eased move between poses. Not a composable: it is
 * remembered once per walkthrough and handed a [push] that writes a pose to the SceneView
 * camera node and requests a render.
 *
 * Tweens:
 *  - run for [Motion.CAMERA_MS] on [FastOutSlowInEasing] (no overshoot), driven by an
 *    [Animatable] on the composition's frame clock, and push + invalidate on every frame
 *    — without that, render-on-demand would show only the first and last frame;
 *  - are cancelled by [cancel], which every gesture, button and joystick push calls
 *    first, so the user is never fighting an animation;
 *  - jump straight to their end state when the system animator scale is 0.
 *
 * A mode switch tweens an explicit [CameraPose] (the mode flips at the START, so a
 * gesture that interrupts the tween acts on the camera you were heading to); zoom and
 * framing tweens interpolate the live rig's own state instead, so an interrupted zoom
 * simply stops where it is.
 */
class CameraDirector(
    val walk: CameraRig,
    val orbit: OrbitRig,
    private val scope: CoroutineScope,
    private val push: (CameraPose) -> Unit,
) {
    var mode by mutableStateOf(CameraMode.WALK)
        private set

    var viewWidthPx = 0f
        private set
    var viewHeightPx = 0f
        private set
    private val aspect: Float
        get() = if (viewWidthPx > 0f && viewHeightPx > 0f) viewWidthPx / viewHeightPx else 9f / 16f

    private var tweenPose: CameraPose? = null
    private var job: Job? = null
    private var generation = 0
    private var orbitFramed = false

    fun currentPose(): CameraPose =
        tweenPose ?: if (mode == CameraMode.WALK) walk.pose() else orbit.pose()

    fun sync() = push(currentPose())

    fun onViewSize(width: Int, height: Int) {
        viewWidthPx = width.toFloat()
        viewHeightPx = height.toFloat()
        sync()
    }

    /** Stops any tween. A mode-switch tween lands on its destination pose. */
    fun cancel() {
        job?.cancel()
        job = null
        if (tweenPose != null) {
            tweenPose = null
            generation++
            sync()
        }
    }

    // --- Gestures ----------------------------------------------------------------

    val gestures = object : CameraGestureListener {
        override fun onGestureStart() = cancel()

        override fun onDrag(dx: Float, dy: Float) {
            if (mode == CameraMode.WALK) walk.look(dx, dy) else orbit.orbit(dx, dy)
            sync()
        }

        override fun onPinch(zoom: Float, pan: Offset, centroid: Offset) {
            if (mode == CameraMode.WALK) {
                // Two fingers never look around in walk mode; they only change the lens.
                walk.zoomFov(zoom)
            } else {
                orbit.dolly(zoom)
                orbit.pan(pan.x, pan.y, viewHeightPx)
            }
            sync()
        }

        override fun onDoubleTap(position: Offset) {
            if (mode == CameraMode.WALK) {
                animateWalkFov(CameraRig.DEFAULT_FOV_DEG)
            } else {
                zoomTowardScreenPoint(position)
            }
        }
    }

    // --- Buttons -----------------------------------------------------------------

    fun zoomIn() = zoomBy(ZOOM_STEP)

    fun zoomOut() = zoomBy(1f / ZOOM_STEP)

    private fun zoomBy(factor: Float) {
        if (mode == CameraMode.WALK) {
            animateWalkFov(walk.fovDeg / factor)
        } else {
            animateOrbit(orbit.withDistance(orbit.state.distance / factor))
        }
    }

    /** Re-frames the whole house — switching to the overview first if walking. */
    fun frameHouse() {
        val home = orbit.home(aspect)
        if (mode == CameraMode.WALK) {
            orbitFramed = true
            switchTo(CameraMode.ORBIT, orbitState = home)
        } else {
            animateOrbit(home)
        }
    }

    fun toggleMode() {
        if (mode == CameraMode.WALK) {
            switchTo(CameraMode.ORBIT, orbitState = if (orbitFramed) null else orbit.home(aspect))
            orbitFramed = true
        } else {
            switchTo(CameraMode.WALK)
        }
    }

    /** Room chip: glide to a standing point in walk mode, from whichever mode is live. */
    fun teleport(x: Float, z: Float, lookX: Float, lookZ: Float) {
        val from = currentPose()
        cancelQuietly()
        walk.teleport(x, z)
        walk.faceTowards(lookX, lookZ)
        mode = CameraMode.WALK
        animatePose(from, walk.pose())
    }

    fun raise(dy: Float) {
        cancel()
        walk.raise(dy)
        sync()
    }

    // --- Internals ---------------------------------------------------------------

    private fun switchTo(target: CameraMode, orbitState: OrbitRig.State? = null) {
        val from = currentPose()
        cancelQuietly()
        if (orbitState != null) orbit.set(orbitState)
        mode = target
        val to = if (target == CameraMode.WALK) walk.pose() else orbit.pose()
        animatePose(from, to)
    }

    private fun zoomTowardScreenPoint(position: Offset) {
        val pose = currentPose()
        val ray = CameraMath.screenRay(pose, position.x, position.y, viewWidthPx, viewHeightPx)
        val hit = ray?.let { (o, d) -> CameraMath.intersectHorizontalPlane(o, d, 0f) }
        val b = orbit.bounds
        val onHouse = hit != null &&
            hit.x in (b.minX - 1f)..(b.maxX + 1f) &&
            hit.z in (b.minZ - 1f)..(b.maxZ + 1f)
        val target = if (hit != null && onHouse) {
            orbit.zoomedToward(hit.x, hit.z, DOUBLE_TAP_ZOOM)
        } else {
            // Double-tapping sky or lawn re-frames the house instead.
            orbit.home(aspect)
        }
        animateOrbit(target)
    }

    private fun animateWalkFov(targetDeg: Float) {
        val start = walk.fovDeg
        val end = targetDeg.coerceIn(CameraRig.MIN_FOV_DEG, CameraRig.MAX_FOV_DEG)
        tweenBy { t -> walk.setFov(CameraMath.lerp(start, end, t)) }
    }

    private fun animateOrbit(target: OrbitRig.State) {
        val start = orbit.state
        tweenBy { t -> orbit.set(OrbitRig.lerp(start, target, t)) }
    }

    private fun animatePose(from: CameraPose, to: CameraPose) {
        val gen = ++generation
        tweenBy(
            onEnd = { if (generation == gen) tweenPose = null },
        ) { t -> if (generation == gen) tweenPose = CameraMath.lerp(from, to, t) }
    }

    /** Cancels without snapping, for callers that are about to start the next tween. */
    private fun cancelQuietly() {
        job?.cancel()
        job = null
        tweenPose = null
        generation++
    }

    private fun tweenBy(onEnd: () -> Unit = {}, step: (Float) -> Unit) {
        job?.cancel()
        if (!Motion.animationsEnabled()) {
            step(1f)
            onEnd()
            sync()
            return
        }
        job = scope.launch {
            val progress = Animatable(0f)
            try {
                progress.animateTo(1f, tween(Motion.CAMERA_MS, easing = FastOutSlowInEasing)) {
                    step(value)
                    sync()
                }
                step(1f)
            } finally {
                onEnd()
                sync()
            }
        }
    }

    companion object {
        private const val ZOOM_STEP = 1.4f
        private const val DOUBLE_TAP_ZOOM = 0.5f
    }
}
