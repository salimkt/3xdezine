package com.threexdezine.android.ui.walk

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.threexdezine.android.data.DataOrigin
import com.threexdezine.android.data.model.Catalog
import com.threexdezine.android.data.model.CostBreakdown
import com.threexdezine.android.data.model.CostLineItem
import com.threexdezine.android.ui.formatArea
import com.threexdezine.android.ui.formatMoney
import com.threexdezine.android.ui.formatPercent
import com.threexdezine.android.ui.formatQuantity

/**
 * The itemised breakdown and the buffered total from `POST /api/cost/estimate`.
 *
 * Both buffering stages are shown separately on purpose — per-material wastage and the
 * project-wide contingency are different things and a user deserves to see which is
 * which. The scope disclaimer ("material supply only, no labour") is repeated here
 * because a cost tool that silently omits labour is worse than no cost tool.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CostPanel(
    cost: CostBreakdown?,
    catalog: Catalog,
    origin: DataOrigin,
    pending: Boolean,
    onDismiss: () -> Unit,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = false)

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheetState) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp)
                .navigationBarsPadding(),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text("Estimated cost", style = MaterialTheme.typography.headlineSmall)
                if (pending) CircularProgressIndicator(Modifier.padding(4.dp))
            }

            if (cost == null) {
                Text(
                    "Pricing…",
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.padding(vertical = 24.dp),
                )
                return@Column
            }

            if (origin == DataOrigin.BUNDLED) {
                Surface(
                    color = MaterialTheme.colorScheme.secondaryContainer,
                    shape = MaterialTheme.shapes.small,
                    modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp),
                ) {
                    Text(
                        "Offline estimate — computed on this device because " +
                            "POST /api/cost/estimate was unreachable. The backend is " +
                            "authoritative; this can differ by a few percent on roof area.",
                        style = MaterialTheme.typography.labelSmall,
                        modifier = Modifier.padding(8.dp),
                    )
                }
            }

            Text(
                formatMoney(cost.total, cost.currency),
                style = MaterialTheme.typography.displaySmall,
                fontWeight = FontWeight.Bold,
            )
            Text(
                "Buffered total · materials only",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            Column(Modifier.padding(vertical = 12.dp)) {
                TotalRow("Materials subtotal", formatMoney(cost.materialsSubtotal, cost.currency))
                TotalRow(
                    "Contingency (${formatPercent(cost.contingencyBuffer)})",
                    formatMoney(cost.contingencyAmount, cost.currency),
                )
                HorizontalDivider(Modifier.padding(vertical = 6.dp))
                TotalRow("Total", formatMoney(cost.total, cost.currency), bold = true)
            }

            Text("Measured quantities", style = MaterialTheme.typography.titleSmall)
            Row(
                modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp),
                horizontalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                Quantity("Floor", cost.quantities.floorAreaSqm)
                Quantity("Wall", cost.quantities.wallAreaSqm)
                Quantity("Ceiling", cost.quantities.ceilingAreaSqm)
                Quantity("Roof", cost.quantities.roofAreaSqm)
            }

            HorizontalDivider(Modifier.padding(vertical = 8.dp))
            Text("Line items", style = MaterialTheme.typography.titleSmall)

            LazyColumn(
                modifier = Modifier.heightIn(max = 340.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(vertical = 8.dp),
            ) {
                items(cost.lineItems, key = { it.surface + it.materialId + it.location }) { item ->
                    LineItemRow(item, cost.currency)
                }
                item {
                    Text(
                        catalog.meta.priceBasis,
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(top = 16.dp, bottom = 24.dp),
                    )
                }
            }
        }
    }
}

@Composable
private fun TotalRow(label: String, value: String, bold: Boolean = false) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(
            label,
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = if (bold) FontWeight.Bold else FontWeight.Normal,
        )
        Text(
            value,
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = if (bold) FontWeight.Bold else FontWeight.Normal,
        )
    }
}

@Composable
private fun Quantity(label: String, value: Double) {
    Column {
        Text(formatArea(value), style = MaterialTheme.typography.bodyMedium)
        Text(
            label,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun LineItemRow(item: CostLineItem, currency: String) {
    Column(Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Text(
                item.materialName,
                style = MaterialTheme.typography.bodyMedium,
                modifier = Modifier.weight(1f),
            )
            Text(formatMoney(item.subtotal, currency), style = MaterialTheme.typography.bodyMedium)
        }
        Text(
            "${item.location} · " +
                "${formatQuantity(item.rawQuantity, item.unit.shortLabel)} raw → " +
                "${formatQuantity(item.bufferedQuantity, item.unit.shortLabel)} buffered " +
                "(+${(item.wastageFactor * 100).toInt()}% wastage) @ " +
                formatMoney(item.unitPrice, currency),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}
