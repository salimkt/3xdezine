plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    // NO org.jetbrains.kotlin.android — AGP 9 removed support for applying it.
}

android {
    // AGP 9 requires an explicit namespace.
    namespace = "com.threexdezine.android"
    compileSdk = libs.versions.compileSdk.get().toInt()

    defaultConfig {
        applicationId = "com.threexdezine.android"
        minSdk = libs.versions.minSdk.get().toInt()
        // Must be explicit: AGP 9 silently defaults targetSdk to compileSdk otherwise.
        targetSdk = libs.versions.targetSdk.get().toInt()
        versionCode = 1
        versionName = "0.1.0"

        // Filament ships four ABIs; the .so files are large. Keep the two that matter.
        ndk {
            abiFilters += listOf("arm64-v8a", "armeabi-v7a")
        }
    }

    buildTypes {
        debug {
            isMinifyEnabled = false
            isDebuggable = true
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    androidResources {
        // Filament reads these straight out of the APK via mmap; compressing them
        // costs a copy at best and breaks alignment-sensitive loaders at worst.
        noCompress += listOf("filamat", "ktx", "hdr", "glb", "gltf")
    }

    packaging {
        resources {
            excludes += setOf(
                "/META-INF/{AL2.0,LGPL2.1}",
                "/META-INF/DEPENDENCY",
                "/META-INF/LICENSE*",
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    lint {
        abortOnError = false
    }
}

// `android { kotlinOptions { } }` no longer exists in AGP 9. Kotlin compiler settings
// live in the top-level `kotlin { }` extension. jvmTarget is derived from
// android.compileOptions, so it is not repeated here.
kotlin {
    jvmToolchain(17)
    compilerOptions {
        allWarningsAsErrors.set(false)
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)

    val composeBom = platform(libs.compose.bom)
    implementation(composeBom)
    implementation(libs.compose.ui)
    implementation(libs.compose.ui.graphics)
    implementation(libs.compose.ui.tooling.preview)
    // Material 3 Expressive is NOT stable; stay on material3 1.4.0 from the BOM.
    implementation(libs.compose.material3)
    debugImplementation(libs.compose.ui.tooling)

    // Pulls Filament 1.72.1 transitively. Never declare Filament explicitly.
    implementation(libs.sceneview)
    implementation(libs.kotlin.math)

    implementation(libs.retrofit)
    implementation(libs.retrofit.converter.kotlinx.serialization)
    implementation(libs.okhttp)
    // `implementation`, not `debugImplementation`: Network.kt references the class
    // from the main source set and only enables it when BuildConfig.DEBUG.
    implementation(libs.okhttp.logging.interceptor)

    implementation(libs.kotlinx.serialization.json)
    implementation(libs.kotlinx.coroutines.android)
}
