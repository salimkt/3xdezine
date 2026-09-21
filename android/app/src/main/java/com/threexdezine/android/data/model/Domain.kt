@file:Suppress("unused")

package com.threexdezine.android.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

/**
 * Kotlin mirror of `shared/types.ts`.
 *
 * Field names are IDENTICAL to the JSON on the wire — no @SerialName renaming except
 * where a TypeScript string-literal union uses a value that is not a legal Kotlin
 * identifier (`"metric"` / `"imperial"`).
 *
 * Conventions carried over verbatim:
 *  - All lengths are METRES, all areas SQUARE METRES.
 *  - The floor plane is XZ (x = east, z = south). Y is up (glTF / three.js / Filament).
 *  - Room polygons are closed loops with the first point NOT repeated.
 *  - Opening `t` is 0..1 along the wall from `start` to `end`, to the opening's centre.
 *  - `texture.tileSizeM` is the real-world size of one texture repeat.
 *
 * Two deliberate Kotlin-side renames of TYPE names (not of JSON keys):
 *  - `Unit`      -> [PricingUnit]   (`kotlin.Unit` clash)
 *  - `Material`  -> [DesignMaterial] (`com.google.android.filament.Material` clash)
 */

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

@Serializable
enum class Surface {
    FLOOR,
    WALL,
    CEILING,
    EXTERIOR_WALL,
    ROOF,
    ;

    /** Title-cased label for the UI, e.g. EXTERIOR_WALL -> "Exterior wall". */
    val label: String
        get() = name.lowercase().replace('_', ' ').replaceFirstChar { it.uppercase() }
}

@Serializable
enum class MaterialCategory {
    FLOORING,
    TILE,
    PAINT,
    WALL_FINISH,
    CEILING,
    EXTERIOR_SIDING,
    ROOFING,
}

/** Pricing unit. The cost engine converts measured quantities into this unit. */
@Serializable
enum class PricingUnit {
    SQM,
    LITER,
    LINEAR_M,
    EACH,
    ;

    val shortLabel: String
        get() = when (this) {
            SQM -> "m²"
            LITER -> "L"
            LINEAR_M -> "lm"
            EACH -> "ea"
        }

    /** Continuous units round to 2 dp; EACH rounds to whole items. */
    val isContinuous: Boolean get() = this != EACH
}

@Serializable
enum class Tier { BUDGET, STANDARD, PREMIUM, LUXURY }

@Serializable
data class ColorInfo(
    val name: String,
    /** Uppercase 6-digit hex, e.g. "#C8A165". */
    val hex: String,
)

@Serializable
data class TextureInfo(
    val pattern: String,
    val assetHint: String,
    /** Real-world size of one texture repeat, in metres. Drives UV scale. */
    val tileSizeM: Double,
)

@Serializable
data class PbrInfo(
    /** 0 = mirror, 1 = fully diffuse. */
    val roughness: Double,
    /** 0 for dielectrics, ~1 for bare metal. */
    val metalness: Double,
)

@Serializable
data class DesignMaterial(
    val id: String,
    val name: String,
    val category: MaterialCategory,
    val subtype: String,
    val description: String,
    val color: ColorInfo,
    val texture: TextureInfo,
    val pbr: PbrInfo,
    val unit: PricingUnit,
    val pricePerUnit: Double,
    /** Default cutting/overage allowance, 0..1. Applied before project contingency. */
    val wastageFactor: Double,
    val finish: String,
    val tier: Tier,
    val durabilityScore: Int,
    val sustainabilityScore: Int,
    val aestheticScore: Int,
    val styleTags: List<String> = emptyList(),
    val applicableSurfaces: List<Surface> = emptyList(),

    /** Required when [unit] is LITER: square metres covered per litre, per coat. */
    val coveragePerUnit: Double? = null,
    /** Required when [unit] is LITER. */
    val coatsRecommended: Int? = null,

    /**
     * Smallest purchasable increment, in [unit]. When set, the cost engine rounds the
     * buffered quantity UP to a whole multiple of this.
     */
    val packSize: Double? = null,
    /** Human label for a pack, e.g. "box", "can", "pack". Display only. */
    val packLabel: String? = null,
)

@Serializable
enum class ComponentType { DOOR, WINDOW, CABINET, LIGHT, FURNITURE }

@Serializable
data class ComponentProduct(
    val id: String,
    val name: String,
    val type: ComponentType,
    val description: String,
    val color: ColorInfo,
    val price: Double,
    val widthM: Double,
    val heightM: Double,
    val depthM: Double,
    val styleTags: List<String> = emptyList(),
    /** Renderer-side geometry recipe, e.g. "door-flush", "window-casement". */
    val modelKind: String,
)

@Serializable
data class StylePreset(
    val id: String,
    val name: String,
    val description: String,
    val styleTags: List<String> = emptyList(),
    /** Hex swatches that define the look. */
    val palette: List<String> = emptyList(),
    /**
     * Keys are [Surface] names. Modelled as a String map rather than an enum-keyed map
     * so an unknown surface added server-side does not blow up deserialization.
     */
    val recommended: Map<String, String> = emptyMap(),
)

@Serializable
data class CatalogMeta(
    val version: String,
    val baseCurrency: String,
    val priceBasis: String,
    val units: Map<String, String> = emptyMap(),
    val scoring: String = "",
)

@Serializable
data class Catalog(
    val meta: CatalogMeta,
    val materials: List<DesignMaterial> = emptyList(),
    val components: List<ComponentProduct> = emptyList(),
    val styles: List<StylePreset> = emptyList(),
) {
    val materialsById: Map<String, DesignMaterial> by lazy { materials.associateBy { it.id } }
    val componentsById: Map<String, ComponentProduct> by lazy { components.associateBy { it.id } }

    fun material(id: String?): DesignMaterial? = id?.let { materialsById[it] }

    fun forSurface(surface: Surface): List<DesignMaterial> =
        materials.filter { surface in it.applicableSurfaces }
}

// ---------------------------------------------------------------------------
// Project geometry
// ---------------------------------------------------------------------------

/** A point on the floor plane, in metres. */
@Serializable
data class Vec2(val x: Double, val z: Double)

@Serializable
data class Wall(
    val id: String,
    val start: Vec2,
    val end: Vec2,
    val heightM: Double,
    val thicknessM: Double,
    val exterior: Boolean = false,
    /** Finish on the inward face(s). */
    val interiorMaterialId: String? = null,
    /** Finish on the outward face. Only meaningful when [exterior] is true. */
    val exteriorMaterialId: String? = null,
)

@Serializable
data class Opening(
    val id: String,
    val wallId: String,
    val componentId: String? = null,
    /** Centre of the opening along the wall, 0..1 from `start` to `end`. */
    val t: Double,
    val widthM: Double,
    val heightM: Double,
    /** Height of the opening's bottom edge above the floor. 0 for doors. */
    val sillM: Double,
)

@Serializable
data class Room(
    val id: String,
    val name: String,
    /** Ordered closed loop, first point NOT repeated. Counter-clockwise. */
    val polygon: List<Vec2>,
    val ceilingHeightM: Double,
    val floorMaterialId: String? = null,
    val ceilingMaterialId: String? = null,
)

@Serializable
data class PlacedComponent(
    val id: String,
    val componentId: String,
    val position: Vec2,
    val rotationDeg: Double,
)

@Serializable
data class Floor(
    val id: String,
    val name: String,
    /** 0 = ground floor. */
    val level: Int,
    val walls: List<Wall> = emptyList(),
    val rooms: List<Room> = emptyList(),
    val openings: List<Opening> = emptyList(),
    val components: List<PlacedComponent> = emptyList(),
)

@Serializable
enum class RoofKind { GABLE, HIP, FLAT }

@Serializable
data class RoofSpec(
    val kind: RoofKind,
    val pitchDeg: Double,
    val overhangM: Double,
    val materialId: String? = null,
)

@Serializable
enum class UnitSystem {
    @SerialName("metric")
    METRIC,

    @SerialName("imperial")
    IMPERIAL,
}

@Serializable
data class Project(
    val id: String? = null,
    val name: String,
    val currency: String,
    val unitSystem: UnitSystem = UnitSystem.METRIC,
    /** Project-wide contingency on top of per-material wastage, 0..1. */
    val contingencyBuffer: Double,
    val floors: List<Floor> = emptyList(),
    val roof: RoofSpec? = null,
    val createdAt: String? = null,
    val updatedAt: String? = null,
) {
    val groundFloor: Floor? get() = floors.minByOrNull { it.level }
}

// ---------------------------------------------------------------------------
// Cost engine
// ---------------------------------------------------------------------------

@Serializable
data class CostLineItem(
    /**
     * A [Surface] name or the literal "COMPONENT". Kept as a String because the
     * TypeScript type is `Surface | 'COMPONENT'`, which has no clean enum mirror.
     */
    val surface: String,
    val materialId: String,
    val materialName: String,
    /** Human-readable location, e.g. "Living Room — floor". */
    val location: String,
    /** Measured quantity before wastage, in [unit]. */
    val rawQuantity: Double,
    val unit: PricingUnit,
    val wastageFactor: Double,
    /** rawQuantity * (1 + wastageFactor), rounded up to a purchasable amount. */
    val bufferedQuantity: Double,
    val unitPrice: Double,
    val subtotal: Double,
)

@Serializable
data class CostQuantities(
    val floorAreaSqm: Double = 0.0,
    val wallAreaSqm: Double = 0.0,
    val ceilingAreaSqm: Double = 0.0,
    val exteriorWallAreaSqm: Double = 0.0,
    val roofAreaSqm: Double = 0.0,
    val openingAreaSqm: Double = 0.0,
)

@Serializable
data class CostBreakdown(
    val currency: String,
    val lineItems: List<CostLineItem> = emptyList(),
    /** Sum of line items. Already includes per-material wastage. */
    val materialsSubtotal: Double,
    val contingencyBuffer: Double,
    val contingencyAmount: Double,
    /** materialsSubtotal + contingencyAmount. The headline, buffered number. */
    val total: Double,
    /** Totals grouped by surface. Keys are [Surface] names or "COMPONENT". */
    val perSurface: Map<String, Double> = emptyMap(),
    val quantities: CostQuantities = CostQuantities(),
)

// ---------------------------------------------------------------------------
// Recommendation engine
// ---------------------------------------------------------------------------

@Serializable
enum class SuggestionMode { AESTHETIC, COST_EFFICIENCY, BALANCED }

@Serializable
data class SuggestionRequest(
    val mode: SuggestionMode,
    val styleId: String? = null,
    val budget: Double? = null,
    val surfaces: List<Surface>? = null,
    /** What the user has chosen so far, keyed by [Surface] name. */
    val current: Map<String, String>? = null,
    val project: Project? = null,
)

@Serializable
data class SuggestionBreakdown(
    val styleMatch: Double,
    val colorHarmony: Double,
    val value: Double,
    val durability: Double,
    val sustainability: Double,
)

@Serializable
data class SuggestionItem(
    val surface: Surface,
    val materialId: String,
    val materialName: String,
    /** Plain-language justification shown in the UI. Never empty. */
    val reason: String,
    /** 0..1 composite score. */
    val score: Double,
    val unitPrice: Double,
    val unit: PricingUnit,
    val replaces: String? = null,
    val replacesName: String? = null,
    /** Positive = cheaper than what it replaces. */
    val estimatedSavings: Double? = null,
    val estimatedSavingsPct: Double? = null,
    val breakdown: SuggestionBreakdown,
)

@Serializable
data class SuggestionResponse(
    val mode: SuggestionMode,
    val styleId: String? = null,
    val items: List<SuggestionItem> = emptyList(),
    val note: String = "",
    val projectedTotal: Double? = null,
    val currentTotal: Double? = null,
)

// ---------------------------------------------------------------------------
// API envelope
// ---------------------------------------------------------------------------

@Serializable
data class ApiError(
    val error: String,
    val message: String,
)

@Serializable
data class HealthResponse(
    val status: String,
    val version: String? = null,
    /**
     * Left as a raw [JsonElement]: ARCHITECTURE.md only says the health payload is
     * `{ status, version, db }` without pinning `db`'s type, and the client only ever
     * uses this endpoint as a reachability probe.
     */
    val db: JsonElement? = null,
)
