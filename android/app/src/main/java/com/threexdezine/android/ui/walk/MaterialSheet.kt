package com.threexdezine.android.ui.walk

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.threexdezine.android.data.ApplyTarget
import com.threexdezine.android.data.currentMaterialId
import com.threexdezine.android.data.model.Catalog
import com.threexdezine.android.data.model.DesignMaterial
import com.threexdezine.android.data.model.Project
import com.threexdezine.android.data.model.Surface
import com.threexdezine.android.data.targetsFor
import com.threexdezine.android.ui.formatMoney
import com.threexdezine.android.ui.swatchColor

/**
 * Browse the catalog by surface and apply a material live.
 *
 * Structured surface -> target -> material, in that order, because that is the order the
 * decision is actually made: "the floors", then "just the kitchen", then "this tile".
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MaterialSheet(
    project: Project,
    catalog: Catalog,
    onApply: (ApplyTarget, String) -> Unit,
    onDismiss: () -> Unit,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = false)
    var surface by remember { mutableStateOf(Surface.FLOOR) }
    var target by remember(surface) {
        mutableStateOf(project.targetsFor(surface).firstOrNull() ?: ApplyTarget.AllOfSurface(surface))
    }

    val targets = remember(project, surface) { project.targetsFor(surface) }
    val materials = remember(catalog, surface) { catalog.forSurface(surface) }
    val selectedId = project.currentMaterialId(target)

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheetState) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp)
                .navigationBarsPadding(),
        ) {
            Text("Materials", style = MaterialTheme.typography.headlineSmall)

            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState())
                    .padding(vertical = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Surface.entries.forEach { s ->
                    FilterChip(
                        selected = s == surface,
                        onClick = { surface = s },
                        label = { Text(s.label) },
                    )
                }
            }

            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState())
                    .padding(bottom = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                targets.forEach { t ->
                    FilterChip(
                        selected = t == target,
                        onClick = { target = t },
                        label = { Text(t.label) },
                    )
                }
            }

            if (materials.isEmpty()) {
                Text(
                    "No catalog material declares ${surface.label.lowercase()} in " +
                        "applicableSurfaces.",
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.padding(vertical = 24.dp),
                )
            }

            LazyColumn(
                modifier = Modifier.heightIn(max = 420.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(bottom = 24.dp),
            ) {
                items(materials, key = { it.id }) { material ->
                    MaterialRow(
                        material = material,
                        currency = project.currency,
                        selected = material.id == selectedId,
                        onClick = { onApply(target, material.id) },
                    )
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun MaterialRow(
    material: DesignMaterial,
    currency: String,
    selected: Boolean,
    onClick: () -> Unit,
) {
    Card(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth(),
        colors = if (selected) {
            CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.secondaryContainer)
        } else {
            CardDefaults.cardColors()
        },
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Box(
                modifier = Modifier
                    .size(44.dp)
                    .background(swatchColor(material.color.hex), RoundedCornerShape(8.dp))
                    .border(1.dp, Color.Black.copy(alpha = 0.15f), RoundedCornerShape(8.dp)),
            )
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    material.name,
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.SemiBold,
                )
                Text(
                    "${material.tier.name.lowercase().replaceFirstChar { it.uppercase() }} · " +
                        "${material.finish} · tile ${material.texture.tileSizeM} m",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Text(
                    "${formatMoney(material.pricePerUnit, currency)} / ${material.unit.shortLabel}" +
                        " · ${(material.wastageFactor * 100).toInt()}% wastage",
                    style = MaterialTheme.typography.labelSmall,
                )
            }
            AssistChip(
                onClick = onClick,
                label = { Text(if (selected) "Applied" else "Apply") },
            )
        }
    }
}
