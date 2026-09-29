package com.threexdezine.android.render

import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.tan

/**
 * Overview camera that orbits a target point from outside the house. Pure maths, like
 * [CameraRig].
 *
 * The camera sits at
 *
 *     position = target + distance * (sin(yaw)·cos(elev),  sin(elev),  cos(yaw)·cos(elev))
 *
 * and looks back at the target, which in [CameraRig]'s convention is the same `yaw` with
 * `pitch = -elevation`. That shared convention is what lets a tween interpolate between
 * a walk pose and an orbit pose component by component.
 *
 * Elevation is clamped to [MIN_ELEVATION]..[MAX_ELEVATION] and the target never goes
 * below the floor, so the camera can never dip under the ground plane.
 */
class OrbitRig(
    val bounds: PlanBounds,
    val fovDeg: Float = DEFAULT_FOV_DEG,
) {
    data class State(
        val targetX: Float,
        val targetY: Float,
        val targetZ: Float,
        val yaw: Float,
        val elevation: Float,
        val distance: Float,
    )

    /** Closest the camera may dolly to the target. */
    val minDistance: Float = max(1.5f, bounds.radius * 0.25f)

    /** Furthest the camera may dolly out. */
    val maxDistance: Float = max(minDistance * 2f, bounds.radius * 6f + 10f)

    var state: State = home(1f)
        private set

    fun set(s: State) {
        state = clamp(s)
    }

    /**
     * A pleasant three-quarter view of the whole plan, mirroring the web client's orbit
     * default (camera off the +X/+Z corner, looking down at ~26°), pulled back until the
     * plan's bounding sphere fits the narrower FOV at the given width/height [aspect].
     */
    fun home(aspect: Float): State = clamp(
        State(
            targetX = bounds.centreX,
            targetY = min(1.2f, bounds.height * 0.45f),
            targetZ = bounds.centreZ,
            yaw = HOME_YAW,
            elevation = HOME_ELEVATION,
            distance = CameraMath.fitDistance(bounds.radius, fovDeg, aspect),
        ),
    )

    /** One-finger drag, in pixels. Dragging right swings the camera left round the house. */
    fun orbit(dxPixels: Float, dyPixels: Float) {
        val s = state
        state = clamp(
            s.copy(
                yaw = s.yaw - dxPixels * ORBIT_RADIANS_PER_PIXEL,
                elevation = s.elevation + dyPixels * ORBIT_RADIANS_PER_PIXEL,
            ),
        )
    }

    /** Pinch. [zoom] > 1 means fingers spreading, which dollies in. */
    fun dolly(zoom: Float) {
        if (zoom <= 0f || zoom.isNaN()) return
        state = clamp(state.copy(distance = state.distance / zoom))
    }

    /**
     * Two-finger drag: slides the target across the floor plane in screen-aligned
     * directions, scaled so the house moves roughly with the fingers.
     */
    fun pan(dxPixels: Float, dyPixels: Float, viewHeightPx: Float) {
        if (viewHeightPx <= 0f) return
        val s = state
        val metresPerPixel = 2f * s.distance * tan(fovDeg * CameraMath.DEG * 0.5f) / viewHeightPx
        // Screen right on the ground = camera right; screen up = away from the camera,
        // projected flat onto the floor.
        val rx = cos(s.yaw)
        val rz = -sin(s.yaw)
        val fx = -sin(s.yaw)
        val fz = -cos(s.yaw)
        val mx = -dxPixels * metresPerPixel
        val my = dyPixels * metresPerPixel
        state = clamp(
            s.copy(
                targetX = s.targetX + rx * mx + fx * my,
                targetZ = s.targetZ + rz * mx + fz * my,
            ),
        )
    }

    /** A state that dollies toward [pointX], [pointZ] on the floor by [factor] (< 1). */
    fun zoomedToward(pointX: Float, pointZ: Float, factor: Float): State {
        val s = state
        return clamp(
            s.copy(
                targetX = pointX,
                targetZ = pointZ,
                distance = s.distance * factor,
            ),
        )
    }

    fun withDistance(distance: Float): State = clamp(state.copy(distance = distance))

    fun clamp(s: State): State {
        val margin = max(2f, bounds.radius * 0.5f)
        return s.copy(
            targetX = s.targetX.coerceIn(bounds.minX - margin, bounds.maxX + margin),
            targetY = s.targetY.coerceIn(0f, max(0.5f, bounds.height)),
            targetZ = s.targetZ.coerceIn(bounds.minZ - margin, bounds.maxZ + margin),
            yaw = CameraMath.wrapAngle(s.yaw),
            elevation = s.elevation.coerceIn(MIN_ELEVATION, MAX_ELEVATION),
            distance = s.distance.coerceIn(minDistance, maxDistance),
        )
    }

    fun pose(s: State = state): CameraPose {
        val ce = cos(s.elevation)
        return CameraPose(
            x = s.targetX + s.distance * sin(s.yaw) * ce,
            y = s.targetY + s.distance * sin(s.elevation),
            z = s.targetZ + s.distance * cos(s.yaw) * ce,
            yaw = s.yaw,
            pitch = -s.elevation,
            fovDeg = fovDeg,
        )
    }

    companion object {
        const val DEFAULT_FOV_DEG = 45f
        const val HOME_YAW = 39f * CameraMath.DEG
        const val HOME_ELEVATION = 30f * CameraMath.DEG
        const val MIN_ELEVATION = 3f * CameraMath.DEG
        const val MAX_ELEVATION = 85f * CameraMath.DEG
        private const val ORBIT_RADIANS_PER_PIXEL = 0.005f

        fun lerp(a: State, b: State, t: Float): State = State(
            targetX = CameraMath.lerp(a.targetX, b.targetX, t),
            targetY = CameraMath.lerp(a.targetY, b.targetY, t),
            targetZ = CameraMath.lerp(a.targetZ, b.targetZ, t),
            yaw = CameraMath.lerpAngle(a.yaw, b.yaw, t),
            elevation = CameraMath.lerp(a.elevation, b.elevation, t),
            // Geometric, not linear, so a dolly feels even at every range.
            distance = a.distance * Math.pow((b.distance / a.distance).toDouble(), t.toDouble()).toFloat(),
        )
    }
}
