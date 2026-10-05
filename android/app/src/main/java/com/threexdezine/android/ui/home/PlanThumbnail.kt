package com.threexdezine.android.ui.home

import androidx.compose.foundation.Canvas
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.dp
import com.threexdezine.android.data.model.Catalog
import com.threexdezine.android.data.model.ComponentType
import com.threexdezine.android.data.model.Project
import com.threexdezine.android.ui.swatchColor

/**
 * A top-down plan drawn straight from the project JSON — no image assets.
 *
 *  - each room is filled with its floor material's catalog colour;
 *  - walls are stroked at their real thickness (scaled), with door and window openings
 *    left as gaps; windows get a thin glazing line across the gap so they read as
 *    windows rather than doorways.
 */
@Composable
fun PlanThumbnail(project: Project, catalog: Catalog?, modifier: Modifier = Modifier) {
    val floor = project.groundFloor
    val bounds = remember(project) { floor?.let { PlanGeometry.bounds(it) } }
    val wallColor = MaterialTheme.colorScheme.onSurface
    val glazing = MaterialTheme.colorScheme.primary
    val emptyFill = MaterialTheme.colorScheme.surfaceVariant
    val roomFills = remember(project, catalog) {
        floor?.rooms.orEmpty().map { room ->
            catalog?.material(room.floorMaterialId)?.color?.hex?.let(::swatchColor)
        }
    }
    val windowIds = remember(project, catalog) {
        floor?.openings.orEmpty().filter { o ->
            val type = o.componentId?.let { catalog?.componentsById?.get(it)?.type }
            // Without a component, anything above the floor is a window.
            type == ComponentType.WINDOW || (type == null && o.sillM > 0.05)
        }.map { it.id }.toSet()
    }

    Canvas(modifier) {
        if (floor == null || bounds == null) return@Canvas
        val fit = PlanGeometry.fit(bounds, size.width, size.height, padding = 8.dp.toPx())

        floor.rooms.forEachIndexed { i, room ->
            if (room.polygon.size < 3) return@forEachIndexed
            val path = Path().apply {
                moveTo(fit.x(room.polygon[0].x), fit.y(room.polygon[0].z))
                for (k in 1 until room.polygon.size) lineTo(fit.x(room.polygon[k].x), fit.y(room.polygon[k].z))
                close()
            }
            drawPath(path, color = roomFills.getOrNull(i) ?: emptyFill)
            drawPath(path, color = wallColor.copy(alpha = 0.12f), style = Stroke(width = 1f))
        }

        for (wall in floor.walls) {
            val stroke = (wall.thicknessM * fit.scale).toFloat().coerceAtLeast(1.5f)
            val openings = floor.openings.filter { it.wallId == wall.id }
            for ((t0, t1) in PlanGeometry.solidSpans(wall, openings)) {
                val (x0, z0) = PlanGeometry.pointAt(wall, t0)
                val (x1, z1) = PlanGeometry.pointAt(wall, t1)
                drawLine(
                    color = wallColor,
                    start = Offset(fit.x(x0), fit.y(z0)),
                    end = Offset(fit.x(x1), fit.y(z1)),
                    strokeWidth = stroke,
                    cap = StrokeCap.Square,
                )
            }
            for (o in openings) {
                if (o.id !in windowIds) continue
                val (t0, t1) = PlanGeometry.openingSpan(wall, o) ?: continue
                val (x0, z0) = PlanGeometry.pointAt(wall, t0)
                val (x1, z1) = PlanGeometry.pointAt(wall, t1)
                drawLine(
                    color = glazing,
                    start = Offset(fit.x(x0), fit.y(z0)),
                    end = Offset(fit.x(x1), fit.y(z1)),
                    strokeWidth = (stroke * 0.35f).coerceAtLeast(1f),
                )
            }
        }
    }
}
