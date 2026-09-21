package com.threexdezine.android.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

/**
 * A fixed brand palette rather than dynamic colour.
 *
 * This app's job is to show a user what a real material looks like. Letting Material You
 * recolour the chrome from the wallpaper would tint the frame around a colour-critical
 * image, which is exactly the wrong trade here.
 *
 * Material 3 EXPRESSIVE is deliberately not used — it is not stable. This stays on
 * material3 1.4.0 from Compose BOM 2026.09.00.
 */
private val Oak = Color(0xFFC8A165)
private val OakDeep = Color(0xFF8A6A3B)
private val Walnut = Color(0xFF5A3B27)
private val Greige = Color(0xFFC9C1B4)
private val Paper = Color(0xFFF3F3F0)
private val Charcoal = Color(0xFF1B1A18)
private val Slate = Color(0xFF2A2825)

private val LightColors = lightColorScheme(
    primary = OakDeep,
    onPrimary = Color.White,
    primaryContainer = Oak,
    onPrimaryContainer = Charcoal,
    secondary = Walnut,
    onSecondary = Color.White,
    secondaryContainer = Greige,
    onSecondaryContainer = Charcoal,
    background = Paper,
    onBackground = Charcoal,
    surface = Color.White,
    onSurface = Charcoal,
    surfaceVariant = Greige,
    onSurfaceVariant = Slate,
)

private val DarkColors = darkColorScheme(
    primary = Oak,
    onPrimary = Charcoal,
    primaryContainer = OakDeep,
    onPrimaryContainer = Paper,
    secondary = Greige,
    onSecondary = Charcoal,
    secondaryContainer = Walnut,
    onSecondaryContainer = Paper,
    background = Charcoal,
    onBackground = Paper,
    surface = Slate,
    onSurface = Paper,
    surfaceVariant = Color(0xFF3A3733),
    onSurfaceVariant = Greige,
)

@Composable
fun ThreeXDezineTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    MaterialTheme(
        colorScheme = if (darkTheme) DarkColors else LightColors,
        content = content,
    )
}
