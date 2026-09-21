#!/usr/bin/env bash
set -euo pipefail

release_apk=$1
baseline_apk=$2
expected_code=$3
package_name=hk.my.myhku

adb wait-for-device
# The emulator starts empty. Test both a fresh install and a real package
# replacement using an older version signed with the same persistent key.
adb install "$release_apk"
adb uninstall "$package_name"
adb install "$baseline_apk"
adb install -r "$release_apk"
package_info=$(adb shell dumpsys package "$package_name" | tr -d '\r')
if ! [[ "$package_info" =~ versionCode=$expected_code[[:space:]] ]]; then
  echo 'Installed Android version does not match the release.' >&2
  exit 1
fi
adb shell am start -W -n "$package_name/.MainActivity"
sleep 3
if ! adb shell pidof "$package_name"; then
  adb logcat -d -b crash
  echo 'The installed Android app did not remain running.' >&2
  exit 1
fi
echo 'Verified fresh APK install, signed upgrade, package version and app launch.'
