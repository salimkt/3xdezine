package com.threexdezine.android.data

import android.content.Context
import com.threexdezine.android.data.remote.BackendDefaults
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * The configurable backend endpoints, persisted in SharedPreferences.
 *
 * Deliberately not DataStore: this is two strings read once at start-up, and DataStore
 * is not in the pinned dependency set.
 */
class BackendSettings(context: Context) {

    private val prefs = context.applicationContext
        .getSharedPreferences("backend", Context.MODE_PRIVATE)

    private val _apiBaseUrl = MutableStateFlow(
        prefs.getString(KEY_API, null) ?: BackendDefaults.API_BASE_URL,
    )
    val apiBaseUrl: StateFlow<String> = _apiBaseUrl.asStateFlow()

    private val _assetBaseUrl = MutableStateFlow(
        prefs.getString(KEY_ASSETS, null) ?: BackendDefaults.ASSET_BASE_URL,
    )
    val assetBaseUrl: StateFlow<String> = _assetBaseUrl.asStateFlow()

    fun setApiBaseUrl(value: String) {
        val normalized = value.trim().ifEmpty { BackendDefaults.API_BASE_URL }
        prefs.edit().putString(KEY_API, normalized).apply()
        _apiBaseUrl.value = normalized
    }

    fun setAssetBaseUrl(value: String) {
        val normalized = value.trim().ifEmpty { BackendDefaults.ASSET_BASE_URL }
        prefs.edit().putString(KEY_ASSETS, normalized).apply()
        _assetBaseUrl.value = normalized
    }

    fun reset() {
        prefs.edit().clear().apply()
        _apiBaseUrl.value = BackendDefaults.API_BASE_URL
        _assetBaseUrl.value = BackendDefaults.ASSET_BASE_URL
    }

    private companion object {
        const val KEY_API = "api_base_url"
        const val KEY_ASSETS = "asset_base_url"
    }
}
