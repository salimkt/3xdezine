package com.threexdezine.android.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/**
 * Backend configuration. Two URLs, because the REST API and the static PBR/HDRI assets
 * are served by different processes in dev (`backend` on 4000, Vite on 5173).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsSheet(
    apiBaseUrl: String,
    assetBaseUrl: String,
    onDismiss: () -> Unit,
    onSave: (String, String) -> Unit,
    onReset: () -> Unit,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    var api by remember(apiBaseUrl) { mutableStateOf(apiBaseUrl) }
    var assets by remember(assetBaseUrl) { mutableStateOf(assetBaseUrl) }

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheetState) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp)
                .padding(bottom = 24.dp)
                .navigationBarsPadding(),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text("Backend", style = MaterialTheme.typography.headlineSmall)

            OutlinedTextField(
                value = api,
                onValueChange = { api = it },
                label = { Text("REST API base URL") },
                supportingText = { Text("Must end in /api. Default: http://10.0.2.2:4000/api/") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )

            OutlinedTextField(
                value = assets,
                onValueChange = { assets = it },
                label = { Text("Static asset base URL") },
                supportingText = { Text("Serves /textures/manifest.json. Default: http://10.0.2.2:5173/") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )

            HorizontalDivider()

            Text(
                "10.0.2.2 is the Android emulator's alias for your machine's localhost. " +
                    "On a physical device use your machine's LAN address, e.g. " +
                    "http://192.168.1.20:4000/api/ — and make sure the backend binds to " +
                    "0.0.0.0, not 127.0.0.1.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                TextButton(onClick = onReset) { Text("Reset") }
                TextButton(onClick = onDismiss) { Text("Cancel") }
                Button(onClick = { onSave(api, assets) }) { Text("Save & reload") }
            }
        }
    }
}
