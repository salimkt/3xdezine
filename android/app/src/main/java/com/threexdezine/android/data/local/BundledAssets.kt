package com.threexdezine.android.data.local

import android.content.Context
import android.util.Log
import com.threexdezine.android.cost.LocalCostEngine
import com.threexdezine.android.data.model.Catalog
import com.threexdezine.android.data.model.PlanTemplateMeta
import com.threexdezine.android.data.model.Project
import com.threexdezine.android.data.model.TemplateCategory
import com.threexdezine.android.data.remote.AppJson
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.builtins.ListSerializer

/** A starter plan: its index entry plus the parsed [Project]. */
data class PlanTemplate(val meta: PlanTemplateMeta, val project: Project)

/**
 * The offline fallback, and the plan templates. `shared/catalog.seed.json`,
 * `shared/sample-project.json` and `shared/templates/` are copied into the APK's assets
 * AT BUILD TIME by the `sync<Variant>SharedAssets` Gradle task (app/build.gradle.kts), so
 * they can never drift from the web client and are never edited here by hand.
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

    /**
     * Every template in `templates/index.json`, in index order. A template whose file is
     * missing or does not parse is skipped (and logged) rather than taking the gallery
     * down. When there is no index at all — the templates have not landed in `shared/`
     * yet — the sample project is offered as the only template.
     */
    suspend fun templates(): List<PlanTemplate> = withContext(Dispatchers.IO) {
        val index = runCatching {
            AppJson.decodeFromString(ListSerializer(PlanTemplateMeta.serializer()), read(TEMPLATE_INDEX))
        }.onFailure { Log.i(TAG, "No usable $TEMPLATE_INDEX; using the sample project as the only template", it) }
            .getOrNull()

        val loaded = index.orEmpty().mapNotNull { meta ->
            runCatching {
                val project = AppJson.decodeFromString(Project.serializer(), read("$TEMPLATE_DIR/${meta.file}"))
                PlanTemplate(meta, project.copy(id = templateProjectId(meta.id), templateId = project.templateId ?: meta.id))
            }.onFailure { Log.w(TAG, "Template ${meta.id} (${meta.file}) skipped", it) }.getOrNull()
        }
        loaded.ifEmpty { listOf(sampleAsTemplate(sampleProject())) }
    }

    private fun sampleAsTemplate(project: Project): PlanTemplate {
        val rooms = project.groundFloor?.rooms.orEmpty()
        return PlanTemplate(
            meta = PlanTemplateMeta(
                id = SAMPLE_TEMPLATE_ID,
                name = project.name,
                tagline = "The bundled sample plan",
                category = TemplateCategory.APARTMENT,
                bhk = rooms.count { it.name.contains("bed", ignoreCase = true) },
                builtUpSqm = rooms.sumOf { LocalCostEngine.roomArea(it) },
                rooms = rooms.size,
                file = PROJECT_FILE,
            ),
            project = project,
        )
    }

    private fun read(name: String): String =
        assets.open(name).bufferedReader(Charsets.UTF_8).use { it.readText() }

    companion object {
        const val CATALOG_FILE = "catalog.seed.json"
        const val PROJECT_FILE = "sample-project.json"
        const val TEMPLATE_DIR = "templates"
        const val TEMPLATE_INDEX = "$TEMPLATE_DIR/index.json"
        const val SAMPLE_TEMPLATE_ID = "sample"

        /** Templates are opened as local, unsaved projects with this id prefix. */
        const val TEMPLATE_ID_PREFIX = "template:"
        fun templateProjectId(templateId: String) = TEMPLATE_ID_PREFIX + templateId
        fun isLocalId(id: String?) = id == null || id == LOCAL_SAMPLE_ID || id.startsWith(TEMPLATE_ID_PREFIX)

        private const val TAG = "BundledAssets"

        /** Bundled HDRI, copied from `web/public/hdri/kloofendal_43d_clear_puresky.hdr`. */
        const val HDRI_FILE = "hdri/environment.hdr"

        /** Marks a project that came from assets rather than from the backend. */
        const val LOCAL_SAMPLE_ID = "local-sample"
    }
}
