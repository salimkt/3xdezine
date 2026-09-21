package com.threexdezine.android.data

import com.threexdezine.android.data.model.Project
import com.threexdezine.android.data.model.Surface

/**
 * Where a material is about to be applied.
 *
 * The bulk targets ([AllOfSurface]) are what the material browser leads with — picking
 * "every floor" is what a user actually wants 90% of the time — while the specific
 * targets let them fix one room without touching the rest.
 */
sealed interface ApplyTarget {
    val surface: Surface
    val label: String

    data class AllOfSurface(override val surface: Surface) : ApplyTarget {
        override val label: String = "Every ${surface.label.lowercase()}"
    }

    data class RoomFloor(val roomId: String, val roomName: String) : ApplyTarget {
        override val surface = Surface.FLOOR
        override val label: String = "$roomName — floor"
    }

    data class RoomCeiling(val roomId: String, val roomName: String) : ApplyTarget {
        override val surface = Surface.CEILING
        override val label: String = "$roomName — ceiling"
    }

    data class WallInterior(val wallId: String) : ApplyTarget {
        override val surface = Surface.WALL
        override val label: String = "Wall $wallId — inner face"
    }

    data class WallExterior(val wallId: String) : ApplyTarget {
        override val surface = Surface.EXTERIOR_WALL
        override val label: String = "Wall $wallId — outer face"
    }

    data object Roof : ApplyTarget {
        override val surface = Surface.ROOF
        override val label: String = "Roof"
    }
}

/** Every target offered for a given surface, bulk option first. */
fun Project.targetsFor(surface: Surface): List<ApplyTarget> {
    val floor = groundFloor ?: return listOf(ApplyTarget.AllOfSurface(surface))
    val specific: List<ApplyTarget> = when (surface) {
        Surface.FLOOR -> floor.rooms.map { ApplyTarget.RoomFloor(it.id, it.name) }
        Surface.CEILING -> floor.rooms.map { ApplyTarget.RoomCeiling(it.id, it.name) }
        Surface.WALL -> floor.walls.map { ApplyTarget.WallInterior(it.id) }
        Surface.EXTERIOR_WALL -> floor.walls.filter { it.exterior }.map { ApplyTarget.WallExterior(it.id) }
        Surface.ROOF -> emptyList()
    }
    return if (surface == Surface.ROOF) {
        listOf(ApplyTarget.Roof)
    } else {
        listOf(ApplyTarget.AllOfSurface(surface)) + specific
    }
}

/** The material currently on [target], for the "selected" tick in the browser. */
fun Project.currentMaterialId(target: ApplyTarget): String? {
    val floor = groundFloor ?: return null
    return when (target) {
        is ApplyTarget.AllOfSurface -> when (target.surface) {
            Surface.FLOOR -> floor.rooms.map { it.floorMaterialId }.distinct().singleOrNull()
            Surface.CEILING -> floor.rooms.map { it.ceilingMaterialId }.distinct().singleOrNull()
            Surface.WALL -> floor.walls.map { it.interiorMaterialId }.distinct().singleOrNull()
            Surface.EXTERIOR_WALL ->
                floor.walls.filter { it.exterior }.map { it.exteriorMaterialId }.distinct().singleOrNull()
            Surface.ROOF -> roof?.materialId
        }
        is ApplyTarget.RoomFloor -> floor.rooms.firstOrNull { it.id == target.roomId }?.floorMaterialId
        is ApplyTarget.RoomCeiling -> floor.rooms.firstOrNull { it.id == target.roomId }?.ceilingMaterialId
        is ApplyTarget.WallInterior -> floor.walls.firstOrNull { it.id == target.wallId }?.interiorMaterialId
        is ApplyTarget.WallExterior -> floor.walls.firstOrNull { it.id == target.wallId }?.exteriorMaterialId
        ApplyTarget.Roof -> roof?.materialId
    }
}

/**
 * Returns a copy of the project with [materialId] applied to [target].
 *
 * Pure and immutable on purpose: the walkthrough re-derives its materials from the
 * project state, and the cost estimate POSTs the whole project, so there is exactly one
 * source of truth and no way for the picture and the price to disagree.
 */
fun Project.applyMaterial(target: ApplyTarget, materialId: String): Project {
    val floors = this.floors.map { fl ->
        when (target) {
            is ApplyTarget.AllOfSurface -> when (target.surface) {
                Surface.FLOOR -> fl.copy(rooms = fl.rooms.map { it.copy(floorMaterialId = materialId) })
                Surface.CEILING -> fl.copy(rooms = fl.rooms.map { it.copy(ceilingMaterialId = materialId) })
                Surface.WALL -> fl.copy(walls = fl.walls.map { it.copy(interiorMaterialId = materialId) })
                Surface.EXTERIOR_WALL -> fl.copy(
                    walls = fl.walls.map { if (it.exterior) it.copy(exteriorMaterialId = materialId) else it },
                )
                Surface.ROOF -> fl
            }
            is ApplyTarget.RoomFloor -> fl.copy(
                rooms = fl.rooms.map { if (it.id == target.roomId) it.copy(floorMaterialId = materialId) else it },
            )
            is ApplyTarget.RoomCeiling -> fl.copy(
                rooms = fl.rooms.map { if (it.id == target.roomId) it.copy(ceilingMaterialId = materialId) else it },
            )
            is ApplyTarget.WallInterior -> fl.copy(
                walls = fl.walls.map { if (it.id == target.wallId) it.copy(interiorMaterialId = materialId) else it },
            )
            is ApplyTarget.WallExterior -> fl.copy(
                walls = fl.walls.map { if (it.id == target.wallId) it.copy(exteriorMaterialId = materialId) else it },
            )
            ApplyTarget.Roof -> fl
        }
    }
    val newRoof = if (target.surface == Surface.ROOF) roof?.copy(materialId = materialId) else roof
    return copy(floors = floors, roof = newRoof)
}
