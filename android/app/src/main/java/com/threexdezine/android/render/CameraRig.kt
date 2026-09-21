package com.threexdezine.android.render

import dev.romainguy.kotlin.math.Float3
import dev.romainguy.kotlin.math.Quaternion
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin

/**
 * First-person walkthrough camera state. Pure data and trigonometry — no Filament, no
 * SceneView, no Compose — so it can be reasoned about (and unit tested) on its own.
 *
 * Filament cameras look down their local -Z, which is the convention every angle here
 * is built around:
 *
 *     forward = (-sin(yaw) * cos(pitch),  sin(pitch),  -cos(yaw) * cos(pitch))
 *     right   = ( cos(yaw),               0,           -sin(yaw))
 *
 * At yaw = 0, pitch = 0 that gives forward = (0, 0, -1) and right = (1, 0, 0), which is
 * exactly cross(forward, up).
 */
class CameraRig(
    startX: Float = 0f,
    startY: Float = EYE_HEIGHT_M,
    startZ: Float = 0f,
    startYawDeg: Float = 0f,
) {
    var x: Float = startX
        private set
    var y: Float = startY
        private set
    var z: Float = startZ
        private set

    /** Radians, about +Y. 0 looks along -Z. */
    var yaw: Float = (startYawDeg * PI.toFloat() / 180f)
        private set

    /** Radians, clamped to just short of straight up/down to avoid gimbal snap. */
    var pitch: Float = 0f
        private set

    fun teleport(nx: Float, nz: Float, ny: Float = EYE_HEIGHT_M) {
        x = nx; y = ny; z = nz
    }

    fun faceTowards(tx: Float, tz: Float) {
        val dx = tx - x
        val dz = tz - z
        if (dx * dx + dz * dz < 1e-6f) return
        // Invert forward = (-sin(yaw), _, -cos(yaw)).
        yaw = kotlin.math.atan2(-dx, -dz)
    }

    /** Screen drag, in pixels, applied as a look. */
    fun look(dxPixels: Float, dyPixels: Float) {
        yaw -= dxPixels * LOOK_RADIANS_PER_PIXEL
        pitch = (pitch - dyPixels * LOOK_RADIANS_PER_PIXEL).coerceIn(-MAX_PITCH, MAX_PITCH)
    }

    /**
     * Walks the camera. [forward] and [strafe] are -1..1 joystick axes; [seconds] is
     * the frame time, so speed is frame-rate independent.
     *
     * Movement stays on the floor plane (pitch does not make you fly), which is what
     * makes an interior walkthrough feel like walking rather than flying.
     */
    fun move(forward: Float, strafe: Float, seconds: Float, speedMps: Float = WALK_SPEED_MPS) {
        if (forward == 0f && strafe == 0f) return
        val fx = -sin(yaw)
        val fz = -cos(yaw)
        val rx = cos(yaw)
        val rz = -sin(yaw)
        val step = speedMps * seconds
        x += (fx * forward + rx * strafe) * step
        z += (fz * forward + rz * strafe) * step
    }

    fun raise(dy: Float) {
        y = (y + dy).coerceIn(0.2f, 12f)
    }

    fun position(): Float3 = Float3(x, y, z)

    /**
     * Orientation as a unit quaternion: yaw about +Y, then pitch about the resulting +X.
     * Composed as q = qYaw * qPitch, written out rather than delegated so the component
     * order does not depend on a library's multiplication convention.
     */
    fun quaternion(): Quaternion {
        val hy = yaw * 0.5f
        val hp = pitch * 0.5f
        val cy = cos(hy)
        val sy = sin(hy)
        val cp = cos(hp)
        val sp = sin(hp)
        // qYaw = (0, sy, 0, cy), qPitch = (sp, 0, 0, cp)
        // (w1,v1) * (w2,v2) = (w1w2 - v1.v2, w1v2 + w2v1 + v1 x v2)
        // v1 x v2 = (0,sy,0) x (sp,0,0) = (sy*0 - 0*0, 0*sp - 0*0, 0*0 - sy*sp)
        //         = (0, 0, -sy*sp)
        return Quaternion(
            x = cy * sp,
            y = sy * cp,
            z = -sy * sp,
            w = cy * cp,
        )
    }

    companion object {
        const val EYE_HEIGHT_M = 1.6f
        const val WALK_SPEED_MPS = 1.9f
        private const val LOOK_RADIANS_PER_PIXEL = 0.004f
        private val MAX_PITCH = (PI / 2 - 0.02).toFloat()
    }
}
