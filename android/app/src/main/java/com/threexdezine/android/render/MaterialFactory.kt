package com.threexdezine.android.render

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Log
import com.google.android.filament.Engine
import com.google.android.filament.MaterialInstance
import com.google.android.filament.Texture
import com.google.android.filament.TextureSampler
import com.google.android.filament.android.TextureHelper
import com.threexdezine.android.data.model.ColorInfo
import com.threexdezine.android.data.model.DesignMaterial
import com.threexdezine.android.data.remote.AppJson
import io.github.sceneview.loaders.MaterialLoader
import io.github.sceneview.math.Color
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.ByteArrayInputStream
import kotlin.math.max
import kotlin.math.pow

/**
 * Creates and caches one ubershader [MaterialInstance] per catalog material.
 *
 * ---------------------------------------------------------------------------
 * TWO DELIBERATE DEVIATIONS FROM THE BRIEF, BOTH BECAUSE THIS COULD NOT BE COMPILED
 * ---------------------------------------------------------------------------
 *
 * 1. TILING IS BAKED INTO UV0, NOT SET VIA `setBaseColorUvMatrix(Mat3)`.
 *    [HouseBuilder] emits UV0 in metres, and [SceneController] re-uploads a UV-scaled
 *    copy (`uv / tileSizeM`) whenever a surface's material changes. The result is
 *    numerically identical to a uniform-scale baseColor UV matrix and mirrors the web
 *    client's `surface size / tileSizeM`, but it only uses Filament APIs already used
 *    elsewhere in this file rather than a SceneView extension whose exact signature
 *    could not be verified here. To switch back, set the mat3
 *    `[1/tile, 0, 0, 0, 1/tile, 0, 0, 0, 1]` on the instance and stop scaling the UVs.
 *    Because the scale is uniform and positive, the TANGENTS quaternions are unaffected.
 *
 * 2. MAP PARAMETER NAMES ARE PROBED, NOT ASSUMED.
 *    Which sampler parameters SceneView 4.38.0's precompiled `.filamat` ubershaders
 *    expose is not something this machine can check, so every map is applied through
 *    [applyFirstMatching], which consults Filament's stable `Material.hasParameter`.
 *    If none of the candidate names exist the material simply stays flat colour plus
 *    PBR constants — the degradation ARCHITECTURE.md calls for when a material has no
 *    maps. NOTHING here can hard-fail because of a missing parameter.
 *
 * ---------------------------------------------------------------------------
 * TEXTURE MEMORY
 * ---------------------------------------------------------------------------
 * A 2K PBR set is roughly 64 MB per material uncompressed, so bitmaps are downsampled
 * to 1K on decode and the whole set is cached by material id with LRU eviction
 * ([pruneTo]), which never evicts an entry that a live renderable is still using.
 */
class MaterialFactory(
    private val engine: Engine,
    private val materialLoader: MaterialLoader,
    private val httpClient: OkHttpClient,
    private val assetBaseUrl: () -> String,
) {

    /** One cache entry: the shader instance plus every Filament texture we own for it. */
    class Entry(
        val materialId: String,
        val instance: MaterialInstance,
        val tileSizeM: Float,
    ) {
        internal val textures = mutableListOf<Texture>()
        internal var texturesApplied = false
        internal var lastUsed = 0L
    }

    private val cache = LinkedHashMap<String, Entry>()
    private var cachedManifest: TextureManifest? = null
    private var manifestAttempted = false
    private var clock = 0L

    /**
     * Returns a ready-to-render instance immediately (flat colour + PBR constants), so
     * the scene is never unpainted while textures are still in flight.
     */
    @Synchronized
    fun instanceFor(material: DesignMaterial): Entry {
        cache[material.id]?.let {
            it.lastUsed = ++clock
            return it
        }
        val instance = materialLoader.createColorInstance(
            color = material.color.toFilamentColor(),
            metallic = material.pbr.metalness.toFloat(),
            roughness = material.pbr.roughness.toFloat(),
            reflectance = DEFAULT_REFLECTANCE,
        )
        val entry = Entry(
            materialId = material.id,
            instance = instance,
            tileSizeM = material.texture.tileSizeM.toFloat().coerceAtLeast(0.05f),
        )
        entry.lastUsed = ++clock
        cache[material.id] = entry
        return entry
    }

    /** A flat colour instance for a catalog component (door leaf, sofa, pendant). */
    @Synchronized
    fun fittingInstance(key: String, color: ColorInfo, roughness: Float, metallic: Float): Entry {
        cache[key]?.let {
            it.lastUsed = ++clock
            return it
        }
        val instance = materialLoader.createColorInstance(
            color = color.toFilamentColor(),
            metallic = metallic,
            roughness = roughness,
            reflectance = DEFAULT_REFLECTANCE,
        )
        val entry = Entry(key, instance, tileSizeM = 1f)
        entry.lastUsed = ++clock
        cache[key] = entry
        return entry
    }

    @Synchronized
    fun cached(id: String): Entry? = cache[id]

    /**
     * Downloads and applies the PBR map set for [material], if the asset server has one.
     * Safe to call repeatedly; it is a no-op once the maps are on.
     *
     * @return true when something actually changed and a re-render is needed.
     */
    suspend fun loadTextures(material: DesignMaterial): Boolean {
        val entry = synchronized(this) { cache[material.id] } ?: return false
        if (entry.texturesApplied) return false

        val maps = loadManifest().materials[material.id]?.maps.orEmpty()
        if (maps.isEmpty()) {
            synchronized(this) { entry.texturesApplied = true }
            return false
        }

        val base = assetBaseUrl()
        var changed = false

        suspend fun load(key: String, srgb: Boolean, candidates: List<String>) {
            val path = maps[key] ?: return
            val bitmap = fetchBitmap(join(base, path)) ?: return
            val texture = createTexture(bitmap, srgb) ?: run { bitmap.recycle(); return }
            bitmap.recycle()
            synchronized(this) { entry.textures += texture }
            if (applyFirstMatching(entry.instance, candidates, texture)) changed = true
        }

        // sRGB for albedo only. Normal/roughness/AO are data, not colour — decoding them
        // as sRGB is the classic way to get subtly wrong lighting everywhere.
        load("color", srgb = true, candidates = BASE_COLOR_PARAMS)
        load("normal", srgb = false, candidates = NORMAL_PARAMS)
        load("roughness", srgb = false, candidates = ROUGHNESS_PARAMS)
        load("ao", srgb = false, candidates = OCCLUSION_PARAMS)

        synchronized(this) { entry.texturesApplied = true }
        return changed
    }

    /** Tile size for a material id, falling back to 1 m when unknown. */
    @Synchronized
    fun tileSizeM(id: String?): Float = id?.let { cache[it]?.tileSizeM } ?: 1f

    /**
     * LRU-evicts down to [capacity], never touching an id in [inUse]. Destroying a
     * MaterialInstance that a renderable still points at is a native crash, not an
     * exception, so this guard is not optional.
     */
    @Synchronized
    fun pruneTo(capacity: Int, inUse: Set<String>) {
        if (cache.size <= capacity) return
        val evictable = cache.values
            .filter { it.materialId !in inUse }
            .sortedBy { it.lastUsed }
        var toDrop = cache.size - capacity
        for (entry in evictable) {
            if (toDrop <= 0) break
            destroyEntry(entry)
            cache.remove(entry.materialId)
            toDrop--
        }
    }

    @Synchronized
    fun destroy() {
        cache.values.forEach(::destroyEntry)
        cache.clear()
    }

    private fun destroyEntry(entry: Entry) {
        entry.textures.forEach { runCatching { engine.destroyTexture(it) } }
        entry.textures.clear()
        runCatching { engine.destroyMaterialInstance(entry.instance) }
    }

    // -----------------------------------------------------------------------
    // Filament plumbing
    // -----------------------------------------------------------------------

    /**
     * Sets [texture] on the first parameter name the shader actually declares.
     * `Material.hasParameter` is plain Filament and always available, which is what
     * makes probing safe.
     */
    private fun applyFirstMatching(
        instance: MaterialInstance,
        candidates: List<String>,
        texture: Texture,
    ): Boolean {
        val material = instance.material
        for (name in candidates) {
            val declared = runCatching { material.hasParameter(name) }.getOrDefault(false)
            if (!declared) continue
            val ok = runCatching { instance.setParameter(name, texture, REPEAT_SAMPLER) }.isSuccess
            if (ok) return true
        }
        Log.i(TAG, "No shader parameter from $candidates on this ubershader; staying flat colour.")
        return false
    }

    private fun createTexture(bitmap: Bitmap, srgb: Boolean): Texture? = runCatching {
        val levels = mipLevels(bitmap.width, bitmap.height)
        val texture = Texture.Builder()
            .width(bitmap.width)
            .height(bitmap.height)
            .levels(levels)
            .sampler(Texture.Sampler.SAMPLER_2D)
            .format(if (srgb) Texture.InternalFormat.SRGB8_A8 else Texture.InternalFormat.RGBA8)
            .build(engine)
        TextureHelper.setBitmap(engine, texture, 0, bitmap)
        if (levels > 1) texture.generateMipmaps(engine)
        texture
    }.onFailure { Log.w(TAG, "Filament texture creation failed", it) }.getOrNull()

    private fun mipLevels(width: Int, height: Int): Int {
        var size = max(width, height)
        var levels = 1
        while (size > 1) {
            size /= 2
            levels++
        }
        return levels
    }

    // -----------------------------------------------------------------------
    // Asset fetching
    // -----------------------------------------------------------------------

    private suspend fun loadManifest(): TextureManifest {
        cachedManifest?.let { return it }
        if (manifestAttempted) return EMPTY_MANIFEST
        manifestAttempted = true
        val url = join(assetBaseUrl(), MANIFEST_PATH)
        val body = fetchBytes(url) ?: return EMPTY_MANIFEST
        val parsed = runCatching {
            AppJson.decodeFromString(TextureManifest.serializer(), body.decodeToString())
        }.onFailure { Log.w(TAG, "Could not parse $url", it) }.getOrNull() ?: EMPTY_MANIFEST
        cachedManifest = parsed
        return parsed
    }

    private suspend fun fetchBytes(url: String): ByteArray? = withContext(Dispatchers.IO) {
        runCatching {
            httpClient.newCall(Request.Builder().url(url).build()).execute().use { response ->
                if (!response.isSuccessful) return@use null
                response.body?.bytes()
            }
        }.onFailure { Log.i(TAG, "GET $url failed: ${it.message}") }.getOrNull()
    }

    private suspend fun fetchBitmap(url: String): Bitmap? = withContext(Dispatchers.IO) {
        val bytes = fetchBytes(url) ?: return@withContext null
        runCatching {
            // Measure first so a 2K/4K download still lands as a 1K texture.
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeStream(ByteArrayInputStream(bytes), null, bounds)
            val longest = max(bounds.outWidth, bounds.outHeight)
            var sample = 1
            while (longest / sample > MAX_TEXTURE_EDGE) sample *= 2

            val options = BitmapFactory.Options().apply {
                inSampleSize = sample
                inPreferredConfig = Bitmap.Config.ARGB_8888
            }
            BitmapFactory.decodeStream(ByteArrayInputStream(bytes), null, options)
        }.onFailure { Log.w(TAG, "Bitmap decode failed for $url", it) }.getOrNull()
    }

    companion object {
        private const val TAG = "MaterialFactory"
        private const val MANIFEST_PATH = "textures/manifest.json"
        private const val DEFAULT_REFLECTANCE = 0.5f

        /** 1K. A 2K PBR set is ~64 MB per material uncompressed. */
        const val MAX_TEXTURE_EDGE = 1024

        private val EMPTY_MANIFEST = TextureManifest()

        private val REPEAT_SAMPLER = TextureSampler(
            TextureSampler.MinFilter.LINEAR_MIPMAP_LINEAR,
            TextureSampler.MagFilter.LINEAR,
            TextureSampler.WrapMode.REPEAT,
        )

        // Probed in order. All are unambiguously SAMPLER parameter names in the
        // Filament / gltfio ubershader family; none collides with a float parameter
        // such as `roughness` or `metallic`, which would be a type error at runtime.
        private val BASE_COLOR_PARAMS = listOf("baseColorMap", "baseColorTexture", "albedoMap")
        private val NORMAL_PARAMS = listOf("normalMap", "normalTexture")
        private val ROUGHNESS_PARAMS = listOf("metallicRoughnessMap", "roughnessMap", "ormMap")
        private val OCCLUSION_PARAMS = listOf("occlusionMap", "aoMap", "ambientOcclusionMap")

        fun join(base: String, path: String): String {
            val b = base.trimEnd('/')
            val p = path.trimStart('/')
            return "$b/$p"
        }

        /**
         * "#RRGGBB" -> linear Filament colour. The catalog stores sRGB hex, and
         * Filament's baseColor parameter is linear, so the transfer function has to be
         * undone here or every material comes out washed out.
         */
        fun ColorInfo.toFilamentColor(): Color {
            val clean = hex.removePrefix("#")
            val value = clean.toLongOrNull(16)?.toInt() ?: 0xCCCCCC
            val r = ((value shr 16) and 0xFF) / 255f
            val g = ((value shr 8) and 0xFF) / 255f
            val b = (value and 0xFF) / 255f
            return Color(srgbToLinear(r), srgbToLinear(g), srgbToLinear(b), 1f)
        }

        private fun srgbToLinear(c: Float): Float =
            if (c <= 0.04045f) c / 12.92f else ((c + 0.055f) / 1.055f).pow(2.4f)
    }
}
