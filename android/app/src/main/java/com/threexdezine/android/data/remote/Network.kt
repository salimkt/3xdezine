package com.threexdezine.android.data.remote

import android.content.Context
import com.threexdezine.android.BuildConfig
import kotlinx.serialization.json.Json
import okhttp3.Cache
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory
import java.io.File
import java.util.concurrent.TimeUnit

/**
 * JSON configuration shared by the network layer and the bundled-asset loader, so the
 * offline fallback parses exactly the same way as a live response.
 *
 *  - `ignoreUnknownKeys`: `catalog.seed.json` carries a `$schema` key, and the backend
 *    is free to add fields without breaking this client.
 *  - `explicitNulls = false`: `Project` has several optional fields (`id`, `roof`,
 *    `createdAt`). Serialising them as explicit `null` would make POST /cost/estimate
 *    bodies noisier than the contract expects.
 *  - `coerceInputValues = false`: we want a hard failure, not a silent default, if the
 *    backend and this mirror disagree about an enum.
 */
val AppJson: Json = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
    encodeDefaults = true
    isLenient = false
    prettyPrint = false
}

object BackendDefaults {
    /**
     * `10.0.2.2` is the Android emulator's alias for the host machine's loopback
     * interface, so this points at a backend running on `localhost:4000` on the dev
     * machine. On a physical device this must be changed to the machine's LAN IP
     * (see android/README.md).
     */
    const val API_BASE_URL: String = "http://10.0.2.2:4000/api/"

    /**
     * PBR texture sets and HDRIs are served as static files by the web dev server
     * (`web/public/textures/...`), not by the REST API, so they get their own base.
     */
    const val ASSET_BASE_URL: String = "http://10.0.2.2:5173/"

    /** PBR texture sets are the real payload; a generous on-disk cache is the point. */
    const val HTTP_CACHE_BYTES: Long = 256L * 1024L * 1024L
}

/**
 * Builds the OkHttp/Retrofit stack. Cheap to rebuild: the [Cache] is keyed on a
 * directory, so a new client over the same directory reuses the same cached bodies.
 *
 * Rebuilt whenever the user changes the base URL in Settings.
 */
class NetworkFactory(context: Context) {

    private val appContext = context.applicationContext

    private val cache: Cache by lazy {
        Cache(File(appContext.cacheDir, "http"), BackendDefaults.HTTP_CACHE_BYTES)
    }

    val okHttpClient: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .cache(cache)
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .callTimeout(60, TimeUnit.SECONDS)
            .retryOnConnectionFailure(true)
            .apply {
                if (BuildConfig.DEBUG) {
                    addInterceptor(
                        HttpLoggingInterceptor().apply {
                            level = HttpLoggingInterceptor.Level.BASIC
                        },
                    )
                }
            }
            .build()
    }

    fun createApi(baseUrl: String): ApiService =
        Retrofit.Builder()
            .baseUrl(normalizeBaseUrl(baseUrl))
            .client(okHttpClient)
            .addConverterFactory(AppJson.asConverterFactory(JSON_MEDIA_TYPE))
            .build()
            .create(ApiService::class.java)

    companion object {
        private val JSON_MEDIA_TYPE = "application/json".toMediaType()

        /** Retrofit requires a base URL with a trailing slash or it drops the last segment. */
        fun normalizeBaseUrl(raw: String): String {
            val trimmed = raw.trim()
            val withScheme = if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
                trimmed
            } else {
                "http://$trimmed"
            }
            return if (withScheme.endsWith("/")) withScheme else "$withScheme/"
        }
    }
}
