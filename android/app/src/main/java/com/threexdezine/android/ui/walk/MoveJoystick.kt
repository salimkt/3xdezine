package com.threexdezine.android.ui.walk

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.unit.dp
import kotlin.math.hypot

/**
 * A thumb stick for walking. Drag-to-look owns the rest of the screen, so movement needs
 * its own control — a two-finger convention would fight the pinch gesture and a
 * tap-to-move would make it impossible to judge a material at a chosen distance.
 *
 * Reports normalised axes: x = strafe (+right), y = forward (+forward, i.e. UP on
 * screen, which is why the raw delta is negated).
 */
@Composable
fun MoveJoystick(
    modifier: Modifier = Modifier,
    diameterDp: Int = 132,
    onAxes: (strafe: Float, forward: Float) -> Unit,
) {
    val callback by rememberUpdatedState(onAxes)
    var knob by remember { mutableStateOf(Offset.Zero) }
    var radiusPx by remember { mutableStateOf(1f) }

    Canvas(
        modifier = modifier
            .size(diameterDp.dp)
            .pointerInput(Unit) {
                // PointerInputScope.size is an IntSize, unlike DrawScope's Size.
                radiusPx = minOf(size.width, size.height) / 2f
                detectDragGestures(
                    onDragStart = { start ->
                        val centre = Offset(size.width / 2f, size.height / 2f)
                        knob = clampToRadius(start - centre, radiusPx)
                        emit(knob, radiusPx, callback)
                    },
                    onDrag = { change, delta ->
                        change.consume()
                        knob = clampToRadius(knob + delta, radiusPx)
                        emit(knob, radiusPx, callback)
                    },
                    onDragEnd = {
                        knob = Offset.Zero
                        callback(0f, 0f)
                    },
                    onDragCancel = {
                        knob = Offset.Zero
                        callback(0f, 0f)
                    },
                )
            },
    ) {
        val r = size.minDimension / 2f
        radiusPx = r
        val centre = Offset(size.width / 2f, size.height / 2f)
        drawCircle(color = Color.White.copy(alpha = 0.14f), radius = r, center = centre)
        drawCircle(
            color = Color.White.copy(alpha = 0.35f),
            radius = r,
            center = centre,
            style = androidx.compose.ui.graphics.drawscope.Stroke(width = 2f),
        )
        drawCircle(
            color = Color.White.copy(alpha = 0.75f),
            radius = r * 0.34f,
            center = centre + knob,
        )
    }
}

private fun clampToRadius(offset: Offset, radius: Float): Offset {
    val length = hypot(offset.x, offset.y)
    if (length <= radius || length == 0f) return offset
    val scale = radius / length
    return Offset(offset.x * scale, offset.y * scale)
}

private fun emit(knob: Offset, radius: Float, callback: (Float, Float) -> Unit) {
    if (radius <= 0f) {
        callback(0f, 0f)
        return
    }
    // Screen +y is down; forward is up.
    callback((knob.x / radius).coerceIn(-1f, 1f), (-knob.y / radius).coerceIn(-1f, 1f))
}
