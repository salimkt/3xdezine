package com.threexdezine.android.cost

import com.threexdezine.android.data.model.Catalog
import com.threexdezine.android.data.model.CostBreakdown
import com.threexdezine.android.data.model.CostLineItem
import com.threexdezine.android.data.model.CostQuantities
import com.threexdezine.android.data.model.DesignMaterial
import com.threexdezine.android.data.model.Floor
import com.threexdezine.android.data.model.PricingUnit
import com.threexdezine.android.data.model.Project
import com.threexdezine.android.data.model.RoofKind
import com.threexdezine.android.data.model.Room
import com.threexdezine.android.data.model.Surface
import com.threexdezine.android.data.model.Vec2
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.round

/**
 * An OFFLINE MIRROR of the backend cost engine, used only when `POST /api/cost/estimate`
 * is unreachable. The backend remains authoritative; anything this produces is labelled
 * "offline estimate" in the UI.
 *
 * Implements ARCHITECTURE.md > "Cost engine" literally:
 *
 *   floorArea(room)   = shoelaceArea(room.polygon)
 *   ceilingArea(room) = floorArea(room)
 *   grossFace(w)      = |w.end - w.start| * w.heightM
 *   netFace(w)        = max(0, grossFace(w) - Σ openings on w)
 *   interior wall -> interiorMaterialId on netFace x 2
 *   exterior wall -> interiorMaterialId x 1 and exteriorMaterialId x 1
 *   litres            = area * coatsRecommended / coveragePerUnit
 *   bufferedQuantity  = roundUp(raw * (1 + wastageFactor))
 *   subtotal          = bufferedQuantity * pricePerUnit
 *   total             = materialsSubtotal * (1 + contingencyBuffer)
 *
 * TWO DOCUMENTED APPROXIMATIONS where ARCHITECTURE.md is not fully specified. These may
 * make this differ from the backend by a few percent:
 *
 *  1. Roof "footprint" is taken as the sum of ground-floor room areas rather than the
 *     true union of the room polygons. For the sample plan (rooms tile the footprint
 *     without overlap) these are identical.
 *  2. The GABLE/HIP "overhang allowance" is taken as
 *     (total exterior wall length) * overhangM.
 *
 * Buffering is applied per line item, which is what makes the "per-material cutting
 * waste" stage visible in the UI breakdown.
 */
object LocalCostEngine {

    private const val EPS = 1e-9

    fun estimate(project: Project, catalog: Catalog): CostBreakdown {
        val lines = mutableListOf<CostLineItem>()

        var floorAreaSqm = 0.0
        var ceilingAreaSqm = 0.0
        var wallAreaSqm = 0.0
        var exteriorWallAreaSqm = 0.0
        var openingAreaSqm = 0.0

        // Raw area accumulators, keyed so walls collapse into readable grouped lines.
        val wallAreas = mutableMapOf<GroupKey, Double>()

        for (floor in project.floors) {
            val openingAreaByWall = floor.openings
                .groupBy { it.wallId }
                .mapValues { (_, list) -> list.sumOf { it.widthM * it.heightM } }
            openingAreaSqm += openingAreaByWall.values.sum()

            for (room in floor.rooms) {
                val area = shoelaceArea(room.polygon)
                floorAreaSqm += area
                ceilingAreaSqm += area

                catalog.material(room.floorMaterialId)?.let { m ->
                    lines += lineItem(Surface.FLOOR.name, m, "${room.name} — floor", area)
                }
                catalog.material(room.ceilingMaterialId)?.let { m ->
                    lines += lineItem(Surface.CEILING.name, m, "${room.name} — ceiling", area)
                }
            }

            for (wall in floor.walls) {
                val length = wallLength(wall.start, wall.end)
                val gross = length * wall.heightM
                val net = max(0.0, gross - (openingAreaByWall[wall.id] ?: 0.0))

                if (wall.exterior) {
                    // Interior face x1 + exterior face x1.
                    wallAreaSqm += net
                    exteriorWallAreaSqm += net
                    wall.interiorMaterialId?.let {
                        wallAreas.merge(GroupKey(Surface.WALL.name, it, "Exterior walls — inner face"), net, Double::plus)
                    }
                    wall.exteriorMaterialId?.let {
                        wallAreas.merge(GroupKey(Surface.EXTERIOR_WALL.name, it, "Exterior walls — outer face"), net, Double::plus)
                    }
                } else {
                    // Both sides of an interior wall.
                    val both = net * 2.0
                    wallAreaSqm += both
                    wall.interiorMaterialId?.let {
                        wallAreas.merge(GroupKey(Surface.WALL.name, it, "Interior walls — both faces"), both, Double::plus)
                    }
                }
            }
        }

        for ((key, area) in wallAreas.entries.sortedBy { it.key.location }) {
            val m = catalog.material(key.materialId) ?: continue
            lines += lineItem(key.surface, m, key.location, area)
        }

        // ---- Roof --------------------------------------------------------------
        var roofAreaSqm = 0.0
        val roof = project.roof
        if (roof != null) {
            val ground: Floor? = project.groundFloor
            val footprint = ground?.rooms?.sumOf { shoelaceArea(it.polygon) } ?: 0.0
            val exteriorPerimeter = ground?.walls
                ?.filter { it.exterior }
                ?.sumOf { wallLength(it.start, it.end) }
                ?: 0.0

            roofAreaSqm = when (roof.kind) {
                RoofKind.FLAT -> footprint
                RoofKind.GABLE, RoofKind.HIP -> {
                    val pitchRad = Math.toRadians(roof.pitchDeg.coerceIn(0.0, 85.0))
                    val slope = footprint / cos(pitchRad)
                    slope + exteriorPerimeter * roof.overhangM
                }
            }
            catalog.material(roof.materialId)?.let { m ->
                lines += lineItem(Surface.ROOF.name, m, "Roof — ${roof.kind.name.lowercase()}", roofAreaSqm)
            }
        }

        // ---- Placed components --------------------------------------------------
        val componentCounts = project.floors
            .flatMap { it.components }
            .groupingBy { it.componentId }
            .eachCount()

        for ((componentId, count) in componentCounts) {
            val product = catalog.componentsById[componentId] ?: continue
            val subtotal = money(product.price * count)
            lines += CostLineItem(
                surface = "COMPONENT",
                materialId = product.id,
                materialName = product.name,
                location = "Fittings — ${product.type.name.lowercase()}",
                rawQuantity = count.toDouble(),
                unit = PricingUnit.EACH,
                wastageFactor = 0.0,
                bufferedQuantity = count.toDouble(),
                unitPrice = product.price,
                subtotal = subtotal,
            )
        }

        val materialsSubtotal = money(lines.sumOf { it.subtotal })
        val contingencyAmount = money(materialsSubtotal * project.contingencyBuffer)
        val total = money(materialsSubtotal + contingencyAmount)

        val perSurface = lines
            .groupBy { it.surface }
            .mapValues { (_, items) -> money(items.sumOf { it.subtotal }) }

        return CostBreakdown(
            currency = project.currency,
            lineItems = lines,
            materialsSubtotal = materialsSubtotal,
            contingencyBuffer = project.contingencyBuffer,
            contingencyAmount = contingencyAmount,
            total = total,
            perSurface = perSurface,
            quantities = CostQuantities(
                floorAreaSqm = round2(floorAreaSqm),
                wallAreaSqm = round2(wallAreaSqm),
                ceilingAreaSqm = round2(ceilingAreaSqm),
                exteriorWallAreaSqm = round2(exteriorWallAreaSqm),
                roofAreaSqm = round2(roofAreaSqm),
                openingAreaSqm = round2(openingAreaSqm),
            ),
        )
    }

    // -----------------------------------------------------------------------
    // Quantity helpers
    // -----------------------------------------------------------------------

    /** Shoelace area of a closed loop whose first point is NOT repeated. */
    fun shoelaceArea(polygon: List<Vec2>): Double {
        if (polygon.size < 3) return 0.0
        var sum = 0.0
        for (i in polygon.indices) {
            val a = polygon[i]
            val b = polygon[(i + 1) % polygon.size]
            sum += a.x * b.z - b.x * a.z
        }
        return abs(sum) / 2.0
    }

    /** Signed shoelace area. Positive means counter-clockwise in a +X right / +Z down plane. */
    fun signedArea(polygon: List<Vec2>): Double {
        if (polygon.size < 3) return 0.0
        var sum = 0.0
        for (i in polygon.indices) {
            val a = polygon[i]
            val b = polygon[(i + 1) % polygon.size]
            sum += a.x * b.z - b.x * a.z
        }
        return sum / 2.0
    }

    fun wallLength(start: Vec2, end: Vec2): Double = hypot(end.x - start.x, end.z - start.z)

    fun roomArea(room: Room): Double = shoelaceArea(room.polygon)

    // -----------------------------------------------------------------------
    // Line-item construction
    // -----------------------------------------------------------------------

    private data class GroupKey(val surface: String, val materialId: String, val location: String)

    private fun lineItem(
        surface: String,
        material: DesignMaterial,
        location: String,
        areaSqm: Double,
    ): CostLineItem {
        val raw = toPricingUnit(material, areaSqm)
        val buffered = purchasable(raw * (1.0 + material.wastageFactor), material)
        return CostLineItem(
            surface = surface,
            materialId = material.id,
            materialName = material.name,
            location = location,
            rawQuantity = round2(raw),
            unit = material.unit,
            wastageFactor = material.wastageFactor,
            bufferedQuantity = buffered,
            unitPrice = material.pricePerUnit,
            subtotal = money(buffered * material.pricePerUnit),
        )
    }

    /** Converts a measured area into the material's pricing unit. */
    private fun toPricingUnit(material: DesignMaterial, areaSqm: Double): Double =
        when (material.unit) {
            PricingUnit.SQM -> areaSqm
            PricingUnit.LITER -> {
                val coverage = material.coveragePerUnit ?: 10.0
                val coats = material.coatsRecommended ?: 2
                if (coverage <= 0.0) 0.0 else areaSqm * coats / coverage
            }
            // Not meaningful for a surface measured by area, but keep it deterministic.
            PricingUnit.LINEAR_M -> areaSqm
            PricingUnit.EACH -> areaSqm
        }

    /**
     * roundUp: to a whole multiple of `packSize` when the material ships in packs, then
     * to whole integers for EACH and 2 dp for continuous units.
     */
    fun purchasable(quantity: Double, material: DesignMaterial): Double {
        if (quantity <= 0.0) return 0.0
        val packed = material.packSize
            ?.takeIf { it > 0.0 }
            ?.let { pack -> ceil(quantity / pack - EPS) * pack }
            ?: quantity
        return if (material.unit == PricingUnit.EACH) {
            ceil(packed - EPS)
        } else {
            ceil(packed * 100.0 - EPS) / 100.0
        }
    }

    private fun money(value: Double): Double = round(value * 100.0) / 100.0

    private fun round2(value: Double): Double = round(value * 100.0) / 100.0
}
