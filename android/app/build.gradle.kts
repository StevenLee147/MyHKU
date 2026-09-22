import groovy.json.JsonSlurper

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val packageMetadata = JsonSlurper().parse(rootProject.file("../package.json")) as Map<*, *>

val releaseKeystore = System.getenv("MYHKU_ANDROID_KEYSTORE_PATH")
val releaseAlias = System.getenv("MYHKU_ANDROID_KEY_ALIAS")
val releaseStorePassword = System.getenv("MYHKU_ANDROID_KEYSTORE_PASSWORD")
val releaseKeyPassword = System.getenv("MYHKU_ANDROID_KEY_PASSWORD")
val releaseSigningReady = !releaseKeystore.isNullOrBlank() && file(releaseKeystore.orEmpty()).isFile &&
    !releaseAlias.isNullOrBlank() && !releaseStorePassword.isNullOrBlank() && !releaseKeyPassword.isNullOrBlank()

android {
    namespace = "hk.my.myhku"
    compileSdk = 35

    defaultConfig {
        applicationId = "hk.my.myhku"
        minSdk = 26
        targetSdk = 35
        versionCode = providers.gradleProperty("myhkuVersionCode").orNull?.toInt() ?: (packageMetadata["androidVersionCode"] as Number).toInt()
        versionName = providers.gradleProperty("myhkuVersionName").orNull ?: packageMetadata["version"].toString()
    }

    signingConfigs {
        create("release") {
            if (releaseSigningReady) {
                storeFile = file(releaseKeystore!!)
                storePassword = releaseStorePassword
                keyAlias = releaseAlias
                keyPassword = releaseKeyPassword
            }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }
        release {
            isMinifyEnabled = false
            val releaseSigning = signingConfigs.getByName("release")
            if (releaseSigning.storeFile != null) signingConfig = releaseSigning
        }
    }
}

// Missing credentials must fail a release, never emit an un-installable APK.
val verifyReleaseSigning by tasks.registering {
    doLast {
        check(releaseSigningReady) {
            "Android release signing is required. Configure MYHKU_ANDROID_KEYSTORE_PATH, MYHKU_ANDROID_KEY_ALIAS, MYHKU_ANDROID_KEYSTORE_PASSWORD and MYHKU_ANDROID_KEY_PASSWORD."
        }
    }
}
tasks.matching { it.name == "preReleaseBuild" }.configureEach { dependsOn(verifyReleaseSigning) }

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("androidx.security:security-crypto:1.1.0-alpha06")
}
