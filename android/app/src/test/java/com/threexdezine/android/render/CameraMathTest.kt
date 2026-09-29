package com.threexdezine.android.render

import dev.romainguy.kotlin.math.Float3
import dev.romainguy.kotlin.math.Quaternion
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.PI
import kotlin.math.abs

class CameraMathTest {

    private val eps = 1e-4f

    /** v' = v + 2w(q×v) + 2 q×(q×v), written out so the test trusts no library. */
    private fun rotate(q: Quaternion, v: Float3): Float3 {
        fun cross(a: Float3, b: Float3) =
            Float3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x)
        val u = Float3(q.x, q.y, q.z)
        val t = cross(u, v).let { Float3(it.x * 2f, it.y * 2f, it.z * 2f) }
        val c = cross(u, t)
        return Float3(v.x + q.w * t.x + c.x, v.y + q.w * t.y + c.y, v.z + q.w * t.z + c.z)
    }

    private fun assertVec(expected: Float3, actual: Float3, tol: Float = eps) {
        assertEquals("x", expected.x, actual.x, tol)
        assertEquals("y", expected.y, actual.y, tol)
        assertEquals("z", expected.z, actual.z, tol)
    }

    @Test
    fun sceneViewDefaultLensIsAbout46Degrees() {
        assertEquals(46.4f, CameraMath.verticalFovForFocalLengthMm(28.0), 0.05f)
        assertEquals(46.4f, CameraRig.DEFAULT_FOV_DEG, 0.05f)
    }

    @Test
    fun focalLengthRoundTrips() {
        for (fov in listOf(30f, 45f, 60f, 80f)) {
            val f = CameraMath.focalLengthMmForVerticalFov(fov)
            assertEquals(fov, CameraMath.verticalFovForFocalLengthMm(f), 1e-3f)
        }
        // Narrower FOV = longer lens.
        assertTrue(CameraMath.focalLengthMmForVerticalFov(30f) > CameraMath.focalLengthMmForVerticalFov(80f))
    }

    @Test
    fun horizontalFovFollowsAspect() {
        assertEquals(50f, CameraMath.horizontalFov(50f, 1f), 1e-3f)
        assertTrue(CameraMath.horizontalFov(50f, 0.5f) < 50f)
        assertTrue(CameraMath.horizontalFov(50f, 2f) > 50f)
    }

    @Test
    fun yawInterpolatesAlongTheShortestArc() {
        val a = 170f * CameraMath.DEG
        val b = -170f * CameraMath.DEG
        val mid = CameraMath.wrapAngle(CameraMath.lerpAngle(a, b, 0.5f))
        assertEquals(PI.toFloat(), abs(mid), 1e-3f)
        assertEquals(b, CameraMath.wrapAngle(CameraMath.lerpAngle(a, b, 1f)), 1e-4f)
        assertEquals(0.5f, CameraMath.lerpAngle(0f, 1f, 0.5f), eps)
    }

    @Test
    fun wrapAngleStaysInRange() {
        for (deg in listOf(-721f, -181f, -180f, 0f, 179f, 181f, 540f, 1000f)) {
            val w = CameraMath.wrapAngle(deg * CameraMath.DEG)
            assertTrue("$deg -> $w", w > -PI.toFloat() - 1e-5f && w <= PI.toFloat() + 1e-5f)
        }
    }

    @Test
    fun quaternionTurnsMinusZIntoForward() {
        for (yawDeg in listOf(0f, 30f, -90f, 135f)) {
            for (pitchDeg in listOf(0f, 20f, -45f)) {
                val yaw = yawDeg * CameraMath.DEG
                val pitch = pitchDeg * CameraMath.DEG
                val q = CameraMath.quaternion(yaw, pitch)
                assertVec(CameraMath.forward(yaw, pitch), rotate(q, Float3(0f, 0f, -1f)))
                assertVec(CameraMath.right(yaw), rotate(q, Float3(1f, 0f, 0f)))
            }
        }
    }

    @Test
    fun centreRayIsForward() {
        val pose = CameraPose(1f, 2f, 3f, 0.4f, -0.3f, 50f)
        val (o, d) = CameraMath.screenRay(pose, 540f, 960f, 1080f, 1920f)!!
        assertVec(pose.position(), o)
        assertVec(CameraMath.forward(pose.yaw, pose.pitch), d)
    }

    @Test
    fun topEdgeRayIsHalfFovAboveForward() {
        val pose = CameraPose(0f, 0f, 0f, 0f, 0f, 60f)
        val (_, d) = CameraMath.screenRay(pose, 500f, 0f, 1000f, 1000f)!!
        // Looking down -Z, the top-centre ray points up by exactly half the vertical FOV.
        val angle = kotlin.math.atan2(d.y, -d.z) / CameraMath.DEG
        assertEquals(30f, angle, 1e-2f)
    }

    @Test
    fun planeIntersection() {
        val hit = CameraMath.intersectHorizontalPlane(Float3(0f, 10f, 0f), Float3(0f, -1f, 0f), 0f)
        assertNotNull(hit)
        assertVec(Float3(0f, 0f, 0f), hit!!)
        // Looking up never hits the floor.
        assertEquals(null, CameraMath.intersectHorizontalPlane(Float3(0f, 1f, 0f), Float3(0f, 1f, 0f), 0f))
    }

    @Test
    fun poseLerpEndpoints() {
        val a = CameraPose(0f, 1.6f, 0f, 3f, 0.1f, 46f)
        val b = CameraPose(10f, 8f, -4f, -3f, -0.5f, 45f)
        val start = CameraMath.lerp(a, b, 0f)
        val end = CameraMath.lerp(a, b, 1f)
        assertEquals(a.x, start.x, eps); assertEquals(a.fovDeg, start.fovDeg, eps)
        assertEquals(b.x, end.x, eps); assertEquals(b.y, end.y, eps); assertEquals(b.z, end.z, eps)
        assertEquals(CameraMath.wrapAngle(b.yaw), CameraMath.wrapAngle(end.yaw), 1e-4f)
        assertEquals(b.pitch, end.pitch, eps)
    }

    @Test
    fun walkFovIsClamped() {
        val rig = CameraRig()
        rig.zoomFov(100f)
        assertEquals(CameraRig.MIN_FOV_DEG, rig.fovDeg, eps)
        rig.zoomFov(0.001f)
        assertEquals(CameraRig.MAX_FOV_DEG, rig.fovDeg, eps)
        rig.zoomFov(Float.NaN)
        assertEquals(CameraRig.MAX_FOV_DEG, rig.fovDeg, eps)
    }

    @Test
    fun walkPoseRoundTrips() {
        val rig = CameraRig(1f, 1.6f, 2f)
        val p = CameraPose(3f, 1.7f, -2f, 0.7f, 0.2f, 55f)
        rig.setPose(p)
        val back = rig.pose()
        assertEquals(p, back) // exact: nothing needed clamping
    }
}
