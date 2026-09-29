package com.threexdezine.android.ui

import android.animation.ValueAnimator
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableDoubleStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.text.TextStyle

/**
 * Motion tokens and helpers. Kept deliberately small: every animation in the app is one
 * of these durations with [FastOutSlowInEasing] (Material's "standard" curve), so nothing
 * bounces and nothing takes long enough to get in the way.
 */
object Motion {
    const val SHORT_MS = 200
    const val CAMERA_MS = 400
    const val NUMBER_MS = 500
    const val SCREEN_MS = 320

    /**
     * False when the user has turned animations off (Developer options → Animator
     * duration scale → Off, or the Accessibility "Remove animations" switch, both of which
     * set `Settings.Global.ANIMATOR_DURATION_SCALE` to 0). Compose's own animations
     * already honour that scale; this is for the hand-driven camera tweens, which should
     * jump to their end state instead.
     *
     * Read at the start of each animation rather than cached, so flipping the setting
     * takes effect without restarting the app.
     */
    fun animationsEnabled(): Boolean = ValueAnimator.areAnimatorsEnabled()
}

/** Tabular (fixed-width) digits, so a counting number does not jitter sideways. */
fun TextStyle.tabular(): TextStyle = copy(fontFeatureSettings = "tnum")

/**
 * A Double that eases toward [target] whenever it changes — used to make a reprice
 * visibly count up or down. Doubles are interpolated by hand because Float would lose
 * cents on a seven-figure total.
 */
@Composable
fun animatedDouble(target: Double, durationMs: Int = Motion.NUMBER_MS): Double {
    var shown by remember { mutableDoubleStateOf(target) }
    val progress = remember { Animatable(1f) }
    LaunchedEffect(target) {
        val from = shown
        if (from == target || !Motion.animationsEnabled()) {
            shown = target
            return@LaunchedEffect
        }
        progress.snapTo(0f)
        progress.animateTo(1f, tween(durationMs, easing = FastOutSlowInEasing)) {
            shown = from + (target - from) * value
        }
        shown = target
    }
    return shown
}
