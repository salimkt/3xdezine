package com.threexdezine.android.ui

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.ContentTransform
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.threexdezine.android.AppContainer
import com.threexdezine.android.data.model.Catalog
import com.threexdezine.android.data.model.Project
import com.threexdezine.android.ui.home.HomeScreen
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

    val destination: Destination =
        if (openProject != null && catalog != null) Destination.Walk(openProject, catalog) else Destination.List

    AnimatedContent(
        targetState = destination,
        // Keyed on WHICH screen, not on its data: a material swap hands the walkthrough
        // a new Project every time, and that must recompose it in place — never tear
        // down and rebuild the Filament engine behind a cross-fade.
        contentKey = { it.key },
        transitionSpec = { screenTransition(toList = targetState is Destination.List) },
        label = "screen",
    ) { dest ->
        when (dest) {
            is Destination.Walk -> WalkthroughScreen(
                container = container,
                // While the walkthrough is exiting, `dest` still holds the project it was
                // showing, so it keeps rendering the right house as it fades.
                project = dest.project,
                catalog = dest.catalog,
                cost = state.cost,
                costOrigin = state.costOrigin,
                costPending = state.costPending,
                onApplyMaterial = viewModel::applyMaterial,
                onBack = viewModel::closeProject,
                onOpenSettings = { showSettings = true },
            )
            Destination.List -> HomeScreen(
                state = state,
                onOpenProject = viewModel::openProject,
                onRefresh = viewModel::refresh,
                onOpenSettings = { showSettings = true },
            )
        }
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

private sealed interface Destination {
    val key: String

    data object List : Destination {
        override val key = "list"
    }

    data class Walk(val project: Project, val catalog: Catalog) : Destination {
        override val key: String get() = "walk:" + (project.id ?: project.name)
    }
}

/**
 * The project list always draws ABOVE the walkthrough, in both directions, and is the
 * only side that fades and scales.
 *
 * Why: the walkthrough renders into a SurfaceView (SceneView's default, and the fast
 * path), which composites behind the window and ignores Compose alpha and scale. If the
 * walkthrough were on top its hole-punch would cut the list out instantly. With the list
 * on top, entering is the list fading/scaling away to reveal the 3D view, and leaving is
 * the list fading back in over it; the walkthrough is disposed — and its Filament
 * resources freed, once — only when that exit finishes.
 */
private fun screenTransition(toList: Boolean): ContentTransform {
    val spec = tween<Float>(Motion.SCREEN_MS, easing = FastOutSlowInEasing)
    return if (toList) {
        ContentTransform(
            targetContentEnter = fadeIn(spec) + scaleIn(spec, initialScale = 0.96f),
            initialContentExit = fadeOut(tween(Motion.SCREEN_MS, delayMillis = Motion.SCREEN_MS)),
            targetContentZIndex = 1f,
            sizeTransform = null,
        )
    } else {
        ContentTransform(
            targetContentEnter = fadeIn(tween(Motion.SHORT_MS)),
            initialContentExit = fadeOut(spec) + scaleOut(spec, targetScale = 1.04f),
            targetContentZIndex = -1f,
            sizeTransform = null,
        )
    }
}
