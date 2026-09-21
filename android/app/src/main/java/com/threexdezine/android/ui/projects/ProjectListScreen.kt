package com.threexdezine.android.ui.projects

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.threexdezine.android.cost.LocalCostEngine
import com.threexdezine.android.data.model.Project
import com.threexdezine.android.ui.DesignUiState
import com.threexdezine.android.ui.formatArea

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProjectListScreen(
    state: DesignUiState,
    onOpenProject: (Project) -> Unit,
    onRefresh: () -> Unit,
    onOpenSettings: () -> Unit,
) {
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
        Box(modifier = Modifier.fillMaxSize().padding(padding)) {
            when {
                state.loading -> CircularProgressIndicator(Modifier.align(Alignment.Center))
                else -> LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    item { OriginBanner(state) }
                    items(state.projects, key = { it.id ?: it.name }) { project ->
                        ProjectCard(project = project, onClick = { onOpenProject(project) })
                    }
                    item {
                        Text(
                            text = state.catalog?.meta?.priceBasis.orEmpty(),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(top = 16.dp),
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun OriginBanner(state: DesignUiState) {
    if (!state.isOffline) return
    Surface(
        color = MaterialTheme.colorScheme.secondaryContainer,
        shape = MaterialTheme.shapes.medium,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(12.dp)) {
            Text(
                "Offline — using the bundled sample",
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.SemiBold,
            )
            Text(
                "The backend was unreachable, so this is shared/catalog.seed.json and " +
                    "shared/sample-project.json from the app's assets. Everything below " +
                    "still works; cost figures are an on-device approximation.",
                style = MaterialTheme.typography.bodySmall,
            )
            state.connectionNote?.let {
                Text(
                    it,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ProjectCard(project: Project, onClick: () -> Unit) {
    val floor = project.groundFloor
    val area = floor?.rooms?.sumOf { LocalCostEngine.roomArea(it) } ?: 0.0
    Card(onClick = onClick, modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp)) {
            Text(project.name, style = MaterialTheme.typography.titleLarge)
            Row(
                modifier = Modifier.fillMaxWidth().padding(top = 6.dp),
                horizontalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                Stat("Area", formatArea(area))
                Stat("Rooms", (floor?.rooms?.size ?: 0).toString())
                Stat("Walls", (floor?.walls?.size ?: 0).toString())
                Stat("Openings", (floor?.openings?.size ?: 0).toString())
            }
            Text(
                text = "Contingency buffer ${(project.contingencyBuffer * 100).toInt()}% · " +
                    project.currency,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 8.dp),
            )
        }
    }
}

@Composable
private fun Stat(label: String, value: String) {
    Column {
        Text(value, style = MaterialTheme.typography.titleMedium)
        Text(
            label,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}
