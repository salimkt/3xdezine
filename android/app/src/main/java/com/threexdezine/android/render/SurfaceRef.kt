package com.threexdezine.android.render

import com.threexdezine.android.data.model.Project
import com.threexdezine.android.data.model.Surface

/**
 * Identifies one addressable piece of the house shell.
 *
 * This is what makes a material swap instant: geometry is built once per project and
 * keyed by [SurfaceRef], so applying a new material re-binds a MaterialInstance on an
 * existing renderable instead of regenerating vertex buffers.
 */
sealed interface SurfaceRef {

    /** The catalog surface slot this piece is painted from. */
    val surface: Surface

    /** Which material this piece should currently be wearing, per the project data. */
    fun materialId(project: Project): String?

    data class RoomFloor(val roomId: String) : SurfaceRef {
        override val surface = Surface.FLOOR
        override fun materialId(project: Project) = project.room(roomId)?.floorMaterialId
    }

    data class RoomCeiling(val roomId: String) : SurfaceRef {
        override val surface = Surface.CEILING
        override fun materialId(project: Project) = project.room(roomId)?.ceilingMaterialId
    }

    /** The inward face(s) of a wall, and — for [WallStructure] — its caps and reveals. */
    data class WallInterior(val wallId: String) : SurfaceRef {
        override val surface = Surface.WALL
        override fun materialId(project: Project) = project.wall(wallId)?.interiorMaterialId
    }

    data class WallExterior(val wallId: String) : SurfaceRef {
        override val surface = Surface.EXTERIOR_WALL
        override fun materialId(project: Project) = project.wall(wallId)?.exteriorMaterialId
    }

    /**
     * Wall top, end caps and opening reveals. Painted with the interior finish, which is
     * what a real jamb/reveal detail would be.
     */
    data class WallStructure(val wallId: String) : SurfaceRef {
        override val surface = Surface.WALL
        override fun materialId(project: Project) = project.wall(wallId)?.interiorMaterialId
    }

    /**
     * A door leaf or a placed furniture/light box. Not material-driven — it is coloured
     * from the catalog [com.threexdezine.android.data.model.ComponentProduct].
     */
    data class Fitting(val componentId: String, val instanceId: String) : SurfaceRef {
        override val surface = Surface.WALL
        override fun materialId(project: Project): String? = null
    }
}

fun Project.room(id: String) = floors.firstNotNullOfOrNull { f -> f.rooms.firstOrNull { it.id == id } }
fun Project.wall(id: String) = floors.firstNotNullOfOrNull { f -> f.walls.firstOrNull { it.id == id } }

/**
 * A single addressable renderable: one [SurfaceRef] and the geometry that wears it.
 */
data class SurfacePart(val ref: SurfaceRef, val mesh: MeshData)
