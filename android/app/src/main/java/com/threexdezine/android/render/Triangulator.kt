package com.threexdezine.android.render

import kotlin.math.abs

/**
 * Ear-clipping polygon triangulation with hole support, on the XZ plane.
 *
 * WHY THIS EXISTS RATHER THAN SceneView's `generateShape(polygonPath, polygonHoles, …)`:
 * `generateShape` wraps Earcut and would do the same job, but its exact signature and
 * return type could not be verified without compiling against SceneView 4.38.0 on this
 * machine. This implementation is self-contained, has no external API surface to get
 * wrong, and is small enough to read end to end. If you later want SceneView's version,
 * swap the body of [triangulate] — nothing else depends on how the indices are produced.
 *
 * Coordinates are (x, z) pairs, matching the project's floor plane. "CCW" throughout
 * means a positive shoelace sum of `a.x * b.z - b.x * a.z`.
 *
 * NOTE ON WINDING: a polygon that is CCW by that shoelace convention produces triangles
 * whose 3D normal (cross(v1 - v0, v2 - v0) with y = const) points along **-Y**. So a
 * floor (normal +Y) needs the indices REVERSED, and a ceiling (normal -Y) uses them as
 * produced. [HouseBuilder] does exactly that and says so at the call site.
 */
object Triangulator {

    private const val EPS = 1e-9

    /**
     * @param outer     closed loop, first point not repeated, any winding.
     * @param holes     inner loops, any winding. May be empty.
     * @return flat triangle index triples into `outer + holes.flatten()` (in that order).
     */
    fun triangulate(
        outer: List<DoubleArray>,
        holes: List<List<DoubleArray>> = emptyList(),
    ): IntArray {
        if (outer.size < 3) return IntArray(0)

        // Working polygon: positions plus the ORIGINAL index each position came from.
        val pts = ArrayList<DoubleArray>(outer.size)
        val origin = ArrayList<Int>(outer.size)

        // Outer ring, forced CCW.
        val outerCcw = if (signedArea(outer) < 0) outer.asReversed() else outer
        val outerIsReversed = signedArea(outer) < 0
        for (i in outerCcw.indices) {
            pts += outerCcw[i]
            origin += if (outerIsReversed) outer.size - 1 - i else i
        }

        // Holes, forced CW (opposite of the outer ring), then bridged in.
        var offset = outer.size
        for (hole in holes) {
            if (hole.size >= 3) {
                val holeCw = if (signedArea(hole) > 0) hole.asReversed() else hole
                val holeReversed = signedArea(hole) > 0
                val holePts = ArrayList<DoubleArray>(hole.size)
                val holeOrigin = ArrayList<Int>(hole.size)
                for (i in holeCw.indices) {
                    holePts += holeCw[i]
                    holeOrigin += offset + if (holeReversed) hole.size - 1 - i else i
                }
                bridgeHole(pts, origin, holePts, holeOrigin)
            }
            offset += hole.size
        }

        val local = earClip(pts)
        val out = IntArray(local.size)
        for (i in local.indices) out[i] = origin[local[i]]
        return out
    }

    // -----------------------------------------------------------------------

    fun signedArea(poly: List<DoubleArray>): Double {
        var sum = 0.0
        for (i in poly.indices) {
            val a = poly[i]
            val b = poly[(i + 1) % poly.size]
            sum += a[0] * b[1] - b[0] * a[1]
        }
        return sum / 2.0
    }

    fun pointInPolygon(px: Double, pz: Double, poly: List<DoubleArray>): Boolean {
        var inside = false
        var j = poly.size - 1
        for (i in poly.indices) {
            val xi = poly[i][0]
            val zi = poly[i][1]
            val xj = poly[j][0]
            val zj = poly[j][1]
            if ((zi > pz) != (zj > pz) &&
                px < (xj - xi) * (pz - zi) / (zj - zi + EPS) + xi
            ) {
                inside = !inside
            }
            j = i
        }
        return inside
    }

    /**
     * Splices a hole into the outer ring with a two-way bridge.
     *
     * Takes the hole's right-most vertex M, then picks the outer vertex that is visible
     * from M (segment M→candidate crosses no polygon edge) and closest to it. The scan
     * is O(outer * edges), which is irrelevant at floor-plan sizes and much easier to
     * verify than earcut's ray-cast + reflex-refinement version.
     */
    private fun bridgeHole(
        pts: ArrayList<DoubleArray>,
        origin: ArrayList<Int>,
        holePts: List<DoubleArray>,
        holeOrigin: List<Int>,
    ) {
        var mIdx = 0
        for (i in holePts.indices) if (holePts[i][0] > holePts[mIdx][0]) mIdx = i
        val m = holePts[mIdx]

        var bestOuter = -1
        var bestDist = Double.MAX_VALUE
        for (i in pts.indices) {
            val c = pts[i]
            val d = dist2(m, c)
            if (d >= bestDist) continue
            if (segmentIsClear(m, c, pts, holePts)) {
                bestDist = d
                bestOuter = i
            }
        }
        if (bestOuter < 0) bestOuter = 0 // Degenerate input: splice anyway rather than drop the hole.

        // outer[0..bestOuter] + hole[mIdx..] + hole[..mIdx] + hole[mIdx] + outer[bestOuter..]
        val merged = ArrayList<DoubleArray>(pts.size + holePts.size + 2)
        val mergedOrigin = ArrayList<Int>(pts.size + holePts.size + 2)
        for (i in 0..bestOuter) {
            merged += pts[i]; mergedOrigin += origin[i]
        }
        for (k in holePts.indices) {
            val i = (mIdx + k) % holePts.size
            merged += holePts[i]; mergedOrigin += holeOrigin[i]
        }
        merged += holePts[mIdx]; mergedOrigin += holeOrigin[mIdx]
        for (i in bestOuter until pts.size) {
            merged += pts[i]; mergedOrigin += origin[i]
        }

        pts.clear(); pts.addAll(merged)
        origin.clear(); origin.addAll(mergedOrigin)
    }

    private fun segmentIsClear(
        a: DoubleArray,
        b: DoubleArray,
        outer: List<DoubleArray>,
        hole: List<DoubleArray>,
    ): Boolean {
        for (ring in listOf(outer, hole)) {
            for (i in ring.indices) {
                val p = ring[i]
                val q = ring[(i + 1) % ring.size]
                if (sharesEndpoint(a, b, p, q)) continue
                if (segmentsIntersect(a, b, p, q)) return false
            }
        }
        return true
    }

    private fun sharesEndpoint(a: DoubleArray, b: DoubleArray, p: DoubleArray, q: DoubleArray) =
        same(a, p) || same(a, q) || same(b, p) || same(b, q)

    private fun same(a: DoubleArray, b: DoubleArray) =
        abs(a[0] - b[0]) < 1e-12 && abs(a[1] - b[1]) < 1e-12

    private fun segmentsIntersect(
        p1: DoubleArray,
        p2: DoubleArray,
        p3: DoubleArray,
        p4: DoubleArray,
    ): Boolean {
        val d1 = cross(p3, p4, p1)
        val d2 = cross(p3, p4, p2)
        val d3 = cross(p1, p2, p3)
        val d4 = cross(p1, p2, p4)
        return ((d1 > EPS && d2 < -EPS) || (d1 < -EPS && d2 > EPS)) &&
            ((d3 > EPS && d4 < -EPS) || (d3 < -EPS && d4 > EPS))
    }

    private fun cross(o: DoubleArray, a: DoubleArray, b: DoubleArray): Double =
        (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    private fun dist2(a: DoubleArray, b: DoubleArray): Double {
        val dx = a[0] - b[0]
        val dz = a[1] - b[1]
        return dx * dx + dz * dz
    }

    /** Standard O(n^2) ear clipping on a CCW simple polygon. */
    private fun earClip(poly: List<DoubleArray>): IntArray {
        val n = poly.size
        if (n < 3) return IntArray(0)

        val remaining = ArrayList<Int>(n)
        for (i in 0 until n) remaining += i
        val out = ArrayList<Int>((n - 2) * 3)

        var guard = 0
        val guardLimit = n * n + 16

        while (remaining.size > 3) {
            if (guard++ > guardLimit) {
                // Numerically hostile polygon. A fan is wrong-ish but never crashes and
                // never produces a hole in the floor.
                out.clear()
                for (i in 1 until remaining.size - 1) {
                    out += remaining[0]; out += remaining[i]; out += remaining[i + 1]
                }
                return out.toIntArray()
            }
            var clipped = false
            for (k in remaining.indices) {
                val iPrev = remaining[(k - 1 + remaining.size) % remaining.size]
                val iCur = remaining[k]
                val iNext = remaining[(k + 1) % remaining.size]
                if (isEar(poly, remaining, iPrev, iCur, iNext)) {
                    out += iPrev; out += iCur; out += iNext
                    remaining.removeAt(k)
                    clipped = true
                    break
                }
            }
            if (!clipped) {
                // No ear found (collinear run). Drop the most degenerate vertex.
                remaining.removeAt(remaining.size - 1)
            }
        }
        if (remaining.size == 3) {
            out += remaining[0]; out += remaining[1]; out += remaining[2]
        }
        return out.toIntArray()
    }

    private fun isEar(
        poly: List<DoubleArray>,
        remaining: List<Int>,
        iPrev: Int,
        iCur: Int,
        iNext: Int,
    ): Boolean {
        val a = poly[iPrev]
        val b = poly[iCur]
        val c = poly[iNext]
        // Convex in a CCW polygon means a positive cross product.
        if (cross(a, b, c) <= EPS) return false
        for (idx in remaining) {
            if (idx == iPrev || idx == iCur || idx == iNext) continue
            if (pointInTriangle(poly[idx], a, b, c)) return false
        }
        return true
    }

    private fun pointInTriangle(p: DoubleArray, a: DoubleArray, b: DoubleArray, c: DoubleArray): Boolean {
        val d1 = cross(a, b, p)
        val d2 = cross(b, c, p)
        val d3 = cross(c, a, p)
        val hasNeg = d1 < -EPS || d2 < -EPS || d3 < -EPS
        val hasPos = d1 > EPS || d2 > EPS || d3 > EPS
        return !(hasNeg && hasPos)
    }
}
