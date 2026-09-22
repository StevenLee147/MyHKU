# MyHKU Android host

This module is the Android WebView adapter for the MyHKU dashboard. It loads the official HKU Moodle and Student Portal pages, so the first login and MFA are completed by HKU's own UI. Android WebView persists its cookie store between launches; the app never reads, exports, or logs cookies, passwords, tokens, or authorization headers.

The app refreshes the current page when it returns to the foreground and exposes a manual `刷新` button. It does not run background polling. A read-only JavaScript interface extracts normalized course, schedule, assignment, resource, announcement, and grade candidates from visible Moodle/SIS DOM fields. The shared React dashboard is copied into `app/src/main/assets/dashboard-app` by the root `npm run build`; it reads the native snapshot through the `myhkuAndroid` bridge. The latest normalized payload is stored only when AndroidX `EncryptedSharedPreferences` can use the Android Keystore; otherwise it remains memory-only.

## Build

First run `npm ci` and `npm run build` from the repository root to generate the shared dashboard assets. These generated files are ignored by Git and must be rebuilt after a fresh checkout or frontend change. Then open this `android/` directory in Android Studio with JDK 17 and Android SDK 35. The repository includes a Gradle 8.10.2 wrapper; `./gradlew :app:assembleDebug` (or `gradlew.bat :app:assembleDebug` on Windows) builds the debug APK.

The Android SDK is intentionally not committed. The verified local build used SDK platform 35, JDK 17, and Gradle 8.10.2. If Maven Central is unavailable in your network, the project also lists the Aliyun public mirror in `settings.gradle.kts`.

## Signed releases

From v0.1.4-alpha, releases use one persistent signing key. The public certificate SHA-256 is pinned in `release-certificate.sha256`; the private keystore and passwords are stored in GitHub Actions secrets, never in this repository. Preserve the signing key for future updates. Debug builds use `hk.my.myhku.debug` so new development installs do not conflict with the release package `hk.my.myhku`.

Set `MYHKU_ANDROID_KEYSTORE_PATH`, `MYHKU_ANDROID_KEY_ALIAS`, `MYHKU_ANDROID_KEYSTORE_PASSWORD`, and `MYHKU_ANDROID_KEY_PASSWORD` before running `./gradlew :app:assembleRelease :app:bundleRelease`. Missing signing configuration fails the build instead of producing an unsigned release APK. CI restores the same keystore from `MYHKU_ANDROID_KEYSTORE_BASE64` and publishes only the verified `app-release.apk`, signed AAB, and public certificate digest.

CI verifies APK signatures, the pinned certificate, package ID, version, minimum SDK, non-debuggable status, ZIP alignment, and the AAB signing identity. It then installs and starts the actual APK on API 26 and API 35 emulators and verifies replacement of an older APK signed with the same key. A failed check prevents publication. The older APK is only a test fixture and is never uploaded to the release.

Old v0.1.1/v0.1.2 debug builds used ephemeral runner keys and cannot be upgraded with the new signing identity. Users who installed them need to preserve any required local data before uninstalling that old test build once. Subsequent releases retain the new certificate and increase `versionCode`. The public download guide explains this migration.

## Branding and agreements

The app uses adaptive launcher artwork derived from the MyHKU book/M/star identity. Before creating either WebView, a native screen presents all three bundled agreements and requires separate confirmations. The agreement version and acceptance time persist in app-private preferences; upgrades retain them, and a new agreement version requires consent again. The dashboard Settings page provides the same documents for review. The release version and monotonically increasing `androidVersionCode` come from the root `package.json`. CI downloads the actual v0.2.0-alpha APK as its upgrade baseline.
