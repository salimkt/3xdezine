package com.threexdezine.android.render

import android.util.Log
import com.google.android.filament.Engine
import com.google.android.filament.Scene
import com.threexdezine.android.data.model.Catalog
import com.threexdezine.android.data.model.ColorInfo
import com.threexdezine.android.data.model.ComponentType
import com.threexdezine.android.data.model.Project
import kotlin.math.abs

/**
 * Owns every Filament resource this app creates for the house shell, and is the only
 * place that mutates the Filament [Scene].
 *
 * LIFECYCLE CONTRACT: Filament leaks natively when resources outlive the Engine, and
 * SceneView only manages what SceneView created. Everything created here — vertex and
 * index buffers, renderables, entities, material instances and textures — is destroyed
 * by [destroy], which the walkthrough screen calls from a DisposableEffect.
 *
 * RENDER-ON-DEMAND: SceneView 4.38.0 renders on demand. Mutating a MaterialInstance or
 * swapping a renderable's material does NOT wake the loop by itself, so every mutating
 * method returns/whether something changed and the caller must invalidate. `onFrame`
 * cannot be used to keep the loop awake.
 */
class SceneController(
    private val engine: Engine,
    private val scene: Scene,
    private val materialFactory: MaterialFactory,
) {

    private class Rendered(val part: SurfacePart) {
        var mesh: FilamentMesh? = null
        var uvScale: Float = Float.NaN
        var materialKey: String? = null
    }

    private val rendered = mutableListOf<Rendered>()
    private var destroyed = false

    val surfaceCount: Int get() = rendered.size
    val triangleCount: Int get() = rendered.sumOf { it.part.mesh.indices.size / 3 }

    /** Rebuilds the whole shell. Cheap enough to call on a project change. */
    fun rebuild(project: Project, catalog: Catalog) {
        if (destroyed) return
        clearMeshes()
        val parts = runCatching { HouseBuilder.build(project, catalog) }
            .onFailure { Log.e(TAG, "House geometry generation failed", it) }
            .getOrDefault(emptyList())
        rendered += parts.map { Rendered(it) }
        applyMaterials(project, catalog)
    }

    /**
     * Re-binds materials from the current project state. This is the instant-swap path:
     * it touches no geometry unless the new material's `tileSizeM` differs, in which
     * case only the affected surface's UV-scaled mesh is re-uploaded.
     *
     * @return true when anything changed and the caller should invalidate the renderer.
     */
    fun applyMaterials(project: Project, catalog: Catalog): Boolean {
        if (destroyed) return false
        var changed = false

        for (item in rendered) {
            val entry = resolveMaterial(item.part.ref, project, catalog) ?: continue
            val key = entry.materialId
            val uvScale = 1f / entry.tileSizeM.coerceAtLeast(0.05f)

            val existing = item.mesh
            val needsGeometry = existing == null || abs(uvScale - item.uvScale) > 1e-5f

            if (needsGeometry) {
                existing?.destroy(engine, scene)
                val castShadows = item.part.ref !is SurfaceRef.RoomCeiling
                val mesh = FilamentMesh.create(
                    engine = engine,
                    scene = scene,
                    ref = item.part.ref,
                    mesh = item.part.mesh.withUvScale(uvScale),
                    material = entry.instance,
                    castShadows = castShadows,
                    receiveShadows = true,
                )
                item.mesh = mesh
                item.uvScale = uvScale
                item.materialKey = key
                changed = true
            } else if (item.materialKey != key) {
                // `existing` is non-null here (needsGeometry covers the null case), but
                // a safe call costs nothing and does not lean on smart-cast rules.
                existing?.setMaterial(engine, entry.instance)
                item.materialKey = key
                changed = true
            }
        }

        materialFactory.pruneTo(MATERIAL_CACHE_CAPACITY, inUseKeys())
        return changed
    }

    /**
     * Downloads PBR map sets for every material currently on screen. Suspending and
     * incremental: each material that lands calls [onProgress] so the caller can
     * invalidate the renderer and the picture fills in progressively.
     */
    suspend fun loadTextures(project: Project, catalog: Catalog, onProgress: () -> Unit) {
        if (destroyed) return
        val ids = rendered
            .mapNotNull { it.part.ref.materialId(project) }
            .distinct()
        for (id in ids) {
            val material = catalog.material(id) ?: continue
            val changed = runCatching { materialFactory.loadTextures(material) }
                .onFailure { Log.w(TAG, "Texture load failed for $id", it) }
                .getOrDefault(false)
            if (changed) onProgress()
        }
    }

    fun destroy() {
        if (destroyed) return
        destroyed = true
        clearMeshes()
        materialFactory.destroy()
    }

    // -----------------------------------------------------------------------

    private fun clearMeshes() {
        rendered.forEach { it.mesh?.destroy(engine, scene) }
        rendered.clear()
    }

    private fun inUseKeys(): Set<String> = rendered.mapNotNull { it.materialKey }.toSet()

    private fun resolveMaterial(
        ref: SurfaceRef,
        project: Project,
        catalog: Catalog,
    ): MaterialFactory.Entry? {
        if (ref is SurfaceRef.Fitting) {
            val product = catalog.componentsById[ref.componentId]
            val roughness = when (product?.type) {
                ComponentType.LIGHT -> 0.25f
                ComponentType.FURNITURE -> 0.85f
                else -> 0.55f
            }
            return materialFactory.fittingInstance(
                key = FITTING_KEY_PREFIX + ref.componentId,
                color = product?.color ?: FALLBACK_COLOR,
                roughness = roughness,
                metallic = 0f,
            )
        }
        val materialId = ref.materialId(project)
        val material = catalog.material(materialId)
        if (material != null) return materialFactory.instanceFor(material)

        // Unpainted surface: a neutral plaster-ish stand-in beats an invisible wall.
        return materialFactory.fittingInstance(
            key = UNPAINTED_KEY,
            color = FALLBACK_COLOR,
            roughness = 0.9f,
            metallic = 0f,
        )
    }

    private companion object {
        const val TAG = "SceneController"

        /**
         * The sample project uses ~8 distinct materials; 24 is the whole catalog. This
         * caps resident texture sets while never thrashing a realistic project.
         */
        const val MATERIAL_CACHE_CAPACITY = 16

        const val FITTING_KEY_PREFIX = "__fitting:"
        const val UNPAINTED_KEY = "__unpainted"

        val FALLBACK_COLOR = ColorInfo(name = "Unfinished", hex = "#CFCBC4")
    }
}
