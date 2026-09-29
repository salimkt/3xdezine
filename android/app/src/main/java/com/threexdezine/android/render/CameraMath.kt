package com.threexdezine.android.render

import dev.romainguy.kotlin.math.Float3
import dev.romainguy.kotlin.math.Quaternion
import kotlin.math.PI
import kotlin.math.atan
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.sin
import kotlin.math.sqrt
import kotlin.math.tan

/**
 * Camera maths shared by the walk ([CameraRig]) and overview ([OrbitRig]) cameras, and by
 * the tweens that move between them. Pure Kotlin — no Filament, no SceneView, no Compose —
 * so everything here is covered by plain JVM unit tests.
 *
 * Angle convention (same as [CameraRig]; Filament cameras look down local -Z):
 *
 *     forward = (-sin(yaw) * cos(pitch),  sin(pitch),  -cos(yaw) * cos(pitch))
 *     right   = ( cos(yaw),               0,           -sin(yaw))
 *     up      = cross(right, forward)
 */
data class CameraPose(
    val x: Float,
    val y: Float,
    val z: Float,
    /** Radians about +Y. 0 looks along -Z. */
    val yaw: Float,
    /** Radians. Positive looks up. */
    val pitch: Float,
    /** Full vertical field of view, degrees. */
    val fovDeg: Float,
) {
    fun position(): Float3 = Float3(x, y, z)
    fun quaternion(): Quaternion = CameraMath.quaternion(yaw, pitch)
}

/** Axis-aligned extents of the floor plan, metres. Y runs from 0 (floor) to [height]. */
data class PlanBounds(
    val minX: Float,
    val maxX: Float,
    val minZ: Float,
    val maxZ: Float,
    val height: Float,
) {
    val centreX: Float get() = (minX + maxX) * 0.5f
    val centreZ: Float get() = (minZ + maxZ) * 0.5f
    val sizeX: Float get() = maxX - minX
    val sizeZ: Float get() = maxZ - minZ

    /** Radius of the sphere around the box's centre (at half height) that contains it. */
    val radius: Float
        get() {
            val hx = sizeX * 0.5f
            val hz = sizeZ * 0.5f
            val hy = height * 0.5f
            return sqrt(hx * hx + hy * hy + hz * hz)
        }

    companion object {
        /** A 10 m × 10 m × 2.7 m box around the origin, for a project with no geometry. */
        val FALLBACK = PlanBounds(-5f, 5f, -5f, 5f, 2.7f)
    }
}

object CameraMath {
    /** Degrees to radians. A literal so it can seed other `const val`s. */
    const val DEG = 0.017453292f
    private val TWO_PI = (2 * PI).toFloat()

    /**
     * Filament's `Camera.setLensProjection(focalLength, …)` models a 24 mm-tall sensor
     * (`Camera::SENSOR_SIZE = 0.024`) and derives a VERTICAL field of view from it:
     * fov = 2·atan(12 mm / f). SceneView's `CameraNode` re-applies its stored focal length
     * on every surface resize, so zoom is expressed as a focal length — that way the
     * aspect ratio is recomputed from the new viewport on rotation and our FOV survives.
     */
    const val SENSOR_HALF_HEIGHT_MM = 12.0

    fun focalLengthMmForVerticalFov(fovDeg: Float): Double =
        SENSOR_HALF_HEIGHT_MM / tan(fovDeg.toDouble() * PI / 360.0)

    fun verticalFovForFocalLengthMm(focalMm: Double): Float =
        (2.0 * atan(SENSOR_HALF_HEIGHT_MM / focalMm) * 180.0 / PI).toFloat()

    /** Horizontal FOV (degrees) for a vertical FOV at a width/height [aspect]. */
    fun horizontalFov(verticalFovDeg: Float, aspect: Float): Float =
        (2.0 * atan(tan(verticalFovDeg * DEG * 0.5) * aspect) / DEG).toFloat()

    /**
     * Orientation as a unit quaternion: yaw about +Y, then pitch about the resulting +X.
     * q = qYaw * qPitch, written out so the component order does not depend on a
     * library's multiplication convention.
     */
    fun quaternion(yaw: Float, pitch: Float): Quaternion {
        val hy = yaw * 0.5f
        val hp = pitch * 0.5f
        val cy = cos(hy)
        val sy = sin(hy)
        val cp = cos(hp)
        val sp = sin(hp)
        // qYaw = (0, sy, 0, cy), qPitch = (sp, 0, 0, cp); v1 x v2 = (0, 0, -sy*sp)
        return Quaternion(x = cy * sp, y = sy * cp, z = -sy * sp, w = cy * cp)
    }

    fun forward(yaw: Float, pitch: Float): Float3 =
        Float3(-sin(yaw) * cos(pitch), sin(pitch), -cos(yaw) * cos(pitch))

    fun right(yaw: Float): Float3 = Float3(cos(yaw), 0f, -sin(yaw))

    /** Wraps an angle into (-π, π]. */
    fun wrapAngle(a: Float): Float {
        var r = a % TWO_PI
        if (r <= -PI.toFloat()) r += TWO_PI
        if (r > PI.toFloat()) r -= TWO_PI
        return r
    }

    /** Interpolates from [a] to [b] along the shorter way round the circle. */
    fun lerpAngle(a: Float, b: Float, t: Float): Float = a + wrapAngle(b - a) * t

    fun lerp(a: Float, b: Float, t: Float): Float = a + (b - a) * t

    fun lerp(a: CameraPose, b: CameraPose, t: Float): CameraPose = CameraPose(
        x = lerp(a.x, b.x, t),
        y = lerp(a.y, b.y, t),
        z = lerp(a.z, b.z, t),
        yaw = lerpAngle(a.yaw, b.yaw, t),
        pitch = lerp(a.pitch, b.pitch, t),
        fovDeg = lerp(a.fovDeg, b.fovDeg, t),
    )

    /**
     * World-space ray through a pixel. Returns (origin, unit direction), or null for a
     * degenerate viewport. [px], [py] are in view pixels, y down.
     */
    fun screenRay(
        pose: CameraPose,
        px: Float,
        py: Float,
        viewWidth: Float,
        viewHeight: Float,
    ): Pair<Float3, Float3>? {
        if (viewWidth <= 0f || viewHeight <= 0f) return null
        val aspect = viewWidth / viewHeight
        val ndcX = 2f * px / viewWidth - 1f
        val ndcY = 1f - 2f * py / viewHeight
        val t = tan(pose.fovDeg * DEG * 0.5f)
        val f = forward(pose.yaw, pose.pitch)
        val r = right(pose.yaw)
        // up = cross(right, forward)
        val u = Float3(
            r.y * f.z - r.z * f.y,
            r.z * f.x - r.x * f.z,
            r.x * f.y - r.y * f.x,
        )
        val sx = ndcX * t * aspect
        val sy = ndcY * t
        val dx = f.x + r.x * sx + u.x * sy
        val dy = f.y + r.y * sx + u.y * sy
        val dz = f.z + r.z * sx + u.z * sy
        val len = sqrt(dx * dx + dy * dy + dz * dz)
        if (len < 1e-6f) return null
        return pose.position() to Float3(dx / len, dy / len, dz / len)
    }

    /** Where a ray meets the horizontal plane y = [planeY], if it does in front of it. */
    fun intersectHorizontalPlane(origin: Float3, dir: Float3, planeY: Float): Float3? {
        if (kotlin.math.abs(dir.y) < 1e-5f) return null
        val s = (planeY - origin.y) / dir.y
        if (s <= 0f) return null
        return Float3(origin.x + dir.x * s, planeY, origin.z + dir.z * s)
    }

    /**
     * Distance at which a sphere of [radius] fits the frustum with [padding] to spare.
     * Uses the narrower of the vertical and horizontal FOV, so a portrait phone frames
     * by width and a landscape one by height.
     */
    fun fitDistance(radius: Float, verticalFovDeg: Float, aspect: Float, padding: Float = 1.08f): Float {
        val v = verticalFovDeg
        val h = horizontalFov(verticalFovDeg, max(aspect, 0.1f))
        val half = minOf(v, h) * DEG * 0.5f
        return radius * padding / sin(half)
    }
}
