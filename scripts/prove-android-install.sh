#!/usr/bin/env bash
set -euo pipefail

readonly package_name="com.lateefrazaqoyetola.snapebtwictracker.qa"
readonly apk_path="dist/grocery-benefits-tracker-qa.apk"

if [[ ! -f "$apk_path" ]]; then
  echo "QA APK is missing: $apk_path" >&2
  exit 1
fi
if [[ ! "${ANDROID_VERSION_CODE:-}" =~ ^[1-9][0-9]*$ ]]; then
  echo "ANDROID_VERSION_CODE is missing or invalid." >&2
  exit 1
fi

adb devices -l
adb install --no-streaming -r "$apk_path"

installed_path="$(adb shell pm path "$package_name" | tr -d '\r')"
if [[ "$installed_path" != package:* ]]; then
  echo "QA package was not installed: $installed_path" >&2
  exit 1
fi

adb shell dumpsys package "$package_name" \
  | grep -F "versionCode=${ANDROID_VERSION_CODE}"
