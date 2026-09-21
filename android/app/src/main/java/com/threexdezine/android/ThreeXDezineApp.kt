package com.threexdezine.android

import android.app.Application
import android.content.Context
import com.threexdezine.android.data.BackendSettings
import com.threexdezine.android.data.DesignRepository
import com.threexdezine.android.data.local.BundledAssets
import com.threexdezine.android.data.remote.NetworkFactory

/**
 * Hand-rolled service locator. The dependency graph is five objects deep; a DI framework
 * would be more moving parts than the thing it wires up, and Hilt is not in the pinned
 * dependency set.
 */
class AppContainer(context: Context) {
    val settings: BackendSettings = BackendSettings(context)
    val bundledAssets: BundledAssets = BundledAssets(context)
    val networkFactory: NetworkFactory = NetworkFactory(context)
    val repository: DesignRepository = DesignRepository(networkFactory, settings, bundledAssets)

    /** Call after changing a base URL so the next request uses it. */
    fun onBackendChanged() = repository.invalidate()
}

class ThreeXDezineApp : Application() {

    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this)
    }
}

/** Reaches the container from anywhere with a Context, including Compose previews. */
val Context.appContainer: AppContainer
    get() = (applicationContext as ThreeXDezineApp).container
