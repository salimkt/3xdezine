package com.threexdezine.android.render

import kotlin.math.abs
import kotlin.math.sqrt

/**
 * CPU-side mesh with everything Filament needs for a PBR surface:
 * POSITION (float3), TANGENTS (float4 quaternion) and UV0 (float2).
 */
class MeshData(
    val positions: FloatArray,
    /** Filament TANGENTS: a normalised quaternion per vertex encoding the TBN basis. */
    val tangents: FloatArray,
    /** UV0 in METRES. Tiling is applied per material via the baseColor UV matrix. */
    val uvs: FloatArray,
    val indices: IntArray,
    val minX: Float, val minY: Float, val minZ: Float,
    val maxX: Float, val maxY: Float, val maxZ: Float,
) {
    val vertexCount: Int get() = positions.size / 3
    val isEmpty: Boolean get() = indices.isEmpty()

    /**
     * A copy with UV0 multiplied by [scale], sharing positions, tangents and indices.
     *
     * This is how texture tiling is applied: UV0 is authored in metres, so a scale of
     * `1 / texture.tileSizeM` makes one texture repeat cover exactly `tileSizeM` metres
     * — the same rule the web client applies via `texture.repeat`.
     *
     * A uniform POSITIVE scale leaves the tangent basis direction and handedness
     * untouched, so the TANGENTS quaternions are reused as-is rather than recomputed.
     */
    fun withUvScale(scale: Float): MeshData {
        if (scale == 1f) return this
        val scaled = FloatArray(uvs.size) { uvs[it] * scale }
        return MeshData(positions, tangents, scaled, indices, minX, minY, minZ, maxX, maxY, maxZ)
    }

    /** Largest UV extent in metres, used to sanity-check tiling. */
    val uvExtent: Pair<Float, Float>
        get() {
            var maxU = 0f
            var maxV = 0f
            var i = 0
            while (i < uvs.size) {
                if (uvs[i] > maxU) maxU = uvs[i]
                if (uvs[i + 1] > maxV) maxV = uvs[i + 1]
                i += 2
            }
            return maxU to maxV
        }
}

/**
 * Accumulates triangles and derives normals and tangents from the geometry itself.
 *
 * TANGENT DECISION — this is the "tangent gotcha" from ARCHITECTURE.md.
 *
 * SceneView's `normalToTangent` computes `cross(+Y, normal)` and never looks at UVs.
 * That is right for vertical walls, but for floors and ceilings (normal = ±Y) it hits a
 * degenerate fallback with an arbitrary tangent basis, so a directional normal map
 * (plank grain, brick courses, herringbone) can light from the wrong direction.
 *
 * WE TAKE THE SECOND OPTION FROM THE BRIEF: we write the TANGENTS buffer ourselves.
 * Tangents come from the actual UV derivatives (Lengyel's method), accumulated per
 * vertex, Gram-Schmidt orthogonalised against the geometric normal, with handedness
 * recovered from the accumulated bitangent. That is correct for every surface
 * orientation including ±Y, so floor UVs do NOT have to be bent to suit a fallback
 * basis — they stay honest world-space metres, which is also what makes
 * `setBaseColorUvMatrix` scaling by 1/tileSizeM physically correct.
 *
 * The quaternion packing follows Filament's own `packTangentFrame` convention:
 * build the rotation from mat3(t, b, n), make w positive, then negate the whole
 * quaternion when the frame is mirrored (Filament's shader reads `sign(q.w)` to flip
 * the bitangent). w is nudged away from exactly zero, which Filament cannot represent.
 */
class MeshBuilder(expectedVertices: Int = 64) {

    private val px = ArrayList<Float>(expectedVertices * 3)
    private val uv = ArrayList<Float>(expectedVertices * 2)
    private val idx = ArrayList<Int>(expectedVertices * 3)

    fun vertex(x: Float, y: Float, z: Float, u: Float, v: Float): Int {
        px += x; px += y; px += z
        uv += u; uv += v
        return px.size / 3 - 1
    }

    fun triangle(a: Int, b: Int, c: Int) {
        idx += a; idx += b; idx += c
    }

    /**
     * Adds a planar quad. Vertices must be given in counter-clockwise order **as seen
     * from the side the face should be visible from** — that is what fixes the normal.
     */
    fun quad(
        x0: Float, y0: Float, z0: Float, u0: Float, v0: Float,
        x1: Float, y1: Float, z1: Float, u1: Float, v1: Float,
        x2: Float, y2: Float, z2: Float, u2: Float, v2: Float,
        x3: Float, y3: Float, z3: Float, u3: Float, v3: Float,
    ) {
        val a = vertex(x0, y0, z0, u0, v0)
        val b = vertex(x1, y1, z1, u1, v1)
        val c = vertex(x2, y2, z2, u2, v2)
        val d = vertex(x3, y3, z3, u3, v3)
        triangle(a, b, c)
        triangle(a, c, d)
    }

    val isEmpty: Boolean get() = idx.isEmpty()

    fun build(): MeshData {
        val n = px.size / 3
        val positions = FloatArray(px.size) { px[it] }
        val uvs = FloatArray(uv.size) { uv[it] }
        val indices = IntArray(idx.size) { idx[it] }

        val normals = FloatArray(n * 3)
        val tanAcc = FloatArray(n * 3)
        val bitAcc = FloatArray(n * 3)

        var t = 0
        while (t < indices.size) {
            val i0 = indices[t]
            val i1 = indices[t + 1]
            val i2 = indices[t + 2]
            t += 3

            val p0x = positions[i0 * 3]; val p0y = positions[i0 * 3 + 1]; val p0z = positions[i0 * 3 + 2]
            val p1x = positions[i1 * 3]; val p1y = positions[i1 * 3 + 1]; val p1z = positions[i1 * 3 + 2]
            val p2x = positions[i2 * 3]; val p2y = positions[i2 * 3 + 1]; val p2z = positions[i2 * 3 + 2]

            val e1x = p1x - p0x; val e1y = p1y - p0y; val e1z = p1z - p0z
            val e2x = p2x - p0x; val e2y = p2y - p0y; val e2z = p2z - p0z

            // Face normal (not normalised: area-weighted accumulation is what we want).
            val nx = e1y * e2z - e1z * e2y
            val ny = e1z * e2x - e1x * e2z
            val nz = e1x * e2y - e1y * e2x

            val d1u = uvs[i1 * 2] - uvs[i0 * 2]
            val d1v = uvs[i1 * 2 + 1] - uvs[i0 * 2 + 1]
            val d2u = uvs[i2 * 2] - uvs[i0 * 2]
            val d2v = uvs[i2 * 2 + 1] - uvs[i0 * 2 + 1]

            val det = d1u * d2v - d2u * d1v
            val r = if (abs(det) < 1e-12f) 0f else 1f / det

            val tx = (d2v * e1x - d1v * e2x) * r
            val ty = (d2v * e1y - d1v * e2y) * r
            val tz = (d2v * e1z - d1v * e2z) * r

            val bx = (d1u * e2x - d2u * e1x) * r
            val by = (d1u * e2y - d2u * e1y) * r
            val bz = (d1u * e2z - d2u * e1z) * r

            for (i in intArrayOf(i0, i1, i2)) {
                normals[i * 3] += nx; normals[i * 3 + 1] += ny; normals[i * 3 + 2] += nz
                tanAcc[i * 3] += tx; tanAcc[i * 3 + 1] += ty; tanAcc[i * 3 + 2] += tz
                bitAcc[i * 3] += bx; bitAcc[i * 3 + 1] += by; bitAcc[i * 3 + 2] += bz
            }
        }

        val tangents = FloatArray(n * 4)
        for (i in 0 until n) {
            var nx = normals[i * 3]; var ny = normals[i * 3 + 1]; var nz = normals[i * 3 + 2]
            var len = sqrt(nx * nx + ny * ny + nz * nz)
            if (len < 1e-12f) {
                nx = 0f; ny = 1f; nz = 0f
            } else {
                nx /= len; ny /= len; nz /= len
            }

            // Gram-Schmidt the accumulated tangent against the normal.
            var tx = tanAcc[i * 3]; var ty = tanAcc[i * 3 + 1]; var tz = tanAcc[i * 3 + 2]
            val dotNT = nx * tx + ny * ty + nz * tz
            tx -= nx * dotNT; ty -= ny * dotNT; tz -= nz * dotNT
            len = sqrt(tx * tx + ty * ty + tz * tz)
            if (len < 1e-8f) {
                // No usable UV gradient (degenerate or untextured helper geometry).
                // Any stable perpendicular will do; a normal map has nothing to key off
                // here anyway. Pick the world axis least aligned with the normal.
                val ax: Float
                val ay: Float
                val az: Float
                if (abs(ny) < 0.9f) {
                    ax = 0f; ay = 1f; az = 0f
                } else {
                    ax = 1f; ay = 0f; az = 0f
                }
                tx = ay * nz - az * ny
                ty = az * nx - ax * nz
                tz = ax * ny - ay * nx
                len = sqrt(tx * tx + ty * ty + tz * tz)
                if (len < 1e-12f) {
                    tx = 1f; ty = 0f; tz = 0f; len = 1f
                }
            }
            tx /= len; ty /= len; tz /= len

            // Handedness: does cross(n, t) agree with the accumulated bitangent?
            val cnx = ny * tz - nz * ty
            val cny = nz * tx - nx * tz
            val cnz = nx * ty - ny * tx
            val dotB = cnx * bitAcc[i * 3] + cny * bitAcc[i * 3 + 1] + cnz * bitAcc[i * 3 + 2]
            val w = if (dotB < 0f) -1f else 1f

            val bx = cnx * w; val by = cny * w; val bz = cnz * w

            var q = quaternionFromBasis(tx, ty, tz, bx, by, bz, nx, ny, nz)
            if (q[3] < 0f) q = floatArrayOf(-q[0], -q[1], -q[2], -q[3]) // positive w
            q = nudgeAwayFromZeroW(q)
            if (w < 0f) q = floatArrayOf(-q[0], -q[1], -q[2], -q[3]) // encode mirroring

            tangents[i * 4] = q[0]
            tangents[i * 4 + 1] = q[1]
            tangents[i * 4 + 2] = q[2]
            tangents[i * 4 + 3] = q[3]
        }

        var minX = Float.MAX_VALUE; var minY = Float.MAX_VALUE; var minZ = Float.MAX_VALUE
        var maxX = -Float.MAX_VALUE; var maxY = -Float.MAX_VALUE; var maxZ = -Float.MAX_VALUE
        var i = 0
        while (i < positions.size) {
            val x = positions[i]; val y = positions[i + 1]; val z = positions[i + 2]
            if (x < minX) minX = x; if (x > maxX) maxX = x
            if (y < minY) minY = y; if (y > maxY) maxY = y
            if (z < minZ) minZ = z; if (z > maxZ) maxZ = z
            i += 3
        }
        if (n == 0) {
            minX = 0f; minY = 0f; minZ = 0f; maxX = 0f; maxY = 0f; maxZ = 0f
        }

        return MeshData(positions, tangents, uvs, indices, minX, minY, minZ, maxX, maxY, maxZ)
    }

    private companion object {

        /**
         * Shepperd's method on the column-major rotation matrix whose columns are
         * (t, b, n). Returns [x, y, z, w].
         */
        fun quaternionFromBasis(
            tx: Float, ty: Float, tz: Float,
            bx: Float, by: Float, bz: Float,
            nx: Float, ny: Float, nz: Float,
        ): FloatArray {
            val trace = tx + by + nz
            return when {
                trace > 0f -> {
                    val s = sqrt(trace + 1f) * 2f
                    floatArrayOf((bz - ny) / s, (nx - tz) / s, (ty - bx) / s, 0.25f * s)
                }
                tx > by && tx > nz -> {
                    val s = sqrt(1f + tx - by - nz) * 2f
                    floatArrayOf(0.25f * s, (bx + ty) / s, (nx + tz) / s, (bz - ny) / s)
                }
                by > nz -> {
                    val s = sqrt(1f + by - tx - nz) * 2f
                    floatArrayOf((bx + ty) / s, 0.25f * s, (ny + bz) / s, (nx - tz) / s)
                }
                else -> {
                    val s = sqrt(1f + nz - tx - by) * 2f
                    floatArrayOf((nx + tz) / s, (ny + bz) / s, 0.25f * s, (ty - bx) / s)
                }
            }.let { normalizeQuat(it) }
        }

        fun normalizeQuat(q: FloatArray): FloatArray {
            val l = sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3])
            if (l < 1e-20f) return floatArrayOf(0f, 0f, 0f, 1f)
            return floatArrayOf(q[0] / l, q[1] / l, q[2] / l, q[3] / l)
        }

        /**
         * Filament cannot encode w == 0 (the sign of w is the mirroring bit), so nudge
         * w up to a small positive floor and rescale xyz to keep the quaternion unit.
         * Mirrors Filament's own `packTangentFrame` storage-size guard.
         */
        fun nudgeAwayFromZeroW(q: FloatArray): FloatArray {
            val floor = 1e-6f
            if (q[3] >= floor) return q
            val scale = sqrt(1f - floor * floor) / sqrt(maxOf(1f - q[3] * q[3], 1e-20f))
            return floatArrayOf(q[0] * scale, q[1] * scale, q[2] * scale, floor)
        }
    }
}
