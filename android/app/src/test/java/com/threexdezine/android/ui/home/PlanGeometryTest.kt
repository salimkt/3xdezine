package com.threexdezine.android.ui.home

import com.threexdezine.android.data.model.Floor
import com.threexdezine.android.data.model.Opening
import com.threexdezine.android.data.model.Room
import com.threexdezine.android.data.model.Vec2
import com.threexdezine.android.data.model.Wall
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PlanGeometryTest {

    private val eps = 1e-6

    private fun wall(id: String, x0: Double, z0: Double, x1: Double, z1: Double, t: Double = 0.2) =
        Wall(id, Vec2(x0, z0), Vec2(x1, z1), heightM = 2.7, thicknessM = t, exterior = true)

    private fun opening(wallId: String, t: Double, w: Double) =
        Opening(id = "o-$wallId-$t", wallId = wallId, t = t, widthM = w, heightM = 2.1, sillM = 0.0)

    @Test
    fun boundsIncludeHalfTheThickestWall() {
        val floor = Floor(
            id = "f", name = "G", level = 0,
            walls = listOf(wall("a", 0.0, 0.0, 10.0, 0.0, t = 0.3)),
            rooms = listOf(Room("r", "R", listOf(Vec2(0.0, 0.0), Vec2(10.0, 0.0), Vec2(10.0, 5.0)), 2.7)),
        )
        val b = PlanGeometry.bounds(floor)!!
        assertEquals(-0.15, b.minX, eps)
        assertEquals(10.15, b.maxX, eps)
        assertEquals(-0.15, b.minZ, eps)
        assertEquals(5.15, b.maxZ, eps)
    }

    @Test
    fun emptyFloorHasNoBounds() {
        assertNull(PlanGeometry.bounds(Floor(id = "f", name = "G", level = 0)))
    }

    @Test
    fun fitPreservesAspectAndCentres() {
        // 10 m x 5 m into a 100 x 100 canvas, no padding: width-limited, scale 10,
        // so the 50 px tall plan sits 25 px down.
        val fit = PlanGeometry.fit(PlanGeometry.Bounds(0.0, 0.0, 10.0, 5.0), 100f, 100f, 0f)
        assertEquals(10f, fit.scale, 1e-4f)
        assertEquals(0f, fit.x(0.0), 1e-4f)
        assertEquals(100f, fit.x(10.0), 1e-4f)
        assertEquals(25f, fit.y(0.0), 1e-4f)
        assertEquals(75f, fit.y(5.0), 1e-4f)
    }

    @Test
    fun fitHonoursPaddingAndOffsetOrigin() {
        val fit = PlanGeometry.fit(PlanGeometry.Bounds(-2.0, 3.0, 2.0, 7.0), 120f, 80f, 10f)
        // 4 x 4 m into 100 x 60: height-limited at 15 px/m, centred horizontally.
        assertEquals(15f, fit.scale, 1e-4f)
        assertEquals(10f, fit.y(3.0), 1e-4f)
        assertEquals(70f, fit.y(7.0), 1e-4f)
        assertEquals(60f, (fit.x(-2.0) + fit.x(2.0)) / 2f, 1e-4f)
    }

    @Test
    fun fitSurvivesADegeneratePlan() {
        val fit = PlanGeometry.fit(PlanGeometry.Bounds(1.0, 1.0, 1.0, 1.0), 100f, 100f, 0f)
        assertTrue(fit.scale.isFinite())
    }

    @Test
    fun openingIsCutOutOfTheWallByItsCentre() {
        val w = wall("a", 0.0, 0.0, 4.0, 0.0)
        val spans = PlanGeometry.solidSpans(w, listOf(opening("a", 0.5, 1.0)))
        assertEquals(2, spans.size)
        assertEquals(0.0, spans[0].first, eps)
        assertEquals(0.375, spans[0].second, eps)
        assertEquals(0.625, spans[1].first, eps)
        assertEquals(1.0, spans[1].second, eps)
    }

    @Test
    fun overlappingAndEdgeOpeningsMergeAndClamp() {
        val w = wall("a", 0.0, 0.0, 10.0, 0.0)
        val spans = PlanGeometry.solidSpans(
            w,
            listOf(
                opening("a", 0.05, 2.0), // runs off the start: gap 0..0.15
                opening("a", 0.5, 2.0), // 0.4..0.6
                opening("a", 0.55, 2.0), // 0.45..0.65, overlaps the previous
                opening("other", 0.8, 1.0), // a different wall: ignored
            ),
        )
        assertEquals(listOf(0.15 to 0.4, 0.65 to 1.0).size, spans.size)
        assertEquals(0.15, spans[0].first, eps)
        assertEquals(0.4, spans[0].second, eps)
        assertEquals(0.65, spans[1].first, eps)
        assertEquals(1.0, spans[1].second, eps)
    }

    @Test
    fun wallWithoutOpeningsIsOneSpan() {
        val spans = PlanGeometry.solidSpans(wall("a", 1.0, 1.0, 1.0, 6.0), emptyList())
        assertEquals(listOf(0.0 to 1.0), spans)
        assertEquals(1.0 to 3.5, PlanGeometry.pointAt(wall("a", 1.0, 1.0, 1.0, 6.0), 0.5))
    }

    @Test
    fun squareMetresToSquareFeet() {
        assertEquals(1076.39, PlanGeometry.sqft(100.0), 1e-6)
    }
}
