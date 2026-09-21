package com.threexdezine.android.render

import kotlinx.serialization.Serializable

/**
 * Mirror of `web/public/textures/manifest.json`, written by `scripts/fetch-assets.mjs`.
 *
 * PBR maps are static files served by the web dev server, NOT by the REST API — there
 * is no texture endpoint in ARCHITECTURE.md > "REST API". Hence the separate asset base
 * URL in settings. When the manifest is unreachable, a material degrades to its flat
 * colour plus PBR constants, which ARCHITECTURE.md explicitly sanctions.
 */
@Serializable
data class TextureManifest(
    val generatedAt: String? = null,
    val resolution: String? = null,
    val materials: Map<String, TextureManifestEntry> = emptyMap(),
    val hdris: List<HdriEntry> = emptyList(),
)

@Serializable
data class TextureManifestEntry(
    val source: String? = null,
    val sourceId: String? = null,
    val license: String? = null,
    val tileSizeM: Double? = null,
    /** Keys seen in the wild: "color", "normal", "roughness", "ao". Values are paths. */
    val maps: Map<String, String> = emptyMap(),
)

@Serializable
data class HdriEntry(
    val id: String,
    val label: String? = null,
    val url: String,
)
