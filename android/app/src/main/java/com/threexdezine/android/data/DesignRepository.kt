package com.threexdezine.android.data

import android.util.Log
import com.threexdezine.android.cost.LocalCostEngine
import com.threexdezine.android.data.local.BundledAssets
import com.threexdezine.android.data.model.Catalog
import com.threexdezine.android.data.model.CostBreakdown
import com.threexdezine.android.data.model.Project
import com.threexdezine.android.data.model.SuggestionRequest
import com.threexdezine.android.data.model.SuggestionResponse
import com.threexdezine.android.data.remote.ApiService
import com.threexdezine.android.data.remote.NetworkFactory
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** Where a piece of data actually came from. Surfaced in the UI, never guessed at. */
enum class DataOrigin { BACKEND, BUNDLED }

data class Sourced<T>(val value: T, val origin: DataOrigin, val error: String? = null)

/**
 * Single entry point for catalog / project / cost data.
 *
 * Every remote call degrades to the bundled `assets/` copies rather than failing, so the
 * app is demonstrable with no server. The origin travels with the data so the UI can say
 * "offline" instead of silently showing stale numbers.
 */
class DesignRepository(
    private val networkFactory: NetworkFactory,
    private val settings: BackendSettings,
    private val bundled: BundledAssets,
) {

    /** Rebuilt on demand so a base-URL change in Settings takes effect immediately. */
    private var cachedBaseUrl: String? = null
    private var cachedApi: ApiService? = null

    @Synchronized
    private fun api(): ApiService {
        val url = settings.apiBaseUrl.value
        val existing = cachedApi
        if (existing != null && cachedBaseUrl == url) return existing
        val created = networkFactory.createApi(url)
        cachedApi = created
        cachedBaseUrl = url
        return created
    }

    /** Drops the memoised Retrofit instance. Call after changing the base URL. */
    @Synchronized
    fun invalidate() {
        cachedApi = null
        cachedBaseUrl = null
    }

    suspend fun loadCatalog(): Sourced<Catalog> = withContext(Dispatchers.IO) {
        try {
            Sourced(api().catalog(), DataOrigin.BACKEND)
        } catch (t: Throwable) {
            Log.w(TAG, "GET /catalog failed, falling back to bundled catalog.seed.json", t)
            Sourced(bundled.catalog(), DataOrigin.BUNDLED, t.readableMessage())
        }
    }

    suspend fun loadProjects(): Sourced<List<Project>> = withContext(Dispatchers.IO) {
        try {
            val remote = api().projects()
            if (remote.isEmpty()) {
                // A reachable but empty backend still deserves something to walk through.
                Sourced(listOf(bundled.sampleProject()), DataOrigin.BUNDLED)
            } else {
                Sourced(remote, DataOrigin.BACKEND)
            }
        } catch (t: Throwable) {
            Log.w(TAG, "GET /projects failed, falling back to bundled sample-project.json", t)
            Sourced(listOf(bundled.sampleProject()), DataOrigin.BUNDLED, t.readableMessage())
        }
    }

    suspend fun loadProject(id: String): Sourced<Project> = withContext(Dispatchers.IO) {
        if (id == BundledAssets.LOCAL_SAMPLE_ID) {
            return@withContext Sourced(bundled.sampleProject(), DataOrigin.BUNDLED)
        }
        try {
            Sourced(api().project(id), DataOrigin.BACKEND)
        } catch (t: Throwable) {
            Log.w(TAG, "GET /projects/$id failed, falling back to bundled sample", t)
            Sourced(bundled.sampleProject(), DataOrigin.BUNDLED, t.readableMessage())
        }
    }

    /**
     * `POST /api/cost/estimate` with the whole project, per ARCHITECTURE.md. Falls back
     * to [LocalCostEngine], which is an approximation — the caller must label it.
     */
    suspend fun estimateCost(project: Project, catalog: Catalog): Sourced<CostBreakdown> =
        withContext(Dispatchers.IO) {
            try {
                Sourced(api().estimateCost(project), DataOrigin.BACKEND)
            } catch (t: Throwable) {
                Log.w(TAG, "POST /cost/estimate failed, using on-device approximation", t)
                Sourced(
                    LocalCostEngine.estimate(project, catalog),
                    DataOrigin.BUNDLED,
                    t.readableMessage(),
                )
            }
        }

    /** No offline equivalent: the recommendation engine lives only on the backend. */
    suspend fun suggestions(request: SuggestionRequest): Result<SuggestionResponse> =
        withContext(Dispatchers.IO) {
            runCatching { api().suggestions(request) }
        }

    suspend fun saveProject(project: Project): Result<Project> = withContext(Dispatchers.IO) {
        runCatching {
            val id = project.id
            if (id == null || id == BundledAssets.LOCAL_SAMPLE_ID) {
                api().createProject(project.copy(id = null))
            } else {
                api().updateProject(id, project)
            }
        }
    }

    private fun Throwable.readableMessage(): String =
        this::class.simpleName?.let { "$it: ${message ?: "no detail"}" } ?: (message ?: "unknown error")

    private companion object {
        const val TAG = "DesignRepository"
    }
}
