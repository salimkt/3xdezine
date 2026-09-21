package com.threexdezine.android.ui

import androidx.compose.ui.graphics.Color
import java.util.Locale

/** Money, e.g. 12345.6 -> "USD 12,345.60". Currency is a display concern per the contract. */
fun formatMoney(value: Double, currency: String): String =
    String.format(Locale.US, "%s %,.2f", currency, value)

fun formatQuantity(value: Double, unit: String): String =
    String.format(Locale.US, "%,.2f %s", value, unit)

fun formatArea(value: Double): String = String.format(Locale.US, "%,.1f m²", value)

fun formatPercent(fraction: Double): String = String.format(Locale.US, "%.0f%%", fraction * 100)

/** "#C8A165" -> a Compose colour, for catalog swatches. */
fun swatchColor(hex: String): Color {
    val clean = hex.removePrefix("#")
    val value = clean.toLongOrNull(16) ?: 0xCCCCCCL
    return Color(0xFF000000L.or(value).toInt())
}
