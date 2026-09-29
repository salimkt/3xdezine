package com.threexdezine.android.render

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.sin
import kotlin.math.sqrt

class OrbitRigTest {

    private val house = PlanBounds(minX = 0f, maxX = 12f, minZ = 0f, maxZ = 9f, height = 2.7f)
    private val eps = 1e-3f

    private fun lookDirectionError(rig: OrbitRig): Float {
        val s = rig.state
        val p = rig.pose()
        val dx = s.targetX - p.x
        val dy = s.targetY - p.y
        val dz = s.targetZ - p.z
        val len = sqrt(dx * dx + dy * dy + dz * dz)
        val f = CameraMath.forward(p.yaw, p.pitch)
        return abs3(f.x - dx / len, f.y - dy / len, f.z - dz / len)
    }

    private fun abs3(a: Float, b: Float, c: Float) = sqrt(a * a + b * b + c * c)

    @Test
    fun cameraAlwaysLooksAtTheTarget() {
        val rig = OrbitRig(house)
        assertTrue(lookDirectionError(rig) < eps)
        rig.orbit(250f, -120f)
        assertTrue(lookDirectionError(rig) < eps)
        rig.dolly(1.7f)
        rig.pan(80f, 40f, 1920f)
        assertTrue(lookDirectionError(rig) < eps)
    }

    @Test
    fun homeFramesTheWholePlan() {
        val rig = OrbitRig(house)
        for (aspect in listOf(9f / 19.5f, 1f, 19.5f / 9f)) {
            val home = rig.home(aspect)
            assertEquals(house.centreX, home.targetX, eps)
            assertEquals(house.centreZ, home.targetZ, eps)
            // The bounding sphere fits the narrower half-FOV at that distance.
            val v = rig.fovDeg
            val h = CameraMath.horizontalFov(v, aspect)
            val half = minOf(v, h) * CameraMath.DEG * 0.5f
            assertTrue("aspect $aspect", home.distance * sin(half) >= house.radius - eps)
        }
        // Portrait needs to stand further back than landscape.
        assertTrue(rig.home(0.46f).distance > rig.home(2.1f).distance)
    }

    @Test
    fun homeIsAThreeQuarterViewFromAbove() {
        val rig = OrbitRig(house)
        rig.set(rig.home(1f))
        val p = rig.pose()
        assertTrue("camera east of centre", p.x > house.centreX)
        assertTrue("camera south of centre", p.z > house.centreZ)
        assertTrue("camera above the walls", p.y > house.height)
    }

    @Test
    fun pitchNeverGoesUnderTheGround() {
        val rig = OrbitRig(house)
        rig.orbit(0f, -100_000f)
        assertEquals(OrbitRig.MIN_ELEVATION, rig.state.elevation, eps)
        assertTrue(rig.pose().y > 0f)
        rig.orbit(0f, 100_000f)
        assertEquals(OrbitRig.MAX_ELEVATION, rig.state.elevation, eps)
    }

    @Test
    fun dollyIsClampedToTheBounds() {
        val rig = OrbitRig(house)
        repeat(50) { rig.dolly(2f) }
        assertEquals(rig.minDistance, rig.state.distance, eps)
        repeat(50) { rig.dolly(0.5f) }
        assertEquals(rig.maxDistance, rig.state.distance, eps)
        assertTrue(rig.minDistance < rig.home(1f).distance)
        assertTrue(rig.maxDistance > rig.home(0.4f).distance)
        // Nonsense input is ignored.
        val before = rig.state
        rig.dolly(0f)
        rig.dolly(Float.NaN)
        assertEquals(before, rig.state)
    }

    @Test
    fun spreadingFingersDolliesIn() {
        val rig = OrbitRig(house)
        val d = rig.state.distance
        rig.dolly(1.25f)
        assertEquals(d / 1.25f, rig.state.distance, eps)
    }

    @Test
    fun panMovesTheTargetWithTheFingers() {
        val rig = OrbitRig(house)
        rig.set(rig.state.copy(yaw = 0f)) // camera on +Z looking toward -Z; screen right = +X
        val x0 = rig.state.targetX
        val z0 = rig.state.targetZ
        rig.pan(100f, 0f, 1000f)
        // Dragging right pulls the house right, so the target moves left (-X).
        assertTrue(rig.state.targetX < x0)
        assertEquals(z0, rig.state.targetZ, eps)
        val x1 = rig.state.targetX
        rig.pan(0f, -100f, 1000f)
        // Dragging up pushes the house away, so the target comes toward the camera (+Z).
        assertTrue(rig.state.targetZ > z0)
        assertEquals(x1, rig.state.targetX, eps)
    }

    @Test
    fun panCannotLoseTheHouse() {
        val rig = OrbitRig(house)
        repeat(200) { rig.pan(5000f, 5000f, 1000f) }
        val margin = maxOf(2f, house.radius * 0.5f)
        assertTrue(rig.state.targetX >= house.minX - margin - eps)
        assertTrue(rig.state.targetX <= house.maxX + margin + eps)
        assertTrue(rig.state.targetZ >= house.minZ - margin - eps)
        assertTrue(rig.state.targetZ <= house.maxZ + margin + eps)
    }

    @Test
    fun lerpHitsBothEndsAndIsGeometricInDistance() {
        val rig = OrbitRig(house)
        val a = rig.clamp(rig.state.copy(distance = 5f))
        val b = rig.clamp(a.copy(yaw = a.yaw + 3f, distance = 20f, targetX = 1f))
        assertEquals(20f, b.distance, eps) // inside the clamp, so the test means something
        val start = OrbitRig.lerp(a, b, 0f)
        val end = OrbitRig.lerp(a, b, 1f)
        assertEquals(a.distance, start.distance, eps)
        assertEquals(b.distance, end.distance, 1e-2f)
        assertEquals(b.targetX, end.targetX, eps)
        assertEquals(CameraMath.wrapAngle(b.yaw), CameraMath.wrapAngle(end.yaw), eps)
        // Halfway between d and 4d, geometrically, is 2d.
        assertEquals(a.distance * 2f, OrbitRig.lerp(a, b, 0.5f).distance, 1e-2f)
    }

    @Test
    fun doubleTapCentreRayLandsOnTheTarget() {
        val rig = OrbitRig(house)
        rig.set(rig.home(1f))
        val pose = rig.pose()
        val (o, d) = CameraMath.screenRay(pose, 500f, 500f, 1000f, 1000f)!!
        val hit = CameraMath.intersectHorizontalPlane(o, d, rig.state.targetY)!!
        assertEquals(rig.state.targetX, hit.x, 1e-2f)
        assertEquals(rig.state.targetZ, hit.z, 1e-2f)
        val zoomed = rig.zoomedToward(hit.x, hit.z, 0.5f)
        assertEquals(rig.state.distance * 0.5f, zoomed.distance, 1e-2f)
    }
}
