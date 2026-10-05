package com.threexdezine.android.ui.home

import com.threexdezine.android.data.model.Floor
import com.threexdezine.android.data.model.Opening
import com.threexdezine.android.data.model.Wall
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min

/**
 * The maths behind the plan thumbnails, kept free of Compose and Android types so it runs
 * in plain JVM unit tests (`PlanGeometryTest`).
 *
 * The plan is drawn top-down with +X to the right and +Z DOWN the screen, which is the
 * floor-plane convention in `shared/types.ts` (z = south), so no axis is flipped.
 */
object PlanGeometry {

    const val SQFT_PER_SQM = 10.7639

    data class Bounds(val minX: Double, val minZ: Double, val maxX: Double, val maxZ: Double) {
        val width: Double get() = maxX - minX
        val depth: Double get() = maxZ - minZ
    }

    /** Uniform scale and offset mapping plan metres to canvas pixels. */
    data class Fit(val scale: Float, val offsetX: Float, val offsetY: Float) {
        fun x(planX: Double): Float = (offsetX + planX * scale).toFloat()
        fun y(planZ: Double): Float = (offsetY + planZ * scale).toFloat()
    }

    /** Extents of every room vertex and wall end point, grown by half the thickest wall. */
    fun bounds(floor: Floor): Bounds? {
        var minX = Double.POSITIVE_INFINITY
        var minZ = Double.POSITIVE_INFINITY
        var maxX = Double.NEGATIVE_INFINITY
        var maxZ = Double.NEGATIVE_INFINITY
        fun add(x: Double, z: Double) {
            minX = min(minX, x); maxX = max(maxX, x)
            minZ = min(minZ, z); maxZ = max(maxZ, z)
        }
        floor.rooms.forEach { r -> r.polygon.forEach { add(it.x, it.z) } }
        floor.walls.forEach { w -> add(w.start.x, w.start.z); add(w.end.x, w.end.z) }
        if (minX > maxX) return null
        val pad = (floor.walls.maxOfOrNull { it.thicknessM } ?: 0.0) / 2.0
        return Bounds(minX - pad, minZ - pad, maxX + pad, maxZ + pad)
    }

    /**
     * Fits [b] inside a [width] x [height] canvas with [padding] pixels on every side,
     * preserving aspect ratio and centring the slack. A degenerate plan (zero width or
     * depth) is treated as 1 m so the scale stays finite.
     */
    fun fit(b: Bounds, width: Float, height: Float, padding: Float): Fit {
        val availW = max(1f, width - 2 * padding)
        val availH = max(1f, height - 2 * padding)
        val planW = max(b.width, 1e-3)
        val planD = max(b.depth, 1e-3)
        val scale = min(availW / planW, availH / planD).toFloat()
        val usedW = planW * scale
        val usedH = planD * scale
        val offsetX = (padding + (availW - usedW) / 2.0 - b.minX * scale).toFloat()
        val offsetY = (padding + (availH - usedH) / 2.0 - b.minZ * scale).toFloat()
        return Fit(scale, offsetX, offsetY)
    }

    /**
     * The solid stretches of [wall] once its [openings] are cut out, as `t` ranges
     * (0..1 from start to end). Opening `t` is the opening's CENTRE, as in the renderer.
     * Overlapping openings merge; an opening running off either end is clamped.
     */
    fun solidSpans(wall: Wall, openings: List<Opening>): List<Pair<Double, Double>> {
        val length = hypot(wall.end.x - wall.start.x, wall.end.z - wall.start.z)
        if (length < 1e-9) return emptyList()
        val gaps = openings
            .filter { it.wallId == wall.id && it.widthM > 0 }
            .map { o ->
                val half = o.widthM / 2.0 / length
                (o.t - half).coerceIn(0.0, 1.0) to (o.t + half).coerceIn(0.0, 1.0)
            }
            .filter { it.second - it.first > 1e-9 }
            .sortedBy { it.first }

        val spans = ArrayList<Pair<Double, Double>>()
        var cursor = 0.0
        for ((g0, g1) in gaps) {
            if (g0 > cursor + 1e-9) spans += cursor to g0
            cursor = max(cursor, g1)
        }
        if (cursor < 1.0 - 1e-9) spans += cursor to 1.0
        return spans
    }

    /** The gaps themselves, for drawing a window as a thin glazing line. */
    fun openingSpan(wall: Wall, opening: Opening): Pair<Double, Double>? {
        val length = hypot(wall.end.x - wall.start.x, wall.end.z - wall.start.z)
        if (length < 1e-9 || opening.widthM <= 0) return null
        val half = opening.widthM / 2.0 / length
        return (opening.t - half).coerceIn(0.0, 1.0) to (opening.t + half).coerceIn(0.0, 1.0)
    }

    fun pointAt(wall: Wall, t: Double): Pair<Double, Double> =
        (wall.start.x + (wall.end.x - wall.start.x) * t) to (wall.start.z + (wall.end.z - wall.start.z) * t)

    fun sqft(sqm: Double): Double = sqm * SQFT_PER_SQM
}
