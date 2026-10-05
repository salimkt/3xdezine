import javax.inject.Inject

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
        // CI passes ANDROID_VERSION_CODE = run_number + 100 so every published build is
        // strictly newer than the last (Android refuses to "update" to a lower or equal
        // code). Local builds default to 1, which is fine for a fresh install.
        versionCode = providers.environmentVariable("ANDROID_VERSION_CODE").orNull?.toIntOrNull() ?: 1
        versionName = providers.environmentVariable("ANDROID_VERSION_NAME").orNull ?: "0.2.0-local"

        // Filament ships four ABIs; the .so files are large. Keep the two that matter.
        ndk {
            abiFilters += listOf("arm64-v8a", "armeabi-v7a")
        }
    }

    // ---------------------------------------------------------------------------------
    // Release signing. ONE stable key for every published build: Android refuses to
    // install an update signed by a different certificate, which is exactly what broke
    // when CI signed each run with a fresh throwaway debug keystore.
    //
    // Read from the environment so the keystore never lives in the repo. CI decodes the
    // ANDROID_KEYSTORE_BASE64 secret into $RUNNER_TEMP and exports the path. When the
    // variables are absent (local builds, forks) the release build is left UNSIGNED and
    // CI refuses to publish it — see .github/workflows/android.yml and README > Signing.
    // ---------------------------------------------------------------------------------
    val keystorePath = providers.environmentVariable("ANDROID_KEYSTORE_PATH").orNull
    val keystorePassword = providers.environmentVariable("ANDROID_KEYSTORE_PASSWORD").orNull
    val keyAliasEnv = providers.environmentVariable("ANDROID_KEY_ALIAS").orNull
    val keyPasswordEnv = providers.environmentVariable("ANDROID_KEY_PASSWORD").orNull
    val hasReleaseKey = !keystorePath.isNullOrBlank() && !keystorePassword.isNullOrBlank() &&
        !keyAliasEnv.isNullOrBlank() && !keyPasswordEnv.isNullOrBlank()

    signingConfigs {
        if (hasReleaseKey) {
            create("release") {
                storeFile = file(keystorePath!!)
                storePassword = keystorePassword
                keyAlias = keyAliasEnv
                keyPassword = keyPasswordEnv
                storeType = "pkcs12"
                enableV1Signing = true
                enableV2Signing = true
            }
        }
    }

    buildTypes {
        debug {
            isMinifyEnabled = false
            isDebuggable = true
        }
        release {
            // R8 is deliberately OFF. This app has never been through a shrinker, and
            // Filament/SceneView reach into Java through JNI and reflection: a missing
            // keep rule is a native crash on a device nobody here can test, which is
            // worse than a larger APK. To turn it on later: set both flags to true, build
            // assembleRelease, install it on a real device and walk through a template
            // (materials, textures, cost panel) before publishing. proguard-rules.pro
            // already keeps Filament, SceneView, kotlinx-serialization and Retrofit.
            isMinifyEnabled = false
            isShrinkResources = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
            if (hasReleaseKey) signingConfig = signingConfigs.getByName("release")
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

// kotlin-math 1.8.0's JVM classes are Java 21 bytecode (class-file major 65). D8 handles
// that for the APK, but plain JVM unit tests load them directly, so the test JVM must be
// 21 even though the app itself targets 17.
tasks.withType<Test>().configureEach {
    javaLauncher.set(
        javaToolchains.launcherFor { languageVersion.set(JavaLanguageVersion.of(21)) },
    )
}

// -------------------------------------------------------------------------------------
// shared/ -> assets/, generated at build time.
//
// The catalog, the sample project and the plan templates live once, in ../shared, and
// are copied into a generated assets directory for every variant. Nothing is hand-copied
// into src/main/assets any more, so the app can never drift from the web client.
//
// shared/templates/ may not exist yet (it is produced by another workstream): a missing
// directory is simply an empty file tree, and BundledAssets then falls back to the sample
// project as the only template. catalog.seed.json and sample-project.json ARE required.
// -------------------------------------------------------------------------------------
abstract class SyncSharedAssetsTask : DefaultTask() {
    @get:InputFiles
    @get:PathSensitive(PathSensitivity.NAME_ONLY)
    abstract val requiredFiles: ConfigurableFileCollection

    @get:InputFiles
    @get:PathSensitive(PathSensitivity.NAME_ONLY)
    abstract val templateFiles: ConfigurableFileCollection

    /** Set by AGP through `addGeneratedSourceDirectory` (as a convention). */
    @get:OutputDirectory
    abstract val outputDir: DirectoryProperty

    @get:Inject
    abstract val fs: FileSystemOperations

    @TaskAction
    fun sync() {
        val missing = requiredFiles.files.filterNot { it.isFile }
        if (missing.isNotEmpty()) {
            throw GradleException("Missing shared asset(s): ${missing.joinToString()}")
        }
        val templates = templateFiles.files.filter { it.isFile }
        fs.sync {
            from(requiredFiles)
            from(templates) { into("templates") }
            into(outputDir)
        }
        logger.lifecycle("Bundled ${templates.size} file(s) from shared/templates")
    }
}

val sharedDir = rootProject.layout.projectDirectory.dir("../shared")

androidComponents {
    onVariants { variant ->
        val task = tasks.register<SyncSharedAssetsTask>(
            "sync${variant.name.replaceFirstChar { it.uppercase() }}SharedAssets",
        ) {
            requiredFiles.from(
                sharedDir.file("catalog.seed.json"),
                sharedDir.file("sample-project.json"),
            )
            templateFiles.from(sharedDir.dir("templates").asFileTree.matching { include("*.json") })
        }
        variant.sources.assets?.addGeneratedSourceDirectory(task, SyncSharedAssetsTask::outputDir)
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

    testImplementation(libs.junit)
}
