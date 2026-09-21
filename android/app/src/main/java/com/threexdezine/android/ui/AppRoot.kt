package com.threexdezine.android.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.threexdezine.android.AppContainer
import com.threexdezine.android.ui.projects.ProjectListScreen
import com.threexdezine.android.ui.walk.WalkthroughScreen

/**
 * Navigation is a single nullable "open project" plus a settings flag.
 *
 * There are exactly two destinations and one dialog, so `androidx.navigation` would add
 * a dependency (and a back-stack abstraction) for a state machine that fits in a line.
 */
@Composable
fun AppRoot(container: AppContainer) {
    val viewModel: DesignViewModel = viewModel(factory = DesignViewModel.factory(container))
    val state by viewModel.state.collectAsStateWithLifecycle()
    val apiBaseUrl by viewModel.apiBaseUrl.collectAsStateWithLifecycle()
    val assetBaseUrl by viewModel.assetBaseUrl.collectAsStateWithLifecycle()

    var showSettings by remember { mutableStateOf(false) }

    val openProject = state.openProject
    val catalog = state.catalog

    if (openProject != null && catalog != null) {
        WalkthroughScreen(
            container = container,
            project = openProject,
            catalog = catalog,
            cost = state.cost,
            costOrigin = state.costOrigin,
            costPending = state.costPending,
            onApplyMaterial = viewModel::applyMaterial,
            onBack = viewModel::closeProject,
            onOpenSettings = { showSettings = true },
        )
    } else {
        ProjectListScreen(
            state = state,
            onOpenProject = viewModel::openProject,
            onRefresh = viewModel::refresh,
            onOpenSettings = { showSettings = true },
        )
    }

    if (showSettings) {
        SettingsSheet(
            apiBaseUrl = apiBaseUrl,
            assetBaseUrl = assetBaseUrl,
            onDismiss = { showSettings = false },
            onSave = { api, assets ->
                viewModel.setBackend(api, assets)
                showSettings = false
            },
            onReset = {
                viewModel.resetBackend()
                showSettings = false
            },
        )
    }
}
