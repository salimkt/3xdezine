package com.threexdezine.android.render

import android.util.Log
import com.google.android.filament.ColorGrading
import com.google.android.filament.Engine
import com.google.android.filament.ToneMapper
import com.google.android.filament.View

/**
 * The photorealism knobs, set on the Filament [View] directly.
 *
 * WHY NOT `RenderQuality.Cinematic` AS A STARTING POINT:
 * a RenderQuality preset re-applies inside a LaunchedEffect and CLOBBERS manual view
 * tweaks — that is called out in both the brief and ARCHITECTURE.md. Rather than set a
 * preset and then race it, every relevant setting is written explicitly here, once, and
 * nothing else touches `view.*`. If you do introduce a preset later, apply it FIRST and
 * call [apply] afterwards in the same effect, keyed on the preset.
 *
 * All of it is wrapped so that a knob missing on a given Filament build degrades the
 * picture instead of crashing the app.
 *
 * TONE MAPPING: AgX, not Filament's default ACESLegacy. Interiors lit through windows
 * blow out the window highlights; AgX rolls those off gracefully where ACESLegacy
 * clips and desaturates. This matches the web client's `AgXToneMapping`.
 */
object RenderTuning {

    /**
     * @return the [ColorGrading] that was installed, or null. The caller OWNS it and
     *   must destroy it with `engine.destroyColorGrading(...)` before the Engine dies —
     *   SceneView only manages what SceneView created.
     */
    fun apply(engine: Engine, view: View): ColorGrading? {
        runCatching {
            // Soft, contact-hardening shadows. PCSS is the single biggest "this looks
            // rendered, not real-time" win indoors.
            view.shadowType = View.ShadowType.PCSS
        }.onFailure { Log.w(TAG, "PCSS shadows unavailable", it) }

        runCatching {
            view.screenSpaceReflectionsOptions = View.ScreenSpaceReflectionsOptions().apply {
                enabled = true
            }
        }.onFailure { Log.w(TAG, "SSR unavailable", it) }

        runCatching {
            view.temporalAntiAliasingOptions = View.TemporalAntiAliasingOptions().apply {
                enabled = true
            }
        }.onFailure { Log.w(TAG, "TAA unavailable", it) }

        runCatching {
            view.ambientOcclusionOptions = View.AmbientOcclusionOptions().apply {
                enabled = true
            }
        }.onFailure { Log.w(TAG, "SSAO unavailable", it) }

        runCatching {
            view.bloomOptions = View.BloomOptions().apply {
                enabled = true
                strength = 0.08f
            }
        }.onFailure { Log.w(TAG, "Bloom unavailable", it) }

        runCatching {
            view.isPostProcessingEnabled = true
        }.onFailure { Log.w(TAG, "Post-processing toggle unavailable", it) }

        return runCatching {
            val grading = ColorGrading.Builder()
                .toneMapper(ToneMapper.AgX())
                .build(engine)
            view.colorGrading = grading
            grading
        }.onFailure { Log.w(TAG, "AgX colour grading unavailable; keeping the default", it) }
            .getOrNull()
    }

    fun dispose(engine: Engine, view: View, grading: ColorGrading?) {
        if (grading == null) return
        runCatching { view.colorGrading = null }
        runCatching { engine.destroyColorGrading(grading) }
    }

    private const val TAG = "RenderTuning"
}
