package com.threexdezine.android.data.local

import android.content.Context
import com.threexdezine.android.data.model.Catalog
import com.threexdezine.android.data.model.Project
import com.threexdezine.android.data.remote.AppJson
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * The offline fallback. `shared/catalog.seed.json` and `shared/sample-project.json` are
 * copied verbatim into `assets/`, so the app is fully demonstrable with no server at all
 * — which is also what makes the 3D walkthrough testable on a device with no network.
 *
 * Keep these in sync with `shared/` by re-copying them; they are not generated.
 */
class BundledAssets(context: Context) {

    private val assets = context.applicationContext.assets

    suspend fun catalog(): Catalog = withContext(Dispatchers.IO) {
        AppJson.decodeFromString(Catalog.serializer(), read(CATALOG_FILE))
    }

    suspend fun sampleProject(): Project = withContext(Dispatchers.IO) {
        AppJson.decodeFromString(Project.serializer(), read(PROJECT_FILE))
            // The bundled file has no `id` (it is a template, not a saved project).
            // Give it a stable local one so the UI can key off it.
            .let { if (it.id == null) it.copy(id = LOCAL_SAMPLE_ID) else it }
    }

    private fun read(name: String): String =
        assets.open(name).bufferedReader(Charsets.UTF_8).use { it.readText() }

    companion object {
        const val CATALOG_FILE = "catalog.seed.json"
        const val PROJECT_FILE = "sample-project.json"

        /** Bundled HDRI, copied from `web/public/hdri/kloofendal_43d_clear_puresky.hdr`. */
        const val HDRI_FILE = "hdri/environment.hdr"

        /** Marks a project that came from assets rather than from the backend. */
        const val LOCAL_SAMPLE_ID = "local-sample"
    }
}
