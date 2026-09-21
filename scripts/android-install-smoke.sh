#!/usr/bin/env bash
set -euo pipefail

release_apk=$1
baseline_apk=$2
expected_code=$3
package_name=hk.my.myhku
diagnostics_dir="release/android-install-diagnostics/${4:-device}"
mkdir -p "$diagnostics_dir"

collect_diagnostics() {
  result=$?
  if [[ $result -ne 0 ]]; then
    set +e
    timeout 15s adb logcat -d -v threadtime -t 300 > "$diagnostics_dir/logcat.txt" 2>&1
    timeout 15s adb shell dumpsys activity activities > "$diagnostics_dir/activities.txt" 2>&1
    timeout 15s adb shell dumpsys activity lastanr > "$diagnostics_dir/last-anr.txt" 2>&1
    timeout 15s adb exec-out screencap -p > "$diagnostics_dir/screen.png"
    cat "$diagnostics_dir/launch.txt" "$diagnostics_dir/last-anr.txt" "$diagnostics_dir/logcat.txt"
  fi
  exit "$result"
}
trap collect_diagnostics EXIT

timeout 60s adb wait-for-device
# The emulator starts empty. Test both a fresh install and a real package
# replacement using an older version signed with the same persistent key.
timeout 120s adb install "$release_apk"
timeout 30s adb uninstall "$package_name"
timeout 120s adb install "$baseline_apk"
timeout 120s adb install -r "$release_apk"
package_info=$(timeout 30s adb shell dumpsys package "$package_name" | tr -d '\r')
if ! [[ "$package_info" =~ versionCode=$expected_code[[:space:]] ]]; then
  echo 'Installed Android version does not match the release.' >&2
  exit 1
fi
timeout 90s adb shell am start -W -n "$package_name/.MainActivity" | tee "$diagnostics_dir/launch.txt"
if ! grep -q '^Status: ok' "$diagnostics_dir/launch.txt"; then
  echo 'Android did not confirm a successful activity launch.' >&2
  exit 1
fi
sleep 3
if ! timeout 15s adb shell pidof "$package_name"; then
  echo 'The installed Android app did not remain running.' >&2
  exit 1
fi
echo 'Verified fresh APK install, signed upgrade, package version and app launch.'
