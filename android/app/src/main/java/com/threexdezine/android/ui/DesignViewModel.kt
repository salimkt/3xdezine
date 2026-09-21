package com.threexdezine.android.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.threexdezine.android.AppContainer
import com.threexdezine.android.data.ApplyTarget
import com.threexdezine.android.data.DataOrigin
import com.threexdezine.android.data.applyMaterial
import com.threexdezine.android.data.model.Catalog
import com.threexdezine.android.data.model.CostBreakdown
import com.threexdezine.android.data.model.Project
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class DesignUiState(
    val loading: Boolean = true,
    val catalog: Catalog? = null,
    val catalogOrigin: DataOrigin = DataOrigin.BUNDLED,
    val projects: List<Project> = emptyList(),
    val projectsOrigin: DataOrigin = DataOrigin.BUNDLED,
    val openProject: Project? = null,
    val cost: CostBreakdown? = null,
    val costOrigin: DataOrigin = DataOrigin.BUNDLED,
    val costPending: Boolean = false,
    /** Set when the backend was unreachable. Shown once, not as a blocking error. */
    val connectionNote: String? = null,
) {
    val isOffline: Boolean
        get() = catalogOrigin == DataOrigin.BUNDLED || projectsOrigin == DataOrigin.BUNDLED
}

/**
 * Single view model for both screens: the catalog and the open project are the same two
 * objects on the list screen and in the walkthrough, and splitting them would mean
 * re-fetching the catalog on every navigation.
 */
class DesignViewModel(private val container: AppContainer) : ViewModel() {

    private val _state = MutableStateFlow(DesignUiState())
    val state: StateFlow<DesignUiState> = _state.asStateFlow()

    val apiBaseUrl: StateFlow<String> = container.settings.apiBaseUrl
    val assetBaseUrl: StateFlow<String> = container.settings.assetBaseUrl

    private var costJob: Job? = null

    init {
        refresh()
    }

    fun refresh() {
        viewModelScope.launch {
            _state.update { it.copy(loading = true, connectionNote = null) }
            val catalog = container.repository.loadCatalog()
            val projects = container.repository.loadProjects()
            _state.update {
                it.copy(
                    loading = false,
                    catalog = catalog.value,
                    catalogOrigin = catalog.origin,
                    projects = projects.value,
                    projectsOrigin = projects.origin,
                    connectionNote = catalog.error ?: projects.error,
                )
            }
        }
    }

    fun openProject(project: Project) {
        _state.update { it.copy(openProject = project, cost = null) }
        scheduleCostEstimate(immediate = true)
    }

    fun closeProject() {
        costJob?.cancel()
        _state.update { it.copy(openProject = null, cost = null, costPending = false) }
    }

    /**
     * Applies a material and re-prices. The project object is replaced wholesale, which
     * is what makes the 3D view and the cost panel impossible to get out of sync.
     */
    fun applyMaterial(target: ApplyTarget, materialId: String) {
        val current = _state.value.openProject ?: return
        _state.update { it.copy(openProject = current.applyMaterial(target, materialId)) }
        scheduleCostEstimate(immediate = false)
    }

    /**
     * Debounced because `POST /cost/estimate` is called on every edit and a user
     * scrubbing through a material list would otherwise fire a request per tap.
     */
    private fun scheduleCostEstimate(immediate: Boolean) {
        costJob?.cancel()
        val project = _state.value.openProject ?: return
        val catalog = _state.value.catalog ?: return
        _state.update { it.copy(costPending = true) }
        costJob = viewModelScope.launch {
            if (!immediate) delay(COST_DEBOUNCE_MS)
            val result = container.repository.estimateCost(project, catalog)
            _state.update {
                // Drop a stale response if the user has since changed the project.
                if (it.openProject !== project) it
                else it.copy(cost = result.value, costOrigin = result.origin, costPending = false)
            }
        }
    }

    fun setBackend(apiUrl: String, assetUrl: String) {
        container.settings.setApiBaseUrl(apiUrl)
        container.settings.setAssetBaseUrl(assetUrl)
        container.onBackendChanged()
        refresh()
        if (_state.value.openProject != null) scheduleCostEstimate(immediate = true)
    }

    fun resetBackend() {
        container.settings.reset()
        container.onBackendChanged()
        refresh()
    }

    companion object {
        private const val COST_DEBOUNCE_MS = 400L

        fun factory(container: AppContainer) = viewModelFactory {
            initializer { DesignViewModel(container) }
        }
    }
}
