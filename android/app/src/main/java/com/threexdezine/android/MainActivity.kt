package com.threexdezine.android

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import com.threexdezine.android.ui.AppRoot
import com.threexdezine.android.ui.theme.ThreeXDezineTheme

class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        setContent {
            ThreeXDezineTheme {
                AppRoot(container = applicationContext.appContainer)
            }
        }
    }
}
