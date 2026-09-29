package com.threexdezine.android.ui.walk

import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculateCentroid
import androidx.compose.foundation.gestures.calculatePan
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChange

/** What the camera surface reports. Every callback is in view pixels. */
interface CameraGestureListener {
    /** A finger went down — cancel any camera tween so the user is never fought. */
    fun onGestureStart()

    /** One finger, past touch slop. */
    fun onDrag(dx: Float, dy: Float)

    /** Two or more fingers. [zoom] is this event's spread ratio (> 1 = apart). */
    fun onPinch(zoom: Float, pan: Offset, centroid: Offset)

    fun onDoubleTap(position: Offset)
}

/**
 * Drag, pinch and double-tap on one surface, hand-tracked with [awaitEachGesture] so the
 * three can never be confused:
 *
 *  - A drag only starts after touch slop, and only while exactly one finger is down.
 *  - The moment a second finger lands the gesture becomes a pinch **for the rest of that
 *    gesture** — lifting one finger does not turn the remaining one into a look/orbit
 *    drag, which is what makes the camera lurch at the end of a pinch with
 *    `detectTransformGestures` + `detectDragGestures` stacked.
 *  - A tap is a down/up that never passed slop, never had a second finger and was not a
 *    long press; two of those close together in time and space are a double tap.
 *
 * The joystick and buttons sit above this surface as siblings, so Compose's hit testing
 * never routes their touches here: walking with the stick while looking with another
 * finger works, and pushing the stick never looks around.
 */
@Composable
fun Modifier.cameraGestures(listener: CameraGestureListener): Modifier {
    val current by rememberUpdatedState(listener)
    return this.pointerInput(Unit) {
        var lastTapUpMs = 0L
        var lastTapPos = Offset.Zero
        val slop = viewConfiguration.touchSlop
        val doubleTapTimeout = viewConfiguration.doubleTapTimeoutMillis
        val longPressTimeout = viewConfiguration.longPressTimeoutMillis
        // Two taps further apart than this are two taps, not a double tap.
        val doubleTapRadius = slop * 6f

        awaitEachGesture {
            val down = awaitFirstDown(requireUnconsumed = false)
            current.onGestureStart()
            var multiTouch = false
            var dragging = false
            var travelled = Offset.Zero
            var upTime = down.uptimeMillis

            while (true) {
                val event = awaitPointerEvent()
                val pressed = event.changes.filter { it.pressed }
                if (pressed.isEmpty()) {
                    upTime = event.changes.maxOfOrNull { it.uptimeMillis } ?: upTime
                    break
                }
                if (pressed.size >= 2) {
                    multiTouch = true
                    val zoom = event.calculateZoom()
                    val pan = event.calculatePan()
                    val centroid = event.calculateCentroid(useCurrent = true)
                    if (zoom != 1f || pan != Offset.Zero) {
                        current.onPinch(zoom, pan, centroid)
                    }
                    event.changes.forEach { it.consume() }
                } else if (!multiTouch) {
                    val change = pressed.first()
                    val delta = change.positionChange()
                    if (!dragging) {
                        travelled += delta
                        if (travelled.getDistance() > slop) {
                            dragging = true
                            // Apply only the motion past slop so the camera does not jump.
                            val excess = travelled.getDistance() - slop
                            val unit = travelled / travelled.getDistance()
                            current.onDrag(unit.x * excess, unit.y * excess)
                        }
                    } else if (delta != Offset.Zero) {
                        current.onDrag(delta.x, delta.y)
                    }
                    if (dragging) change.consume()
                } else {
                    // A pinch that is ending: swallow the leftover finger.
                    event.changes.forEach { it.consume() }
                }
            }

            val wasTap = !multiTouch && !dragging && (upTime - down.uptimeMillis) < longPressTimeout
            if (wasTap) {
                val isDouble = lastTapUpMs != 0L &&
                    down.uptimeMillis - lastTapUpMs <= doubleTapTimeout &&
                    (down.position - lastTapPos).getDistance() <= doubleTapRadius
                if (isDouble) {
                    lastTapUpMs = 0L
                    current.onDoubleTap(down.position)
                } else {
                    lastTapUpMs = upTime
                    lastTapPos = down.position
                }
            } else {
                lastTapUpMs = 0L
            }
        }
    }
}
