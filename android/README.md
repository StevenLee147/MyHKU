# MyHKU Android host

This module is the Android WebView adapter for the MyHKU dashboard. It loads the official HKU Moodle and Student Portal pages, so the first login and MFA are completed by HKU's own UI. Android WebView persists its cookie store between launches; the app never reads, exports, or logs cookies, passwords, tokens, or authorization headers.

The app refreshes the current page when it returns to the foreground and exposes a manual `刷新` button. It does not run background polling. A read-only JavaScript interface extracts normalized course, schedule, assignment, resource, announcement, and grade candidates from visible Moodle/SIS DOM fields. The shared React dashboard is copied into `app/src/main/assets/dashboard-app` by the root `npm run build`; it reads the native snapshot through the `myhkuAndroid` bridge. The latest normalized payload is stored only when AndroidX `EncryptedSharedPreferences` can use the Android Keystore; otherwise it remains memory-only.

## Build

First run `npm ci` and `npm run build` from the repository root to generate the shared dashboard assets. These generated files are ignored by Git and must be rebuilt after a fresh checkout or frontend change. Then open this `android/` directory in Android Studio with JDK 17 and Android SDK 35. The repository includes a Gradle 8.10.2 wrapper; `./gradlew :app:assembleDebug` (or `gradlew.bat :app:assembleDebug` on Windows) builds the debug APK.

The Android SDK is intentionally not committed. The verified local build used SDK platform 35, JDK 17, and Gradle 8.10.2. If Maven Central is unavailable in your network, the project also lists the Aliyun public mirror in `settings.gradle.kts`.
