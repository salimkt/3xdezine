// Root build script. No `buildscript {}` block and no `org.jetbrains.kotlin.android`
// plugin: AGP 9 ships built-in Kotlin support.
plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.kotlin.compose) apply false
    alias(libs.plugins.kotlin.serialization) apply false
}
