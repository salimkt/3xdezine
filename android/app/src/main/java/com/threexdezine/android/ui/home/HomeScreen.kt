package com.threexdezine.android.ui.home

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.threexdezine.android.cost.LocalCostEngine
import com.threexdezine.android.data.DataOrigin
import com.threexdezine.android.data.model.Catalog
import com.threexdezine.android.data.model.Project
import com.threexdezine.android.data.model.TemplateCategory
import com.threexdezine.android.ui.DesignUiState
import com.threexdezine.android.ui.Motion
import com.threexdezine.android.ui.TemplateTile
import com.threexdezine.android.ui.formatMoney
import com.threexdezine.android.ui.tabular
import kotlinx.coroutines.delay
import java.util.Locale

/** Filter chip values. `null` category means "All". */
private val CATEGORY_FILTERS: List<Pair<String, TemplateCategory?>> = listOf(
    "All" to null,
    "Studio" to TemplateCategory.STUDIO,
    "Apartment" to TemplateCategory.APARTMENT,
    "Villa" to TemplateCategory.VILLA,
    "Commercial" to TemplateCategory.COMMERCIAL,
)

/**
 * The first screen: a gallery of plan templates, each drawn from its own JSON, plus the
 * user's saved projects when the backend is reachable. Tapping a tile opens the 3D
 * overview with the build-up intro.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(
    state: DesignUiState,
    onOpenProject: (Project) -> Unit,
    onRefresh: () -> Unit,
    onOpenSettings: () -> Unit,
) {
    var filterName by rememberSaveable { mutableStateOf("All") }
    val filter = CATEGORY_FILTERS.firstOrNull { it.first == filterName }?.second
    val tiles = state.templates.filter { filter == null || it.template.meta.category == filter }
    val savedProjects = if (state.projectsOrigin == DataOrigin.BACKEND) state.projects else emptyList()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("3xDezine") },
                actions = {
                    TextButton(onClick = onRefresh) { Text("Reload") }
                    TextButton(onClick = onOpenSettings) { Text("Backend") }
                },
            )
        },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            if (state.loading && state.templates.isEmpty()) {
                CircularProgressIndicator(Modifier.align(Alignment.Center))
                return@Box
            }
            LazyVerticalGrid(
                columns = GridCells.Adaptive(minSize = 280.dp),
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 24.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                item(span = { GridItemSpan(maxLineSpan) }, key = "intro") {
                    Column {
                        Text(
                            "Start from a plan",
                            style = MaterialTheme.typography.headlineSmall,
                            fontWeight = FontWeight.SemiBold,
                        )
                        Text(
                            "Pick a layout to walk through in 3D, then change its finishes and watch the price move.",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }

                if (savedProjects.isNotEmpty()) {
                    item(span = { GridItemSpan(maxLineSpan) }, key = "saved") {
                        SavedProjectsRow(savedProjects, state.catalog, onOpenProject)
                    }
                }

                item(span = { GridItemSpan(maxLineSpan) }, key = "filters") {
                    Row(
                        modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        CATEGORY_FILTERS.forEach { (label, category) ->
                            val count = state.templates.count { category == null || it.template.meta.category == category }
                            FilterChip(
                                selected = filterName == label,
                                onClick = { filterName = label },
                                label = { Text(if (category == null) label else "$label · $count") },
                                enabled = category == null || count > 0,
                            )
                        }
                    }
                }

                if (tiles.isEmpty()) {
                    item(span = { GridItemSpan(maxLineSpan) }, key = "empty") {
                        Text(
                            "No templates in this category yet.",
                            style = MaterialTheme.typography.bodyMedium,
                            modifier = Modifier.padding(vertical = 24.dp),
                        )
                    }
                }

                itemsIndexedStaggered(tiles, filterName) { index, tile ->
                    TemplateCard(
                        tile = tile,
                        catalog = state.catalog,
                        index = index,
                        staggerKey = filterName,
                        onClick = { onOpenProject(tile.template.project) },
                    )
                }

                if (state.isOffline) {
                    item(span = { GridItemSpan(maxLineSpan) }, key = "offline") {
                        OfflineNote(state.connectionNote)
                    }
                }
                item(span = { GridItemSpan(maxLineSpan) }, key = "basis") {
                    Text(
                        text = state.catalog?.meta?.priceBasis.orEmpty(),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(top = 8.dp),
                    )
                }
            }
        }
    }
}

private fun androidx.compose.foundation.lazy.grid.LazyGridScope.itemsIndexedStaggered(
    tiles: List<TemplateTile>,
    filterKey: String,
    content: @Composable (Int, TemplateTile) -> Unit,
) {
    items(tiles.size, key = { "tpl:" + tiles[it].template.meta.id + ":" + filterKey }) { i ->
        content(i, tiles[i])
    }
}

/**
 * One template tile. Enters with a short staggered fade-and-rise (SHORT_MS each, 45 ms
 * apart, capped so the eighth tile is not left waiting), and presses in slightly while
 * held. Both collapse to the final state when system animations are off.
 */
@Composable
private fun TemplateCard(
    tile: TemplateTile,
    catalog: Catalog?,
    index: Int,
    staggerKey: String,
    onClick: () -> Unit,
) {
    val meta = tile.template.meta
    val project = tile.template.project
    val entrance = remember(meta.id, staggerKey) { Animatable(if (Motion.animationsEnabled()) 0f else 1f) }
    LaunchedEffect(meta.id, staggerKey) {
        if (entrance.value >= 1f) return@LaunchedEffect
        delay((index.coerceAtMost(6) * STAGGER_MS).toLong())
        entrance.animateTo(1f, tween(Motion.SHORT_MS + 80, easing = FastOutSlowInEasing))
    }
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val pressScale by animateFloatAsState(
        targetValue = if (pressed) 0.97f else 1f,
        animationSpec = tween(if (pressed) 90 else Motion.SHORT_MS, easing = FastOutSlowInEasing),
        label = "tilePress",
    )
    val rise = with(LocalDensity.current) { 16.dp.toPx() }

    Card(
        onClick = onClick,
        interactionSource = interaction,
        modifier = Modifier
            .fillMaxWidth()
            .graphicsLayer {
                alpha = entrance.value
                translationY = (1f - entrance.value) * rise
                scaleX = pressScale
                scaleY = pressScale
            },
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow),
    ) {
        Surface(
            color = MaterialTheme.colorScheme.surfaceContainerHighest,
            modifier = Modifier.fillMaxWidth().aspectRatio(16f / 10f),
        ) {
            PlanThumbnail(project, catalog, Modifier.fillMaxSize())
        }
        Column(Modifier.padding(horizontal = 16.dp, vertical = 12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    meta.name,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                Text(
                    categoryLabel(meta.category, meta.bhk),
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.primary,
                )
            }
            if (meta.tagline.isNotBlank()) {
                Text(
                    meta.tagline,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            val area = meta.builtUpSqm.takeIf { it > 0 }
                ?: project.groundFloor?.rooms?.sumOf { LocalCostEngine.roomArea(it) } ?: 0.0
            val rooms = meta.rooms.takeIf { it > 0 } ?: project.groundFloor?.rooms?.size ?: 0
            Row(
                modifier = Modifier.fillMaxWidth().padding(top = 10.dp),
                horizontalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                Stat(String.format(Locale.US, "%,.0f m²", area), String.format(Locale.US, "%,.0f sq ft", PlanGeometry.sqft(area)))
                Stat(rooms.toString(), "rooms")
                Stat(
                    tile.estimatedTotal?.let { formatMoney(it, project.currency) } ?: "—",
                    "est. buffered total",
                    modifier = Modifier.weight(1f),
                )
            }
            PolicyLine(project)
        }
    }
}

/** Read-only policy / review status, shown only when the project carries any. */
@Composable
fun PolicyLine(project: Project, modifier: Modifier = Modifier) {
    val summary = policySummary(project) ?: return
    Text(
        summary,
        style = MaterialTheme.typography.labelSmall,
        color = MaterialTheme.colorScheme.tertiary,
        modifier = modifier.padding(top = 8.dp),
    )
}

@Composable
private fun SavedProjectsRow(projects: List<Project>, catalog: Catalog?, onOpen: (Project) -> Unit) {
    Column {
        Text(
            "Your projects",
            style = MaterialTheme.typography.titleSmall,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.padding(bottom = 8.dp),
        )
        LazyRow(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            items(projects, key = { it.id ?: it.name }) { project ->
                Card(onClick = { onOpen(project) }, modifier = Modifier.width(200.dp)) {
                    Surface(
                        color = MaterialTheme.colorScheme.surfaceContainerHighest,
                        modifier = Modifier.fillMaxWidth().height(110.dp),
                    ) {
                        PlanThumbnail(project, catalog, Modifier.fillMaxSize())
                    }
                    Column(Modifier.padding(10.dp)) {
                        Text(project.name, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        val area = project.groundFloor?.rooms?.sumOf { LocalCostEngine.roomArea(it) } ?: 0.0
                        Text(
                            String.format(Locale.US, "%,.0f m² · %d rooms", area, project.groundFloor?.rooms?.size ?: 0),
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        PolicyLine(project)
                    }
                }
            }
        }
    }
}

@Composable
private fun OfflineNote(note: String?) {
    Surface(
        color = MaterialTheme.colorScheme.secondaryContainer,
        shape = MaterialTheme.shapes.medium,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(12.dp)) {
            Text("Offline", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
            Text(
                "The backend was unreachable. Templates and the catalog are bundled in the app, so " +
                    "everything still works; prices are an on-device estimate and saved projects are hidden.",
                style = MaterialTheme.typography.bodySmall,
            )
            note?.let {
                Text(it, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

@Composable
private fun Stat(value: String, label: String, modifier: Modifier = Modifier) {
    Column(modifier) {
        Text(value, style = MaterialTheme.typography.titleSmall.tabular(), maxLines = 1, overflow = TextOverflow.Ellipsis)
        Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

private fun categoryLabel(category: TemplateCategory, bhk: Int): String = when (category) {
    TemplateCategory.STUDIO -> "Studio"
    TemplateCategory.COMMERCIAL -> "Commercial"
    TemplateCategory.APARTMENT, TemplateCategory.VILLA ->
        (if (bhk > 0) "$bhk BHK " else "") + category.name.lowercase().replaceFirstChar { it.uppercase() }
}

private const val STAGGER_MS = 45
