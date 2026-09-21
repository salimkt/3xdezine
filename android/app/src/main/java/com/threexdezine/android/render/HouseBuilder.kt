package com.threexdezine.android.render

import com.threexdezine.android.data.model.Catalog
import com.threexdezine.android.data.model.ComponentType
import com.threexdezine.android.data.model.Floor
import com.threexdezine.android.data.model.Opening
import com.threexdezine.android.data.model.Project
import com.threexdezine.android.data.model.Vec2
import com.threexdezine.android.data.model.Wall
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin

/**
 * Builds the house shell at runtime from the floor plan.
 *
 * Building the shell here rather than shipping a baked .glb is what makes material
 * swaps instant — a swap re-binds a MaterialInstance, it does not re-download a model.
 *
 * What is produced, per ARCHITECTURE.md:
 *  - Floors and ceilings: the room polygon triangulated with [Triangulator] (ear
 *    clipping with hole support), UV0 = world (x, z) in metres.
 *  - Walls: a real extruded box with thickness — never a single-sided plane, because
 *    long thin single-sided wall geometry is the classic source of shadow acne and
 *    peter-panning. Each long face is cut into a grid around its openings, so the
 *    openings are genuine holes rather than decals, and each opening gets four reveal
 *    faces (two jambs, a head, and a sill when it is not a door).
 *  - Door leaves as thin inset boxes. WINDOW openings are left OPEN on purpose: the IBL
 *    then actually lights the interior through them, which is the whole point of the
 *    AgX tone mapper choice for blown window highlights.
 *  - Placed components as simple boxes at catalog dimensions. Authored .glb furniture is
 *    the intended upgrade path (see README) — there are no .glb assets in this repo.
 *
 * The roof is deliberately NOT rendered: this is an interior walkthrough, and a roof
 * over the camera just makes the scene black. It is still priced by the cost engine.
 *
 * UV CONVENTION: UV0 is in METRES everywhere. Tiling is then a pure per-material
 * concern: scale = 1 / texture.tileSizeM via setBaseColorUvMatrix. See [MaterialFactory].
 */
object HouseBuilder {

    /** Keeps the floor slab out of the wall bottoms' depth range. */
    private const val FLOOR_Y = 0.0f

    fun build(project: Project, catalog: Catalog): List<SurfacePart> {
        val floor = project.groundFloor ?: return emptyList()
        val parts = mutableListOf<SurfacePart>()
        parts += buildRoomSurfaces(floor)
        parts += buildWalls(floor)
        parts += buildDoorLeaves(floor, catalog)
        parts += buildPlacedComponents(floor, catalog)
        return parts.filterNot { it.mesh.isEmpty }
    }

    // -----------------------------------------------------------------------
    // Floors and ceilings
    // -----------------------------------------------------------------------

    private fun buildRoomSurfaces(floor: Floor): List<SurfacePart> {
        val parts = mutableListOf<SurfacePart>()
        for (room in floor.rooms) {
            if (room.polygon.size < 3) continue
            val ring = room.polygon.map { doubleArrayOf(it.x, it.z) }
            val tris = Triangulator.triangulate(ring)
            if (tris.isEmpty()) continue

            // FLOOR — normal +Y. Triangulator emits CCW-in-(x,z) triples, whose 3D
            // normal points -Y, so the winding is reversed here.
            val fb = MeshBuilder(room.polygon.size)
            for (p in room.polygon) {
                fb.vertex(p.x.toFloat(), FLOOR_Y, p.z.toFloat(), p.x.toFloat(), p.z.toFloat())
            }
            var i = 0
            while (i < tris.size) {
                fb.triangle(tris[i + 2], tris[i + 1], tris[i])
                i += 3
            }
            parts += SurfacePart(SurfaceRef.RoomFloor(room.id), fb.build())

            // CEILING — normal -Y, so the CCW triples are used as produced.
            val cy = room.ceilingHeightM.toFloat()
            val cb = MeshBuilder(room.polygon.size)
            for (p in room.polygon) {
                cb.vertex(p.x.toFloat(), cy, p.z.toFloat(), p.x.toFloat(), p.z.toFloat())
            }
            i = 0
            while (i < tris.size) {
                cb.triangle(tris[i], tris[i + 1], tris[i + 2])
                i += 3
            }
            parts += SurfacePart(SurfaceRef.RoomCeiling(room.id), cb.build())
        }
        return parts
    }

    // -----------------------------------------------------------------------
    // Walls
    // -----------------------------------------------------------------------

    private class WallFrame(wall: Wall) {
        val sx = wall.start.x
        val sz = wall.start.z
        val length = hypot(wall.end.x - wall.start.x, wall.end.z - wall.start.z)

        /** Unit direction along the wall, start -> end, on the XZ plane. */
        val dx = if (length > 1e-9) (wall.end.x - wall.start.x) / length else 1.0
        val dz = if (length > 1e-9) (wall.end.z - wall.start.z) / length else 0.0

        /** Left normal: cross(d, +Y) == (-dz, 0, dx). */
        val nx = -dz
        val nz = dx

        val half = wall.thicknessM / 2.0
        val height = wall.heightM

        /** World position at (along-wall u, across-wall v, height y). */
        fun px(u: Double, v: Double): Float = (sx + dx * u + nx * v).toFloat()
        fun pz(u: Double, v: Double): Float = (sz + dz * u + nz * v).toFloat()
    }

    private fun buildWalls(floor: Floor): List<SurfacePart> {
        val parts = mutableListOf<SurfacePart>()
        val openingsByWall = floor.openings.groupBy { it.wallId }
        val roomRings = floor.rooms.map { r -> r.polygon.map { doubleArrayOf(it.x, it.z) } }

        for (wall in floor.walls) {
            val f = WallFrame(wall)
            if (f.length < 1e-6 || f.height < 1e-6) continue

            val rects = openingsByWall[wall.id].orEmpty()
                .mapNotNull { it.toRect(f) }

            // Which side faces indoors? Probe just outside each face and test the room
            // polygons, rather than trusting the wall's winding order.
            val midU = f.length / 2.0
            val probeOut = f.half + 0.12
            val plusIsInterior = roomRings.any {
                Triangulator.pointInPolygon(
                    f.px(midU, probeOut).toDouble(),
                    f.pz(midU, probeOut).toDouble(),
                    it,
                )
            }
            val minusIsInterior = roomRings.any {
                Triangulator.pointInPolygon(
                    f.px(midU, -probeOut).toDouble(),
                    f.pz(midU, -probeOut).toDouble(),
                    it,
                )
            }

            // Interior walls wear the same finish on both sides, so the probe only has
            // to decide anything for exterior walls.
            val interiorOnPlus = when {
                plusIsInterior && !minusIsInterior -> true
                minusIsInterior && !plusIsInterior -> false
                else -> true
            }

            val plusRef: SurfaceRef
            val minusRef: SurfaceRef
            if (!wall.exterior) {
                plusRef = SurfaceRef.WallInterior(wall.id)
                minusRef = SurfaceRef.WallInterior(wall.id)
            } else if (interiorOnPlus) {
                plusRef = SurfaceRef.WallInterior(wall.id)
                minusRef = SurfaceRef.WallExterior(wall.id)
            } else {
                plusRef = SurfaceRef.WallExterior(wall.id)
                minusRef = SurfaceRef.WallInterior(wall.id)
            }

            val plusBuilder = MeshBuilder(32)
            addWallFace(plusBuilder, f, rects, positiveSide = true)
            if (!plusBuilder.isEmpty) parts += SurfacePart(plusRef, plusBuilder.build())

            val minusBuilder = MeshBuilder(32)
            addWallFace(minusBuilder, f, rects, positiveSide = false)
            if (!minusBuilder.isEmpty) parts += SurfacePart(minusRef, minusBuilder.build())

            val structure = MeshBuilder(32)
            addWallTopAndCaps(structure, f)
            rects.forEach { addOpeningReveals(structure, f, it) }
            if (!structure.isEmpty) {
                parts += SurfacePart(SurfaceRef.WallStructure(wall.id), structure.build())
            }
        }
        return parts
    }

    /** An opening projected onto a wall face: [u0,u1] along the wall, [y0,y1] up it. */
    private class OpeningRect(
        val u0: Double,
        val u1: Double,
        val y0: Double,
        val y1: Double,
        val source: Opening,
    )

    private fun Opening.toRect(f: WallFrame): OpeningRect? {
        val centre = t.coerceIn(0.0, 1.0) * f.length
        val u0 = max(0.0, centre - widthM / 2.0)
        val u1 = min(f.length, centre + widthM / 2.0)
        val y0 = max(0.0, sillM)
        val y1 = min(f.height, sillM + heightM)
        if (u1 - u0 < 1e-4 || y1 - y0 < 1e-4) return null
        return OpeningRect(u0, u1, y0, y1, this)
    }

    /**
     * Emits one long wall face as a grid of quads with the opening cells dropped.
     *
     * The grid is the set of u-edges {0, L} plus every opening edge, crossed with the
     * y-edges {0, H} plus every sill and head. That is exact for axis-aligned
     * rectangular openings and needs no clipping library.
     */
    private fun addWallFace(
        mb: MeshBuilder,
        f: WallFrame,
        rects: List<OpeningRect>,
        positiveSide: Boolean,
    ) {
        val v = if (positiveSide) f.half else -f.half

        val uEdges = sortedEdges(listOf(0.0, f.length) + rects.flatMap { listOf(it.u0, it.u1) }, f.length)
        val yEdges = sortedEdges(listOf(0.0, f.height) + rects.flatMap { listOf(it.y0, it.y1) }, f.height)

        for (ui in 0 until uEdges.size - 1) {
            val ua = uEdges[ui]
            val ub = uEdges[ui + 1]
            if (ub - ua < 1e-6) continue
            for (yi in 0 until yEdges.size - 1) {
                val ya = yEdges[yi]
                val yb = yEdges[yi + 1]
                if (yb - ya < 1e-6) continue

                val cu = (ua + ub) / 2.0
                val cy = (ya + yb) / 2.0
                val covered = rects.any { cu > it.u0 && cu < it.u1 && cy > it.y0 && cy < it.y1 }
                if (covered) continue

                if (positiveSide) {
                    // Seen from +n, U = +d and V = +Y, so (ua,ya)->(ub,ya)->(ub,yb)->(ua,yb)
                    // is counter-clockwise: cross(d, +Y) == n.
                    mb.quad(
                        f.px(ua, v), ya.toFloat(), f.pz(ua, v), ua.toFloat(), ya.toFloat(),
                        f.px(ub, v), ya.toFloat(), f.pz(ub, v), ub.toFloat(), ya.toFloat(),
                        f.px(ub, v), yb.toFloat(), f.pz(ub, v), ub.toFloat(), yb.toFloat(),
                        f.px(ua, v), yb.toFloat(), f.pz(ua, v), ua.toFloat(), yb.toFloat(),
                    )
                } else {
                    // Mirrored winding, and U runs the other way so the texture is not
                    // flipped when read from the far side.
                    val mua = (f.length - ua).toFloat()
                    val mub = (f.length - ub).toFloat()
                    mb.quad(
                        f.px(ua, v), ya.toFloat(), f.pz(ua, v), mua, ya.toFloat(),
                        f.px(ua, v), yb.toFloat(), f.pz(ua, v), mua, yb.toFloat(),
                        f.px(ub, v), yb.toFloat(), f.pz(ub, v), mub, yb.toFloat(),
                        f.px(ub, v), ya.toFloat(), f.pz(ub, v), mub, ya.toFloat(),
                    )
                }
            }
        }
    }

    private fun sortedEdges(values: List<Double>, limit: Double): List<Double> {
        val clamped = values.map { it.coerceIn(0.0, limit) }.sorted()
        val out = ArrayList<Double>(clamped.size)
        for (value in clamped) {
            if (out.isEmpty() || value - out.last() > 1e-6) out += value
        }
        return out
    }

    /** Wall top face plus the two end caps, all wearing the interior finish. */
    private fun addWallTopAndCaps(mb: MeshBuilder, f: WallFrame) {
        val h = f.height.toFloat()
        val t = f.half * 2.0

        // Top, normal +Y: U = +n (v from -half to +half), V = +d, cross(n, d) == +Y.
        mb.quad(
            f.px(0.0, -f.half), h, f.pz(0.0, -f.half), 0f, 0f,
            f.px(0.0, f.half), h, f.pz(0.0, f.half), t.toFloat(), 0f,
            f.px(f.length, f.half), h, f.pz(f.length, f.half), t.toFloat(), f.length.toFloat(),
            f.px(f.length, -f.half), h, f.pz(f.length, -f.half), 0f, f.length.toFloat(),
        )

        // Far cap at u = L, normal +d: U = +Y, V = +n, cross(+Y, n) == d.
        mb.quad(
            f.px(f.length, -f.half), 0f, f.pz(f.length, -f.half), 0f, 0f,
            f.px(f.length, -f.half), h, f.pz(f.length, -f.half), h, 0f,
            f.px(f.length, f.half), h, f.pz(f.length, f.half), h, t.toFloat(),
            f.px(f.length, f.half), 0f, f.pz(f.length, f.half), 0f, t.toFloat(),
        )

        // Near cap at u = 0, normal -d: the same quad with reversed winding.
        mb.quad(
            f.px(0.0, -f.half), 0f, f.pz(0.0, -f.half), 0f, 0f,
            f.px(0.0, f.half), 0f, f.pz(0.0, f.half), 0f, t.toFloat(),
            f.px(0.0, f.half), h, f.pz(0.0, f.half), h, t.toFloat(),
            f.px(0.0, -f.half), h, f.pz(0.0, -f.half), h, 0f,
        )
    }

    /** The four faces lining an opening: two jambs, a head, and a sill when not a door. */
    private fun addOpeningReveals(mb: MeshBuilder, f: WallFrame, r: OpeningRect) {
        val y0 = r.y0.toFloat()
        val y1 = r.y1.toFloat()
        val t = (f.half * 2.0).toFloat()

        // Jamb at u0, facing INTO the opening (towards +u), so normal = +d.
        mb.quad(
            f.px(r.u0, -f.half), y0, f.pz(r.u0, -f.half), 0f, 0f,
            f.px(r.u0, -f.half), y1, f.pz(r.u0, -f.half), y1 - y0, 0f,
            f.px(r.u0, f.half), y1, f.pz(r.u0, f.half), y1 - y0, t,
            f.px(r.u0, f.half), y0, f.pz(r.u0, f.half), 0f, t,
        )
        // Jamb at u1, normal = -d.
        mb.quad(
            f.px(r.u1, -f.half), y0, f.pz(r.u1, -f.half), 0f, 0f,
            f.px(r.u1, f.half), y0, f.pz(r.u1, f.half), 0f, t,
            f.px(r.u1, f.half), y1, f.pz(r.u1, f.half), y1 - y0, t,
            f.px(r.u1, -f.half), y1, f.pz(r.u1, -f.half), y1 - y0, 0f,
        )
        // Head at y1, facing down: normal -Y, so the winding is the top face's, reversed.
        mb.quad(
            f.px(r.u0, -f.half), y1, f.pz(r.u0, -f.half), 0f, 0f,
            f.px(r.u1, -f.half), y1, f.pz(r.u1, -f.half), (r.u1 - r.u0).toFloat(), 0f,
            f.px(r.u1, f.half), y1, f.pz(r.u1, f.half), (r.u1 - r.u0).toFloat(), t,
            f.px(r.u0, f.half), y1, f.pz(r.u0, f.half), 0f, t,
        )
        // Sill at y0, facing up: normal +Y. Skipped for doors, which sit on the floor.
        if (r.y0 > 1e-3) {
            mb.quad(
                f.px(r.u0, -f.half), y0, f.pz(r.u0, -f.half), 0f, 0f,
                f.px(r.u0, f.half), y0, f.pz(r.u0, f.half), t, 0f,
                f.px(r.u1, f.half), y0, f.pz(r.u1, f.half), t, (r.u1 - r.u0).toFloat(),
                f.px(r.u1, -f.half), y0, f.pz(r.u1, -f.half), 0f, (r.u1 - r.u0).toFloat(),
            )
        }
    }

    // -----------------------------------------------------------------------
    // Door leaves and placed components
    // -----------------------------------------------------------------------

    private fun buildDoorLeaves(floor: Floor, catalog: Catalog): List<SurfacePart> {
        val wallsById = floor.walls.associateBy { it.id }
        val parts = mutableListOf<SurfacePart>()

        for (opening in floor.openings) {
            val componentId = opening.componentId ?: continue // cased opening: a plain void
            val product = catalog.componentsById[componentId] ?: continue
            if (product.type != ComponentType.DOOR) continue // windows stay open for the IBL

            val wall = wallsById[opening.wallId] ?: continue
            val f = WallFrame(wall)
            val rect = opening.toRect(f) ?: continue

            val leafHalf = (product.depthM / 2.0).coerceAtLeast(0.015)
            val inset = 0.02
            val mb = MeshBuilder(24)
            addOrientedBox(
                mb, f,
                u0 = rect.u0 + inset, u1 = rect.u1 - inset,
                v0 = -leafHalf, v1 = leafHalf,
                y0 = rect.y0, y1 = rect.y1 - inset,
            )
            parts += SurfacePart(SurfaceRef.Fitting(componentId, opening.id), mb.build())
        }
        return parts
    }

    private fun buildPlacedComponents(floor: Floor, catalog: Catalog): List<SurfacePart> {
        val parts = mutableListOf<SurfacePart>()
        val ceiling = floor.rooms.minOfOrNull { it.ceilingHeightM } ?: 2.7

        for (placed in floor.components) {
            val product = catalog.componentsById[placed.componentId] ?: continue
            val yBottom = when (product.type) {
                // Pendants hang from the ceiling; everything else stands on the floor.
                ComponentType.LIGHT -> (ceiling - product.heightM).coerceAtLeast(0.0)
                else -> 0.0
            }
            val mb = MeshBuilder(24)
            addRotatedBox(
                mb,
                cx = placed.position.x,
                cz = placed.position.z,
                rotationDeg = placed.rotationDeg,
                halfWidth = product.widthM / 2.0,
                halfDepth = product.depthM / 2.0,
                yBottom = yBottom,
                yTop = yBottom + product.heightM,
            )
            parts += SurfacePart(SurfaceRef.Fitting(product.id, placed.id), mb.build())
        }
        return parts
    }

    /** A box expressed in a wall's (u, v, y) frame. Used for door leaves. */
    private fun addOrientedBox(
        mb: MeshBuilder,
        f: WallFrame,
        u0: Double, u1: Double,
        v0: Double, v1: Double,
        y0: Double, y1: Double,
    ) {
        if (u1 <= u0 || y1 <= y0) return
        val corners = Array(8) { FloatArray(3) }
        var i = 0
        for (uu in listOf(u0, u1)) {
            for (yy in listOf(y0, y1)) {
                for (vv in listOf(v0, v1)) {
                    corners[i][0] = f.px(uu, vv)
                    corners[i][1] = yy.toFloat()
                    corners[i][2] = f.pz(uu, vv)
                    i++
                }
            }
        }
        // corner index = u*4 + y*2 + v
        fun c(u: Int, y: Int, v: Int) = corners[u * 4 + y * 2 + v]
        val du = (u1 - u0).toFloat()
        val dv = (v1 - v0).toFloat()
        val dy = (y1 - y0).toFloat()

        // Face towards +v (the wall's +n side).
        quad3(mb, c(0, 0, 1), c(1, 0, 1), c(1, 1, 1), c(0, 1, 1), du, dy)
        // Face towards -v.
        quad3(mb, c(1, 0, 0), c(0, 0, 0), c(0, 1, 0), c(1, 1, 0), du, dy)
        // Top and bottom.
        quad3(mb, c(0, 1, 0), c(0, 1, 1), c(1, 1, 1), c(1, 1, 0), dv, du)
        quad3(mb, c(0, 0, 1), c(0, 0, 0), c(1, 0, 0), c(1, 0, 1), dv, du)
        // The two narrow edges.
        quad3(mb, c(1, 0, 1), c(1, 0, 0), c(1, 1, 0), c(1, 1, 1), dv, dy)
        quad3(mb, c(0, 0, 0), c(0, 0, 1), c(0, 1, 1), c(0, 1, 0), dv, dy)
    }

    /** An axis-aligned box rotated about +Y and placed on the floor plane. */
    private fun addRotatedBox(
        mb: MeshBuilder,
        cx: Double, cz: Double,
        rotationDeg: Double,
        halfWidth: Double, halfDepth: Double,
        yBottom: Double, yTop: Double,
    ) {
        if (yTop <= yBottom || halfWidth <= 0 || halfDepth <= 0) return
        val a = Math.toRadians(rotationDeg)
        val ca = cos(a)
        val sa = sin(a)
        // Ry: x' = x cos + z sin ; z' = -x sin + z cos
        fun wx(x: Double, z: Double) = (cx + x * ca + z * sa).toFloat()
        fun wz(x: Double, z: Double) = (cz - x * sa + z * ca).toFloat()

        val x0 = -halfWidth
        val x1 = halfWidth
        val z0 = -halfDepth
        val z1 = halfDepth
        val yb = yBottom.toFloat()
        val yt = yTop.toFloat()

        fun p(x: Double, y: Float, z: Double) = floatArrayOf(wx(x, z), y, wz(x, z))

        val w = (halfWidth * 2).toFloat()
        val d = (halfDepth * 2).toFloat()
        val h = (yTop - yBottom).toFloat()

        // +X local face
        quad3(mb, p(x1, yb, z1), p(x1, yb, z0), p(x1, yt, z0), p(x1, yt, z1), d, h)
        // -X local face
        quad3(mb, p(x0, yb, z0), p(x0, yb, z1), p(x0, yt, z1), p(x0, yt, z0), d, h)
        // +Y
        quad3(mb, p(x0, yt, z1), p(x1, yt, z1), p(x1, yt, z0), p(x0, yt, z0), w, d)
        // -Y
        quad3(mb, p(x0, yb, z0), p(x1, yb, z0), p(x1, yb, z1), p(x0, yb, z1), w, d)
        // +Z local face
        quad3(mb, p(x0, yb, z1), p(x1, yb, z1), p(x1, yt, z1), p(x0, yt, z1), w, h)
        // -Z local face
        quad3(mb, p(x1, yb, z0), p(x0, yb, z0), p(x0, yt, z0), p(x1, yt, z0), w, h)
    }

    /** Adds a quad from four world-space corners, with a simple (0..su, 0..sv) UV box. */
    private fun quad3(
        mb: MeshBuilder,
        a: FloatArray, b: FloatArray, c: FloatArray, d: FloatArray,
        su: Float, sv: Float,
    ) {
        mb.quad(
            a[0], a[1], a[2], 0f, 0f,
            b[0], b[1], b[2], su, 0f,
            c[0], c[1], c[2], su, sv,
            d[0], d[1], d[2], 0f, sv,
        )
    }

    // -----------------------------------------------------------------------

    /** A sensible first camera position: the centre of the largest room, at eye height. */
    fun suggestedStart(project: Project): Triple<Float, Float, Float> {
        val floor = project.groundFloor ?: return Triple(0f, 1.6f, 0f)
        val room = floor.rooms.maxByOrNull { polygonArea(it.polygon) } ?: return Triple(0f, 1.6f, 0f)
        val cx = room.polygon.sumOf { it.x } / room.polygon.size
        val cz = room.polygon.sumOf { it.z } / room.polygon.size
        return Triple(cx.toFloat(), 1.6f, cz.toFloat())
    }

    fun polygonArea(polygon: List<Vec2>): Double =
        Triangulator.signedArea(polygon.map { doubleArrayOf(it.x, it.z) }).let { kotlin.math.abs(it) }
}
