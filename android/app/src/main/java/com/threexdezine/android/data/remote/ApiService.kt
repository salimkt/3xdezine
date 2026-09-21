package com.threexdezine.android.data.remote

import com.threexdezine.android.data.model.Catalog
import com.threexdezine.android.data.model.ComponentProduct
import com.threexdezine.android.data.model.CostBreakdown
import com.threexdezine.android.data.model.DesignMaterial
import com.threexdezine.android.data.model.HealthResponse
import com.threexdezine.android.data.model.Project
import com.threexdezine.android.data.model.StylePreset
import com.threexdezine.android.data.model.SuggestionRequest
import com.threexdezine.android.data.model.SuggestionResponse
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.PUT
import retrofit2.http.Path
import retrofit2.http.Query

/**
 * The REST surface from ARCHITECTURE.md > "REST API". Base path `/api`, which is part
 * of the configured base URL, so the paths here are relative and carry no leading `/`.
 */
interface ApiService {

    @GET("health")
    suspend fun health(): HealthResponse

    /** One call for clients that want everything. This is what the app uses at start-up. */
    @GET("catalog")
    suspend fun catalog(): Catalog

    @GET("materials")
    suspend fun materials(
        @Query("category") category: String? = null,
        @Query("surface") surface: String? = null,
        @Query("tier") tier: String? = null,
        @Query("style") style: String? = null,
        @Query("maxPrice") maxPrice: Double? = null,
        @Query("q") q: String? = null,
    ): List<DesignMaterial>

    @GET("materials/{id}")
    suspend fun material(@Path("id") id: String): DesignMaterial

    @GET("components")
    suspend fun components(): List<ComponentProduct>

    @GET("styles")
    suspend fun styles(): List<StylePreset>

    /**
     * POSTs the whole project rather than looking up by id, so an unsaved design can be
     * priced on every edit. Must be pure and fast server-side.
     */
    @POST("cost/estimate")
    suspend fun estimateCost(@Body project: Project): CostBreakdown

    @POST("suggestions")
    suspend fun suggestions(@Body request: SuggestionRequest): SuggestionResponse

    @GET("projects")
    suspend fun projects(): List<Project>

    @POST("projects")
    suspend fun createProject(@Body project: Project): Project

    @GET("projects/{id}")
    suspend fun project(@Path("id") id: String): Project

    @PUT("projects/{id}")
    suspend fun updateProject(@Path("id") id: String, @Body project: Project): Project

    /** Returns 204 with no body, so the return type is a bodyless [Response]. */
    @DELETE("projects/{id}")
    suspend fun deleteProject(@Path("id") id: String): Response<Unit>
}
